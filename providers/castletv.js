// CastleTV scraper for Nuvio
// Standalone, sandbox-compatible (WebCrypto for AES-128-CBC, no Node APIs).
// Source: CastleTV provider — hits api.hlowb.com, decrypts AES-128-CBC
// responses (key = base64(secKey) ++ "T!BgJB", padded/trimmed to 16 bytes,
// IV = key), searches by title, navigates seasons/episodes.

var CASTLE_BASE = "https://api.hlowb.com";
var PKG = "com.external.castle";
var CHANNEL = "IndiaA";
var CLIENT = "1";
var LANG = "en-US";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var API_HEADERS = {
  "User-Agent": "okhttp/4.9.3",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: CASTLE_BASE,
};

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 12000);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function base64ToBytes(b64) {
  var bin = atob(String(b64).replace(/-/g, "+").replace(/_/g, "/"));
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return bytes;
}

// --- AES-128-CBC via WebCrypto ---
function deriveKey(securityKey) {
  var keyBytes = base64ToBytes(securityKey);
  var suffix = new TextEncoder().encode("T!BgJB");
  var out = new Uint8Array(16); // zero-filled
  var kLen = Math.min(keyBytes.length, 16);
  out.set(keyBytes.subarray(0, kLen), 0);
  var sLen = Math.min(suffix.length, 16 - kLen);
  out.set(suffix.subarray(0, sLen), kLen);
  return out;
}

function decryptCastle(cipherText, securityKey) {
  var keyBytes = deriveKey(securityKey);
  var cipherBytes = base64ToBytes(cipherText);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"])
    .then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-CBC", iv: keyBytes }, key, cipherBytes);
    })
    .then(function (pt) { return new TextDecoder().decode(pt); });
}

// BigInt-safe JSON: quote bare integers with 16+ digits before parsing.
function castleSafeParse(text) {
  var safe = text.replace(/([:{[,]\s*)(\d{16,})/g, '$1"$2"');
  return JSON.parse(safe);
}

function castleRequest(url, options) {
  var opts = Object.assign({}, options);
  opts.headers = Object.assign({}, API_HEADERS, (options && options.headers) || {});
  return fetchWithTimeout(url, opts, 12000).then(function (res) {
    if (!res.ok) throw new Error("[CastleTV] HTTP " + res.status);
    return res;
  });
}

function extractCipher(res) {
  return res.text().then(function (text) {
    var trimmed = text.trim();
    if (!trimmed) throw new Error("[CastleTV] Empty response body");
    try {
      var parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.data === "string") return parsed.data.trim();
    } catch (e) { /* raw cipher */ }
    return trimmed;
  });
}

function unwrap(obj) {
  if (obj && obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) return obj.data;
  return obj;
}

function getSecurityKey() {
  var url = CASTLE_BASE + "/v0.1/system/getSecurityKey/1?channel=" + CHANNEL + "&clientType=" + CLIENT + "&lang=" + LANG;
  return castleRequest(url).then(function (res) { return res.json(); }).then(function (json) {
    if (!json || json.code !== 200 || !json.data) throw new Error("[CastleTV] Security key error");
    return json.data;
  });
}

function searchCastle(secKey, keyword) {
  var params = new URLSearchParams({
    channel: CHANNEL, clientType: CLIENT, keyword: keyword, lang: LANG,
    mode: "1", packageName: PKG, page: "1", size: "30",
  });
  return castleRequest(CASTLE_BASE + "/film-api/v1.1.0/movie/searchByKeyword?" + params.toString())
    .then(extractCipher)
    .then(function (cipher) { return decryptCastle(cipher, secKey); })
    .then(castleSafeParse);
}

function getDetails(secKey, movieId) {
  var url = CASTLE_BASE + "/film-api/v1.9.9/movie?channel=" + CHANNEL + "&clientType=" + CLIENT +
    "&lang=" + LANG + "&movieId=" + encodeURIComponent(movieId) + "&packageName=" + PKG;
  return castleRequest(url)
    .then(extractCipher)
    .then(function (cipher) { return decryptCastle(cipher, secKey); })
    .then(castleSafeParse);
}

function getVideo(secKey, movieId, episodeId, languageId, resolution) {
  var body = {
    mode: "1", appMarket: "GuanWang", clientType: CLIENT, woolUser: "false",
    apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475",
    androidVersion: "13", movieId: movieId, episodeId: episodeId,
    isNewUser: "true", resolution: String(resolution), packageName: PKG,
  };
  if (languageId) body.languageId = languageId;
  var url = CASTLE_BASE + "/film-api/v2.0.1/movie/getVideo2?clientType=" + CLIENT +
    "&packageName=" + PKG + "&channel=" + CHANNEL + "&lang=" + LANG;
  return castleRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(extractCipher)
    .then(function (cipher) { return decryptCastle(cipher, secKey); })
    .then(castleSafeParse);
}

function resolutionLabel(res) {
  return res === 1 ? "480p" : res === 2 ? "720p" : res === 3 ? "1080p" : res + "p";
}

function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, {}, 10000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return null;
      var title = j.title || j.name || null;
      var date = j.release_date || j.first_air_date || "";
      var year = /(\d{4})/.exec(date) ? /(\d{4})/.exec(date)[1] : null;
      return title ? { title: title, year: year } : null;
    })
    .catch(function () { return null; });
}

