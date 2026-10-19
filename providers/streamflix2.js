// StreamFlix scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: StreamFlix provider (api.streamflix.app data.json + CDN bases)

var API_BASE = "https://api.streamflix.app";
var FIREBASE_BASE = "https://chilflix-410be-default-rtdb.asia-southeast1.firebasedatabase.app";

var CONFIG_URLS = [
  API_BASE + "/config/config-streamflix2.json",
  API_BASE + "/config/config-streamflixapp.json",
];
var FALLBACK_BASES = ["https://stream.streamflixserver.site/"];

var DATA_TTL = 30 * 60 * 1000;
var CONFIG_TTL = 5 * 60 * 1000;
var EPISODES_TTL = 60 * 60 * 1000;
var PROBE_TTL = 10 * 60 * 1000;

var dataCache = null;
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

function getData() {
  if (dataCache && Date.now() - dataCache.ts < DATA_TTL) return Promise.resolve(dataCache.items);
  return getJson(API_BASE + "/data.json", 20000).then(function (payload) {
    var items = (payload && payload.data) || [];
    dataCache = { items: items, ts: Date.now() };
    return items;
  });
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
  return getJson(FIREBASE_BASE + "/Data/" + encodeURIComponent(movieKey) + "/seasons/" + season + "/episodes.json", 10000)
    .then(function (raw) {
      var episodes = {};
      Object.keys(raw || {}).forEach(function (key) {
        var n = parseInt(key, 10);
        if (isFinite(n)) episodes[n] = raw[key];
      });
      episodesCache[cacheKey] = { episodes: episodes, ts: Date.now() };
      return episodes;
    });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  return Promise.all([getData(), getBases()]).then(function (results) {
    var items = results[0], bases = results[1];
    var match = null;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].tmdb) === String(tmdbId)) { match = items[i]; break; }
    }
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
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.StreamFlixScraperModule = { getStreams: getStreams };
}
