/* __FETCH_RETRY_PRELUDE__ v5 (webOS TV): the TV plugin fetch service
   intermittently returns status-0 transport failures, sometimes in
   host-specific dead windows lasting tens of seconds. Wrap the global
   fetch: retry a rejection or status-0 up to 4 attempts with SHORT
   spin pauses (0.3/0.9/2s, ~3.2s span, no timers exist in the guest).
   Longer window-spanning is left to the chain-retry postlude, which
   re-runs the whole provider chain seconds later. v3's ~31s ladder
   blew the per-provider budget on long chains; v4's instant retries
   all landed inside dead windows and regressed medium chains. */
(function () {
  try {
    var cur = (typeof fetch !== "undefined") ? fetch : null;
    if (!cur || cur.__nuvioRetry) return;
    var raw = cur;
    var PAUSES = [300, 900, 2000];
    function spin(ms) { var t = Date.now(); while (Date.now() - t < ms) {} }
    var wrapped = function (url, opts) {
      var tries = 0;
      var attempt = function () {
        tries++;
        return raw(url, opts).then(function (r) {
          if (r && r.status === 0 && tries < 4) { spin(PAUSES[tries - 1]); return attempt(); }
          return r;
        }, function (e) {
          if (tries < 4) { spin(PAUSES[tries - 1]); return attempt(); }
          throw e;
        });
      };
      return attempt();
    };
    wrapped.__nuvioRetry = true;
    try { fetch = wrapped; } catch (e) {}
    if (typeof globalThis !== "undefined") { try { globalThis.fetch = wrapped; } catch (e) {} }
  } catch (e) {}
})();

/* 111477 v1.0.3 — Nuvio provider for a.111477.xyz (movies + TV), via the
   site's own Stremio addon with Gcore CDN.
   Chain: TMDB (title/year/imdb) -> the 111477 addon stream endpoint
   (st.111477.xyz, config = base a.111477.xyz + ::limit=2 + ::gcore=1)
   -> per-file workers.dev URLs (Gcore CDN edge) -> direct file.
   Why: the a. -> p. bulk worker route is blocked on the user's device
   (HTTP 403 on both WiFi and mobile data, latest version 1.2.275) and
   the sandbox gets 403 on the worker too. The Gcore URLs live on a
   different host with its own limits, so they bypass the p. worker and
   its 10 req/10s + 50-token pool entirely. The URLs are generated fresh
   per addon call (random workers.dev host + hash), so they cannot be
   built by hand — the provider must ask the addon each title open.
   Cost: 2 pool tokens per title open (limit=2). The sandbox gets 429
   "concurrency limit / captcha" on these URLs (datacenter IP); the
   device is the judge for playback.
   Exact by construction: the addon resolves by IMDb id, not by title
   search; TV rows are still filtered to the exact SxxExx episode.
   Never throws; [] on any failure. */

var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "";
var TMDB_BASE = "https://api.themoviedb.org/3";
var IDX_BASE = "https://a.111477.xyz";
var ADDON_CFG = "aHR0cHM6Ly9hLjExMTQ3Ny54eXovOjpsaW1pdD0yOjpnY29yZT0x"; // base64url of "https://a.111477.xyz/::limit=2::gcore=1"
var ADDON_STREAM = "https://st.111477.xyz/config/" + ADDON_CFG + "/stream/";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

function fetchJson(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (res) {
    if (!res || !res.ok) return null;
    return res.json().catch(function () { return null; });
  }).catch(function () { return null; });
}


// TMDB title + year + imdb_id + Latin-script alternative titles
// (shortest first, cap 4). Display + folder lookup only.
function fetchTmdb(tmdbId, mediaType) {
  var url = TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&append_to_response=external_ids,alternative_titles";
  return fetchJson(url, { "Accept": "application/json" }).then(function (data) {
    if (!data) return { title: null, year: "", imdbId: "", aliases: [] };
    var title = data.title || data.name || null;
    var date = data.release_date || data.first_air_date || "";
    var year = date ? String(date).slice(0, 4) : "";
    var imdbId = (data.external_ids && data.external_ids.imdb_id) || "";
    var raw = [];
    try {
      var at = data.alternative_titles || {};
      var list = at.titles || at.results || [];
      for (var i = 0; i < list.length; i++) {
        var t = list[i] && list[i].title;
        if (t) raw.push(String(t));
      }
    } catch (e) {}
    var aliases = [];
    for (var j = 0; j < raw.length; j++) {
      var a = raw[j].trim();
      if (!a || a === title) continue;
      if (/[^\x00-\x7F]/.test(a)) continue;
      if (aliases.indexOf(a) === -1) aliases.push(a);
    }
    aliases.sort(function (x, y) { return x.length - y.length; });
    aliases = aliases.slice(0, 4);
    return { title: title, year: year, imdbId: imdbId, aliases: aliases };
  }).catch(function () { return { title: null, year: "", imdbId: "", aliases: [] }; });
}

