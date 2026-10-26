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
        var kLabel = formatStreamLabel({ source: "Kartoons", title: resolved.title || "",
          quality: qualityFromLabel(label),
          season: type === "series" ? (seasonNum || 1) : undefined,
          episode: type === "series" ? (episodeNum || 1) : undefined,
          server: (s.name && s.name !== "Kartoons") ? s.name : undefined, url: s.url });
        return {
          name: kLabel,
          title: kLabel,
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
