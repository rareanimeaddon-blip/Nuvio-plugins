// AnimeWorld scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: AnimeWorld provider (watchanimeworld.top search -> episode page ->
// Zephyr iframe -> player API securedLink).
// NOTE: only the Zephyr player is used (Abyss/dub-player iframes are skipped,
// same as the source provider). The source provider proxied streams through
// its own server; here we resolve the Zephyr player API directly and return
// the securedLink as a direct URL.

var BASE = "https://watchanimeworld.top";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var TIMEOUT = 20000;
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || TIMEOUT);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function getHtml(url, extraHeaders) {
  var headers = Object.assign(
    { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    extraHeaders || {}
  );
  return fetchWithTimeout(url, { headers: headers }, TIMEOUT)
    .then(function (r) { return r.ok ? r.text() : null; })
    .catch(function () { return null; });
}

function tmdbTitle(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY,
    { headers: { Accept: "application/json" } },
    10000
  )
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j ? (j.title || j.name) : null; })
    .catch(function () { return null; });
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}
function compact(s) { return norm(s).replace(/\s+/g, ""); }
function score(a, b) {
  if (compact(a) === compact(b) && compact(a)) return 1;
  var x = norm(a).split(" ").filter(Boolean);
  var y = norm(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return 0;
  var yset = {};
  y.forEach(function (v) { yset[v] = 1; });
  var hit = 0;
  x.forEach(function (v) { if (yset[v]) hit++; });
  return (2 * hit) / (x.length + y.length);
}

function searchVariants(title) {
  var beforeColon = title.split(":")[0].trim();
  var hyphenToSpace = title.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  var collapsed = title.replace(/[-\s]+/g, "").trim();
  var seen = {};
  return [title, beforeColon, hyphenToSpace, collapsed].filter(function (v) {
    v = (v || "").trim();
    if (v.length <= 2 || seen[v]) return false;
    seen[v] = 1;
    return true;
  });
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseSearchResults(html) {
  var out = [];
  var seen = {};
  var blockRe = /<(li|article)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  var m, block;
  while ((m = blockRe.exec(html)) !== null) {
    block = m[2];
    var aM = /<a\b[^>]*\bclass="[^"]*\blnk-blk\b[^"]*"[^>]*\bhref="([^"]+)"/i.exec(block) ||
             /<a\b[^>]*\bhref="([^"]+)"[^>]*\bclass="[^"]*\blnk-blk\b[^"]*"/i.exec(block);
    var hM = /<h[12]\b[^>]*\bclass="[^"]*\bentry-title\b[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/i.exec(block);
    if (!aM || !hM) continue;
    var href = aM[1];
    var name = stripTags(hM[1]);
    if (!href || !name) continue;
    var absolute;
    try { absolute = new URL(href, BASE).toString(); } catch (e) { continue; }
    var path;
    try { path = new URL(absolute).pathname; } catch (e) { continue; }
    var slug = path.replace(/\/+$/, "").split("/").pop() || "";
    if (!slug || seen[slug]) continue;
    seen[slug] = 1;
    out.push({
      slug: slug,
      title: name,
      type: path.indexOf("/movies/") !== -1 ? "movie" : "series",
    });
  }
  return out;
}

function findAnimeWorldSlug(title, type) {
  var queries = searchVariants(title);
  var all = {};
  var chain = Promise.resolve();
  queries.forEach(function (q) {
    chain = chain.then(function () {
      return getHtml(BASE + "/?s=" + encodeURIComponent(q)).then(function (html) {
        if (!html) return;
        parseSearchResults(html).forEach(function (item) {
          all[item.type + ":" + item.slug] = item;
        });
      }).catch(function () {});
    });
  });
  return chain.then(function () {
    var pool = Object.keys(all).map(function (k) { return all[k]; });
    var typed = pool.filter(function (c) { return c.type === type; });
    var list = typed.length ? typed : pool;
    list.sort(function (a, b) { return score(b.title, title) - score(a.title, title); });
    var best = list[0];
    if (best && score(best.title, title) >= 0.45) return { slug: best.slug, title: best.title };
    return null;
  });
}

function tagAttr(tag, name) {
  var m = new RegExp(name + '\\s*=\\s*"([^"]*)"', "i").exec(tag) ||
          new RegExp(name + "\\s*=\\s*'([^']*)'", "i").exec(tag);
  return m ? m[1] : "";
}

function extractIframes(html) {
  var out = [];
  var re = /<iframe\b[^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var tag = m[0];
    var src = tagAttr(tag, "src").trim();
    var lazy = tagAttr(tag, "data-src").trim();
    var raw = (src && !/^(about:blank|javascript:)/i.test(src)) ? src : lazy;
    if (raw) out.push(raw.replace(/&amp;/g, "&"));
  }
  return out;
}

// Resolve a Zephyr player page to its direct video URL via the player API.
function resolveZephyr(playerUrl) {
  var idM = /\/video\/([A-Za-z0-9_-]+)/i.exec(playerUrl);
  if (!idM) return Promise.resolve(null);
  var id = idM[1];
  var origin;
  try { origin = new URL(playerUrl).origin; } catch (e) { return Promise.resolve(null); }
  var apiUrl = origin + "/player/index.php?data=" + encodeURIComponent(id) + "&do=getVideo";
  var body = "hash=" + encodeURIComponent(id) + "&r=" + encodeURIComponent(playerUrl);
  return fetchWithTimeout(apiUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Referer": playerUrl,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body,
  }, 15000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return null;
      var raw = j.securedLink || j.videoSource;
      return raw ? String(raw) : null;
    })
    .catch(function () { return null; });
}

function qualityFromUrl(url) {
  var m = /(\d{3,4})p/i.exec(url || "");
  return m ? m[1] + "p" : "Unknown";
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    return findAnimeWorldSlug(title, type);
  }).then(function (match) {
    if (!match) return [];
    var page = type === "movie"
      ? BASE + "/movies/" + match.slug
      : BASE + "/episode/" + match.slug + "-" + (seasonNum || 1) + "x" + (episodeNum || 1) + "/";
    return getHtml(page).then(function (html) {
      if (!html) return [];
      var seen = {};
      var zephyrs = [];
      extractIframes(html).forEach(function (raw) {
        var u;
        try { u = new URL(raw, page).toString(); } catch (e) { return; }
        var path;
        try { path = new URL(u).pathname; } catch (e) { return; }
        if (/\/dub-player\/t\/\d+\/?$/.test(path)) return; // nested dub page: abyss only
        if (!/zephyr/i.test(u)) return; // keep Zephyr only, like the source
        if (seen[u]) return;
        seen[u] = 1;
        zephyrs.push(u);
      });
      // Resolve with limited parallelism.
      var results = [];
      var i = 0;
      function next() {
        if (i >= zephyrs.length) return Promise.resolve();
        var batch = zephyrs.slice(i, i + 3);
        i += 3;
        return Promise.all(batch.map(function (u) {
          return resolveZephyr(u).then(function (direct) {
            if (direct) results.push(direct);
          });
        })).then(next);
      }
      return next().then(function () {
        var seenUrl = {};
        return results.filter(function (u) {
          if (seenUrl[u]) return false;
          seenUrl[u] = 1;
          return true;
        }).map(function (u) {
          return {
            name: "AnimeWorld",
            title: "AnimeWorld · ZephyrFlick | " + match.title,
            url: u,
            quality: qualityFromUrl(u),
            type: "direct",
          };
        });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.AnimeWorldScraperModule = { getStreams: getStreams };
}
