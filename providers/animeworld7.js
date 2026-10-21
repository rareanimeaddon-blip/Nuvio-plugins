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
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
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

// Exact-title gate (zero-mismatch): every distinctive word of the TMDB title
// must appear as a whole word in the candidate, and the word sets must be
// near-identical (dice >= 0.8) once release/season noise words are dropped.
var TITLE_NOISE = { the: 1, a: 1, an: 1, with: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, subtitle: 1, subtitles: 1, subs: 1, multi: 1, audio: 1, complete: 1,
  hevc: 1, x264: 1, x265: 1, h264: 1, webdl: 1, hdtv: 1, bluray: 1, brrip: 1, hdrip: 1,
  "480p": 1, "720p": 1, "1080p": 1, "1440p": 1, "2160p": 1, "4k": 1, uhd: 1, hd: 1,
  watch: 1, download: 1, online: 1, sony: 1, yay: 1, uncensored: 1, uncut: 1, hungama: 1, tamil: 1, telugu: 1 };
var ACCENT_MAP = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
  "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
  "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
function foldAccents(s) {
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function (ch) { return ACCENT_MAP[ch] || ch; });
}
function exactWords(s) {
  var seen = {}, out = [];
  norm(foldAccents(String(s).toLowerCase())).split(" ").forEach(function (w) {
    if (!w || TITLE_NOISE[w] || /^\d+$/.test(w) || /^s\d{1,2}(e\d{1,2})?$/.test(w) || /^e\d{1,2}$/.test(w)) return;
    if (!seen[w]) { seen[w] = 1; out.push(w); }
  });
  return out;
}
var TAIL_JUNK = { mal: 1, ben: 1, jap: 1, kor: 1, chi: 1, eng: 1, hq: 1, dvdrip: 1, xvid: 1, aac: 1,
  proper: 1, repack: 1, extended: 1, unrated: 1, remastered: 1, dual: 1, web: 1, dl: 1 };
function isTailJunk(w) { return !!TAIL_JUNK[w] || /^\d{3,4}p$/.test(w) || /^\d+bit$/.test(w); }
function isExactTitle(queryTitle, candTitle) {
  var q = exactWords(queryTitle), c = exactWords(candTitle);
  if (!q.length || !c.length) return false;
  if (q.join("") === c.join("")) return true; // one-word listings: "Shinchan" == "Shin Chan"
  var cset = {};
  c.forEach(function (w) { cset[w] = 1; });
  var contained = true;
  for (var i = 0; i < q.length; i++) if (!cset[q[i]]) { contained = false; break; }
    if (contained && (2 * q.length) / (q.length + c.length) >= 0.8) return true;
  // Release-junk tail: the title words lead and only tech/release tokens
  // follow (e.g. "Shinchan Season 1 ... 480p HQ DVDRip 10bit HEVC").
  var stripped = [];
  for (var j = 0; j < c.length; j++) { if (!isTailJunk(c[j])) stripped.push(c[j]); }
  if (stripped.length && stripped.join("") === q.join("") && c.slice(0, stripped.length).join("") === q.join("")) return true;
  return false;
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
    list = list.filter(function (c) { return isExactTitle(title, c.title); });
    list.sort(function (a, b) { return score(b.title, title) - score(a.title, title); });
    var best = list[0];
    if (best) return { slug: best.slug, title: best.title };
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
