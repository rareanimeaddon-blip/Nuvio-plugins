// RareAnime scraper for Nuvio (Hindi-dubbed anime)
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: RareAnime provider — rareanimes.mov search → episode page →
// codedew multiquality/zipper links → argon.razorshell.space embed → m3u8.
//
// The argon embed page serves its stream URL through an obfuscated
// _juicycodes payload. This is decoded in pure JS (base64 + symbolMap +
// 4-char chunk arithmetic, reverse-engineered 2026-10-19) to extract the
// JWPlayer config containing the m3u8 URL. No eval, no browser globals needed.
//
// NOTE: set TMDB_API_KEY below (free key from themoviedb.org) — used to turn
// the TMDB ID Nuvio passes in into a title for searching.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var BASE_URL = "https://www.rareanimes.mov";
var ARGON_BASE = "https://argon.razorshell.space";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ---------- helpers ----------

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function fetchHtml(url, referer, timeoutMs) {
  return fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer || BASE_URL + "/",
    },
  }, timeoutMs || 20000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function slugFromUrl(url) {
  try {
    var parts = new URL(url).pathname.replace(/^\/|\/$/g, "").split("/");
    return parts[parts.length - 1] || "";
  } catch (e) {
    var m = /\/([^/]+)\/?$/.exec(url);
    return m ? m[1] : "";
  }
}

function cleanTitle(t) {
  return String(t || "")
    .replace(/\s*[-–|]\s*Rare (?:Toons|Animes?) India.*$/i, "")
    .replace(/\s*[-–|]\s*rareanimes.mov.*$/i, "")
    .replace(/\s*Download.*$/i, "")
    .replace(/\s*Episodes?\s*$/i, "")
    .replace(/\s+/g, " ").trim();
}

