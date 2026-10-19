// HindMovies scraper for Nuvio
// Standalone, sandbox-compatible (WebCrypto for HMAC-SHA256, regex HTML parsing).
// Source: HindMovies provider — searches hindmovie.fit, signs hshare links
// with HMAC-SHA256, resolves to direct download/stream URLs.
// NOTE: base URL hardcoded to https://hindmovie.one (hindmovie.fit 301-redirects
// there as of 2026-10-19; the old .fit/.icu domains no longer serve content).

var BASE_URL = "https://hindmovie.one";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var SECRET_B64 = "NWU5NjA4NWM1NmUwZjU0ZWRhNjU3NzkwYWM1OGQxOWIyNzE0NzljNTA0MzY3ZmM5ZTZhNmMzM2YxZjgyNGU2Yg==";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var REQ_HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 15000);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function getHtml(url, timeoutMs) {
  return fetchWithTimeout(url, { headers: REQ_HEADERS }, timeoutMs || 15000)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
}

// --- HMAC-SHA256 signing (WebCrypto) ---
var _secret = null;
function getSecret() {
  if (!_secret) _secret = atob(SECRET_B64);
  return _secret;
}
function base64Url(input) {
  var bin = "";
  var bytes = new TextEncoder().encode(input);
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hmacSha256Hex(key, data) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    .then(function (k) { return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)); })
    .then(function (ab) {
      var bytes = new Uint8Array(ab), hex = "";
      for (var i = 0; i < bytes.length; i++) {
        var h = bytes[i].toString(16);
        hex += (h.length === 1 ? "0" + h : h);
      }
      return hex.substring(0, 16);
    });
}
function signHShare(rawId, domain) {
  var t = Math.floor(Date.now() / 1000);
  var encoded = base64Url(rawId);
  return hmacSha256Hex(getSecret(), encoded + "|" + t).then(function (s) {
    return domain + "/r.php?d=" + encodeURIComponent(encoded) + "&t=" + t + "&s=" + s;
  });
}

