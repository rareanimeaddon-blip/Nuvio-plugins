/**
 * ShowBox / FebBox Nuvio scraper
 *
 * Resolves direct MP4 streams from showbox.media via the FebBox file-sharing API.
 *
 * Flow:
 *  1. TMDB -> IMDB ID
 *  2. searchShowbox(imdbId): https://showbox.media/search?keyword={imdbId} -> mediaId
 *  3. shareKey(mediaId, type): https://showbox.media/index/share_link -> FebBox share key
 *  4. shareFiles(key): https://www.febbox.com/file/file_share_list -> files
 *  5. qualities(fid, key): https://www.febbox.com/console/video_quality_list -> stream URLs
 *
 * Sandbox-safe: pure JS, var only, fetch, no Node APIs.
 */

var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var FEBBOX_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODQ5OTM4NDcsIm5iZiI6MTc4NDk5Mzg0NywiZXhwIjoxODE2MDk3ODY3LCJkYXRhIjp7InVpZCI6MjIxODYyNCwidG9rZW4iOiIzODZlZjAxMTFhNWM4NGRhMzFlY2Y3NTIwYzNhNzM1YiJ9fQ.XGa9kccveelGw69OwCym8AtZfNE0Sq49K0VYDQfrLcc";

var SHOWBOX = "https://showbox.media";
var FEBBOX = "https://www.febbox.com";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
var REQ_TIMEOUT = 15000;

function fetchWithTimeout(url, opts, ms) {
  var timeout = ms || REQ_TIMEOUT;
  return Promise.race([
    fetch(url, opts || {}),
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("Timeout")); }, timeout);
    })
  ]);
}

function addonHeaders(extra) {
  var h = {
    "user-agent": USER_AGENT,
    "accept": "application/json, text/html, */*",
    "accept-language": "en"
  };
  if (extra) {
    for (var k in extra) h[k] = extra[k];
  }
  return h;
}

function febboxCookie() {
  var token = (FEBBOX_TOKEN || "").trim();
  if (!token) return "";
  return token.indexOf("ui=") === 0 ? token : "ui=" + token;
}

function showboxJson(url, extra) {
  return fetchWithTimeout(url, { headers: addonHeaders(extra) }, REQ_TIMEOUT).then(function (response) {
    if (!response.ok) return null;
    var ct = response.headers.get("content-type") || "";
    if (ct.indexOf("json") === -1) return null;
    return response.json();
  }).catch(function () { return null; });
}

// --- Step 1: resolve internal ShowBox media ID from IMDB ID ---
function searchShowbox(imdbId) {
  return fetchWithTimeout(
    SHOWBOX + "/search?keyword=" + encodeURIComponent(imdbId),
    { headers: addonHeaders() },
    REQ_TIMEOUT
  ).then(function (search) {
    if (!search.ok) return null;
    return search.text();
  }).then(function (html) {
    if (!html) return null;
    var linkMatch =
      html.match(/class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/i) ||
      html.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/i);
    if (!linkMatch) return null;
    return fetchWithTimeout(SHOWBOX + linkMatch[1], { headers: addonHeaders() }, REQ_TIMEOUT);
  }).then(function (detail) {
    if (!detail || !detail.ok) return null;
    return detail.text();
  }).then(function (detailHtml) {
    if (!detailHtml) return null;
    var headingMatch = detailHtml.match(
      /class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i
    );
    if (!headingMatch) return null;
    var parts = headingMatch[1].split("/");
    var mediaId = Number(parts[parts.length - 1]);
    return isFinite(mediaId) ? mediaId : null;
  }).catch(function () { return null; });
}

// --- Step 2: get FebBox share key ---
function shareKey(mediaId, type) {
  return showboxJson(SHOWBOX + "/index/share_link?id=" + mediaId + "&type=" + type).then(function (data) {
    var link = data && data.data && data.data.link;
    if (!link) return null;
    var parts = link.split("/");
    return parts[parts.length - 1] || null;
  });
}

// --- Step 3: list FebBox files ---
function shareFiles(key, parentId) {
  var cookie = febboxCookie();
  var url = FEBBOX + "/file/file_share_list?share_key=" + encodeURIComponent(key);
  if (parentId !== undefined && parentId !== null) {
    url += "&parent_id=" + encodeURIComponent(String(parentId)) + "&page=1";
  }
  return showboxJson(url, cookie ? { cookie: cookie } : {}).then(function (data) {
    var list = data && data.data && data.data.file_list;
    return list || [];
  });
}

// --- Step 4: pick season folder / episode file ---
function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function isDir(f) {
  return !!f.is_dir;
}

