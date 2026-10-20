// KMMovies scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: KMMovies provider (k1.kmmovies.cam search -> post page ->
// magiclinks/skydrop/pixeldrain/R2 link resolution).
// Cookies for the SkyDrop multi-step flow are handled manually via headers
// (no cookie jar in the sandbox).

var KMMOVIES_BASE = "https://k1.kmmovies.cam";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

var KMMOVIES_HOSTS = {
  "k1.kmmovies.cam": 1, "kmmovies.cam": 1, "kmmovies.baby": 1,
  "kmmovies.cfd": 1, "kmmovies.rest": 1, "kmmovies.pics": 1,
};
var PLAYABLE_HOSTS = {
  "z1.kmphotos.cv": 1, "pixeldrain.com": 1, "cdn.pixeldrain.com": 1,
  "charlie.freakingfileditch.st": 1, "lh3.googleusercontent.com": 1,
  "video-downloads.googleusercontent.com": 1,
};

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function defaultHeaders(referer) {
  var h = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (referer) h.Referer = referer;
  return h;
}

function getHtml(url, referer, timeoutMs) {
  return fetchWithTimeout(url, { headers: defaultHeaders(referer) }, timeoutMs || 12000)
    .then(function (r) { return r.ok ? r.text() : null; })
    .catch(function () { return null; });
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

function isKMMoviesPageUrl(value) {
  try {
    var p = new URL(value);
    return p.protocol === "https:" && !!KMMOVIES_HOSTS[p.hostname];
  } catch (e) { return false; }
}

function isAllowedMediaUrl(value) {
  try {
    var p = new URL(value);
    if (p.protocol !== "https:") return false;
    if (PLAYABLE_HOSTS[p.hostname]) return true;
    return /\.r2\.dev$/.test(p.hostname) ||
           /\.skydrop\.sbs$/.test(p.hostname) ||
           /\.skydrop\.cv$/.test(p.hostname);
  } catch (e) { return false; }
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

var EXCLUDE_PATHS = ["/category/", "/tag/", "/page/", "/genre/", "/trending/", "/browse/",
  "/actor/", "/director/", "/writer/", "/year/", "/disclaimer/", "/privacy-policy/",
  "/dmca/", "/faq/"];

function searchKMMovies(query) {
  var cleanQuery = String(query).replace(/[^\w\s]/g, " ").trim();
  var searchUrl = KMMOVIES_BASE + "/?s=" + encodeURIComponent(cleanQuery);
  return getHtml(searchUrl).then(function (html) {
    if (!html) return [];
    var posts = [];
    var seen = {};
    var aRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = aRe.exec(html)) !== null) {
      var href = m[1].replace(/&amp;/g, "&");
      var rawTitle = stripTags(m[2]);
      if (!href || !isKMMoviesPageUrl(href)) continue;
      var path;
      try { path = new URL(href).pathname; } catch (e) { continue; }
      if (path === "/") continue;
      var bad = false;
      for (var i = 0; i < EXCLUDE_PATHS.length; i++) {
        if (href.indexOf(EXCLUDE_PATHS[i]) !== -1) { bad = true; break; }
      }
      if (bad) continue;
      if (href === "https://kmmovies.rest/" || href === "https://kmmovies.pics/") continue;
      if (rawTitle.length <= 2 || seen[href]) continue;
      seen[href] = 1;
      var yearMatch = rawTitle.match(/\b(19\d\d|20\d\d)\b/);
      var qMatch = rawTitle.match(/\b(4K|2160p|1080p|720p|480p|WEB-DL|WEBRip|BluRay|HDTC)\b/i);
      posts.push({
        title: rawTitle,
        url: href,
        year: yearMatch ? parseInt(yearMatch[1], 10) : undefined,
        quality: qMatch ? qMatch[1] : undefined,
      });
    }
    return posts;
  });
}

function normalizeWords(value) {
  return String(value).toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
    .split(/\s+/).filter(Boolean);
}

function scorePost(post, title, year) {
  var titleWords = normalizeWords(title);
  var wordSet = {};
  normalizeWords(post.title).forEach(function (w) { wordSet[w] = 1; });
  var matched = titleWords.filter(function (w) { return wordSet[w]; }).length;
  var value = matched * 10;
  if (titleWords.length > 0 && matched === titleWords.length) value += 30;
  if (year && post.year === year) value += 100;
  else if (year && post.year !== undefined) value -= 75;
  return value;
}