// Path-segment encoding matching the index's own links (%28/%29/%27).

// .mkv entries of a folder listing: [{name, url, size}]. Rows carry
// data-name / data-url attributes; size is the Size cell text.

// Subfolder entries of a listing: [{name, url}] (no .mkv).

function sizeBytes(s) {
  var m = String(s || "").match(/([\d.]+)\s*(GB|MB|KB|B)/i);
  if (!m) return 0;
  var mult = { GB: 1e9, MB: 1e6, KB: 1e3, B: 1 }[(m[2] || "B").toUpperCase()] || 1;
  return parseFloat(m[1]) * mult;
}

function qualityRank(q) {
  if (q === "2160p") return 4;
  if (q === "1080p") return 3;
  if (q === "720p") return 2;
  if (q === "480p") return 1;
  return 0;
}

// Quality / source / codec / audio from a release filename.
function qualityFrom(name) {
  var s = String(name || "");
  var q = "Unknown";
  if (/2160p/i.test(s)) q = "2160p";
  else if (/1080p/i.test(s)) q = "1080p";
  else if (/720p/i.test(s)) q = "720p";
  else if (/480p/i.test(s)) q = "480p";
  var src = "";
  if (/remux/i.test(s)) src = "BluRay REMUX";
  else if (/bluray|blu-ray/i.test(s)) src = "BluRay";
  else if (/web-?dl/i.test(s)) src = "WEB-DL";
  else if (/webrip/i.test(s)) src = "WEBRip";
  else if (/hdtv/i.test(s)) src = "HDTV";
  var codec = "";
  if (/x265|hevc|h\.?265/i.test(s)) codec = "x265";
  else if (/x264|avc|h\.?264/i.test(s)) codec = "x264";
  else if (/av1/i.test(s)) codec = "AV1";
  var audio = "";
  if (/atmos/i.test(s)) audio = "Atmos";
  else if (/truehd/i.test(s)) audio = "TrueHD";
  else if (/dts-?hd/i.test(s)) audio = "DTS-HD";
  else if (/dts/i.test(s)) audio = "DTS";
  else if (/ddp|dd\+/i.test(s)) audio = "DD+";
  else if (/eac3/i.test(s)) audio = "EAC3";
  else if (/ac3/i.test(s)) audio = "AC3";
  return { quality: q, source: src, codec: codec, audio: audio };
}

// Episode number match: SxxExx first (season checked), then a bare
// E-number (the folder is already the right season).
function episodeMatch(name, season, episode) {
  var m = String(name || "").match(/S(\d+)E(\d+)/i);
  if (m) return parseInt(m[1], 10) === season && parseInt(m[2], 10) === episode;
  var m2 = String(name || "").match(/(?:^|[^A-Za-z0-9])E(\d{1,2})(?:[^0-9]|$)/);
  if (m2) return parseInt(m2[1], 10) === episode;
  return false;
}

function sortFiles(files) {
  var ranked = files.map(function (f) {
    var q = qualityFrom(f.name);
    return { f: f, q: q, rank: qualityRank(q.quality), bytes: sizeBytes(f.size) };
  });
  ranked.sort(function (a, b) {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return b.bytes - a.bytes;
  });
  return ranked;
}

function makeRow(file, q, d, mediaType, season, episode) {
  var audioParts = [];
  if (q.source) audioParts.push(q.source);
  if (q.codec) audioParts.push(q.codec);
  if (q.audio) audioParts.push(q.audio);
  var label = formatStreamSize({
    title: d.title,
    year: d.year,
    quality: q.quality,
    season: mediaType === "tv" ? season : undefined,
    episode: mediaType === "tv" ? episode : undefined,
    audio: audioParts.length ? audioParts : undefined,
    size: file.size,
    server: "111477",
    url: file.url
  });
  var headers = { "Referer": IDX_BASE + "/", "User-Agent": UA };
  return {
    name: "111477",
    title: "111477",
    size: label,
    url: file.url,
    quality: q.quality,
    type: "direct",
    headers: headers,
    behaviorHints: { proxyHeaders: { request: headers } },
    _releaseTitle: file.name.replace(/\.mkv$/i, "")
  };
}

