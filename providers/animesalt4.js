/* __FETCH_RETRY_PRELUDE__ v4 (webOS TV): the TV plugin fetch service
   intermittently returns status-0 transport failures. Wrap the global
   fetch so a rejection or status-0 response is retried up to 3 attempts.
   NON-BLOCKING on purpose: earlier spin-wait pauses stalled the shared
   fetch path and multiplied every hang to ~31s, blowing the app's
   per-provider budget in full searches. Immediate promise retries cost
   nothing when the route is healthy and still rescue isolated drops. */
(function () {
  try {
    var cur = (typeof fetch !== "undefined") ? fetch : null;
    if (!cur || cur.__nuvioRetry) return;
    var raw = cur;
    var wrapped = function (url, opts) {
      var tries = 0;
      var attempt = function () {
        tries++;
        return raw(url, opts).then(function (r) {
          if (r && r.status === 0 && tries < 3) return attempt();
          return r;
        }, function (e) {
          if (tries < 3) return attempt();
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


// AnimeSalt scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: AnimeSalt provider (https://animesalt.cx)
// Anime/animation only (TMDB genre check). Resolves the site's own HLS
// player: episode page -> as-cdn iframe (/video/<hash>) -> POST getVideo -> m3u8.
// The provider's embedded Abyss Player links are intentionally NOT exposed
// (the original addon keeps them internal too).

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var BASE = "https://animesalt.cx";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function httpGet(url, referer) {
  return fetchWithTimeout(url, {
    headers: { "User-Agent": UA, Referer: referer || BASE + "/" },
  }, 20000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function httpPostForm(url, params, headers) {
  var body = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
  }).join("&");
  return fetchWithTimeout(url, {
    method: "POST",
    headers: Object.assign(
      { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      headers || {}
    ),
    body: body,
  }, 15000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

// ---- TMDB meta (title + year + animation flag, one request) ----

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
      var genres = j.genres || [];
      var isAnimation = false, i;
      for (i = 0; i < genres.length; i++) {
        if (genres[i] && genres[i].id === 16) { isAnimation = true; break; }
      }
      if (!isAnimation && j.origin_country && j.origin_country.indexOf("JP") !== -1) isAnimation = true;
      return {
        title: j.title || j.name || null,
        year: date ? parseInt(date.split("-")[0], 10) : null,
        isAnimation: isAnimation,
      };
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
  return (2 * hit) / (qw.length + cw.length);
}

function bestMatch(results, title, year) {
  var best = null, bestScore = 0.45, i, r, s, dy;
  for (i = 0; i < results.length; i++) {
    r = results[i];
    s = textScore(title, r.title);
    if (year && r.year) {
      dy = Math.abs(year - r.year);
      if (dy === 0) s += 0.15;
      else if (dy === 1) s += 0.05;
      else if (dy > 2) s -= 0.2;
    }
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return best;
}

function titleVariants(title) {
  var variants = [title], v;
  v = title.split(/[:\-,]/)[0].trim();
  if (v && v !== title) variants.push(v);
  v = title.split(" ").slice(0, 2).join(" ");
  if (v && variants.indexOf(v) === -1) variants.push(v);
  v = title.split(" ")[0];
  if (v && v.length > 3 && variants.indexOf(v) === -1) variants.push(v);
  return variants;
}

// ---- site search (regex HTML parsing, no cheerio) ----

function parseLiResults(html) {
  var results = [];
  var liRegex = /<li id="post-\d+" class="([^"]+)">([\s\S]*?)<\/li>/g;
  var liMatch, classes, content, type, linkMatch, titleMatch, yearMatch, slug;
  while ((liMatch = liRegex.exec(html)) !== null) {
    classes = liMatch[1];
    content = liMatch[2];
    type = classes.indexOf("type-series") !== -1 ? "series"
      : classes.indexOf("type-movies") !== -1 ? "movies" : null;
    if (!type) continue;
    linkMatch = content.match(/href="(https:\/\/animesalt\.(?:ac|link|cx)\/(series|movies)\/([^\/"]+)\/?)"/);
    titleMatch = content.match(/entry-title[^>]*>([^<]+)</);
    yearMatch = content.match(/class="year[^"]*">(\d{4})/);
    if (linkMatch && titleMatch) {
      slug = linkMatch[3];
      var dup = false, i;
      for (i = 0; i < results.length; i++) if (results[i].slug === slug) { dup = true; break; }
      if (!dup && slug && slug !== "page") {
        results.push({
          url: linkMatch[1],
          type: type,
          slug: slug,
          title: titleMatch[1].trim(),
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
        });
      }
    }
  }
  return results;
}

function searchSite(title, mediaType, year) {
  var wantType = mediaType === "movie" ? "movies" : "series";
  var url = BASE + "/?s=" + encodeURIComponent(title);
  return httpGet(url).then(function (html) {
    var results = parseLiResults(html);
    if (results.length === 0 && html.indexOf('class="navigation pagination"') !== -1) {
      return httpGet(BASE + "/page/2/?s=" + encodeURIComponent(title))
        .then(parseLiResults)
        .catch(function () { return []; });
    }
    return results;
  }).then(function (results) {
    var filtered = results.filter(function (r) { return r.type === wantType; });
    return bestMatch(filtered, title, year);
  }).catch(function () { return null; });
}

function tryDirectUrl(title, mediaType) {
  var prefix = mediaType === "movie" ? "movies" : "series";
  var slugs = [
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    title.toLowerCase().replace(/[^a-z0-9]/g, ""),
    (title.split(" ")[0] || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
  ];
  var seen = {}, chain = Promise.resolve(null);
  slugs.forEach(function (slug) {
    if (!slug || seen[slug]) return;
    seen[slug] = 1;
    chain = chain.then(function (found) {
      if (found) return found;
      var url = BASE + "/" + prefix + "/" + slug + "/";
      return httpGet(url).then(function (html) {
        return html.length > 5000
          ? { url: url, type: prefix, slug: slug, title: title, year: null }
          : null;
      }).catch(function () { return null; });
    });
  });
  return chain;
}

// ---- episode + player resolution ----

function episodeUrlFromHtml(html, season, episode) {
  var re = new RegExp('href="(https://animesalt\\.(?:ac|link|cx)/episode/[^"]*' + season + "x" + episode + '[^"]*)"');
  var m = html.match(re);
  return m ? m[1] : null;
}

function getEpisodeUrl(seriesUrl, season, episode) {
  return httpGet(seriesUrl).then(function (html) {
    var seasons = [], m;
    var seasonRegex = /data-post="(\d+)"\s+data-season="(\d+)"/g;
    while ((m = seasonRegex.exec(html)) !== null) {
      seasons.push({ post: m[1], season: parseInt(m[2], 10) });
    }
    if (seasons.length === 0) return episodeUrlFromHtml(html, season, episode);
    var target = null, i;
    for (i = 0; i < seasons.length; i++) {
      if (seasons[i].season === season) { target = seasons[i]; break; }
    }
    if (!target) return null;
    var ajaxUrl = BASE + "/wp-admin/admin-ajax.php?action=action_select_season&season=" +
      season + "&post=" + target.post;
    return httpGet(ajaxUrl, seriesUrl).then(function (epHtml) {
      return episodeUrlFromHtml(epHtml, season, episode);
    });
  }).catch(function () { return null; });
}

function getM3u8(pageUrl) {
  return httpGet(pageUrl).then(function (html) {
    var iframeMatch = html.match(/src="(https?:\/\/as-cdn\d+\.top\/video\/([a-f0-9]+))"/);
    if (!iframeMatch) {
      iframeMatch = html.match(/src="(https?:\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}\/video\/([a-f0-9]{16,}))"/);
    }
    if (!iframeMatch) {
      iframeMatch = html.match(/src="(https?:\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}[^"]*[?&]data=([a-f0-9]{16,})[^"]*)"/);
    }
    if (!iframeMatch) return null;
    var playerUrl = iframeMatch[1], hash = iframeMatch[2];
    var playerCdn = playerUrl.indexOf("/video/") !== -1
      ? playerUrl.split("/video/")[0]
      : playerUrl.split("/").slice(0, 3).join("/");

    var postUrl = playerCdn + "/player/index.php?data=" + hash + "&do=getVideo";
    return httpPostForm(postUrl, { hash: hash, r: BASE + "/" }, {
      Referer: BASE + "/",
      Origin: playerCdn,
      "X-Requested-With": "XMLHttpRequest",
    }).then(function (data) {
      return data && (data.videoSource || data.securedLink || data.file ||
        data.url || data.hls || data.src) || null;
    }).catch(function () { return null; })
    .then(function (m3u8) {
      if (m3u8) return m3u8;
      // Fallback: scrape the player page HTML for an m3u8 URL.
      return httpGet(playerUrl, BASE + "/").then(function (playerHtml) {
        var m = playerHtml.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*?)["']/);
        return m ? m[1] : null;
      }).catch(function () { return null; });
    });
  }).catch(function () { return null; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isTv = mediaType === "tv";
  var kind = isTv ? "series" : "movie";
  if (isTv && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);

  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta || !meta.title || !meta.isAnimation) return [];
    var variants = titleVariants(meta.title);
    var chain = Promise.resolve(null);
    variants.forEach(function (v) {
      chain = chain.then(function (found) {
        if (found) return found;
        return searchSite(v, kind, meta.year);
      });
    });
    return chain.then(function (target) {
      if (!target) return tryDirectUrl(meta.title, kind);
      return target;
    });
  }).then(function (target) {
    if (!target) return [];
    var pagePromise = isTv
      ? getEpisodeUrl(target.url, seasonNum, episodeNum).then(function (epUrl) { return epUrl; })
      : Promise.resolve(target.url);
    return pagePromise.then(function (pageUrl) {
      if (!pageUrl) return [];
      return getM3u8(pageUrl).then(function (m3u8) {
        if (!m3u8 || !/^https?:\/\//.test(m3u8)) return [];
        return [{
          name: "AnimeSalt",
          title: "AnimeSalt • Multi-Audio" + (isTv ? " S" + seasonNum + "E" + episodeNum : ""),
          url: m3u8,
          quality: "Unknown",
          type: "direct",
        }];
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.AnimeSaltScraperModule = { getStreams: getStreams };
}

/* __CHAIN_RETRY_POSTLUDE__: full-search crowds on TV starve long chains;
   if the first attempt comes back empty fast (a dropped hop), run the
   whole chain once more. Bounded: only when attempt 1 took < 25s. */
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
      return Promise.resolve().then(function () { return orig.apply(null, args); }).then(function (res) {
        if (Array.isArray(res) && res.length === 0 && Date.now() - t0 < 25000) {
          return orig.apply(null, args);
        }
        return res;
      }, function () {
        if (Date.now() - t0 < 25000) return orig.apply(null, args);
        return [];
      });
    };
    wrapped.__chainRetry = true;
    if (typeof module !== "undefined" && module.exports) module.exports.getStreams = wrapped;
    if (g) { try { g.getStreams = wrapped; } catch (e) {} }
  } catch (e) {}
})();
