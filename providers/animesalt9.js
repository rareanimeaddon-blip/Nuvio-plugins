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

function compactTitle(s) {
  return normTitle(s).replace(/\s+/g, "");
}

// Exact acceptance only (user rule: zero mismatch tolerance). The old
// scorer accepted containment/Dice matches - "Crayon Shin-chan
// Spin-off" contains the query, so Shinchan S1E1 played the spinoff.
// Accepted forms:
//   - normalized titles identical
//   - identical with spaces removed ("Shin-chan" vs "Shinchan")
//   - the catalog entry equals the query minus its first word, spaced
//     or compact (AnimeSalt lists "Crayon Shin-chan" as "Shinchan")
// A conflicting year (both known, >1 apart) rejects even an exact
// title (remake protection).
function titleAccepted(query, candidate, year, candYear) {
  var q = normTitle(query), c = normTitle(candidate);
  if (!q || !c) return false;
  var ok = false;
  if (q === c) ok = true;
  else if (compactTitle(query) === compactTitle(candidate)) ok = true;
  else {
    var qw = q.split(" ");
    if (qw.length > 1) {
      var rest = qw.slice(1).join(" ");
      if (rest === c || rest.replace(/\s+/g, "") === compactTitle(candidate)) ok = true;
    }
  }
  if (!ok) return false;
  if (year && candYear && Math.abs(year - candYear) > 1) return false;
  return true;
}

function bestMatch(results, title, year) {
  var i;
  for (i = 0; i < results.length; i++) {
    if (titleAccepted(title, results[i].title, year, results[i].year)) return results[i];
  }
  return null;
}

function titleVariants(title) {
  var variants = [title], v;
  v = title.split(/[:\-,]/)[0].trim();
  if (v && v !== title) variants.push(v);
  v = title.split(" ").slice(0, 2).join(" ");
  if (v && variants.indexOf(v) === -1) variants.push(v);
  v = title.split(" ")[0];
  if (v && v.length > 3 && variants.indexOf(v) === -1) variants.push(v);
  var words = title.split(" ");
  if (words.length > 1) {
    v = words.slice(1).join(" ");
    if (v && variants.indexOf(v) === -1) variants.push(v);
    v = words.slice(1).join("");
    if (v && v.length > 3 && variants.indexOf(v) === -1) variants.push(v);
  }
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
        var streamLabel = formatStreamLabel({ title: target.title, quality: "Unknown", season: isTv ? seasonNum : undefined, episode: isTv ? episodeNum : undefined, audio: "Multi-Audio", source: "AnimeSalt", url: m3u8 });
        return [{
          name: streamLabel,
          title: streamLabel,
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
