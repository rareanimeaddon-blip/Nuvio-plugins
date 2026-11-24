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


/* VideoAPI v1.0.0 — Nuvio provider for videoapi.la (movies + TV).
   Converted from a user-supplied Nuvio-style file.
   Chain: GET https://videoapi.la/e/movie/<tmdb> (TV: /e/tv/<tmdb>/<s>/<e>)
     -> page contains https://vimeos.net/embed-<id>.html?cf=<JWT>
     -> GET the vimeos embed (Referer = videoapi page)
     -> direct .m3u8 master on *.vimeos.zip / *.vimeos.net
        (/hls2/.../master.m3u8, signed ~12h expiry).
   The master playlist is fetched to read best resolution + audio tracks;
   subtitle .vtt files on the same host are attached when found.
   No search/matching: the TMDB id IS the key in the URL, so there is no
   title-mismatch risk. TMDB is fetched for display title/year + imdb_id
   (addon subtitles) only. The public /api/v1/public/embed endpoint only
   returns an IFRAME and is NOT used.
   Changes vs the supplied file: fetchWithTimeout/AbortController/setTimeout
   removed (v5 fetch-retry prelude instead, no timers anywhere); TMDB key
   via the bare global with fallback (no local shadowing); v2 one-line
   label -> v4 multi-line (formatStreamSize); Infinite Subtitles addon
   attach (osAttachSubtitles); chain-retry postlude v2.
   Never throws; returns [] on any failure. */

var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "d80ba92bc7cefe3359668d30d06f3305";
var TMDB_BASE = "https://api.themoviedb.org/3";
var VIDEOAPI_BASE = "https://videoapi.la";
var VIMEOS_REFERER = "https://vimeos.net/";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

// Language code -> display name (2- and 3-letter codes; the vimeos .vtt
// files use 3-letter codes like spa/eng).
function langName(v) {
  var s = (v === undefined || v === null) ? "" : String(v).trim();
  var k = s.toLowerCase();
  var map = { en: "English", eng: "English", english: "English", hi: "Hindi", hin: "Hindi", hindi: "Hindi",
          es: "Spanish", spa: "Spanish", fr: "French", fre: "French", fra: "French", de: "German", ger: "German", deu: "German",
          it: "Italian", ita: "Italian", pt: "Portuguese", por: "Portuguese", ru: "Russian", rus: "Russian",
          ar: "Arabic", ara: "Arabic", bn: "Bengali", ben: "Bengali", zh: "Chinese", chi: "Chinese", zho: "Chinese",
          ja: "Japanese", jpn: "Japanese", ko: "Korean", kor: "Korean", ta: "Tamil", tam: "Tamil", te: "Telugu", tel: "Telugu",
          ml: "Malayalam", mal: "Malayalam", mr: "Marathi", mar: "Marathi", pa: "Punjabi", pan: "Punjabi",
          ur: "Urdu", urd: "Urdu", id: "Indonesian", ind: "Indonesian", ms: "Malay", msa: "Malay", vi: "Vietnamese",
          vie: "Vietnamese", th: "Thai", tha: "Thai", tl: "Filipino", fil: "Filipino", nl: "Dutch", nld: "Dutch",
          sv: "Swedish", swe: "Swedish", da: "Danish", dan: "Danish", fi: "Finnish", fin: "Finnish",
          no: "Norwegian", nor: "Norwegian", pl: "Polish", pol: "Polish", tr: "Turkish", tur: "Turkish",
          uk: "Ukrainian", ukr: "Ukrainian", cs: "Czech", ces: "Czech", cze: "Czech", el: "Greek", ell: "Greek",
          he: "Hebrew", heb: "Hebrew", ro: "Romanian", ron: "Romanian", rum: "Romanian", hu: "Hungarian", hun: "Hungarian", arabic: "Arabic", bengali: "Bengali", chinese: "Chinese", filipino: "Filipino", indonesian: "Indonesian", portuguese: "Portuguese", russian: "Russian", urdu: "Urdu", spanish: "Spanish", french: "French", german: "German", italian: "Italian", japanese: "Japanese", korean: "Korean", tamil: "Tamil", telugu: "Telugu", malayalam: "Malayalam", marathi: "Marathi", punjabi: "Punjabi", vietnamese: "Vietnamese", thai: "Thai", dutch: "Dutch", swedish: "Swedish", danish: "Danish", finnish: "Finnish", norwegian: "Norwegian", polish: "Polish", turkish: "Turkish", ukrainian: "Ukrainian", czech: "Czech", greek: "Greek", hebrew: "Hebrew", romanian: "Romanian", malay: "Malay" };
  if (map[k]) return map[k];
  return s;
}

