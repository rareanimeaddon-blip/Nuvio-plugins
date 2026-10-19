// ShowBox / FebBox scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: ShowBox provider — resolves direct MP4 streams from showbox.media
// via the FebBox file-sharing API.
//
// NOTE: quality-level download links require a FebBox "ui" cookie token.
// Paste it below. Without it the scraper returns [] gracefully.
var FEBBOX_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODQ5OTM4NDcsIm5iZiI6MTc4NDk5Mzg0NywiZXhwIjoxODE2MDk3ODY3LCJkYXRhIjp7InVpZCI6MjIxODYyNCwidG9rZW4iOiIzODZlZjAxMTFhNWM4NGRhMzFlY2Y3NTIwYzNhNzM1YiJ9fQ.XGa9kccveelGw69OwCym8AtZfNE0Sq49K0VYDQfrLcc";

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var SHOWBOX = "https://showbox.media";
var FEBBOX = "https://www.febbox.com";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function addonHeaders(extra) {
  var h = {
    "user-agent": UA,
    accept: "application/json, text/html, */*",
    "accept-language": "en",
  };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}

function febboxCookie() {
  var token = (FEBBOX_TOKEN || "").trim();
  if (!token) return "";
  return token.indexOf("ui=") === 0 ? token : "ui=" + token;
}

function tmdbToImdb(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY,
    { headers: { Accept: "application/json", "User-Agent": UA } }, 10000
  ).then(function (r) { return r.ok ? r.json() : null; })
   .then(function (j) { return j && j.imdb_id ? j.imdb_id : null; })
   .catch(function () { return null; });
}

function showboxJson(url, extra) {
  return fetchWithTimeout(url, { headers: addonHeaders(extra) }, 15000).then(function (r) {
    if (!r.ok) return null;
    var ct = r.headers.get("content-type") || "";
    if (ct.indexOf("json") === -1) return null;
    return r.json().catch(function () { return null; });
  }).catch(function () { return null; });
}

function searchShowbox(imdbId) {
  return fetchWithTimeout(SHOWBOX + "/search?keyword=" + encodeURIComponent(imdbId),
      { headers: addonHeaders() }, 15000)
    .then(function (r) { return r.ok ? r.text() : null; })
    .then(function (html) {
      if (!html) return null;
      var m = html.match(/class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/i) ||
              html.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/i);
      if (!m) return null;
      return fetchWithTimeout(SHOWBOX + m[1], { headers: addonHeaders() }, 15000)
        .then(function (r) { return r.ok ? r.text() : null; });
    }).then(function (detailHtml) {
      if (!detailHtml) return null;
      var hm = detailHtml.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i);
      if (!hm) return null;
      var parts = hm[1].split("/");
      var mediaId = Number(parts[parts.length - 1]);
      return isFinite(mediaId) ? mediaId : null;
    }).catch(function () { return null; });
}

function shareKey(mediaId, type) {
  return showboxJson(SHOWBOX + "/index/share_link?id=" + mediaId + "&type=" + type).then(function (data) {
    var link = data && data.data && data.data.link;
    if (!link) return null;
    var parts = link.split("/");
    return parts[parts.length - 1] || null;
  });
}

function shareFiles(key, parentId) {
  var cookie = febboxCookie();
  var url = FEBBOX + "/file/file_share_list?share_key=" + encodeURIComponent(key);
  if (parentId !== undefined) url += "&parent_id=" + encodeURIComponent(String(parentId)) + "&page=1";
  var extra = cookie ? { cookie: cookie } : {};
  return showboxJson(url, extra).then(function (data) {
    return (data && data.data && data.data.file_list) || [];
  });
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }

function pickSeason(files, season) {
  var s = pad2(season);
  var dirs = files.filter(function (f) { return f.is_dir; });
  for (var i = 0; i < dirs.length; i++) {
    var name = String(dirs[i].file_name || "").toLowerCase();
    if (name.indexOf("season " + season) !== -1 || name.indexOf("s" + s) !== -1 ||
        name === "season " + season || name === "s" + s) return dirs[i];
  }
  return dirs[0] || null;
}

