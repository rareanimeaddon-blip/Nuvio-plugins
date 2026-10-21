/* __FETCH_RETRY_PRELUDE__ v4 (webOS TV): the TV plugin fetch service
   intermittently returns status-0 transport failures. Wrap the global
   fetch so a rejection or status-0 response is retried up to 3 attempts.
   NON-BLOCKING on purpose: earlier spin-wait pauses stalled the shared
   fetch path and multiplied every hang to ~31s, blowing the app's
   per-provider budget in full searches. Immediate promise retries cost
   nothing when the route is healthy and still rescue isolated drops. */
(function () {
  try {
    var cur = (typeof fetch !== "undefined") ? fetch : null;
    if (!cur || cur.__nuvioRetry) return;
    var raw = cur;
    var wrapped = function (url, opts) {
      var tries = 0;
      var attempt = function () {
        tries++;
        return raw(url, opts).then(function (r) {
          if (r && r.status === 0 && tries < 3) return attempt();
          return r;
        }, function (e) {
          if (tries < 3) return attempt();
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
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: StreamFlix provider (api.streamflix.app data.json + CDN bases)

var API_BASE = "https://api.streamflix.app";
var API2_BASE = "https://api2.streamflix.app";

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
  var timeout = timeoutMs || 15000;
  // AbortController removed for Nuvio QuickJS compatibility - use Promise.race instead
  var fetchP = fetch(url, options || {});
  var timeoutP = new Promise(function (_, reject) {
    setTimeout(function () { reject(new Error("Timeout " + timeout + "ms")); }, timeout);
  });
  return Promise.race([fetchP, timeoutP]);
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

function buildStreams(urls, label, subs) {
  return urls.map(function (url, index) {
    var srv = serverName(url);
    return {
      name: "StreamFlix",
      title: srv + (index > 0 ? " Mirror " + index : "") + subs + " | " + label,
      url: url,
      quality: qualityFromLabel(url),
      type: "direct",
    };
  });
}

function getEpisodes(movieKey, season) {
  var cacheKey = movieKey + ":" + season;
  var cached = episodesCache[cacheKey];
  if (cached && Date.now() - cached.ts < EPISODES_TTL) return Promise.resolve(cached.episodes);
  // Series data moved to api2 (the old Firebase episodes DB is permission-locked).
  return getJson(API2_BASE + "/" + encodeURIComponent(movieKey), 10000)
    .then(function (raw) {
      var episodes = {};
      var seasons = (raw && raw.data && raw.data.seasons) || [];
      for (var i = 0; i < seasons.length; i++) {
        if (Number(seasons[i].season) === Number(season)) {
          var list = seasons[i].episodes || [];
          list.forEach(function (ep, idx) {
            // Key by the episode number in the filename when present (exact match),
            // else by position (arrays are in episode order).
            var n = idx;
            var m = /[Ss]\d+[Ee](\d+)/.exec(ep.link || "");
            if (m) n = parseInt(m[1], 10) - 1;
            episodes[n] = ep;
          });
          break;
        }
      }
      episodesCache[cacheKey] = { episodes: episodes, ts: Date.now() };
      return episodes;
    });
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
      return buildStreams(urls, match.moviename, subtitleHint(match.movielink));
    }
    if (seasonNum == null || episodeNum == null) return [];
    return getEpisodes(match.moviekey, seasonNum).then(function (episodes) {
      var episodeData = episodes[episodeNum - 1] || episodes[episodeNum];
      if (!episodeData || !episodeData.link) return [];
      // Skip probe in Nuvio - return URLs directly
      var urls = toUrls(episodeData.link);
      if (!urls.length) return [];
      var label = match.moviename + " S" + seasonNum + "E" + episodeNum +
        (episodeData.name ? " | " + episodeData.name : "");
      return buildStreams(urls, label, subtitleHint(episodeData.link));
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

/* __CHAIN_RETRY_POSTLUDE__: full-search crowds on TV starve long chains;
   if the first attempt comes back empty fast (a dropped hop), run the
   whole chain once more. Bounded: only when attempt 1 took < 25s. */
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
      return Promise.resolve().then(function () { return orig.apply(null, args); }).then(function (res) {
        if (Array.isArray(res) && res.length === 0 && Date.now() - t0 < 25000) {
          return orig.apply(null, args);
        }
        return res;
      }, function () {
        if (Date.now() - t0 < 25000) return orig.apply(null, args);
        return [];
      });
    };
    wrapped.__chainRetry = true;
    if (typeof module !== "undefined" && module.exports) module.exports.getStreams = wrapped;
    if (g) { try { g.getStreams = wrapped; } catch (e) {} }
  } catch (e) {}
})();
