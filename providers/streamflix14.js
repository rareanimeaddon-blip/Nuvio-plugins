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



// StreamFlix scraper for Nuvio
// v1.0.17 (2026-11-25): episode pick by NUMBER, not by index (gate-audit-36
// fix). getEpisodes now maps episodes by their episode NUMBER as written in
// the data (SxxExx in the link, "Episode N", NxNN, leading "N." in the name,
// or an explicit numeric episode field) and finish() takes only
// episodes[episodeNum] — no episodes[episodeNum - 1] positional pick and no
// neighbouring-index fallback, so an unnumbered / missing episode returns 0
// instead of the wrong episode. Title lookup (TMDB-id keyed), season
// handling, v4 formatter, addon subtitle attach, v5 prelude + postlude v2
// all unchanged from v1.0.16.
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: StreamFlix provider (api.streamflix.app data.json + CDN bases)

var API_BASE = "https://api.streamflix.app";
var API2_BASE = "https://api2.streamflix.app";
var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var CONFIG_URLS = [
  API_BASE + "/config/config-streamflix2.json",
  API_BASE + "/config/config-streamflixapp.json",
];
var FALLBACK_BASES = ["https://stream.streamflixserver.site/"];

var DATA_TTL = 30 * 60 * 1000;
var CONFIG_TTL = 5 * 60 * 1000;
var EPISODES_TTL = 60 * 60 * 1000;
var PROBE_TTL = 10 * 60 * 1000;

var DATA_INDEX_URL = "https://raw.githubusercontent.com/rareanimeaddon-blip/Nuvio-plugins/refs/heads/main/streamflix-data/index.json";
var DATA_CHUNK_BASE = "https://raw.githubusercontent.com/rareanimeaddon-blip/Nuvio-plugins/refs/heads/main/streamflix-data/";

var dataCache = null;
var indexCache = null;
var basesCache = null;
var episodesCache = {};
var probeCache = {};

var REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36",
  Accept: "application/json, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request. (The old Promise.race
  // against a setTimeout promise rejected every call on TV, where
  // setTimeout does not exist - the provider returned [] in 0.0s
  // while every network fetch actually succeeded.)
  return fetch(url, options || {});
}

function getJson(url, timeoutMs) {
  return fetchWithTimeout(url, { headers: REQUEST_HEADERS }, timeoutMs).then(function (response) {
    if (!response.ok) throw new Error("Upstream request failed: " + response.status + " " + url);
    return response.json();
  });
}

function getDataText() {
  if (dataCache && Date.now() - dataCache.ts < DATA_TTL) return Promise.resolve(dataCache.text);
  // Fallback only: full 3.7MB catalog (slow/heavy in Nuvio - used when the
  // title is missing from the pre-split chunks, e.g. brand-new additions).
  return fetchWithTimeout(API_BASE + "/data.json", { headers: REQUEST_HEADERS }, 25000).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.text();
  }).then(function (text) {
    dataCache = { text: text, ts: Date.now() };
    return text;
  });
}

// Fast path: index (2.7KB) -> one chunk (~69KB) instead of the 3.7MB file.
function findItemChunked(tmdbId, wantTv) {
  var indexP = (indexCache && Date.now() - indexCache.ts < DATA_TTL)
    ? Promise.resolve(indexCache.index)
    : getJson(DATA_INDEX_URL, 8000).then(function (index) {
        indexCache = { index: index, ts: Date.now() };
        return index;
      });
  return indexP.then(function (index) {
    var num = parseInt(tmdbId, 10);
    if (!isFinite(num) || !index || !index.length) return null;
    var file = null;
    for (var i = 0; i < index.length; i++) {
      if (num >= index[i].min && num <= index[i].max) { file = index[i].file; break; }
    }
    if (!file) return null;
    return getJson(DATA_CHUNK_BASE + file, 8000).then(function (items) {
      var fallback = null;
      for (var j = 0; j < items.length; j++) {
        if (String(items[j].tmdb) === String(tmdbId)) {
          if (!!items[j].isTV === !!wantTv) return items[j];
          if (!fallback) fallback = items[j];
        }
      }
      return fallback;
    });
  }).catch(function () { return null; });
}

// Extract the single data object whose "tmdb" matches, by locating the
// needle and brace-matching its enclosing object. Parses ~1KB, not 3.7MB.
function extractItem(text, tmdbId, wantTv) {
  var needles = ['"tmdb":"' + tmdbId + '"', '"tmdb":' + tmdbId + ','];
  var fallback = null;
  for (var n = 0; n < needles.length; n++) {
    var searchFrom = 0;
    while (true) {
      var idx = text.indexOf(needles[n], searchFrom);
      if (idx === -1) break;
      var start = text.lastIndexOf('{', idx);
      if (start === -1) break;
      var depth = 0, inStr = false, esc = false, end = -1;
      for (var i = start; i < text.length; i++) {
        var c = text.charAt(i);
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) break;
      var obj = null;
      try { obj = JSON.parse(text.slice(start, end + 1)); } catch (e) { obj = null; }
      if (obj && String(obj.tmdb) === String(tmdbId)) {
        if (!!obj.isTV === !!wantTv) return obj;
        if (!fallback) fallback = obj;
      }
      searchFrom = idx + needles[n].length;
    }
    if (fallback) break;
  }
  return fallback;
}

