// OneTouchTV scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: OneTouchTV provider (https://api3.devcorp.me — AES-256-CBC encrypted JSON API).
//
// Notes vs the original addon provider:
// - AES-256-CBC is done with WebCrypto (crypto.subtle); the hardcoded 32-byte
//   key / 16-byte IV from the original provider are inlined below.
// - The addon's 463-line fuzzy matcher is replaced by a compact inline scorer
//   (normalized exact/substring/word-overlap + year bonus, 0.45 threshold).
// - The IMDB cross-check (reject confirmed title mismatches) is kept in a
//   simplified form via TMDB search + external_ids.
// - Absolute-episode offsetting via Cinemeta was dropped; season-specific
//   entries use direct episode index, other entries fall back to it as well.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var MAIN_URL = "https://api3.devcorp.me";
var AES_KEY_STR = "im72charPasswordofdInitVectorStm"; // 32 bytes
var AES_IV_STR = "im72charPassword"; // 16 bytes
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var FETCH_HEADERS = {
  "User-Agent": UA,
  Referer: "https://onetouchtv.xyz/",
};

var cache = {};
var CACHE_TTL = 5 * 60 * 1000;

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

// ---- AES-256-CBC (WebCrypto) ----

var aesKeyPromise = null;
function getAesKey() {
  if (!aesKeyPromise) {
    aesKeyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(AES_KEY_STR),
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
  }
  return aesKeyPromise;
}

function b64ToBytes(s) {
  // Custom base64 variant used by the API: "-_." -> "/", "@" -> "+"
  s = s.replace(/-_\./g, "/").replace(/@/g, "+").replace(/\s+/g, "");
  var pad = s.length % 4;
  if (pad) s += "====".slice(0, 4 - pad);
  var bin = atob(s);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return bytes;
}

function decryptToJson(encoded) {
  var data = b64ToBytes(encoded);
  var iv = new TextEncoder().encode(AES_IV_STR);
  return getAesKey()
    .then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, data);
    })
    .then(function (pt) {
      return JSON.parse(new TextDecoder().decode(pt));
    });
}

function fetchEncryptedOnce(path) {
  var url = path.indexOf("https://") === 0 ? path : MAIN_URL + path;
  return fetchWithTimeout(url, { headers: FETCH_HEADERS }, 15000)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then(decryptToJson)
    .then(function (parsed) { return parsed && parsed.result; });
}

function fetchEncrypted(path, useCache) {
  var url = path.indexOf("https://") === 0 ? path : MAIN_URL + path;
  var entry = useCache === false ? null : cache[url];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return Promise.resolve(entry.data);
  var attempt = function (n) {
    return fetchEncryptedOnce(path).then(function (result) {
      if (useCache !== false) cache[url] = { data: result, ts: Date.now() };
      return result;
    }).catch(function (err) {
      if (n < 2) {
        return new Promise(function (r) { setTimeout(r, 400 * (n + 1)); })
          .then(function () { return attempt(n + 1); });
      }
      throw err;
    });
  };
  return attempt(0);
}

// ---- TMDB meta (title + year + imdb id, one request) ----

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
      var date = j.release_date || j.first_air_date || "";
      return {
        title: j.title || j.name || null,
        year: date ? parseInt(date.split("-")[0], 10) : null,
        imdbId: j.imdb_id || null,
      };
    })
    .catch(function () { return null; });
}

// Resolve a site title back to an IMDB id via TMDB search (for mismatch check).
function tmdbSearchImdbId(title, year, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var yearParam = year ? (kind === "tv" ? "&first_air_date_year=" + year : "&year=" + year) : "";
  var url = "https://api.themoviedb.org/3/search/" + kind + "?api_key=" + TMDB_API_KEY +
    "&query=" + encodeURIComponent(title) + yearParam;
  return fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 10000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var first = j && j.results && j.results[0];
      if (!first) return null;
      return fetchWithTimeout(
        "https://api.themoviedb.org/3/" + kind + "/" + first.id + "/external_ids?api_key=" + TMDB_API_KEY,
        { headers: { Accept: "application/json" } },
        10000
      )
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (e) { return e && e.imdb_id ? e.imdb_id : null; });
    })
    .catch(function () { return null; });
}

