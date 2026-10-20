// Kartoons scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: Kartoons provider. It is a thin client over another Stremio addon
// API (api.kartoons.to/api/stremio) protected by a token query parameter.
// The token below is the provider's own hardcoded default fallback (from
// KARTOONS_TOKEN default in the source) — no secret env needed.
// Flow: TMDB title -> kartoons catalog search -> best match -> (series:
// episode id via meta) -> /stream endpoint -> direct stream URLs.

var BASE_URL = "https://api.kartoons.to/api/stremio";
var TOKEN = "DNU1ZBzyTpwPldcjg09_RBKp5KgrQaMv0tdqDr9SX48";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var TIMEOUT = 20000;
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

var cache = {};

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function addonUrl(path) {
  var sep = path.indexOf("?") !== -1 ? "&" : "?";
  return BASE_URL + path + sep + "token=" + TOKEN;
}

function addonGet(path, timeoutMs) {
  return fetchWithTimeout(addonUrl(path), {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  }, timeoutMs || TIMEOUT)
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

function cached(key, ttlMs, loader) {
  var entry = cache[key];
  if (entry && Date.now() < entry.expiresAt) return Promise.resolve(entry.data);
  return loader().then(function (data) {
    cache[key] = { data: data, expiresAt: Date.now() + ttlMs };
    return data;
  });
}

function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY,
    { headers: { Accept: "application/json" } },
    10000
  )
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return null;
      var title = j.title || j.name || null;
      var date = j.release_date || j.first_air_date || "";
      var year = /^\d{4}/.test(date) ? parseInt(date.substring(0, 4), 10) : null;
      return title ? { title: title, year: year } : null;
    })
    .catch(function () { return null; });
}

function getFullCatalog(type) {
  var catalogId = type === "movie" ? "kartoons_movies" : "kartoons_shows";
  return cached("catalog:full:" + type, 3600 * 1000, function () {
    return addonGet("/catalog/" + type + "/" + catalogId + ".json").then(function (data) {
      return (data && data.metas) || [];
    });
  });
}

function searchCatalog(type, query) {
  var catalogId = type === "movie" ? "kartoons_movies" : "kartoons_shows";
  var cleanQuery = String(query).replace(/\[.*?\]|\(.*?\)/g, "").trim();
  var queries = [cleanQuery, cleanQuery.replace(/[:\-–—]/g, " ").replace(/\s+/g, " ").trim()];
  if (cleanQuery.indexOf(":") !== -1) queries.push(cleanQuery.split(":")[0].trim());
  var i = 0;
  function next() {
    if (i >= queries.length) {
      // Fall back to the full catalog and let scoring pick the best.
      return getFullCatalog(type);
    }
    var q = queries[i++];
    if (!q || q.length < 2) return next();
    return addonGet("/catalog/" + type + "/" + catalogId + "/search=" + encodeURIComponent(q) + ".json")
      .then(function (data) {
        if (data && data.metas && data.metas.length) return data.metas;
        return next();
      });
  }
  return next();
}

function normWords(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(/\s+/).filter(Boolean);
}

function itemYear(meta) {
  var m = /\b(19\d\d|20\d\d)\b/.exec(meta.releaseInfo || "");
  return m ? parseInt(m[1], 10) : null;
}

function scoreCandidate(meta, title, year) {
  var titleWords = normWords(title);
  var set = {};
  normWords(meta.name).forEach(function (w) { set[w] = 1; });
  var hit = titleWords.filter(function (w) { return set[w]; }).length;
  if (!titleWords.length) return 0;
  var text = hit / titleWords.length;
  var yearBonus = 0;
  var iy = itemYear(meta);
  if (year && iy) yearBonus = iy === year ? 0.15 : -0.1;
  return text + yearBonus;
}

function matchItem(type, title, year) {
  return searchCatalog(type, title).then(function (metas) {
    if (!metas.length) return null;
    var best = null, bestScore = -1;
    metas.forEach(function (meta) {
      var s = scoreCandidate(meta, title, year);
      if (s > bestScore) { bestScore = s; best = meta; }
    });
    return bestScore >= 0.45 ? best : null;
  });
}

function getEpisodeId(showId, season, episode) {
  var formattedId = showId.indexOf("kartoons:") === 0 ? showId : "kartoons:" + showId;
  return cached("meta:series:" + formattedId, 3600 * 1000, function () {
    return addonGet("/meta/series/" + formattedId + ".json").then(function (data) {
      return (data && data.meta && data.meta.videos) || [];
    });
  }).then(function (videos) {
    var exact = null, byIndex = null;
    var seasonEps = videos.filter(function (v) { return v.season === season; })
      .sort(function (a, b) { return a.episode - b.episode; });
    for (var i = 0; i < videos.length; i++) {
      if (videos[i].season === season && videos[i].episode === episode) { exact = videos[i]; break; }
    }
    if (exact) return exact.id;
    if (seasonEps[episode - 1]) return seasonEps[episode - 1].id;
    var sorted = videos.slice().sort(function (a, b) { return a.episode - b.episode; });
    return sorted[episode - 1] ? sorted[episode - 1].id : null;
  });
}

function qualityFromLabel(label) {
  var m = /(\d{3,4})p/i.exec(label || "");
  return m ? m[1] + "p" : "Unknown";
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta) return [];
    return matchItem(type, meta.title, meta.year);
  }).then(function (item) {
    if (!item) return [];
    var id = String(item.id || "").replace(/^kartoons:/, "");
    if (type === "movie") return { streamId: id, title: item.name };
    return getEpisodeId(id, seasonNum || 1, episodeNum || 1).then(function (epId) {
      if (!epId) return null;
      return { streamId: String(epId).replace(/^kartoons:/, ""), title: item.name };
    });
  }).then(function (resolved) {
    if (!resolved) return [];
    var formattedId = "kartoons:" + resolved.streamId;
    return cached("streams:" + formattedId, 1800 * 1000, function () {
      return addonGet("/stream/" + type + "/" + formattedId + ".json").then(function (data) {
        return (data && data.streams) || [];
      });
    }).then(function (streams) {
      return streams.filter(function (s) {
        return s && typeof s.url === "string" && /^https?:\/\//.test(s.url);
      }).map(function (s) {
        var label = [s.name, s.title].filter(Boolean).join(" ").trim();
        return {
          name: "Kartoons",
          title: (s.name ? s.name + " | " : "") + (resolved.title || "") +
                 (s.title && s.title !== s.name ? " | " + s.title : ""),
          url: s.url,
          quality: qualityFromLabel(label),
          type: "direct",
        };
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.KartoonsScraperModule = { getStreams: getStreams };
}
