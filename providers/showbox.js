// ShowBox scraper for Nuvio - uses HuggingFace proxy (pure JS, no deps)
var PROXY_API = "https://id-mapping-api-showbox-proxy.hf.space/api/media";
var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var FEBBOX_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODQ5OTM4NDcsIm5iZiI6MTc4NDk5Mzg0NywiZXhwIjoxODE2MDk3ODY3LCJkYXRhIjp7InVpZCI6MjIxODYyNCwidG9rZW4iOiIzODZlZjAxMTFhNWM4NGRhMzFlY2Y3NTIwYzNhNzM1YiJ9fQ.XGa9kccveelGw69OwCym8AtZfNE0Sq49K0VYDQfrLcc";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function fetchWithTimeout(url, opts, ms) {
  opts = opts || {};
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, ms || 15000);
  opts.signal = controller.signal;
  return fetch(url, opts).then(function (res) {
    clearTimeout(timer);
    return res;
  }).catch(function (e) {
    clearTimeout(timer);
    throw e;
  });
}

function getQuality(q) {
  if (!q) return "Unknown";
  var s = String(q).toUpperCase();
  if (s === "ORG" || s === "ORIGINAL") return "Original";
  if (s.indexOf("2160") >= 0 || s === "4K") return "4K";
  if (s.indexOf("1080") >= 0) return "1080p";
  if (s.indexOf("720") >= 0) return "720p";
  if (s.indexOf("480") >= 0) return "480p";
  return s;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isTv = mediaType === "tv";
  var url = isTv
    ? PROXY_API + "/tv/" + tmdbId + "/" + seasonNum + "/" + episodeNum
    : PROXY_API + "/movie/" + tmdbId;

  return fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json",
      "X-FebBox-Token": FEBBOX_TOKEN
    }
  }, 20000).then(function (res) {
    if (!res.ok) return [];
    return res.json();
  }).then(function (data) {
    if (!data || data.success !== true) return [];
    if (!Array.isArray(data.versions) || !data.versions.length) return [];

    var streams = [];
    data.versions.forEach(function (version) {
      if (!Array.isArray(version.links)) return;
      version.links.forEach(function (link) {
        if (!link.url) return;
        var q = getQuality(link.quality);
        streams.push({
          name: "ShowBox " + q,
          title: "ShowBox " + q,
          url: link.url,
          quality: q,
          type: "direct"
        });
      });
    });

    var seen = {};
    return streams.filter(function (s) {
      if (seen[s.url]) return false;
      seen[s.url] = true;
      return true;
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