function getCookieHeader(res) {
  var sc = res.headers.get("set-cookie");
  if (!sc) return "";
  // Split on commas that start a new cookie (not inside expires dates).
  return sc.split(/,(?=[^;,]+=)/).map(function (c) {
    return c.split(";")[0].trim();
  }).filter(Boolean).join("; ");
}

// SkyDrop multi-step resolution with manual cookie handling.
function resolveSkydrop(skydropUrl) {
  var urlObj;
  try { urlObj = new URL(skydropUrl); } catch (e) { return Promise.resolve(null); }
  var hostOk = ["skydrop.sbs", "skydrop.cv"].some(function (d) {
    return urlObj.hostname === d || urlObj.hostname.endsWith("." + d);
  });
  if (urlObj.protocol !== "https:" || !hostOk) return Promise.resolve(null);

  return fetchWithTimeout(skydropUrl, {
    headers: defaultHeaders(skydropUrl), redirect: "manual",
  }, 12000).then(function (pageResponse) {
    var location = pageResponse.headers.get("location");
    if (location) {
      var redirected = new URL(location, urlObj).href;
      return isAllowedMediaUrl(redirected) ? redirected : null;
    }
    if (!pageResponse.ok) return null;
    try { if (new URL(pageResponse.url).origin !== urlObj.origin) return null; } catch (e) { return null; }
    var cookieHeader = getCookieHeader(pageResponse);
    var withCookies = function (h) {
      if (cookieHeader) h.Cookie = cookieHeader;
      return h;
    };
    return pageResponse.text().then(function () {
      return fetchWithTimeout(new URL("/resolve/", urlObj).toString(), {
        method: "POST",
        headers: withCookies(Object.assign(defaultHeaders(), {
          Accept: "application/json",
          Origin: urlObj.origin,
          Referer: pageResponse.url,
          "X-Requested-With": "XMLHttpRequest",
        })),
        redirect: "manual",
      }, 15000);
    }).then(function (resolveResponse) {
      if (!resolveResponse || !resolveResponse.ok) return null;
      return resolveResponse.json().then(function (data) {
        if (!data || !data.success || !data.ready_url) return null;
        var readyUrl = new URL(data.ready_url, pageResponse.url);
        if (readyUrl.origin !== urlObj.origin) return null;
        return fetchWithTimeout(readyUrl.toString(), {
          headers: withCookies(defaultHeaders(pageResponse.url)), redirect: "manual",
        }, 12000).then(function (readyPage) {
          if (!readyPage.ok) return null;
          try { if (new URL(readyPage.url).origin !== urlObj.origin) return null; } catch (e) { return null; }
          return readyPage.text().then(function () {
            return fetchWithTimeout(new URL("/fetch/", readyUrl).toString(), {
              method: "POST",
              headers: withCookies(Object.assign(defaultHeaders(), {
                Origin: urlObj.origin,
                Referer: readyUrl.href,
                "Content-Type": "application/x-www-form-urlencoded",
              })),
              body: "",
              redirect: "manual",
            }, 15000);
          }).then(function (downloadResponse) {
            var downloadLocation = downloadResponse.headers.get("location");
            if (!downloadLocation) return null;
            var mediaUrl = new URL(downloadLocation, readyUrl).href;
            return isAllowedMediaUrl(mediaUrl) ? mediaUrl : null;
          });
        });
      }).catch(function () { return null; });
    });
  }).catch(function () { return null; });
}

function resolveDownloadPage(downloadUrl) {
  return fetchWithTimeout(downloadUrl, {
    headers: Object.assign(defaultHeaders(KMMOVIES_BASE + "/"), { Range: "bytes=0-0" }),
    redirect: "manual",
  }, 12000).then(function (r) {
    var location = r.headers.get("location");
    if (location) {
      var resolved = new URL(location, downloadUrl).toString();
      var ct = (r.headers.get("content-type") || "").toLowerCase();
      if (isAllowedMediaUrl(resolved) &&
          (new URL(resolved).searchParams.has("dl") ||
           ct.indexOf("video/") === 0 || ct.indexOf("octet-stream") !== -1)) {
        return [resolved];
      }
    }
    return getHtml(downloadUrl, KMMOVIES_BASE + "/").then(function (html) {
      if (!html) return [];
      var links = [];
      var aRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>/gi;
      var m;
      while ((m = aRe.exec(html)) !== null) {
        var href = m[1].replace(/&amp;/g, "&");
        if (!/[?&]dl=(?:r2|worker)\b/.test(href)) continue;
        try {
          var absolute = new URL(href, downloadUrl).toString();
          if (links.indexOf(absolute) === -1) links.push(absolute);
        } catch (e) {}
      }
      return links;
    });
  }).catch(function () { return []; });
}