function attachRows(rows, d, mediaType, season, episode) {
  if (!rows.length) return Promise.resolve(rows);
  var cfg = {};
  try {
    var s = (typeof SCRAPER_SETTINGS !== "undefined" && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS : {};
    cfg = {
      osSubtitles: s.osSubtitles,
      subdlApiKey: s.subdlApiKey,
      subdlApiKey2: s.subdlApiKey2,
      wyzieApiKey: s.wyzieApiKey,
      wyzieApiKey2: s.wyzieApiKey2,
      year: d.year || 0
    };
  } catch (e) {}
  return osAttachSubtitles(rows, d.imdbId || "", mediaType === "tv", mediaType === "tv" ? season : undefined, mediaType === "tv" ? episode : undefined, cfg);
}

// Movies: try folders in order (canonical title + year, then year ±1,
// then aliases). First folder with .mkv files wins.
// One addon call per title (limit=2 -> 2 rows, 2 pool tokens).
// The addon resolves the IMDb id to files and returns per-file
// workers.dev (Gcore) URLs. TV rows are filtered to the exact episode.
function tryAddonStreams(d, mediaType, season, episode) {
  if (!d.imdbId) return Promise.resolve([]);
  var imdb = d.imdbId.indexOf("tt") === 0 ? d.imdbId : "tt" + d.imdbId; // TMDB imdb_id already carries the "tt" prefix
  var path = mediaType === "movie"
    ? "movie/" + imdb + ".json"
    : "series/" + imdb + ":" + season + ":" + episode + ".json";
  return fetchJson(ADDON_STREAM + path, { "User-Agent": UA, "Accept": "application/json" }).then(function (data) {
    if (!data || !data.streams || !data.streams.length) return [];
    var files = [];
    data.streams.forEach(function (s) {
      if (!s || !s.url || !s.title) return;
      var m = String(s.title).match(/^(.+?)\s*\[a11\s+([^\]]+)\]/);
      var name = m ? m[1] : String(s.title);
      var size = m ? m[2].trim() : "";
      if (mediaType === "tv" && !episodeMatch(name, season, episode)) return;
      files.push({ name: name, url: s.url, size: size });
    });
    if (!files.length) return [];
    var ranked = sortFiles(files).slice(0, 2);
    var rows = ranked.map(function (r) { return makeRow(r.f, r.q, d, mediaType, season, episode); });
    return attachRows(rows, d, mediaType, season, episode);
  }).catch(function () { return []; });
}


// TV: straight to /tvs/<Title>/Season N (or Specials for season 0) ->
// episode files. Skips the show-folder fetch: one less request per title
// against the site’s 10 req/10s burst budget. A 404 season folder means
// “not this title”, same as before.