function pickSeason(files, season) {
  var s = pad2(season);
  var i, f, name;
  for (i = 0; i < files.length; i++) {
    f = files[i];
    if (!isDir(f)) continue;
    name = String(f.file_name || "").toLowerCase();
    if (name.indexOf("season " + season) !== -1 || name.indexOf("s" + s) !== -1 ||
        name === "season " + season || name === "s" + s) {
      return f;
    }
  }
  for (i = 0; i < files.length; i++) {
    if (isDir(files[i])) return files[i];
  }
  return null;
}

function pickEpisode(files, episode) {
  var e = pad2(episode);
  var i, f, name;
  for (i = 0; i < files.length; i++) {
    f = files[i];
    if (isDir(f)) continue;
    name = String(f.file_name || "").toLowerCase();
    if (name.indexOf("e" + e) !== -1 || name.indexOf("ep" + e) !== -1 ||
        name.indexOf("episode " + episode) !== -1 ||
        name.indexOf("- " + e + " ") !== -1 ||
        name.indexOf("." + e + ".") !== -1) {
      return f;
    }
  }
  for (i = 0; i < files.length; i++) {
    if (!isDir(files[i])) return files[i];
  }
  return null;
}

// --- Step 5: fetch quality-level links from FebBox ---
function qualities(fid, key) {
  var cookie = febboxCookie();
  if (!cookie) return Promise.resolve([]);
  var url = FEBBOX + "/console/video_quality_list?fid=" + encodeURIComponent(String(fid)) +
            "&share_key=" + encodeURIComponent(key);
  return showboxJson(url, { cookie: cookie }).then(function (data) {
    var html = (data && data.html) || "";
    var streams = [];
    var tagPattern = /<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/gi;
    var match;
    while ((match = tagPattern.exec(html))) {
      var tag = match[0];
      var urlM = tag.match(/data-url="([^"]+)"/);
      var qM = tag.match(/data-quality="([^"]+)"/);
      var sizeM = tag.match(/data-size="([^"]+)"/);
      if (urlM && qM) {
        streams.push({
          url: urlM[1].replace(/\\\//g, "/"),
          quality: qM[1],
          size: sizeM ? sizeM[1] : undefined
        });
      }
    }
    return streams;
  });
}

function qualityRank(quality) {
  var res = String(quality || "").match(/(\d{3,4})/);
  if (res) return Number(res[1]);
  return String(quality || "").toUpperCase() === "ORG" ? 10000 : 0;
}

// --- Main resolver ---
function resolveShowboxStreams(imdbId, type, season, episode) {
  return searchShowbox(imdbId).then(function (mediaId) {
    if (!mediaId) return [];
    return shareKey(mediaId, type === "series" ? 2 : 1).then(function (key) {
      if (!key) return [];
      return shareFiles(key).then(function (rootFiles) {
        if (!rootFiles.length) return [];
        var targetPromise;
        if (type === "series" && season !== undefined && episode !== undefined) {
          var seasonFolder = pickSeason(rootFiles, season);
          if (!seasonFolder) return [];
          targetPromise = shareFiles(key, seasonFolder.fid).then(function (epFiles) {
            return pickEpisode(epFiles, episode);
          });
        } else {
          var found = null;
          for (var i = 0; i < rootFiles.length; i++) {
            if (!isDir(rootFiles[i])) { found = rootFiles[i]; break; }
          }
          targetPromise = Promise.resolve(found);
        }
        return targetPromise.then(function (target) {
          if (!target) return [];
          return qualities(target.fid, key);
        });
      });
    });
  });
}

// --- TMDB -> IMDB ---
function tmdbToImdb(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + kind + "/" + tmdbId +
            "?api_key=" + TMDB_KEY + "&language=en-US";
  return fetchWithTimeout(url, { headers: { "Accept": "application/json", "User-Agent": USER_AGENT } }, REQ_TIMEOUT)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return null;
      return j.imdb_id || null;
    })
    .catch(function () { return null; });
}

function qualityLabel(q) {
  var m = String(q || "").match(/(\d{3,4})/);
  return m ? m[1] + "p" : String(q || "Unknown");
}

// --- Nuvio entry point ---
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  if (type === "series" && (seasonNum == null || episodeNum == null)) {
    return Promise.resolve([]);
  }
  if (!febboxCookie()) return Promise.resolve([]);

  return tmdbToImdb(tmdbId, mediaType).then(function (imdbId) {
    if (!imdbId || imdbId.indexOf("tt") !== 0) return [];
    return resolveShowboxStreams(imdbId, type, seasonNum, episodeNum);
  }).then(function (raw) {
    if (!raw || !raw.length) return [];
    raw.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
    return raw.map(function (s) {
      return {
        name: "ShowBox",
        title: "ShowBox " + s.quality + (s.size ? " | " + s.size : ""),
        url: s.url,
        quality: qualityLabel(s.quality),
        type: "direct",
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": "https://www.febbox.com/"
        }
      };
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