// --- title helpers ---
function parseYear(text) {
  var m = /\b(19|20)\d{2}\b/.exec(text || "");
  return m ? m[0] : null;
}
function cleanTitle(raw) {
  return String(raw || "")
    .replace(/\s*season\s*\d+(?:\s*[-–]\s*\d+)?\s*/gi, " ")
    .replace(/\s*multi[- ]?audio\s*/gi, " ")
    .replace(/\s*(480p|720p|1080p|2160p|4K|UHD|Dual\s*Audio|Hindi|English|Tamil|Telugu|Bengali|Malayalam|Kannada|Dubbed|Subtitle|BluRay|WEB-?DL|x264|x265|HEVC)\s*/gi, " ")
    .replace(/\s*\d{4}\s*/, " ")
    .replace(/\s+/g, " ").trim();
}
function normTitle(s) {
  return String(s || "").toLowerCase().replace(/-/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function titleScore(a, b) {
  a = normTitle(a); b = normTitle(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  var aw = a.split(" ").filter(Boolean), bw = b.split(" ").filter(Boolean);
  var hit = 0;
  aw.forEach(function (w) { if (bw.indexOf(w) !== -1) hit++; });
  return (2 * hit) / (aw.length + bw.length);
}
function extractImdbId(html) {
  var m = /imdb\.com\/title\/(tt\d{7,8})/i.exec(html || "");
  return m ? m[1] : null;
}
function absUrl(href, base) {
  try { return new URL(href, base).toString(); } catch (e) { return href; }
}

// --- HTML parsing (regex, no cheerio) ---
function parseMovieList(html) {
  var movies = [];
  var articleRe = /<article[\s\S]*?<\/article>/gi, am;
  while ((am = articleRe.exec(html))) {
    var el = am[0];
    var linkM = /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(el) ||
                /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(el);
    if (!linkM) continue;
    var rawUrl = linkM[1], rawTitle = linkM[2].replace(/<[^>]+>/g, "").trim();
    if (!rawUrl || !rawTitle) continue;
    var imgM = /<img[^>]+(?:data-src|src)="([^"]+)"/i.exec(el);
    var year = parseYear(rawTitle);
    var imdbId = extractImdbId(el);
    var genres = [];
    var gRe = /class="[^"]*cat-links[^"]*"[\s\S]*?<\/div>/i.exec(el);
    if (gRe) {
      var gaRe = /<a[^>]*>([^<]+)<\/a>/gi, gm;
      while ((gm = gaRe.exec(gRe[0]))) genres.push(gm[1].trim());
    }
    movies.push({
      title: cleanTitle(rawTitle),
      url: absUrl(rawUrl.replace(/#.*$/, ""), BASE_URL),
      poster: imgM ? imgM[1] : null,
      year: year,
      imdbId: imdbId,
      genre: genres.length ? genres.join(", ") : null,
    });
  }
  return movies;
}

function searchMovies(query, page) {
  var url = page === 1
    ? BASE_URL + "/?s=" + encodeURIComponent(query)
    : BASE_URL + "/page/" + page + "/?s=" + encodeURIComponent(query);
  return getHtml(url).then(parseMovieList).catch(function () { return []; });
}

function findBest(movies, title, year, imdbId) {
  if (imdbId) {
    for (var i = 0; i < movies.length; i++) {
      if (movies[i].imdbId && movies[i].imdbId === imdbId) return movies[i];
    }
  }
  var best = null, bestScore = 0.55;
  movies.forEach(function (m) {
    var s = titleScore(m.title, title);
    if (year && m.year && String(m.year) === String(year)) s += 0.15;
    if (s > bestScore) { bestScore = s; best = m; }
  });
  return best;
}

function findMovieByTitle(title, year, imdbId) {
  return searchMovies(title, 1).then(function (page1) {
    var hit = findBest(page1, title, year, imdbId);
    if (hit) return hit;
    if (page1.length > 0) {
      return searchMovies(title, 2).then(function (page2) {
        return findBest(page2, title, year, imdbId);
      });
    }
    return null;
  }).catch(function () { return null; });
}

function parseHShareLink(href) {
  try {
    var parsed = new URL(href);
    var rawId = parsed.searchParams.get("id");
    return rawId ? { domain: parsed.origin, rawId: rawId } : null;
  } catch (e) { return null; }
}

function getMovieSignedLinks(movieUrl) {
  return getHtml(movieUrl).then(function (html) {
    var tasks = [];
    // find maxbutton anchors + preceding h3 quality label
    var btnRe = /<a[^>]+class="[^"]*maxbutton[^"]*"[^>]+href="([^"]+)"[^>]*>/gi, bm;
    while ((bm = btnRe.exec(html))) {
      var href = bm[1];
      var before = html.slice(Math.max(0, bm.index - 2000), bm.index);
      var h3m = /<h3[^>]*>([\s\S]*?)<\/h3>\s*$/i.exec(before);
      var qualityLabel = h3m ? h3m[1].replace(/<[^>]+>/g, "").trim() : "";
      tasks.push({ mvlinkUrl: href, qualityLabel: qualityLabel });
    }
    return Promise.all(tasks.map(function (t) {
      return getHtml(t.mvlinkUrl).then(function (mvHtml) {
        var aRe = /<a[^>]+href="([^"]*[\?&]id=[^"]*)"[^>]*>/gi, am, rawHref = "";
        while ((am = aRe.exec(mvHtml))) {
          var h = am[1];
          if (/get-link-btn/i.test(am[0]) || /get links/i.test(mvHtml.slice(am.index, am.index + 300))) { rawHref = h; break; }
          if (!rawHref) rawHref = h;
        }
        var hshare = parseHShareLink(rawHref);
        if (!hshare) return null;
        return signHShare(hshare.rawId, hshare.domain).then(function (signed) {
          return { signedUrl: signed, qualityLabel: t.qualityLabel };
        });
      }).catch(function () { return null; });
    })).then(function (results) {
      return results.filter(function (r) { return r !== null; });
    });
  }).catch(function () { return []; });
}

function getSeriesEpisodeSignedLink(seriesUrl, season, episode) {
  return getHtml(seriesUrl).then(function (html) {
    var episodeListUrl = null;
    var h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>/gi, hm;
    while ((hm = h3Re.exec(html))) {
      var sm = /Season\s*(\d+)/i.exec(hm[1]);
      if (sm && parseInt(sm[1], 10) === season) {
        var after = html.slice(hm.index + hm[0].length, hm.index + hm[0].length + 3000);
        var am = /<a[^>]+href="([^"]+)"[^>]*>/i.exec(after);
        if (am) { episodeListUrl = am[1]; break; }
      }
    }
    if (!episodeListUrl) {
      var fm = /<a[^>]+class="[^"]*maxbutton[^"]*"[^>]+href="([^"]+)"[^>]*>/i.exec(html);
      if (fm) episodeListUrl = fm[1];
    }
    if (!episodeListUrl) return null;
    return getHtml(absUrl(episodeListUrl, seriesUrl)).then(function (epHtml) {
      var epHref = null;
      var aRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, em;
      while ((em = aRe.exec(epHtml))) {
        var emm = /Episode\s*(\d+)/i.exec(em[2].replace(/<[^>]+>/g, ""));
        if (emm && parseInt(emm[1], 10) === episode) { epHref = em[1]; break; }
      }
      if (!epHref) return null;
      var hshare = parseHShareLink(epHref);
      if (!hshare) return null;
      return signHShare(hshare.rawId, hshare.domain);
    });
  }).catch(function () { return null; });
}

function qualityFromText(text) {
  if (/2160|4k|uhd/i.test(text)) return "4K";
  if (/1080/i.test(text)) return "1080p";
  if (/720/i.test(text)) return "720p";
  if (/480/i.test(text)) return "480p";
  return "HD";
}