function normTitle(t) {
  return cleanTitle(t).toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function titleScore(a, b) {
  var na = normTitle(a), nb = normTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  var wa = na.split(" "), wb = nb.split(" ");
  var hit = 0;
  wa.forEach(function (w) { if (wb.indexOf(w) !== -1) hit++; });
  return (2 * hit) / (wa.length + wb.length);
}

// Exact-title gate (zero-mismatch): every distinctive word of the TMDB title
// must appear as a whole word in the candidate, and the word sets must be
// near-identical (dice >= 0.8) once release/season noise words are dropped.
// Kills false hits like "Breaking Bad" -> "The Bad Guys: Breaking In".
var TITLE_NOISE = { the: 1, a: 1, an: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, multi: 1, audio: 1, complete: 1,
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
function exactWords(t) {
  var seen = {}, out = [];
  var cleaned = foldAccents(String(t).toLowerCase()).replace(/^download\s+/, "");
  cleaned.replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (w) {
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

function tmdbTitle(tmdbId, mediaType) {
  if (!TMDB_API_KEY || TMDB_API_KEY === "<redacted>") return Promise.resolve(null);
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, {}, 12000
  ).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j ? (j.title || j.name || null) : null; })
    .catch(function () { return null; });
}

// extract season number from a slug like "shinchan-season-1-hindi-episodes"
function seasonFromSlug(slug) {
  var m = /-season-0*(\d+)/i.exec(slug);
  return m ? parseInt(m[1], 10) : 1;
}

// ---------- search ----------

function searchCatalog(query) {
  var url = BASE_URL + "/?s=" + encodeURIComponent(query);
  return fetchHtml(url, null, 20000).then(function (html) {
    var results = [], seen = {};
    // entry-title headings hold the post title link
    var re = /class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/(?:www\.)?rareanimes.mov\/[^"]+)"[^>]*>([^<]+)<\/a>/gi, m;
    while ((m = re.exec(html)) !== null) {
      var href = m[1];
      var slug = slugFromUrl(href);
      if (!slug || slug.length < 4 || seen[slug]) continue;
      seen[slug] = 1;
      var titleText = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      // try to find a better title nearby (h2/h3)
      results.push({ slug: slug, title: cleanTitle(titleText) || slug.replace(/-/g, " "), pageUrl: href });
      if (results.length >= 30) break;
    }
    if (!results.length) {
      // fallback: any /hindi/ links
      var re2 = /href="https?:\/\/(?:www\.)?rareanimes.mov\/hindi\/([^"/?#]+)\/"/gi;
      while ((m = re2.exec(html)) !== null) {
        if (!seen[m[1]]) { seen[m[1]] = 1; results.push({ slug: m[1], title: m[1].replace(/-/g, " "), pageUrl: BASE_URL + "/hindi/" + m[1] + "/" }); }
        if (results.length >= 30) break;
      }
    }
    return results;
  }).catch(function () { return []; });
}

// ---------- episode links (regex port of parseEpisodesFromHtml) ----------

function isStreamUrl(url) {
  return /codedew\.com\/(?:multiquality|zipper)\//i.test(url);
}
function isBatchLabel(label) {
  return /^zip\s*[-–]?\s*(pixel|nf|hd|fhd|uhd|sd|4k|all|file|bulk|1080|720|480)\b/i.test(label) ||
    /download\s+all\s+episode/i.test(label);
}

function parseEpisodes(html) {
  var links = [];
  var sections = html.split(/<hr\s*\/?>/i);
  sections.forEach(function (section) {
    var epM = /Episode\s+(\d+)/i.exec(section);
    if (!epM) return;
    var epNum = parseInt(epM[1], 10);
    if (isNaN(epNum)) return;
    var are = /href="([^"]*codedew\.com[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, m;
    var anchors = [];
    while ((m = are.exec(section)) !== null) {
      anchors.push({ url: m[1], label: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
    }
    var streamAnchors = anchors.filter(function (a) { return isStreamUrl(a.url) && !isBatchLabel(a.label); });
    var pick = null;
    for (var i = 0; i < streamAnchors.length; i++) {
      if (/watch|multi/i.test(streamAnchors[i].label)) { pick = streamAnchors[i]; break; }
    }
    pick = pick || streamAnchors[0];
    if (pick && !links.some(function (l) { return l.episodeNumber === epNum; })) {
      links.push({ episodeNumber: epNum, codedewUrl: pick.url });
    }
  });
  if (!links.length) {
    var re = /href="(https?:\/\/codedew\.com\/(?:multiquality|zipper)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m2;
    var idx = 0;
    while ((m2 = re.exec(html)) !== null) {
      var label = m2[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (isBatchLabel(label)) continue;
      var em = label.match(/Episode\s*(\d+)/i) || label.match(/Ep\.?\s*(\d+)/i);
      var epNum = em ? parseInt(em[1], 10) : ++idx;
      if (!epNum || epNum <= 0 || epNum > 9999) continue;
      if (!links.some(function (l) { return l.episodeNumber === epNum; })) {
        links.push({ episodeNumber: epNum, codedewUrl: m2[1] });
      }
    }
  }
  links.sort(function (a, b) { return a.episodeNumber - b.episodeNumber; });
  return links;
}

function getEpisodeLinks(pageUrl) {
  return fetchHtml(pageUrl, null, 20000).then(parseEpisodes).catch(function () { return []; });
}

// ---------- codedew → argon ID ----------

function noRedirectFetch(url, timeoutMs) {
  // fetch with manual redirect handling (need the Location header)
  return fetchWithTimeout(url, {
    headers: { "User-Agent": UA, Referer: BASE_URL + "/" },
    redirect: "manual",
  }, timeoutMs || 12000).then(function (res) {
    var loc = res.headers.get("location");
    return { status: res.status, location: loc, res: res };
  });
}

function extractArgonIdFromMultiquality(multiqUrl) {
  return fetchHtml(multiqUrl, BASE_URL + "/", 20000).then(function (html) {
    var m = /<iframe[^>]*src=['"]([^'"]*argon\.razorshell\.space[^'"]*)['"]/i.exec(html) ||
            /argon\.razorshell\.space\/embed\/([^"'&\s/]+)/.exec(html);
    if (m) {
      var em = /\/embed\/([^/?#]+)/.exec(m[1] || m[0]);
      if (em) return em[1];
      if (m[1] && !/^https?:/.test(m[1])) return m[1];
    }
    try {
      var u = new URL(multiqUrl);
      var up = u.searchParams.get("url");
      if (up) return up;
    } catch (e) {}
    return null;
  }).catch(function () {
    try { return new URL(multiqUrl).searchParams.get("url"); } catch (e) { return null; }
  });
}

function resolveCodedewToArgonId(codedewUrl) {
  if (codedewUrl.indexOf("/multiquality/") !== -1) {
    return extractArgonIdFromMultiquality(codedewUrl);
  }
  if (codedewUrl.indexOf("/zipper/") !== -1) {
    return noRedirectFetch(codedewUrl, 12000).then(function (r) {
      if (r.location) {
        if (/mega\.nz|drive\.google/i.test(r.location)) return null;
        var mq = r.location.indexOf("http") === 0 ? r.location : "https://codedew.com" + r.location;
        return extractArgonIdFromMultiquality(mq);
      }
      return r.res.text().then(function (html) {
        var m = /argon\.razorshell\.space\/embed\/([^"'&\s/]+)/.exec(html);
        return m ? m[1] : null;
      }).catch(function () { return null; });
    }).catch(function () { return null; });
  }
  return Promise.resolve(null);
}

// ---------- argon embed → m3u8 (direct regex strategies only) ----------

function decodeJuicycodes(obfuscated) {
  // Reverse-engineered juicycodes decoder (2026-10-19).
  // The embed page contains _juicycodes("..."+...+"...") with an obfuscated
  // payload. Decode: last 3 chars = salt (each charCode-100 concatenated),
  // base64-decode the rest, map symbols to digits via symbolMap,
  // split into 4-char chunks, (parseInt(chunk) % 1000) - salt -> charCode.
  try {
    if (!obfuscated || obfuscated.length < 10) return null;
    var saltStr = obfuscated.slice(-3);
    var salt = "";
    for (var i = 0; i < saltStr.length; i++) {
      salt += String(saltStr.charCodeAt(i) - 100);
    }
    var saltNum = parseInt(salt, 10);
    if (isNaN(saltNum)) return null;

    var main = obfuscated.slice(0, -3);
    // base64 decode (URL-safe variants)
    var b64 = main.replace(/_/g, "+").replace(/-/g, "/");
    while (b64.length % 4) b64 += "=";
    var binary;
    try {
      binary = atob(b64);
    } catch (e) { return null; }

    var symbolMap = { "`": "0", "%": "1", "-": "2", "+": "3", "*": "4",
                      "$": "5", "!": "6", "_": "7", "^": "8", "=": "9" };
    var digits = "";
    for (var j = 0; j < binary.length; j++) {
      var d = symbolMap[binary.charAt(j)];
      if (d === undefined) return null;
      digits += d;
    }

    var decoded = "";
    for (var k = 0; k + 4 <= digits.length; k += 4) {
      var chunk = digits.substr(k, 4);
      var num = (parseInt(chunk, 10) % 1000) - saltNum;
      if (num < 0 || num > 1114111) continue;
      decoded += String.fromCharCode(num);
    }
    return decoded;
  } catch (e) { return null; }
}

function extractArgonStream(videoId) {
  var url = ARGON_BASE + "/embed/" + videoId;
  return fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA,
      Referer: "https://codedew.com/",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  }, 18000).then(function (res) {
    if (!res.ok) return null;
    return res.text();
  }).then(function (html) {
    if (!html) return null;
    // Strategy 1: decode the _juicycodes obfuscated payload
    var jm = /_juicycodes\(([^)]+)\)/.exec(html);
    if (jm) {
      var parts = jm[1].match(/"([^"]*)"/g);
      if (parts) {
        var obfuscated = parts.map(function (p) { return p.slice(1, -1); }).join("");
        var decoded = decodeJuicycodes(obfuscated);
        if (decoded) {
          // The decoded JS is a JWPlayer config with the m3u8 URL
          var clean = decoded.replace(/\\\//g, "/");
          var m3u8 = /https?:\/\/[^"'\s<>]*\.m3u8[^"'\s<>]*/.exec(clean);
          if (m3u8) return m3u8[0];
        }
      }
    }
    // Strategy 2: direct regex (fallback for non-obfuscated pages)
    var clean = html.replace(/\\\//g, "/");
    var m = /https?:\/\/[^"'\s<>]*groovy\.monster[^"'\s<>]*\.m3u8(?:[^"'\s<>]*)?/.exec(clean);
    if (m) return m[0];
    m = /https?:\/\/[^"'\\s<>]+\.m3u8(?:[^"'\s<>]*)?/.exec(clean);
    if (m) return m[0];
    return null;
  }).catch(function () { return null; });
}

// ---------- main ----------

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== "tv") return Promise.resolve([]); // rareanime is anime series (Hindi dubbed)
  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    // Sites index some shows under a squashed name ("Shinchan" for "Shin Chan")
    // and per-season posts rank poorly under the bare title — search variants
    // and merge the results.
    var season = seasonNum || 1;
    var squashed = title.replace(/\s+/g, "");
    var queries = [title];
    if (squashed !== title) queries.push(squashed);
    queries.push(squashed + " Season " + season);
    if (squashed !== title) queries.push(title + " Season " + season);
    return Promise.all(queries.map(function (q) {
      return searchCatalog(q).catch(function () { return []; });
    })).then(function (lists) {
      var seen = {}, results = [];
      lists.forEach(function (list) {
        (list || []).forEach(function (r) {
          if (r && r.slug && !seen[r.slug]) { seen[r.slug] = 1; results.push(r); }
        });
      });
      if (!results.length) return [];
      // Exact title only, and if the post is for a specific season it must be
      // the requested one (per-season posts carry their own episode numbering).
      var best = null, bestScore = 0;
      results.forEach(function (r) {
        if (!isExactTitle(title, r.title)) return; // zero-mismatch gate
        var rSeason = seasonFromSlug(r.slug);
        if (rSeason !== season) return;
        var s = titleScore(r.title, title);
        s += 0.2;
        if (s > bestScore) { bestScore = s; best = r; }
      });
      if (!best) return [];
      return getEpisodeLinks(best.pageUrl).then(function (episodes) {
        var ep = null;
        for (var i = 0; i < episodes.length; i++) {
          if (episodes[i].episodeNumber === (episodeNum || 1)) { ep = episodes[i]; break; }
        }
        if (!ep) return [];
        return resolveCodedewToArgonId(ep.codedewUrl).then(function (argonId) {
          if (!argonId) return [];
          return extractArgonStream(argonId).then(function (streamUrl) {
            if (!streamUrl) return [];
            return [{
              name: "RareAnime",
              title: title + " S" + season + "E" + (episodeNum || 1) + " [Hindi]",
              url: streamUrl,
              quality: "Unknown",
              type: "direct",
            }];
          });
        });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.RareAnimeScraperModule = { getStreams: getStreams };
}