function normalizeBase(base) {
  var value = (base || "").trim();
  if (!value || !/^https?:\/\//i.test(value)) return null;
  return value.endsWith("/") ? value : value + "/";
}

function getBases() {
  if (basesCache && Date.now() - basesCache.ts < CONFIG_TTL) return Promise.resolve(basesCache.bases);
  var bases = [];
  var chain = Promise.resolve();
  CONFIG_URLS.forEach(function (url) {
    chain = chain.then(function () {
      return getJson(url, 8000).then(function (config) {
        [config.download, config.movies, config.tv, config.premium].forEach(function (list) {
          (list || []).forEach(function (entry) {
            var n = normalizeBase(entry);
            if (n && bases.indexOf(n) === -1) bases.push(n);
          });
        });
      }).catch(function () { /* config unreachable, try next */ });
    });
  });
  return chain.then(function () {
    FALLBACK_BASES.forEach(function (f) {
      var n = normalizeBase(f);
      if (n && bases.indexOf(n) === -1) bases.push(n);
    });
    basesCache = { bases: bases, ts: Date.now() };
    return bases;
  });
}

function probe(url) {
  var host;
  try { host = new URL(url).host; } catch (e) { return Promise.resolve(false); }
  var cached = probeCache[host];
  if (cached && Date.now() - cached.ts < PROBE_TTL) return Promise.resolve(cached.ok);
  var headers = Object.assign({}, REQUEST_HEADERS, { Range: "bytes=0-1" });
  return fetchWithTimeout(url, { method: "GET", headers: headers }, 8000).then(function (response) {
    var ok = response.status === 200 || response.status === 206;
    if (response.body && response.body.cancel) { try { response.body.cancel(); } catch (e) {} }
    probeCache[host] = { ok: ok, ts: Date.now() };
    return ok;
  }).catch(function () {
    probeCache[host] = { ok: false, ts: Date.now() };
    return false;
  });
}

function filterPlayable(urls) {
  return Promise.all(urls.map(function (url) {
    return probe(url).then(function (ok) { return ok ? url : null; });
  })).then(function (results) {
    return results.filter(function (u) { return u !== null; });
  });
}

function subtitleHint(filename) {
  var v = (filename || "").toLowerCase();
  return (v.indexOf("esub") !== -1 || v.indexOf(".srt") !== -1 || v.indexOf(".ass") !== -1 || v.indexOf("sub") !== -1)
    ? " [Embedded Subs]" : "";
}

function serverName(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ""); } catch (e) { return "CDN"; }
}

function qualityFromLabel(label) {
  var m = /(\d{3,4})p/i.exec(label || "");
  return m ? m[1] + "p" : "Unknown";
}

function buildStreams(urls, mediaTitle, subs, isSeries, season, episode) {
  return urls.map(function (url, index) {
    var srv = serverName(url);
    var ex = [];
    if (index > 0) ex.push("Mirror " + index);
    if (subs && String(subs).trim()) ex.push("Embedded Subs");
    var sfBody = formatStreamSize({ source: "StreamFlix", title: mediaTitle, quality: qualityFromLabel(url),
      season: isSeries ? season : undefined, episode: isSeries ? episode : undefined,
      extra: ex.length ? ex.join(" • ") : undefined, server: srv || undefined, url: url });
    return {
      name: "StreamFlix",
      title: "StreamFlix",
      url: url,
      quality: qualityFromLabel(url),
      _releaseTitle: mediaTitle + " " + qualityFromLabel(url),
      size: sfBody,
      type: "direct",
    };
  });
}