// __STREAM_LABEL_FORMATTER__ v4 (size): user-spec body — heading is the provider name (in `name`), body is the essential info.
// Body lines: 🎬 Title [(Year)] | 📂 Season N • 🎞️ Episode N (series only) | 💎 Quality | ⏱️ Runtime | 🔊 Audio | 💾 File size | 🗄️ Server | 💬 Subtitles.
// Only lines with data are shown. Pure string work, no timers, no TextEncoder, no fetch. Never throws.
function formatStreamSize(o) {
  try {
    o = o || {};
    function str(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
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
  else if (set['ts'] || set['telesync']) source = 'ts';
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
  var best = null, bestScore = 0;
  for (var k = 0; k < subs.length; k++) {
    var sc = osScore(ff, osReleaseFeatures(subs[k].release));
    if (sc > bestScore) { bestScore = sc; best = subs[k]; }
  }
  return (best && bestScore >= 4) ? best : null;
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

function fetchJson(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (res) {
    if (!res || !res.ok) return null;
    return res.json().catch(function () { return null; });
  }).catch(function () { return null; });
}

function fetchText(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (res) {
    if (!res || !res.ok) return null;
    return res.text().catch(function () { return null; });
  }).catch(function () { return null; });
}

// TMDB title + year + imdb_id (display + addon subtitles). Display-only:
// the stream chain is keyed on the TMDB id in the URL, never on a search.
function fetchTmdbDetails(tmdbId, mediaType) {
  var url = TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&append_to_response=external_ids";
  return fetchJson(url, { "Accept": "application/json" }).then(function (data) {
    if (!data) return { title: null, year: "", imdbId: "" };
    var title = data.title || data.name || null;
    var date = data.release_date || data.first_air_date || "";
    var year = date ? String(date).slice(0, 4) : "";
    var imdbId = (data.external_ids && data.external_ids.imdb_id) || "";
    return { title: title, year: year, imdbId: imdbId };
  }).catch(function () { return { title: null, year: "", imdbId: "" }; });
}

// First vimeos embed URL in a VideoAPI page, or null.
function extractEmbedUrl(html) {
  if (!html) return null;
  var m = html.match(/https:\/\/[a-z0-9.-]*vimeos\.net\/embed-[a-z0-9]+\.html\?cf=[A-Za-z0-9._-]+/i);
  return m ? m[0] : null;
}

// First direct .m3u8 master URL in a vimeos player page, or null.
function extractM3u8(html) {
  if (!html) return null;
  var m = html.match(/https:\/\/[a-z0-9.-]*vimeos\.(?:zip|net)\/hls2\/[^"' \t\r\n]+\.m3u8[^"' \t\r\n]*/i);
  return m ? m[0] : null;
}

// Subtitle .vtt URLs on the same vimeos host: [{url, language}].
function extractSubtitles(html) {
  var out = [];
  if (!html) return out;
  var seen = {};
  var re = /https:\/\/[a-z0-9.-]*vimeos\.(?:zip|net)\/vtt\/[^"' \t\r\n]+\.vtt/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var url = m[0];
    if (seen[url]) continue;
    seen[url] = true;
    var lang = "Unknown";
    var lm = url.match(/_([a-z]{3})\.vtt$/i);
    if (lm) lang = lm[1];
    out.push({ url: url, language: lang });
  }
  return out;
}

// From a master playlist: best resolution height + audio track names.
function parseMaster(text) {
  var info = { quality: "Unknown", audio: [] };
  if (!text) return info;
  var maxH = 0;
  var re = /RESOLUTION=\d+x(\d+)/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var h = parseInt(m[1], 10);
    if (!isNaN(h) && h > maxH) maxH = h;
  }
  if (maxH >= 1080) info.quality = "1080p";
  else if (maxH >= 720) info.quality = "720p";
  else if (maxH >= 480) info.quality = "480p";
  else if (maxH > 0) info.quality = maxH + "p";
  var are = /#EXT-X-MEDIA:TYPE=AUDIO[^,\n]*,NAME="([^"]+)"[^,\n]*,LANGUAGE="([a-z]{2})"/g;
  while ((m = are.exec(text)) !== null) {
    var name = m[1];
    if (name && info.audio.indexOf(name) === -1) info.audio.push(name);
  }
  return info;
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

    var pageUrl;
    if (mediaType === "tv") {
      if (season === null || episode === null) return Promise.resolve([]);
      pageUrl = VIDEOAPI_BASE + "/e/tv/" + tmdbId + "/" + season + "/" + episode;
    } else {
      pageUrl = VIDEOAPI_BASE + "/e/movie/" + tmdbId;
    }

    var detailsPromise = fetchTmdbDetails(tmdbId, mediaType);
    var streamPromise = fetchText(pageUrl, {
      "User-Agent": UA,
      "Accept": "text/html",
      "Referer": VIDEOAPI_BASE + "/"
    }).then(function (pageHtml) {
      var embedUrl = extractEmbedUrl(pageHtml);
      if (!embedUrl) return null;
      return fetchText(embedUrl, {
        "User-Agent": UA,
        "Accept": "text/html",
        "Referer": pageUrl
      }).then(function (embedHtml) {
        var m3u8 = extractM3u8(embedHtml);
        if (!m3u8) return null;
        var subs = extractSubtitles(embedHtml);
        return fetchText(m3u8, {
          "User-Agent": UA,
          "Accept": "*/*",
          "Referer": VIMEOS_REFERER
        }).then(function (master) {
          var info = parseMaster(master);
          return { url: m3u8, quality: info.quality, audio: info.audio, subtitles: subs };
        }).catch(function () {
          return { url: m3u8, quality: "Unknown", audio: [], subtitles: subs };
        });
      });
    }).catch(function () { return null; });

    return Promise.all([detailsPromise, streamPromise]).then(function (results) {
      var details = results[0] || { title: null, year: "", imdbId: "" };
      var found = results[1];
      if (!found || !found.url) return [];
      var subs = [];
      for (var i = 0; i < found.subtitles.length; i++) {
        var code = String(found.subtitles[i].language || "Unknown");
        subs.push({ id: "videoapi-" + code.toLowerCase() + "-" + i, url: found.subtitles[i].url, lang: code.toLowerCase(), label: langName(code) });
      }
      var quality = found.quality;
      var label = formatStreamSize({
        title: details.title,
        year: details.year,
        quality: quality,
        season: mediaType === "tv" ? season : undefined,
        episode: mediaType === "tv" ? episode : undefined,
        audio: found.audio.length ? found.audio : undefined,
        subtitles: subs,
        source: "VideoAPI",
        server: "Vimeos",
        url: found.url
      });
      var streamHeaders = {
        "Referer": VIMEOS_REFERER,
        "User-Agent": UA
      };
      var stream = {
        name: "VideoAPI",
        title: "VideoAPI",
        size: label,
        url: found.url,
        quality: quality,
        type: "hls",
        headers: streamHeaders,
        behaviorHints: { proxyHeaders: { request: streamHeaders } },
        _releaseTitle: (details.title || "") + " " + (quality || "")
      };
      if (subs.length) stream.subtitles = subs;
      var rows = [stream];
      return osAttachSubtitles(rows, details.imdbId || "", mediaType === "tv", mediaType === "tv" ? season : undefined, mediaType === "tv" ? episode : undefined, {
        osSubtitles: (typeof SCRAPER_SETTINGS !== "undefined" && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
        subdlApiKey: (typeof SCRAPER_SETTINGS !== "undefined" && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
        subdlApiKey2: (typeof SCRAPER_SETTINGS !== "undefined" && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
        year: details.year || 0
      });
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