function pickEpisode(files, episode) {
  var e = pad2(episode);
  var vids = files.filter(function (f) { return !f.is_dir; });
  for (var i = 0; i < vids.length; i++) {
    var name = String(vids[i].file_name || "").toLowerCase();
    if (name.indexOf("e" + e) !== -1 || name.indexOf("ep" + e) !== -1 ||
        name.indexOf("episode " + episode) !== -1 ||
        name.indexOf("- " + e + " ") !== -1 || name.indexOf("." + e + ".") !== -1) return vids[i];
  }
  return vids[0] || null;
}

function qualities(fid, key) {
  var cookie = febboxCookie();
  if (!cookie) return Promise.resolve([]);
  var url = FEBBOX + "/console/video_quality_list?fid=" + encodeURIComponent(String(fid)) +
    "&share_key=" + encodeURIComponent(key);
  return showboxJson(url, { cookie: cookie }).then(function (data) {
    var html = (data && data.html) || "";
    var streams = [];
    var tagRe = /<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/gi;
    var m;
    while ((m = tagRe.exec(html)) !== null) {
      var tag = m[0];
      var um = tag.match(/data-url="([^"]+)"/);
      var qm = tag.match(/data-quality="([^"]+)"/);
      var sm = tag.match(/data-size="([^"]+)"/);
      if (um && qm) {
        streams.push({ url: um[1].replace(/\\\//g, "/"), quality: qm[1], size: sm ? sm[1] : "" });
      }
    }
    return streams;
  });
}

function qualityLabel(q) {
  var m = /(\d{3,4})p/i.exec(q || "");
  return m ? m[1] + "p" : "Unknown";
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (!febboxCookie()) {
    console.log("[ShowBox] FEBBOX_TOKEN not set — returning no streams (paste your FebBox ui cookie at the top of the file).");
    return Promise.resolve([]);
  }
  var type = mediaType === "tv" ? "2" : "1"; // showbox API: 1=movie, 2=tv
  return tmdbToImdb(tmdbId, mediaType).then(function (imdbId) {
    if (!imdbId || imdbId.indexOf("tt") !== 0) return [];
    return searchShowbox(imdbId).then(function (mediaId) {
      if (!mediaId) return [];
      return shareKey(mediaId, type === "series" ? 2 : 1).then(function (key) {
        if (!key) return [];
        return shareFiles(key).then(function (rootFiles) {
          if (!rootFiles.length) return [];
          if (type === "series" && seasonNum != null && episodeNum != null) {
            var folder = pickSeason(rootFiles, seasonNum);
            if (!folder) return [];
            return shareFiles(key, folder.fid).then(function (epFiles) {
              var target = pickEpisode(epFiles, episodeNum);
              return target ? qualities(target.fid, key) : [];
            });
          }
          var target = null;
          for (var i = 0; i < rootFiles.length; i++) {
            if (!rootFiles[i].is_dir) { target = rootFiles[i]; break; }
          }
          return target ? qualities(target.fid, key) : [];
        });
      });
    });
  }).then(function (raw) {
    raw.sort(function (a, b) {
      function rank(q) {
        var m = /(\d{3,4})/.exec(q || "");
        return m ? Number(m[1]) : (String(q).toUpperCase() === "ORG" ? 10000 : 0);
      }
      return rank(b.quality) - rank(a.quality);
    });
    return raw.map(function (s) {
      var q = qualityLabel(s.quality);
      return {
        name: "ShowBox",
        title: "ShowBox | " + s.quality + (s.size ? " | " + s.size : ""),
        url: s.url,
        quality: q,
        type: "direct",
      };
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.ShowBoxScraperModule = { getStreams: getStreams };
}