// Episode number extraction: match an episode by its NUMBER as written
// in the data — never by list position. Sources, in order:
//  1. an explicit numeric episode field (episode_number / episodeNumber /
//     episode / number), when present and a plain positive integer;
//  2. SxxExx in the link or name (season part must equal this season);
//  3. NxNN ("1x01") in the link or name (season part must equal this season);
//  4. "Episode N" / "Ep. N" in the name or link;
//  5. a leading "N." / "N -" / "N:" number in the name ("1. Pilot");
//  6. a standalone E01 in the link or name.
// The `key` field is deliberately NOT used: in the live data it is the
// 0-based list index (key 0 = episode 1), so key+1 would just be position
// again. If a link carries an SxxExx / NxNN whose season part does NOT
// match this season, the entry is misfiled under the wrong season and is
// skipped outright (null) rather than mapped under the other season's
// episode number. Entries with no extractable number are not mapped at
// all, so a requested episode with no numbered entry returns 0 —
// never a neighbouring episode.
function episodeNumberFrom(ep, season) {
  if (!ep) return null;
  var fields = ["episode_number", "episodeNumber", "episode", "number"];
  for (var f = 0; f < fields.length; f++) {
    var v = ep[fields[f]];
    if (v === undefined || v === null || v === "") continue;
    var vs = String(v).trim();
    if (!/^\d+$/.test(vs)) continue;
    var n = parseInt(vs, 10);
    if (isFinite(n) && n > 0 && n < 10000) return n;
  }
  var link = String(ep.link || "");
  var name = String(ep.name || ep.title || "");
  var i, m;
  // SxxExx — link first, then name.
  var seTexts = [link, name];
  for (i = 0; i < seTexts.length; i++) {
    m = /[Ss](\d+)[Ee](\d+)/.exec(seTexts[i]);
    if (m) {
      if (Number(m[1]) !== Number(season)) return null;
      return parseInt(m[2], 10);
    }
  }
  // NxNN — link first, then name.
  for (i = 0; i < seTexts.length; i++) {
    m = /(?:^|[^0-9a-zA-Z])(\d+)x(\d{1,3})(?:[^0-9]|$)/.exec(seTexts[i]);
    if (m) {
      if (Number(m[1]) !== Number(season)) return null;
      return parseInt(m[2], 10);
    }
  }
  // "Episode N" / "Ep. N" — name first, then link.
  var epTexts = [name, link];
  for (i = 0; i < epTexts.length; i++) {
    m = /(?:^|[^0-9A-Za-z])[Ee]p(?:isode)?[\s.\-_]*(\d{1,3})\b/.exec(epTexts[i]);
    if (m) return parseInt(m[1], 10);
  }
  // Leading "N." / "N -" / "N:" in the name ("1. Pilot").
  m = /^(\d{1,3})\s*[.\-–—:]\s/.exec(name);
  if (m) return parseInt(m[1], 10);
  // Standalone E01 — link first, then name.
  for (i = 0; i < seTexts.length; i++) {
    m = /(?:^|[^0-9A-Za-z])[Ee](\d{1,3})\b/.exec(seTexts[i]);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function getEpisodes(movieKey, season) {
  var cacheKey = movieKey + ":" + season;
  var cached = episodesCache[cacheKey];
  if (cached && Date.now() - cached.ts < EPISODES_TTL) return Promise.resolve(cached.episodes);
  // Series data moved to api2 (the old Firebase episodes DB is permission-locked).
  return getJson(API2_BASE + "/" + encodeURIComponent(movieKey), 10000)
    .then(function (raw) {
      // Map keyed by 1-based EPISODE NUMBER (episodeNumberFrom), never by
      // list position: an incomplete, out-of-order, or offset episode list
      // must not shift which episode a number resolves to.
      var episodes = {};
      var seasons = (raw && raw.data && raw.data.seasons) || [];
      for (var i = 0; i < seasons.length; i++) {
        if (Number(seasons[i].season) === Number(season)) {
          var list = seasons[i].episodes || [];
          list.forEach(function (ep) {
            var n = episodeNumberFrom(ep, season);
            // First numbered entry wins; a duplicate number never
            // overwrites the first match.
            if (n !== null && n !== undefined && episodes[n] === undefined) episodes[n] = ep;
          });
          break;
        }
      }
      episodesCache[cacheKey] = { episodes: episodes, ts: Date.now() };
      return episodes;
    });
}

// __STREAM_LABEL_FORMATTER__ v2: one-line emoji label for every stream.
// Movie:  🎬 <Title> • 📺 <Quality> • 🔊 <Audio> • 💬 <Subs> • 🖥️ <Provider> • 🗄️ <Server>
// Series: 🎬 <Title> • 📺 <Quality> • 📂 Season <N> • 🎞️ Episode <N> • 🔊 <Audio> • 💬 <Subs> • 🖥️ <Provider> • 🗄️ <Server>
// Segments with no data are omitted, except Quality (always shown, "Unknown" fallback).
// Server = explicit server label when the provider knows one, else the stream URL's hostname.
// Pure string work, no timers, no TextEncoder, no fetch. Never throws.
function formatStreamLabel(o) {
  try {
    o = o || {};
    var parts = [];
    function str(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
    function langName(v) {
      var k = str(v).toLowerCase();
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
      return str(v);
    }
    var title = str(o.title);
    if (title) parts.push("🎬 " + title);
    var q = str(o.quality);
    if (!q || q.toLowerCase() === "unknown") q = "Unknown";
    parts.push("📺 " + q);
    if (o.season !== undefined && o.season !== null && String(o.season) !== "") parts.push("📂 Season " + o.season);
    if (o.episode !== undefined && o.episode !== null && String(o.episode) !== "") parts.push("🎞️ Episode " + o.episode);
    var audio = o.audio;
    if (Array.isArray(audio)) audio = audio.filter(function (a) { return str(a); }).join(" / ");
    audio = str(audio);
    if (audio && audio.toLowerCase() !== "unknown") parts.push("🔊 " + audio);
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
      parts.push("💬 " + shown);
    }
    var size = str(o.size);
    if (size) parts.push("📦 " + size);
    var extra = str(o.extra);
    if (extra) parts.push(extra);
    var src = str(o.source) || str(o.provider);
    if (src) parts.push("🖥️ " + src);
    var server = str(o.server);
    if (!server && str(o.url)) {
      var h = str(o.url).split("/")[2] || "";
      server = h.replace(/^www\./, "");
    }
    if (server) parts.push("🗄️ " + server);
    return parts.join(" • ");
  } catch (e) {
    try { return (o && (o.source || o.provider) ? String(o.source || o.provider) : "Stream") + " • " + (o && o.quality ? String(o.quality) : "Unknown"); } catch (e2) { return "Stream"; }
  }
}

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

// ---- Infinite Subtitles attach helpers ----
// osCfg: subtitle keys from SCRAPER_SETTINGS (the addon block's token-file
// fallback covers the rest). tmdbImdbId: the addon is keyed by IMDb id;
// TMDB detail carries imdb_id for movies, external_ids for TV. Called only
// when rows exist, so a title with no streams costs no extra fetch.
function osCfg() {
  var s = (typeof SCRAPER_SETTINGS !== "undefined" && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS : {};
  return {
    osSubtitles: s.osSubtitles,
    subdlApiKey: s.subdlApiKey,
    subdlApiKey2: s.subdlApiKey2,
    wyzieApiKey: s.wyzieApiKey,
    wyzieApiKey2: s.wyzieApiKey2
  };
}
function tmdbImdbId(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + (kind === "tv" ? "/external_ids" : "") + "?api_key=" + TMDB_KEY;
  return function (u) { return fetchWithTimeout(u, {}, 10000).then(function (r) { return r.json(); }); }(url).then(function (j) { return (j && j.imdb_id) || ""; }).catch(function () { return ""; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  return Promise.all([findItemChunked(tmdbId, type === "series"), getBases()]).then(function (results) {
    var match = results[0], bases = results[1];
    if (match) return finish(match, bases, type, seasonNum, episodeNum);
    // Not in chunks (new title) -> fall back to the full catalog text
    return getDataText().then(function (text) {
      var m2 = extractItem(text, tmdbId, type === "series");
      return finish(m2, bases, type, seasonNum, episodeNum);
    });
  }).then(function (rows) {
    if (!rows || !rows.length) return rows;
    return tmdbImdbId(tmdbId, mediaType).then(function (imdb) { return osAttachSubtitles(rows, imdb, mediaType === "tv", seasonNum, episodeNum, osCfg()); });
  }).catch(function () { return []; });
}

function finish(match, bases, type, seasonNum, episodeNum) {
    if (!match || bases.length === 0) return [];
    var toUrls = function (link) {
      return bases.map(function (base) { return base + String(link).replace(/^\/+/, ""); });
    };
    if (type === "movie") {
      if (!match.movielink) return [];
      // Skip probe in Nuvio - return URLs directly (Nuvio handles playback)
      var urls = toUrls(match.movielink);
      if (!urls.length) return [];
      return buildStreams(urls, match.moviename, subtitleHint(match.movielink), false);
    }
    if (seasonNum == null || episodeNum == null) return [];
    return getEpisodes(match.moviekey, seasonNum).then(function (episodes) {
      // Match by episode NUMBER only. No positional pick and no
      // neighbouring-index fallback: if no entry carries this episode
      // number, the episode is not carried and this returns 0.
      var episodeData = episodes[episodeNum];
      if (!episodeData || !episodeData.link) return [];
      // Skip probe in Nuvio - return URLs directly
      var urls = toUrls(episodeData.link);
      if (!urls.length) return [];
      var label = match.moviename + " S" + seasonNum + "E" + episodeNum +
        (episodeData.name ? " | " + episodeData.name : "");
      return buildStreams(urls, match.moviename, subtitleHint(episodeData.link), true, seasonNum, episodeNum);
    }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
// Always set the global export too - Nuvio looks for global.getStreams
if (typeof global !== "undefined") {
  global.getStreams = getStreams;
  global.StreamFlixScraperModule = { getStreams: getStreams };
}

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
