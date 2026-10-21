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



// MultiMovies scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Aggregates VidOut + Filmu singularity APIs by TMDB ID.

var PROVIDER = "MultiMovies";
var VO_API = "https://api.eclq-404.workers.dev";
var VO_HEADER = { Referer: VO_API + "/" };
var FLMU_BASE = "https://embed.filmu.in";
var UPSTREAM_TIMEOUT_MS = 10000;

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function normalizeQuality(raw) {
  var s = String(raw || "").toLowerCase();
  if (s.indexOf("2160") !== -1 || s.indexOf("4k") !== -1) return "2160p";
  if (s.indexOf("1080") !== -1) return "1080p";
  if (s.indexOf("720") !== -1) return "720p";
  if (s.indexOf("480") !== -1) return "480p";
  if (s.indexOf("360") !== -1) return "360p";
  return "HD";
}

function isPlayable(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    var parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (e) { return false; }
}

function resolveUrl(value, base) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).toString();
    if (!base) return "";
    return new URL(value, String(base).replace(/\/+$/, "") + "/").toString();
  } catch (e) { return ""; }
}

function fetchJson(url, options) {
  return fetchWithTimeout(url, options, UPSTREAM_TIMEOUT_MS).then(function (res) {
    if (!res.ok) return null;
    return res.json().catch(function () { return null; });
  }).catch(function () { return null; });
}

function probe(url) {
  return fetchWithTimeout(url, { method: "GET", headers: { Range: "bytes=0-1" } }, 8000)
    .then(function (res) {
      var ok = res.status === 200 || res.status === 206;
      if (res.body && res.body.cancel) { try { res.body.cancel(); } catch (e) {} }
      return ok;
    }).catch(function () { return false; });
}

function makeStream(source, url, quality, title) {
  var label = PROVIDER + " • " + source;
  return {
    name: label,
    title: title || label,
    url: url,
    quality: quality,
    type: "direct",
  };
}

function fetchVidout(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv";
  var endpoint = isTv
    ? VO_API + "/tv/" + tmdbId + "/" + season + "/" + episode
    : VO_API + "/movie/" + tmdbId;
  return fetchJson(endpoint).then(function (data) {
    if (!data || !isPlayable(data.url)) return [];
    return [makeStream("VidOut", data.url, "1080p")];
  }).catch(function () { return []; });
}

function fetchFilmu(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv";
  var path = isTv
    ? FLMU_BASE + "/api/singularity-tv?tmdb=" + tmdbId + "&s=" + season + "&e=" + episode
    : FLMU_BASE + "/api/singularity-movie?id=" + tmdbId;
  var referer = isTv
    ? FLMU_BASE + "/tv/" + tmdbId + "/" + season + "/" + episode
    : FLMU_BASE + "/movie/" + tmdbId;
  return fetchJson(path, { headers: { Referer: referer } }).then(function (root) {
    if (!root) return [];
    var base = root._base || "";
    var streams = [];
    var push = function (url, q, title) {
      streams.push(makeStream("Filmu", url, q, title));
    };
    var sources = root.sources || [];
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      if (!src || typeof src.url !== "string") continue;
      var url = resolveUrl(src.url, base);
      if (!isPlayable(url)) continue;
      push(url, normalizeQuality(src.quality || "1080p"));
    }
    if (streams.length === 0) {
      var q = normalizeQuality(root.quality || "1080p");
      var single = (typeof root.url === "string" && root.url) ||
        (root.multilingual && root.multilingual_url) || "";
      var singleUrl = resolveUrl(single, base);
      if (isPlayable(singleUrl)) {
        push(singleUrl, q, PROVIDER + " • " + q);
      } else if (root.m3u8_path && base) {
        var m3u8 = resolveUrl(root.m3u8_path, base);
        if (isPlayable(m3u8)) push(m3u8, q);
      }
    }
    return streams;
  }).catch(function () { return []; });
}

function dedupeByUrl(streams) {
  var seen = {};
  return streams.filter(function (s) {
    return s && isPlayable(s.url) && !seen[s.url] && (seen[s.url] = true);
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (!/^\d+$/.test(String(tmdbId))) return Promise.resolve([]);
  if (mediaType !== "movie" && mediaType !== "tv") return Promise.resolve([]);
  if (mediaType === "tv" && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);
  return Promise.all([
    fetchVidout(tmdbId, mediaType, seasonNum, episodeNum),
    fetchFilmu(tmdbId, mediaType, seasonNum, episodeNum),
  ]).then(function (results) {
    var candidates = dedupeByUrl(results[0].concat(results[1]));
    // Probe each candidate quickly; keep the ones that answer.
    return Promise.all(candidates.map(function (s) {
      return probe(s.url).then(function (ok) { return ok ? s : null; });
    }));
  }).then(function (checked) {
    return checked.filter(function (s) { return s !== null; });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.MultiMoviesScraperModule = { getStreams: getStreams };
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
