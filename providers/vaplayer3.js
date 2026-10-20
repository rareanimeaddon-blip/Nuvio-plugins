/* __FETCH_RETRY_PRELUDE__ v3 (webOS TV): the TV plugin fetch service
   intermittently returns status-0 transport failures - isolated drops,
   first-request-of-burst drops, and occasional ~30s dead windows when it
   picks a bad route. Wrap the global fetch so a rejection or status-0
   response is retried with pauses (spin-wait; the TV guest has no
   timers): up to 6 attempts, pauses 0.8/2/4/8/16s (~31s span, inside
   the 60s provider budget). */
(function () {
  try {
    var cur = (typeof fetch !== "undefined") ? fetch : null;
    if (!cur || cur.__nuvioRetry) return;
    var raw = cur;
    var PAUSES = [800, 2000, 4000, 8000, 16000];
    function spin(ms) {
      var end = Date.now() + ms;
      while (Date.now() < end) { /* pause without timers */ }
    }
    var wrapped = function (url, opts) {
      var tries = 0;
      var attempt = function () {
        tries++;
        return raw(url, opts).then(function (r) {
          if (r && r.status === 0 && tries <= PAUSES.length) { spin(PAUSES[tries - 1]); return attempt(); }
          return r;
        }, function (e) {
          if (tries <= PAUSES.length) { spin(PAUSES[tries - 1]); return attempt(); }
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

// VaPlayer scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: VaPlayer provider (https://streamdata.vaplayer.ru/api.php)
// Takes IMDB ID (resolved from TMDB), returns HLS stream URLs.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var STREAM_API = "https://streamdata.vaplayer.ru/api.php";
var PLAYER_ORIGIN = "https://nextgencloudfabric.com";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function tmdbToImdb(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY,
    { headers: { Accept: "application/json" } },
    10000
  )
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j && j.imdb_id ? j.imdb_id : null; })
    .catch(function () { return null; });
}

function qualityFromUrl(url) {
  var m = /(\d{3,4})p/i.exec(url || "");
  return m ? m[1] + "p" : "Unknown";
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isTv = mediaType === "tv";
  if (isTv && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);
  return tmdbToImdb(tmdbId, mediaType).then(function (imdbId) {
    if (!imdbId || imdbId.indexOf("tt") !== 0) return [];
    var params = "imdb=" + encodeURIComponent(imdbId) + "&type=" + (isTv ? "tv" : "movie");
    if (isTv) params += "&season=" + seasonNum + "&episode=" + episodeNum;
    var referer = isTv
      ? PLAYER_ORIGIN + "/embed/tv/" + imdbId + "/" + seasonNum + "/" + episodeNum
      : PLAYER_ORIGIN + "/embed/movie/" + imdbId;
    return fetchWithTimeout(STREAM_API + "?" + params, {
      headers: {
        "User-Agent": UA,
        Referer: referer,
        Origin: PLAYER_ORIGIN,
        Accept: "application/json",
      },
    }, 12000)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (!json || (json.status_code !== 200 && json.status_code !== "200")) return [];
        var urls = (json.data && json.data.stream_urls) || [];
        var label = isTv ? " S" + seasonNum + "E" + episodeNum : "";
        return urls
          .filter(function (u) { return typeof u === "string" && /^https?:\/\//.test(u); })
          .map(function (url, i) {
            return {
              name: "VaPlayer",
              title: "VaPlayer" + label + " · HLS " + (i + 1),
              url: url,
              quality: qualityFromUrl(url),
              type: "direct",
            };
          });
      })
      .catch(function () { return []; });
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.VaPlayerScraperModule = { getStreams: getStreams };
}
