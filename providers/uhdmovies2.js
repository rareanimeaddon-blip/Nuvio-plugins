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

/* UHDMovies (uhdmovies.beauty via phisher98 TVVVV domains list) - ported
   from the user-supplied plugin (uhdmovies_0_8lcp.js, 2026-09-28 build).
   Chain: TMDB details -> site search -> download page links ->
   Driveseed / VideoSeed / direct. Exact title gate (or IMDb anchor)
   + year check; hrefli-gated links skipped (solver not ported).
   TV-guest safe: no timers, no TextEncoder/WebCrypto, regex URLs. */
/**
 * uhdmovies - Built from src/uhdmovies/
 * Generated: 2026-09-28T09:06:23.265Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/uhdmovies/index.js
var import_cheerio_without_node_native2 = __toESM(require("cheerio-without-node-native"));

// src/uhdmovies/constants.js
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var FALLBACK_DOMAIN = "https://uhdmovies.my";

var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var UHD_TMDB_KEY = "";
try { UHD_TMDB_KEY = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : ""; } catch (e) { UHD_TMDB_KEY = ""; }

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1"
};

// src/uhdmovies/utils.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));
var cachedDomain = "";
function getMainUrl() {
  return __async(this, null, function* () {
    if (cachedDomain)
      return cachedDomain;
    try {
      const response = yield fetch(DOMAINS_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
      const data = yield response.json();
      cachedDomain = String(data["UHDMovies"] || FALLBACK_DOMAIN).replace(/\/$/, "");
      return cachedDomain;
    } catch (e) {
      return FALLBACK_DOMAIN;
    }
  });
}
function getBaseUrl(url) {
  var m = /^([a-z]+:\/\/[^\/]+)/i.exec(url || "");
  return m ? m[1] : "";
}
function fixUrl(url, domain) {
  if (!url)
    return "";
  if (url.startsWith("http"))
    return url;
  if (url.startsWith("//"))
    return `https:${url}`;
  if (url.startsWith("/"))
    return domain + url;
  return `${domain}/${url}`;
}
function fetchTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    try {
      const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${UHD_TMDB_KEY}&append_to_response=external_ids`;
      const res = yield fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });
      if (!res.ok)
        return null;
      const data = yield res.json();
      return {
        title: mediaType === "movie" ? data.title || data.original_title : data.name || data.original_name,
        originalTitle: mediaType === "movie" ? data.original_title : data.original_name,
        year: (data.release_date || data.first_air_date || "").substring(0, 4),
        imdbId: (_a = data.external_ids) == null ? void 0 : _a.imdb_id
      };
    } catch (e) {
      return null;
    }
  });
}
function getIndexQuality(str) {
  if (!str)
    return "Unknown";
  const match = str.match(/(\d{3,4})[pP]/);
  if (match)
    return match[1] + "p";
  if (str.toUpperCase().includes("4K") || str.toUpperCase().includes("UHD"))
    return "2160p";
  return "Unknown";
}
function extractVideoSeed(finallink) {
  return __async(this, null, function* () {
    try {
      var hm = /^https?:\/\/([^\/]+)/i.exec(finallink || "");
      const host = hm ? hm[1] : "video-seed.xyz";
      const token = finallink.split("?url=")[1];
      if (!token)
        return null;
      const res = yield fetch(`https://${host}/api`, {
        method: "POST",
        headers: __spreadProps(__spreadValues({}, HEADERS), {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-token": host,
          "Referer": finallink
        }),
        body: `keys=${encodeURIComponent(token)}`
      });
      const text = yield res.text();
      const urlMatch = text.match(/url":"([^"]+)"/);
      return urlMatch ? urlMatch[1].replace(/\\\//g, "/") : null;
    } catch (e) {
      return null;
    }
  });
}
function extractDriveseedPage(url) {
  return __async(this, null, function* () {
    const streams = [];
    try {
      let pageUrl = url;
      if (url.includes("r?key=")) {
        const res2 = yield fetch(url, { headers: HEADERS });
        const html2 = yield res2.text();
        const redirectMatch = html2.match(/replace\("([^"]+)"\)/);
        if (redirectMatch) {
          pageUrl = fixUrl(redirectMatch[1], getBaseUrl(url));
        }
      }
      const res = yield fetch(pageUrl, { headers: HEADERS });
      const html = yield res.text();
      const $ = import_cheerio_without_node_native.default.load(html);
      const baseDomain = getBaseUrl(pageUrl);
      const qualityText = $("li.list-group-item").first().text() || "";
      const size = $("li:nth-child(3)").text().replace("Size : ", "").trim();
      const quality = getIndexQuality(qualityText);
      const elements = $("div.text-center > a").get();
      for (const el of elements) {
        const text = $(el).text().toLowerCase();
        const href = $(el).attr("href");
        if (!href)
          continue;
        if (text.includes("instant download")) {
          const instantRes = yield fetch(fixUrl(href, baseDomain), { headers: HEADERS, redirect: "follow" });
          if (instantRes.url && instantRes.url.includes("url=")) {
            streams.push({ name: "Driveseed Instant", url: instantRes.url.split("url=")[1], quality, size });
          }
        } else if (text.includes("resume cloud")) {
          const cloudRes = yield fetch(fixUrl(href, baseDomain), { headers: HEADERS });
          const cloudHtml = yield cloudRes.text();
          const link = import_cheerio_without_node_native.default.load(cloudHtml)("a.btn-success").first().attr("href");
          if (link)
            streams.push({ name: "Driveseed Cloud", url: link, quality, size });
        } else if (text.includes("cloud download")) {
          streams.push({ name: "Driveseed Cloud", url: fixUrl(href, baseDomain), quality, size });
        }
      }
    } catch (e) {
    }
    return streams;
  });
}

// src/uhdmovies/index.js
function normalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    console.log(`[UHDMovies] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}`);
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details)
      return [];
    const mainUrl = yield getMainUrl();
    try {
            const titleCore = function (raw) {
        var t = String(raw || "").toLowerCase();
        t = t.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ");
        t = t.replace(/dual audio/g, " dualaudio ");
        var toks = t.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
        if (toks[0] === "download") toks.shift();
        var tags = { dualaudio: 1, hindi: 1, english: 1, tamil: 1, telugu: 1, malayalam: 1, kannada: 1, punjabi: 1, bengali: 1, marathi: 1, gujarati: 1, urdu: 1, esubs: 1, esub: 1, "480p": 1, "720p": 1, "1080p": 1, "2160p": 1, "4k": 1, hevc: 1, x264: 1, x265: 1, "10bit": 1, hdr: 1, dovi: 1, remux: 1, webdl: 1, bluray: 1, hdrip: 1, hdtv: 1, cam: 1, dvdrip: 1, brrip: 1, hev: 1, blu: 1, web: 1, imax: 1, dv: 1, sdr: 1, dolby: 1, atmos: 1, ddp: 1, dd: 1, truehd: 1, dts: 1, aac: 1, ac3: 1, eac3: 1, avc: 1, hdcam: 1, hdtc: 1, hdts: 1, dvdscr: 1, screener: 1, proper: 1, repack: 1, extended: 1, unrated: 1, directors: 1 };
        var out = [];
        for (var i = 0; i < toks.length; i++) { if (tags[toks[i]]) break; out.push(toks[i]); }
        return out.join(" ");
      };
      let candidateUrls = [];
      const searchTitles = [...new Set([details.title, details.originalTitle].filter(Boolean))];
      for (const query of searchTitles) {
        const searchUrl = `${mainUrl}/?s=${encodeURIComponent(query)}`;
        const searchRes = yield fetch(searchUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }) });
        if (!searchRes.ok)
          continue;
        const $search = import_cheerio_without_node_native2.default.load(yield searchRes.text());
        const normalizedSearchTitle = normalizeTitle(query);
        $search("article.gridlove-post, article.latestPost").each((i, el) => {
          const title = $search(el).find("h1.sanket, h2.title a").text() || $search(el).find("a").attr("title") || "";
          const href = $search(el).find("div.entry-image > a, h2.title a, a").first().attr("href");
          if (!href) return;
          const core = titleCore(title);
          const imdbMatches = details.imdbId && title.includes(details.imdbId);
          const yearMatch = (title.match(/(?:19|20)\d{2}/) || [])[0] || "";
          const yearOk = !yearMatch || !details.year || Math.abs(parseInt(yearMatch, 10) - parseInt(details.year, 10)) <= 1;
          var ok = yearOk && (imdbMatches || (core && core === normalizedSearchTitle));
          if (!ok && mediaType !== "movie") ok = yearOk && (core.indexOf(normalizedSearchTitle + " season") === 0 || core.indexOf(normalizedSearchTitle + " complete") === 0);
          if (ok) {
            var sm = core.match(/season\s+(\d+)/);
            candidateUrls.push({ url: href, season: sm ? parseInt(sm[1], 10) : 0 });
          }
        });
        if (candidateUrls.length)
          break;
      }
      if (!candidateUrls.length) {
        console.log("[UHDMovies] No search result found");
        return [];
      }
      let targetUrl = candidateUrls[0].url;
      if (mediaType !== "movie") {
        var want = candidateUrls.filter(function (c) { return c.season === seasonNum; });
        if (want.length) targetUrl = want[0].url;
      }
      const pageRes = yield fetch(targetUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }) });
      const pageHtml = yield pageRes.text();
const $ = import_cheerio_without_node_native2.default.load(pageHtml);
      const allStreams = [];
      if (mediaType === "movie") {
        const iframeRegex = /\[.*\]/;
        $("div.entry-content > p, div.entry-content > div").each((i, el) => {
          const text = $(el).text();
          if (iframeRegex.test(text)) {
            const quality = getIndexQuality(text);
            const nextHref = $(el).next().find("a.maxbutton-1, a.maxbutton").attr("href") || $(el).find("a.maxbutton-1, a.maxbutton").attr("href");
            if (nextHref) {
              allStreams.push({ url: nextHref, quality });
            }
          }
        });
      } else {
        const episodesMap = {};
        let currentSeason = seasonNum;
        $("pre, p, a, h3").each((i, el) => {
          const text = $(el).text().trim();
          const seasonMatch = text.match(/(?:season\s*|S)(\d+)/i);
          if (seasonMatch && text.length < 20) {
            currentSeason = parseInt(seasonMatch[1]);
          }
          if (($(el).is("a") || $(el).find("a").length > 0) && text.toLowerCase().includes("episode")) {
            if (text.toLowerCase().includes("zip"))
              return;
            const epMatch = text.match(/Episode\s*(\d+)/i);
            if (epMatch) {
              const realEp = parseInt(epMatch[1]);
              const epUrl = $(el).is("a") ? $(el).attr("href") : $(el).find("a").attr("href");
              if (epUrl) {
                const key = `${currentSeason}-${realEp}`;
                if (!episodesMap[key])
                  episodesMap[key] = [];
                episodesMap[key].push(epUrl);
              }
            }
          }
        });
        const targetKey = `${seasonNum}-${episodeNum}`;
        const urls = episodesMap[targetKey] || [];
        urls.forEach((url) => {
          allStreams.push({ url, quality: "Unknown" });
        });
      }
      const finalResults = [];
      for (const item of allStreams) {
        let finalLink = item.url;
        if (finalLink.includes("unblockedgames")) { continue; /* hrefli-gated links skipped: gate solver not ported */ }
        if (finalLink.includes("thenaukriadda.in")) { continue; /* sid links resolve to an HTML landing page, not a file (device-verified playback failure 2026-10-24); the multi-stage landing handshake is not automated */ }
        if (finalLink) {
          if (finalLink.includes("driveseed") || finalLink.includes("driveleech")) {
            const streams = yield extractDriveseedPage(finalLink);
            finalResults.push(...streams.map((s) => __spreadProps(__spreadValues({}, s), {
              name: "UHDMovies [Driveseed]",
              title: `UHDMovies - ${s.quality} ${s.size ? `[${s.size}]` : ""}`,
              quality: s.quality || item.quality,
              provider: "uhdmovies"
            })));
          } else if (finalLink.includes("video-seed")) {
            const streamUrl = yield extractVideoSeed(finalLink);
            if (streamUrl) {
              finalResults.push({
                name: "UHDMovies [VideoSeed]",
                title: `UHDMovies - ${item.quality}`,
                url: streamUrl,
                quality: item.quality,
                provider: "uhdmovies"
              });
            }
          } else {
            finalResults.push({
              name: "UHDMovies",
              title: `UHDMovies - ${item.quality}`,
              url: finalLink,
              quality: item.quality,
              provider: "uhdmovies"
            });
          }
        }
      }
      return finalResults;
    } catch (e) {
      console.error("[UHDMovies] Error:", e.message);
      return [];
    }
  });
}
module.exports = { getStreams };

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