function resolveGdshine(url) {
  var id = url.split("/").pop() || "";
  if (!id) return Promise.resolve(null);
  return fetchWithTimeout("https://gdshine.org/api/files/s/" + id, { headers: REQ_HEADERS }, 10000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.data || !j.data.id) return null;
      return fetchWithTimeout("https://gdshine.org/api/downloads/" + j.data.id + "/via-worker",
        { method: "POST", headers: REQ_HEADERS, body: "{}" }, 10000);
    })
    .then(function (r) { return r && r.ok ? r.json() : null; })
    .then(function (j) { return j && j.data && j.data.copyUrl ? j.data.copyUrl : null; })
    .catch(function () { return null; });
}

function resolveSignedUrl(signedUrl, qualityLabel) {
  return getHtml(signedUrl, 20000).then(function (html) {
    var nameM = /Name:\s*([^\n<]+)/i.exec(html.replace(/<[^>]+>/g, "\n"));
    var sizeM = /Size:\s*([^\n<]+)/i.exec(html.replace(/<[^>]+>/g, "\n"));
    var rawName = nameM ? nameM[1].trim() : "";
    var fileSize = sizeM ? sizeM[1].trim() : "";
    var specs = qualityFromText(rawName || qualityLabel);
    var sizeTag = fileSize ? " [" + fileSize + "]" : "";
    var btnUrls = [];
    var bRe = /<a[^>]+class="[^"]*\bbtn\b[^"]*"[^>]+href="([^"]+)"[^>]*>/gi, bmc;
    while ((bmc = bRe.exec(html))) {
      var href = bmc[1];
      if (href && href.indexOf("javascript") !== 0) btnUrls.push(href);
    }
    return Promise.all(btnUrls.map(function (btnUrl) {
      if (btnUrl.toLowerCase().indexOf("gdshine") !== -1) {
        return resolveGdshine(btnUrl).then(function (directUrl) {
          return directUrl ? [{
            name: "HindMovies", title: "GDShine " + specs + sizeTag,
            url: directUrl, quality: /^\d{3,4}p$/.test(specs) ? specs : "Unknown", type: "direct",
          }] : [];
        });
      }
      return getHtml(btnUrl, 12000).then(function (btnHtml) {
        var out = [];
        var lRe = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, lm;
        while ((lm = lRe.exec(btnHtml))) {
          var href = lm[1];
          if (!href || href === "#" || href.indexOf("javascript") === 0) continue;
          var label = lm[2].replace(/<[^>]+>/g, "").trim() || "Stream";
          out.push({
            name: "HindMovies", title: label + " " + specs + sizeTag,
            url: href, quality: /^\d{3,4}p$/.test(specs) ? specs : "Unknown", type: "direct",
          });
          if (out.length >= 6) break;
        }
        return out;
      }).catch(function () { return []; });
    })).then(function (all) {
      var out = [];
      all.forEach(function (arr) { arr.forEach(function (s) { out.push(s); }); });
      return out;
    });
  }).catch(function () { return []; });
}

function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, {}, 10000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return null;
      var title = j.title || j.name || null;
      var date = j.release_date || j.first_air_date || "";
      var ym = /(\d{4})/.exec(date);
      return title ? { title: title, year: ym ? ym[1] : "" } : null;
    })
    .catch(function () { return null; });
}

function tmdbToImdb(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY, {}, 10000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j && j.imdb_id ? j.imdb_id : null; })
    .catch(function () { return null; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  return Promise.all([tmdbMeta(tmdbId, mediaType), tmdbToImdb(tmdbId, mediaType)])
    .then(function (res) {
      var meta = res[0], imdbId = res[1];
      if (!meta) return [];
      return findMovieByTitle(meta.title, meta.year, imdbId).then(function (siteEntry) {
        if (!siteEntry) return [];
        if (siteEntry.imdbId && imdbId && siteEntry.imdbId !== imdbId) return [];
        if (type === "movie") {
          return getMovieSignedLinks(siteEntry.url).then(function (signedLinks) {
            return Promise.all(signedLinks.map(function (sl) {
              return resolveSignedUrl(sl.signedUrl, sl.qualityLabel);
            }));
          }).then(function (all) {
            var out = [];
            all.forEach(function (arr) { arr.forEach(function (s) { out.push(s); }); });
            return out;
          });
        }
        if (type === "series" && seasonNum != null && episodeNum != null) {
          return getSeriesEpisodeSignedLink(siteEntry.url, seasonNum, episodeNum).then(function (signedUrl) {
            if (!signedUrl) return [];
            return resolveSignedUrl(signedUrl, "S" + seasonNum + "E" + episodeNum);
          });
        }
        return [];
      });
    }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.HindMoviesScraperModule = { getStreams: getStreams };
}