function qualityFromUrl(url, fallback) {
  var m = /\/(\d{3,4})\//.exec(url || "");
  return m ? m[1] + "p" : fallback;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  var season = seasonNum || 1, episode = episodeNum || 1;
  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta) return [];
    var titleLine = type === "series"
      ? meta.title + " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0") + (meta.year ? " (" + meta.year + ")" : "")
      : meta.title + (meta.year ? " (" + meta.year + ")" : "");
    return getSecurityKey().then(function (secKey) {
      var keyword = meta.year ? meta.title + " " + meta.year : meta.title;
      return searchCastle(secKey, keyword).then(function (searchResult) {
        var rows = unwrap(searchResult).rows || [];
        if (!rows.length) return [];
        var titleLc = meta.title.toLowerCase();
        var match = null;
        for (var i = 0; i < rows.length; i++) {
          var name = String(rows[i].title || rows[i].name || "").toLowerCase();
          if (name && (name.indexOf(titleLc) !== -1 || titleLc.indexOf(name) !== -1)) { match = rows[i]; break; }
        }
        if (!match) match = rows[0];
        var castleId = String(match.id || match.redirectId || match.redirectIdStr || "");
        if (!castleId) return [];
        return getDetails(secKey, castleId).then(function (details) {
          var activeId = castleId;
          if (type === "series") {
            var seasons = unwrap(details).seasons || [];
            for (var s = 0; s < seasons.length; s++) {
              if (seasons[s].number === season && seasons[s].movieId &&
                  String(seasons[s].movieId) !== castleId) {
                activeId = String(seasons[s].movieId);
                return getDetails(secKey, activeId).then(function (d2) {
                  return collectStreams(secKey, d2, activeId, meta, titleLine, type, episode);
                });
              }
            }
          }
          return collectStreams(secKey, details, activeId, meta, titleLine, type, episode);
        });
      });
    });
  }).catch(function () { return []; });
}

function collectStreams(secKey, details, activeId, meta, titleLine, type, episode) {
  var episodes = unwrap(details).episodes || [];
  var episodeId = null, epEntry = null;
  if (type === "series") {
    for (var i = 0; i < episodes.length; i++) {
      if (episodes[i].number === episode) { epEntry = episodes[i]; break; }
    }
  } else {
    epEntry = episodes[0];
  }
  if (!epEntry || !epEntry.id) return Promise.resolve([]);
  episodeId = String(epEntry.id);
  var allTracks = epEntry.tracks || [];
  var tracks = allTracks.filter(function (t) { return t.existIndividualVideo === true; });
  if (!tracks.length) tracks = allTracks;

  var streams = [];
  var seen = {};
  function pushStream(url, qual, langLabel) {
    if (!url || seen[url]) return;
    seen[url] = true;
    streams.push({
      name: "CastleTV",
      title: (langLabel ? langLabel + " " : "") + qual + " | " + titleLine,
      url: url,
      quality: /^\d{3,4}p$/.test(qual) ? qual : "Unknown",
      type: "direct",
    });
  }
  function videosFrom(raw, resolution, langLabel) {
    var data = unwrap(raw);
    var vids = data.videos || [];
    var defQual = resolutionLabel(resolution);
    if (vids.length) {
      vids.forEach(function (v) {
        var url = v.url || data.videoUrl;
        if (url) pushStream(url, qualityFromUrl(url, defQual), langLabel);
      });
    } else if (data.videoUrl) {
      pushStream(data.videoUrl, qualityFromUrl(data.videoUrl, defQual), langLabel);
    }
  }

  var jobs = [];
  if (tracks.length) {
    tracks.forEach(function (track) {
      var langLabel = "[" + (track.languageName || track.abbreviate || "Unknown") + "]";
      [3, 2, 1].forEach(function (resolution) {
        jobs.push(
          getVideo(secKey, activeId, episodeId, String(track.languageId || ""), resolution)
            .then(function (raw) { videosFrom(raw, resolution, langLabel); })
            .catch(function () {})
        );
      });
    });
  }
  return Promise.all(jobs).then(function () {
    if (streams.length) return streams;
    // fallback: shared stream
    var shared = [3, 2, 1].map(function (resolution) {
      return getVideo(secKey, activeId, episodeId, null, resolution)
        .then(function (raw) { videosFrom(raw, resolution, ""); })
        .catch(function () {});
    });
    return Promise.all(shared).then(function () { return streams; });
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.CastleTVScraperModule = { getStreams: getStreams };
}