// ---- compact title matching ----

function normTitle(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function textScore(query, candidate) {
  var q = normTitle(query), c = normTitle(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.indexOf(q) !== -1) return 0.85;
  if (q.indexOf(c) !== -1) return 0.7;
  var qw = q.split(" "), cw = c.split(" ");
  var hit = 0, i;
  for (i = 0; i < qw.length; i++) if (cw.indexOf(qw[i]) !== -1) hit++;
  if (hit === 0) return 0;
  return (2 * hit) / (qw.length + cw.length); // Dice coefficient
}

function bestMatch(results, title, year, type) {
  var allowed = type === "movie" ? ["movie"] : ["drama", "variety", "anime"];
  var best = null, bestScore = 0.45, i, r, t, s, cy;
  for (i = 0; i < results.length; i++) {
    r = results[i];
    t = (r.type || "").toLowerCase();
    if (allowed.indexOf(t) === -1) continue;
    s = textScore(title, r.title);
    cy = parseInt(r.year, 10);
    if (year && cy) {
      var dy = Math.abs(year - cy);
      if (dy === 0) s += 0.15;
      else if (dy === 1) s += 0.05;
      else if (dy > 2) s -= 0.2;
    }
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return best;
}

function qualityLabel(q) {
  if (!q) return "Unknown";
  var s = String(q).toLowerCase();
  if (s.indexOf("1080") !== -1) return "1080p";
  if (s.indexOf("720") !== -1) return "720p";
  if (s.indexOf("480") !== -1) return "480p";
  if (s.indexOf("360") !== -1) return "360p";
  return "Unknown";
}

function pickEpisode(episodes, matchedTitle, isTv, season, episode) {
  if (!isTv) return episodes[0] || null;
  var ep = episode || 1, s = season || 1, i, e, n;
  for (i = 0; i < episodes.length; i++) {
    e = episodes[i];
    n = parseInt(e.episode, 10);
    if (n === ep) return e;
  }
  return null;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isTv = mediaType === "tv";
  var type = isTv ? "series" : "movie";
  var s = seasonNum || 1, ep = episodeNum || 1;
  if (isTv && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);

  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta || !meta.title) return [];
    var keywords = [meta.title];
    if (isTv && s > 1) keywords.unshift(meta.title + " Season " + s);

    var chain = Promise.resolve(null);
    keywords.forEach(function (kw) {
      chain = chain.then(function (found) {
        if (found) return found;
        return fetchEncrypted("/vod/search?keyword=" + encodeURIComponent(kw))
          .then(function (results) {
            if (!Array.isArray(results)) return null;
            return bestMatch(results, kw, kw === meta.title ? meta.year : null, type);
          })
          .catch(function () { return null; });
      });
    });

    return chain.then(function (match) {
      if (!match) return [];
      // IMDB cross-check: reject on CONFIRMED mismatch only.
      var check = (meta.imdbId && meta.imdbId.indexOf("tt") === 0)
        ? tmdbSearchImdbId(match.title, parseInt(match.year, 10) || null, mediaType)
            .then(function (resolved) {
              return !(resolved && resolved !== meta.imdbId);
            })
            .catch(function () { return true; })
        : Promise.resolve(true);
      return check.then(function (ok) {
        if (!ok) return [];
        return fetchEncrypted("/vod/" + match.id + "/detail")
          .then(function (detail) {
            if (!detail || !detail.episodes || !detail.episodes.length) return [];
            var target = pickEpisode(detail.episodes, match.title, isTv, s, ep);
            if (!target) return [];
            return fetchEncrypted("/vod/" + match.id + "/episode/" + target.playId, false)
              .then(function (sd) {
                var sources = (sd && sd.sources) || [];
                var seen = {}, out = [];
                sources.forEach(function (src) {
                  if (!src.url || seen[src.url]) return;
                  seen[src.url] = 1;
                  out.push({
                    name: "OneTouchTV",
                    title: match.title + " | " + qualityLabel(src.quality),
                    url: src.url,
                    quality: qualityLabel(src.quality),
                    type: "direct",
                  });
                });
                return out;
              })
              .catch(function () { return []; });
          })
          .catch(function () { return []; });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.OneTouchTVScraperModule = { getStreams: getStreams };
}