// __STREAM_LABEL_FORMATTER__ v4 (size): user-spec body — heading is the provider name (in `name`), body is the essential info.
// Body lines: 🎬 Title [(Year)] | 📂 Season N • 🎞️ Episode N (series only) | 💎 Quality | ⏱️ Runtime | 🔊 Audio | 💾 File size | 🗄️ Server | 💬 Subtitles.
// Only lines with data are shown. Pure string work, no timers, no TextEncoder, no fetch. Never throws.
function formatStreamSize(o) {
  try {
    o = o || {};
    function str(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
    function langName(v) {
      var k = str(v).toLowerCase();
      var map = { en: "English", eng: "English", english: "English", hi: "Hindi", hin: "Hindi", hindi: "Hindi",
        es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", ru: "Russian",
        ar: "Arabic", bn: "Bengali", zh: "Chinese", ja: "Japanese", ko: "Korean", ta: "Tamil", te: "Telugu",
        ml: "Malayalam", mr: "Marathi", pa: "Punjabi", ur: "Urdu", id: "Indonesian", ms: "Malay",
        vi: "Vietnamese", th: "Thai", tl: "Filipino", nl: "Dutch", sv: "Swedish", da: "Danish",
        fi: "Finnish", no: "Norwegian", pl: "Polish", tr: "Turkish", uk: "Ukrainian", cs: "Czech",
        el: "Greek", he: "Hebrew", ro: "Romanian", hu: "Hungarian" };
      if (map[k]) return map[k];
      return str(v);
    }
    var lines = [];
    var title = str(o.title);
    if (title) {
      var t = "🎬 " + title;
      var year = str(o.year);
      if (year) t += " (" + year + ")";
      lines.push(t);
    }
    if (o.season !== undefined && o.season !== null && String(o.season) !== "" &&
        o.episode !== undefined && o.episode !== null && String(o.episode) !== "")
      lines.push("📂 Season " + o.season + " • 🎞️ Episode " + o.episode);
    var q = str(o.quality);
    if (q && q.toLowerCase() !== "unknown") lines.push("💎 " + q);
    var rt = o.runtime;
    var rtMin = 0;
    if (typeof rt === "number" && rt > 0) rtMin = Math.round(rt);
    else if (typeof rt === "string" && /^\d+$/.test(rt.trim())) rtMin = parseInt(rt.trim(), 10);
    if (rtMin > 0) {
      var rh = Math.floor(rtMin / 60), rm = rtMin % 60;
      lines.push("⏱️ " + (rh > 0 ? rh + "h " + (rm < 10 ? "0" : "") + rm + "m" : rm + "m"));
    }
    var audio = o.audio;
    if (Array.isArray(audio)) audio = audio.filter(function (a) { return str(a); }).join(" / ");
    audio = str(audio);
    if (audio && audio.toLowerCase() !== "unknown") lines.push("🔊 " + audio);
    var size = str(o.size);
    if (size) lines.push("💾 " + size);
    var server = str(o.server);
    if (!server && str(o.url)) {
      var h = str(o.url).split("/")[2] || "";
      server = h.replace(/^www\./, "");
    }
    if (server) lines.push("🗄️ " + server);
    var subs = o.subtitles;
    var langs = [];
    if (Array.isArray(subs)) {
      for (var i = 0; i < subs.length; i++) {
        var lg = (subs[i] && typeof subs[i] === "object") ? (subs[i].language || subs[i].name) : subs[i];
        lg = langName(lg);
        if (lg && langs.indexOf(lg) === -1) langs.push(lg);
      }
    } else if (typeof subs === "string" && str(subs)) { langs = [langName(subs)]; }
    if (langs.length) {
      var shown = langs.slice(0, 3).join(", ");
      if (langs.length > 3) shown += " +" + (langs.length - 3) + " more";
      lines.push("💬 " + shown);
    }
    return lines.join("\n");
  } catch (e) { return ""; }
}


// Secret gist holding the user's tokens (same file the showbox/gramcinema
// tokens live in). SCRAPER_SETTINGS always wins; the gist is only read when
// a key is missing from settings. The keys are never in the repo.
var TOKEN_FILE_URL = 'https://gist.githubusercontent.com/rareanimeaddon-blip/6fc363ac74cb8921d61c07a2c6bb59d6/raw/gistfile1.txt';
var _fileTokens = null;
var _fileTokensPromise = null;
function loadTokenFile() {
  if (_fileTokens) return Promise.resolve(_fileTokens);
  if (_fileTokensPromise) return _fileTokensPromise;
  if (!TOKEN_FILE_URL) { _fileTokens = {}; return Promise.resolve(_fileTokens); }
  try {
    _fileTokensPromise = fetch(TOKEN_FILE_URL).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (j) { _fileTokens = j || {}; return _fileTokens; }).catch(function () { _fileTokens = {}; return _fileTokens; });
  } catch (e) { _fileTokens = {}; return Promise.resolve(_fileTokens); }
  return _fileTokensPromise;
}
function _setting(cfg, key) {
  try {
    if (cfg && cfg[key]) return String(cfg[key]).trim();
  } catch (e) {}
  return '';
}
function getSubdlKeys(cfg) {
  var k1 = _setting(cfg, 'subdlApiKey');
  var k2 = _setting(cfg, 'subdlApiKey2');
  if (k1 && k2) return Promise.resolve([k1, k2]);
  return loadTokenFile().then(function (t) {
    if (!k1) { try { if (t && t.subdlApiKey) k1 = String(t.subdlApiKey).trim(); } catch (e) {} }
    if (!k2) { try { if (t && t.subdlApiKey2) k2 = String(t.subdlApiKey2).trim(); } catch (e) {} }
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  }).catch(function () {
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  });
}
function getWyzieKeys(cfg) {
  var k1 = _setting(cfg, 'wyzieApiKey');
  var k2 = _setting(cfg, 'wyzieApiKey2');
  if (k1 && k2) return Promise.resolve([k1, k2]);
  return loadTokenFile().then(function (t) {
    if (!k1) { try { if (t && t.wyzieApiKey) k1 = String(t.wyzieApiKey).trim(); } catch (e) {} }
    if (!k2) { try { if (t && t.wyzieApiKey2) k2 = String(t.wyzieApiKey2).trim(); } catch (e) {} }
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  }).catch(function () {
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  });
}
// ---- Subtitle addon (Infinite Streams Subtitles, Cloudflare Worker) ----
// The provider asks the addon for this title's subtitles instead of
// calling SubDL/Wyzie/mirror directly. The addon returns its ranked list
// (Sunsync pre-synced first, then SubDL, Wyzie, mirror); the provider
// picks the best match per row with the existing token scorer, so each
// stream carries the subtitle that fits its own release. The addon needs
// the user's keys in the URL config to return SubDL/Wyzie results —
// without them it returns Sunsync + mirror only. Pure-JS base64url
// (no Buffer/btoa in the TV guest); keys are ASCII so one char = one byte.
var ADDON_BASE = 'https://infinite-subtitles.teghvirsingh-work.workers.dev';
function b64urlEncodeAscii(str) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  for (var i = 0; i < str.length; i += 3) {
    var c1 = str.charCodeAt(i) & 255;
    var c2 = (i + 1 < str.length) ? str.charCodeAt(i + 1) & 255 : NaN;
    var c3 = (i + 2 < str.length) ? str.charCodeAt(i + 2) & 255 : NaN;
    var n = (c1 << 16) | ((isNaN(c2) ? 0 : c2) << 8) | (isNaN(c3) ? 0 : c3);
    out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63] + (isNaN(c2) ? '=' : chars[(n >>> 6) & 63]) + (isNaN(c3) ? '=' : chars[n & 63]);
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function addonConfigStr(sdKeys, wzKeys) {
  var o = {};
  if (sdKeys && sdKeys[0]) o.s = sdKeys[0];
  if (sdKeys && sdKeys[1] && sdKeys[1] !== sdKeys[0]) o.s2 = sdKeys[1];
  if (wzKeys && wzKeys[0]) o.w = wzKeys[0];
  if (wzKeys && wzKeys[1] && wzKeys[1] !== wzKeys[0]) o.w2 = wzKeys[1];
  var has = o.s || o.s2 || o.w || o.w2;
  if (!has) return '';
  return b64urlEncodeAscii(JSON.stringify(o));
}
// One addon call per title; returns the addon's ranked English subtitles
// as {id, url, release} for the per-row matcher. [] on any failure.
function addonSubs(imdbId, isSeries, season, episode, cfg) {
  return Promise.all([getSubdlKeys(cfg), getWyzieKeys(cfg)]).then(function (ks) {
    var cfgStr = addonConfigStr(ks[0], ks[1]);
    var path = isSeries
      ? '/subtitles/series/' + imdbId + ':' + season + ':' + episode + '.json'
      : '/subtitles/movie/' + imdbId + '.json';
    var url = ADDON_BASE + (cfgStr ? '/' + cfgStr : '') + path;
    return fetch(url).then(function (r) {
      if (!r.ok) return [];
      return r.json();
    }).then(function (j) {
      var list = (j && j.subtitles) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        var lang = String(it.lang || '').toLowerCase();
        if (lang !== 'en' && lang !== 'eng') continue;
        var u2 = it.url || '';
        if (u2.indexOf('https://') !== 0) continue;
        var rel = it.movieReleaseName || it.subtitleFileName || '';
        if (!rel) continue;
        out.push({ id: it.id, url: u2, release: rel });
      }
      return out;
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}
function osTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (t) { return t.length > 0; });
}
function osGroup(name) {
  var s = String(name || '');
  // Last parenthesised chunk that is NOT just a year (e.g. "(2026)") — the
  // year is not a release group, and treating it as one makes every
  // same-year release "match" (+4). Skip pure years / pure numbers.
  var groups = s.match(/\(([^)]+)\)/g) || [];
  for (var gi = groups.length - 1; gi >= 0; gi--) {
    var g = groups[gi].replace(/[()]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s*4khdhub\s*$/, '').trim();
    if (!g) continue;
    if (/^\d{4}$/.test(g) || /^\d+$/.test(g)) continue;
    return g;
  }
  var m = s.match(/[-.]([A-Za-z][A-Za-z0-9]{1,})\s*$/);
  if (m) return m[1].toLowerCase();
  return '';
}
function osReleaseFeatures(name) {
  var toks = osTokens(name);
  var set = {};
  for (var i = 0; i < toks.length; i++) set[toks[i]] = true;
  var squashed = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  var source = '';
  if (squashed.indexOf('bluray') !== -1) source = 'bluray';
  else if (squashed.indexOf('webdl') !== -1) source = 'webdl';
  else if (squashed.indexOf('webrip') !== -1) source = 'webrip';
  else if (squashed.indexOf('hdtv') !== -1) source = 'hdtv';
  else if (squashed.indexOf('dvdrip') !== -1) source = 'dvdrip';
  else if (set['ts'] || set['telesync'] || set['cam']) source = 'ts';
  return {
    group: osGroup(name),
    source: source,
    res: set['2160p'] ? '2160p' : set['1080p'] ? '1080p' : set['720p'] ? '720p' : set['480p'] ? '480p' : '',
    codec: (set['x265'] || set['hevc'] || squashed.indexOf('h265') !== -1) ? 'hevc' : (set['x264'] || set['avc'] || squashed.indexOf('h264') !== -1) ? 'avc' : '',
    imax: !!set['imax'],
    remux: !!set['remux']
  };
}
function osScore(fileF, subF) {
  var s = 0;
  if (fileF.group && subF.group && fileF.group === subF.group) s += 4;
  else if (fileF.group && subF.group) {
    var fg = fileF.group.split(' '), sg = subF.group.split(' ');
    for (var i = 0; i < fg.length; i++) { if (sg.indexOf(fg[i]) !== -1) { s += 2; break; } }
  }
  if (fileF.source && fileF.source === subF.source) s += 2;
  if (fileF.res && fileF.res === subF.res) s += 1;
  if (fileF.codec && fileF.codec === subF.codec) s += 1;
  if (fileF.imax && subF.imax) s += 1;
  if (fileF.remux && subF.remux) s += 1;
  return s;
}
function osBestMatch(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0, bestF = null;
  for (var k = 0; k < subs.length; k++) {
    var sf = osReleaseFeatures(subs[k].release);
    var sc = osScore(ff, sf);
    if (sc > bestScore) { bestScore = sc; best = subs[k]; bestF = sf; }
  }
  if (!best) return null;
  if (bestScore >= 4) return best;
  // CAM/TELESYNC releases carry no group and are often re-encoded, so
  // source+res is the whole signal: a same-resolution TS subtitle for a
  // TS file is the right class (the codec is only the re-encode, not
  // the timing). Accept that at 3; anything else still needs 4.
  if (bestScore === 3 && ff.source === 'ts' && bestF && bestF.source === 'ts' && ff.res && ff.res === bestF.res) return best;
  return null;
}
// Best subtitle by release fit, with no threshold — returns {sub, score}.
// Used as the fallback when osBestMatch finds nothing: the highest-scoring
// subtitle for this row's release (same resolution class at least) is
// far better than the addon's top-ranked one, which is ranked by source
// quality, not by how well it fits this row. A BluRay-synced subtitle on
// a CAM row scores 0 here and is never picked.
function osBestAny(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0;
  for (var k = 0; k < subs.length; k++) {
    var sf = osReleaseFeatures(subs[k].release);
    var sc = osScore(ff, sf);
    if (sc > bestScore) { bestScore = sc; best = subs[k]; }
  }
  if (!best) return null;
  return { sub: best, score: bestScore };
}
function osAttachSubtitles(rows, imdbId, isSeries, season, episode, cfg) {
  // Subtitles come ONLY from the Infinite Subtitles addon. One addon call
  // per title; the best subtitle for each row’s own release is attached
  // automatically. No direct SubDL/Wyzie/mirror calls from this provider.
  try {
    if (cfg && cfg.osSubtitles === false) return Promise.resolve(rows);
    if (!imdbId || !rows || !rows.length) return Promise.resolve(rows);
    var cleanup = function () {
      for (var c = 0; c < rows.length; c++) { try { delete rows[c]._rel; delete rows[c]._releaseTitle; } catch (e) {} }
      return rows;
    };
    var prep = function () {
      for (var i = 0; i < rows.length; i++) {
        var rel = rows[i]._releaseTitle || '';
        if (!rel && rows[i].url) {
          try { rel = decodeURIComponent(String(rows[i].url).split('/').pop() || '').replace(/.[^.]+$/, ''); } catch (e) {}
        }
        rows[i]._rel = rel;
      }
    };
    prep();
    return addonSubs(imdbId, isSeries, season, episode, cfg).then(function (adSubs) {
      for (var i = 0; i < rows.length; i++) {
        var hit = osBestMatch(rows[i]._rel, adSubs);
        if (!hit) {
          var any = osBestAny(rows[i]._rel, adSubs);
          if (any && any.score >= 1) hit = any.sub;
        }
        if (!hit && adSubs.length) {
          // No release fit at all (e.g. a 480p row when the addon only has
          // 1080p subtitles). The addon only returns subtitles for THIS
          // title, so the top-ranked non-Sunsync one is the right movie —
          // attach it, unless the row is a CAM/TS, where no proper-release
          // subtitle can match the recording's timing.
          var rl = (rows[i]._rel || '').toLowerCase();
          if (rl.indexOf('cam') === -1 && rl.indexOf('ts') === -1) {
            for (var k = 0; k < adSubs.length; k++) {
              var cand = adSubs[k];
              var cid = String(cand.id || '').toLowerCase();
              var crel = String(cand.release || '').toLowerCase();
              if (cid.indexOf('sunsync') === -1 && crel.indexOf('sunsync') === -1) { hit = cand; break; }
            }
          }
        }
        if (hit) rows[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
      }
      return cleanup();
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

function getStreams(tmdbId, mediaType, season, episode) {
  try {
    tmdbId = String(tmdbId);
    mediaType = mediaType === "tv" ? "tv" : "movie";
    if (season !== null && season !== undefined && season !== "") season = Number(season);
    else season = null;
    if (episode !== null && episode !== undefined && episode !== "") episode = Number(episode);
    else episode = null;
    if (isNaN(season)) season = null;
    if (isNaN(episode)) episode = null;
    if (mediaType === "tv" && (season === null || episode === null)) return Promise.resolve([]);

    return fetchTmdb(tmdbId, mediaType).then(function (d) {
      if (!d || !d.title || !d.imdbId) return [];
      return tryAddonStreams(d, mediaType, season, episode);
    }).catch(function () { return []; });
  } catch (e) {
    return Promise.resolve([]);
  }
}

var api = { getStreams: getStreams };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof global !== "undefined") { try { global.getStreams = getStreams; } catch (e) {} }
if (typeof self !== "undefined") { try { self.getStreams = getStreams; } catch (e) {} }

/* __CHAIN_RETRY_POSTLUDE__ v2: in a full TV search, providers die when
   the fetch service drops a hop or sits in a dead window. If a chain
   comes back empty, re-run it - the re-run is naturally spaced by the
   first attempt's own duration, which spans the short windows. Up to
   3 attempts, gated on total elapsed (<20s for #2, <38s for #3) so a
   slow provider never overruns the app budget. */
(function () {
  try {
    var g = (typeof globalThis !== "undefined") ? globalThis : null;
    var orig = null;
    if (typeof module !== "undefined" && module.exports && typeof module.exports.getStreams === "function") orig = module.exports.getStreams;
    else if (g && typeof g.getStreams === "function") orig = g.getStreams;
    if (!orig || orig.__chainRetry) return;
    var wrapped = function () {
      var args = arguments;
      var t0 = Date.now();
      var tries = 0;
      var run = function () {
        tries++;
        return Promise.resolve().then(function () { return orig.apply(null, args); }).then(function (res) {
          var el = Date.now() - t0;
          if (Array.isArray(res) && res.length === 0 && ((tries === 1 && el < 20000) || (tries === 2 && el < 38000))) return run();
          return res;
        }, function () {
          var el = Date.now() - t0;
          if ((tries === 1 && el < 20000) || (tries === 2 && el < 38000)) return run();
          return [];
        });
      };
      return run();
    };
    wrapped.__chainRetry = true;
    if (typeof module !== "undefined" && module.exports) module.exports.getStreams = wrapped;
    if (g) { try { g.getStreams = wrapped; } catch (e) {} }
  } catch (e) {}
})();