function resolveOnlineMediaUrl(url) {
  return fetchWithTimeout(url, {
    headers: defaultHeaders(KMMOVIES_BASE + "/"), redirect: "manual",
  }, 12000).then(function (response) {
    var location = response.headers.get("location");
    if (!location) return null;
    var redirected = new URL(location, url);
    var videoUrl = redirected.searchParams.get("videoUrl");
    return videoUrl && isAllowedMediaUrl(videoUrl) ? videoUrl : null;
  }).catch(function () { return null; });
}

function resolveMagicLinks(magicUrl, referer, targetEpisode) {
  var results = [];
  return getHtml(magicUrl, referer).then(function (html) {
    if (!html) return results;
    var anchors = [];
    var aRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = aRe.exec(html)) !== null) {
      anchors.push({ href: m[1].replace(/&amp;/g, "&"), text: stripTags(m[2]) });
    }

    if (magicUrl.indexOf("episodes.magiclinks.lol") !== -1) {
      var epLinks = anchors.map(function (a) { return a.href; }).filter(function (href) {
        return href.indexOf("skydrop") !== -1 || href.indexOf("flexplayer") !== -1 ||
               href.indexOf("pixeldrain") !== -1 || href.indexOf("gofile") !== -1 ||
               href.indexOf("download") !== -1;
      });
      if (!epLinks.length) return results;
      var chosenUrl = epLinks[(targetEpisode || 1) - 1] || epLinks[0];
      if (chosenUrl.indexOf("skydrop") !== -1 || chosenUrl.indexOf("flexplayer") !== -1) {
        return resolveSkydrop(chosenUrl).then(function (direct) {
          if (direct) results.push({ url: direct, hostName: "Skydrop", refreshUrl: magicUrl });
          return results;
        });
      }
      if (chosenUrl.indexOf("pixeldrain.com/u/") !== -1) {
        var pdId = chosenUrl.split("/u/")[1].split(/[?#]/)[0];
        if (pdId) results.push({ url: "https://pixeldrain.com/api/file/" + pdId, hostName: "Pixeldrain", refreshUrl: magicUrl });
      }
      return results;
    }

    var hosts = anchors.filter(function (a) {
      var href = a.href;
      return href && href.charAt(0) !== "#" &&
        href.indexOf("magiclinks.lol/about") === -1 &&
        href.indexOf("magiclinks.lol/contact") === -1 &&
        href.indexOf("magiclinks.lol/privacy") === -1;
    });

    var chain = Promise.resolve();
    hosts.forEach(function (host) {
      chain = chain.then(function () {
        var href = host.href, label = host.text;
        var done = Promise.resolve();
        if (label.indexOf("WATCH ONLINE") !== -1 || href.indexOf("videoUrl=") !== -1 || href.indexOf(".r2.dev/") !== -1) {
          var directUrl = href;
          if (href.indexOf("videoUrl=") !== -1) {
            try {
              var parsed = new URL(href).searchParams.get("videoUrl");
              if (parsed) directUrl = parsed;
            } catch (e) {}
          } else if (href.indexOf("/online.php") !== -1) {
            done = resolveOnlineMediaUrl(href).then(function (resolved) {
              if (resolved) directUrl = resolved;
            });
          }
          return done.then(function () {
            if (!isAllowedMediaUrl(directUrl)) return;
            if (directUrl.indexOf("download99.php") !== -1 || directUrl.indexOf("clouddownload.php") !== -1) {
              return resolveDownloadPage(directUrl).then(function (links) {
                links.forEach(function (l) {
                  results.push({ url: l, hostName: "R2 Cloud", refreshUrl: magicUrl });
                });
              });
            }
            results.push({ url: directUrl, hostName: "R2 Cloud", refreshUrl: magicUrl });
          });
        }
        if (href.indexOf("skydrop") !== -1 || href.indexOf("flexplayer") !== -1 || label.indexOf("SKYDROP") !== -1) {
          return resolveSkydrop(href).then(function (direct) {
            if (direct) results.push({ url: direct, hostName: "Skydrop", refreshUrl: magicUrl });
          });
        }
        if (href.indexOf("pixeldrain.com/u/") !== -1 || label.indexOf("PIXELDRAIN") !== -1) {
          var pdId = href.split("/u/")[1];
          if (pdId) {
            pdId = pdId.split(/[?#]/)[0];
            results.push({ url: "https://pixeldrain.com/api/file/" + pdId, hostName: "Pixeldrain", refreshUrl: magicUrl });
          }
          return;
        }
        if (label.indexOf("ZIP-ZAP") !== -1 || label.indexOf("ONE CLICK") !== -1 ||
            href.indexOf("download99.php") !== -1 || href.indexOf("clouddownload.php") !== -1 ||
            href.indexOf("fddownload.php") !== -1) {
          if (href.indexOf("download99.php") !== -1 || href.indexOf("clouddownload.php") !== -1) {
            return resolveDownloadPage(href).then(function (links) {
              links.forEach(function (l) {
                results.push({ url: l, hostName: "Fast Cloud", refreshUrl: magicUrl });
              });
            });
          }
          results.push({ url: href, hostName: "Fast Cloud", refreshUrl: magicUrl });
        }
      });
    });
    return chain.then(function () { return results; });
  });
}

function formatServerName(hostName) {
  var n = String(hostName || "").toLowerCase();
  if (n.indexOf("pixeldrain") !== -1) return "Pixeldrain";
  if (n.indexOf("skydrop") !== -1) return "SkyDrop";
  if (n.indexOf("r2") !== -1) return "R2 Cloud";
  if (n.indexOf("fast") !== -1) return "Fast Server";
  return hostName || "CDN";
}

function normalizeQuality(q) {
  var m = /\b(4K|2160p|1080p|720p|480p|360p)\b/i.exec(q || "");
  if (!m) return "Unknown";
  var v = m[1].toUpperCase();
  return v === "4K" ? "2160p" : v;
}

function isPlayableVideoUrl(url) {
  if (!isAllowedMediaUrl(url)) return Promise.resolve(false);
  return fetchWithTimeout(url, {
    method: "GET",
    headers: Object.assign(defaultHeaders(), {
      Range: "bytes=0-1023",
      Referer: KMMOVIES_BASE + "/",
    }),
    redirect: "follow",
  }, 15000).then(function (response) {
    if (!response.ok && response.status !== 206) return false;
    var contentType = (response.headers.get("content-type") || "").toLowerCase();
    var contentRange = response.headers.get("content-range") || "";
    return response.arrayBuffer().then(function (ab) {
      var bytes = new Uint8Array(ab);
      var isMatroska = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 &&
                       bytes[2] === 0xdf && bytes[3] === 0xa3;
      var looksLikeVideo = contentType.indexOf("video/") === 0 ||
        contentType.indexOf("octet-stream") !== -1 || isMatroska;
      return looksLikeVideo && (contentRange.indexOf("bytes") !== -1 || bytes.length > 0);
    }).catch(function () { return false; });
  }).catch(function () { return false; });
}

function extractQualityLinks(html) {
  var links = [];
  var seen = {};
  var aRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = aRe.exec(html)) !== null) {
    var href = m[1].replace(/&amp;/g, "&");
    var text = stripTags(m[2]);
    if (!href || href.charAt(0) === "#") continue;
    var low = href.toLowerCase();
    if (!(low.indexOf("magiclinks") !== -1 || low.indexOf("download") !== -1 ||
          low.indexOf("drive") !== -1 || low.indexOf("skydrop") !== -1 ||
          low.indexOf("pixeldrain") !== -1 || low.indexOf("online.php") !== -1)) continue;
    if (isKMMoviesPageUrl(href)) continue;
    if (/facebook\.com|twitter\.com|telegram|t\.me|whatsapp/i.test(href)) continue;
    if (seen[href]) continue;
    seen[href] = 1;
    var qMatch = text.match(/\b(4K|2160p|1080p|720p(?:\s*10bit)?|480p)\b/i) ||
                 href.match(/\b(4K|2160p|1080p|720p|480p)\b/i);
    var sizeMatch = text.match(/\b(\d+(?:\.\d+)?\s*(?:GB|MB))\b/i);
    links.push({
      quality: qMatch ? qMatch[1].toUpperCase() : "1080p",
      size: sizeMatch ? sizeMatch[1].toUpperCase() : undefined,
      url: href,
      isEpisodePage: href.indexOf("episodes.magiclinks.lol") !== -1,
    });
  }
  return links;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isSeries = mediaType === "tv";
  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta) return [];
    var title = meta.title, year = meta.year;
    var searchQueries = [];
    if (isSeries && seasonNum) {
      var sPadded = seasonNum < 10 ? "S0" + seasonNum : "S" + seasonNum;
      searchQueries.push(title + " " + sPadded);
      searchQueries.push(title + " Season " + seasonNum);
    }
    searchQueries.push(title);
    if (year) searchQueries.push(title + " " + year);

    var candidates = {};
    var chain = Promise.resolve();
    searchQueries.forEach(function (q) {
      chain = chain.then(function () {
        return searchKMMovies(q).then(function (posts) {
          posts.forEach(function (p) { candidates[p.url] = p; });
        });
      });
    });
    return chain.then(function () {
      var list = Object.keys(candidates).map(function (k) { return candidates[k]; });
      if (!list.length) return [];
      list.sort(function (a, b) { return scorePost(b, title, year) - scorePost(a, title, year); });
      var matchedPost = list[0];
      return getHtml(matchedPost.url).then(function (postHtml) {
        if (!postHtml) return [];
        var qualityLinks = extractQualityLinks(postHtml);
        if (!qualityLinks.length) return [];
        var targetLinks = qualityLinks;
        if (isSeries && qualityLinks.some(function (q) { return q.isEpisodePage; })) {
          targetLinks = qualityLinks.filter(function (q) { return q.isEpisodePage; });
        }
        var streams = [];
        // Bound the resolution fan-out for sandbox time limits.
        var queue = targetLinks.slice(0, 8);
        var qi = 0;
        function nextQ() {
          if (qi >= queue.length) return Promise.resolve();
          var batch = queue.slice(qi, qi + 2);
          qi += 2;
          return Promise.all(batch.map(function (ql) {
            return resolveMagicLinks(ql.url, matchedPost.url, episodeNum || 1).then(function (resolved) {
              resolved.forEach(function (res) {
                var epLabel = isSeries ? " S" + (seasonNum || 1) + "E" + (episodeNum || 1) : "";
                var sizeLabel = ql.size ? " · " + ql.size : "";
                var serverName = formatServerName(res.hostName);
                streams.push({
                  name: "KMMovies",
                  title: matchedPost.title + " · " + ql.quality + epLabel + sizeLabel + " · " + serverName,
                  url: res.url,
                  quality: normalizeQuality(ql.quality),
                  type: "direct",
                  _refreshable: !!res.refreshUrl,
                });
              });
            }).catch(function () {});
          })).then(nextQ);
        }
        return nextQ().then(function () {
          var seenUrls = {};
          var unique = streams.filter(function (s) {
            if (seenUrls[s.url]) return false;
            seenUrls[s.url] = 1;
            return true;
          });
          // Refreshable links carry a refreshUrl so the player can renew them;
          // the source provider deliberately does not probe those.
          var refreshable = unique.filter(function (s) { return s._refreshable; });
          var direct = unique.filter(function (s) { return !s._refreshable; });
          var di = 0;
          function nextD() {
            if (di >= direct.length) return Promise.resolve([]);
            var batch = direct.slice(di, di + 3);
            di += 3;
            return Promise.all(batch.map(function (s) {
              return isPlayableVideoUrl(s.url).then(function (ok) { return ok ? s : null; });
            })).then(function (res) {
              return nextD().then(function (rest) {
                return res.filter(Boolean).concat(rest);
              });
            });
          }
          return nextD().then(function (checkedDirect) {
            return refreshable.concat(checkedDirect).map(function (s) {
              return { name: s.name, title: s.title, url: s.url, quality: s.quality, type: "direct" };
            });
          });
        });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.KMMoviesScraperModule = { getStreams: getStreams };
}
