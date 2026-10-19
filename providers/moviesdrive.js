// MoviesDrive scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: MoviesDrive provider — Typesense/WP search, mdrive.lol archive
// links and HubCloud search-recover links, resolved through HubCloud
// download pages into direct CDN mirrors (prefers PixelDrain).

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var DOMAIN_CANDIDATES = [
  "https://new3.moviesdrive.beer",
  "https://new2.moviesdrive.beer",
  "https://new1.moviesdrive.beer",
  "https://new4.moviesdrive.christmas",
  "https://new3.moviesdrive.christmas",
  "https://new2.moviesdrive.christmas",
  "https://new1.moviesdrive.christmas",
  "https://moviesdrives.cfd",
  "https://moviesdrives.mov",
  "https://moviesdrive.space",
];
var MAIN_URL = DOMAIN_CANDIDATES[0];
var ARCHIVE_DOMAIN = "https://mdrive.lol";

// Dynamic domain resolution: fetch the current MoviesDrive domain from the
// community-maintained urls.json (same source phisher98's scrapers use).
// Falls back to DOMAIN_CANDIDATES if the fetch fails.
function resolveDomain() {
  return fetchWithTimeout(
    "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json",
    { headers: { Accept: "application/json", "User-Agent": UA } }, 10000
  ).then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
   .then(function (j) {
     var d = j && j.moviesdrive;
     if (d && typeof d === "string" && d.indexOf("http") === 0) {
       d = d.replace(/\/+$/, "");
       if (DOMAIN_CANDIDATES.indexOf(d) === -1) DOMAIN_CANDIDATES.unshift(d);
       MAIN_URL = d;
       console.log("[MoviesDrive] resolved domain: " + d);
     }
     return MAIN_URL;
   }).catch(function () { return MAIN_URL; });
}

var UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#8211;/g, "\u2013");
}

function b64decode(s) {
  try {
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (e) { return ""; }
}

function isSafeHttpsUrl(raw) {
  var u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol !== "https:") return null;
  var host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" ||
      /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
  return u;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function fetchText(url, opts) {
  opts = opts || {};
  if (!isSafeHttpsUrl(url)) return Promise.resolve(null);
  var timeout = opts.timeout || 12000;
  var retries = opts.retries != null ? opts.retries : 2;
  var attempt = 0;
  function run() {
    var headers = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" };
    if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
    return fetchWithTimeout(url, { headers: headers }, timeout).then(function (res) {
      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          attempt++;
          return sleep(400 * attempt).then(run);
        }
        return null;
      }
      return res.text();
    }).catch(function () {
      if (attempt < retries) { attempt++; return sleep(400 * attempt).then(run); }
      return null;
    });
  }
  return run();
}

function fetchJson(url, opts) {
  return fetchText(url, opts).then(function (t) {
    if (!t) return null;
    try { return JSON.parse(t); } catch (e) { return null; }
  });
}

function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY,
    { headers: { Accept: "application/json", "User-Agent": UA } }, 10000
  ).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j) return null;
    var title = j.title || j.name || null;
    var date = j.release_date || j.first_air_date || "";
    var year = date ? parseInt(date.slice(0, 4), 10) : null;
    return { title: title, year: isFinite(year) ? year : null, imdb: null };
  }).catch(function () { return null; }).then(function (meta) {
    if (!meta) return null;
    return fetchWithTimeout(
      "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY,
      { headers: { Accept: "application/json", "User-Agent": UA } }, 10000
    ).then(function (r) { return r.ok ? r.json() : null; })
     .then(function (j) { meta.imdb = j && j.imdb_id ? j.imdb_id : null; return meta; })
     .catch(function () { return meta; });
  });
}

// ---- title matching ----
function normaliseTitleForMatch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function extractBaseTitle(fullTitle) {
  var title = String(fullTitle || "").replace(/^download\s*[-–:]?\s*/i, "").trim();
  function clean(v) {
    return v.replace(/\s*[-–|:]+\s*$/, "").replace(/\s*\((?:19|20)\d{2}\)\s*$/, "").trim();
  }
  var seasonMarker = title.search(/\s*(?:\(\s*)?season\s*\d+\b/i);
  if (seasonMarker > 0) return clean(title.slice(0, seasonMarker));
  var withYear = title.match(/^(.+?)\s*\(\d{4}\)/);
  var raw = withYear ? withYear[1].trim()
    : title.replace(/\s+(1080p|720p|480p|4K|4k|BluRay|WEB-DL|WEBRip|WEB\s+DL|HDTV|DVDRip|iMAX|\[).*/i, "").trim();
  return clean(raw);
}

function titleIncludesSeason(title, season) {
  var m = /\bseason\s*0*(\d+)(?:\s*[-–]\s*0*(\d+))?\b/i.exec(title || "");
  if (!m) return true;
  var first = parseInt(m[1], 10), last = m[2] ? parseInt(m[2], 10) : first;
  return season >= first && season <= last;
}

function textMatchesTitle(text, expectedTitle) {
  var expected = normaliseTitleForMatch(expectedTitle);
  var candidate = normaliseTitleForMatch(text);
  if (!expected || candidate.indexOf(expected) !== -1) return true;
  var words = expected.split(" ").filter(function (w) { return w.length >= 4; });
  if (!words.length) return true;
  var matched = words.filter(function (w) { return candidate.indexOf(w) !== -1; }).length;
  return matched >= Math.ceil(words.length * 0.7);
}

function isStrictMatch(searchTitle, searchYear, candidateTitle, candidateYear) {
  if (!searchTitle || !candidateTitle) return false;
  function norm(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, " ");
  }
  var st = norm(searchTitle);
  var ct = norm(String(candidateTitle).replace(/download\s*/gi, ""));
  var whole = ct === st || ct.indexOf(st + " ") === 0 ||
    ct.indexOf(" " + st + " ") !== -1 || ct.lastIndexOf(" " + st) === ct.length - st.length - 1;
  if (!whole) return false;
  if (searchYear && candidateYear) {
    var a = parseInt(searchYear, 10), b = parseInt(candidateYear, 10);
    if (isFinite(a) && isFinite(b) && Math.abs(a - b) > 1) return false;
  }
  return true;
}

// ---- site search ----
function searchSiteTypesense(query) {
  var chain = Promise.resolve([]);
  DOMAIN_CANDIDATES.forEach(function (base) {
    chain = chain.then(function (found) {
      if (found.length) return found;
      var url = base + "/search.php?q=" + encodeURIComponent(query) + "&per_page=10";
      return fetchJson(url, { headers: { Referer: base + "/" }, timeout: 8000 }).then(function (json) {
        var hits = (json && json.hits) || [];
        var out = [];
        hits.forEach(function (hit) {
          var doc = hit.document || {};
          if (!doc.permalink || !doc.post_title) return;
          var ym = /(\d{4})/.exec(doc.post_title || "");
          out.push({ title: doc.post_title, href: doc.permalink,
            year: ym ? parseInt(ym[1], 10) : null, imdb: doc.imdb_id || null, content: null });
        });
        if (out.length) MAIN_URL = base;
        return out;
      }).catch(function () { return []; });
    });
  });
  return chain;
}

function stripTags(s) {
  return decodeHtml(s).replace(/<[^>]+>/g, "").trim();
}

function searchSiteWpRest(query) {
  var chain = Promise.resolve([]);
  DOMAIN_CANDIDATES.forEach(function (base) {
    chain = chain.then(function (found) {
      if (found.length) return found;
      var url = base + "/wp-json/wp/v2/posts?search=" + encodeURIComponent(query) +
        "&per_page=15&_fields=title,link,content&_mdcb=" + Date.now();
      return fetchJson(url, { headers: { Accept: "application/json" }, timeout: 10000 }).then(function (json) {
        if (!json || !json.length) return [];
        MAIN_URL = base;
        return json.map(function (post) {
          var title = stripTags(post.title.rendered);
          var ym = /\((\d{4})\)/.exec(title);
          return { title: title, href: post.link,
            year: ym ? parseInt(ym[1], 10) : null, imdb: null,
            content: post.content && post.content.rendered ? post.content.rendered : null };
        });
      }).catch(function () { return []; });
    });
  });
  return chain;
}

function searchSite(query) {
  return searchSiteTypesense(query).then(function (r) {
    return r.length ? r : searchSiteWpRest(query);
  });
}

function resolveHref(href) {
  return href.indexOf("http") === 0 ? href : MAIN_URL + href;
}

// ---- link extraction ----
function parseQuality(label) {
  var s = String(label || "");
  var m = s.match(/(2160|1080|720|480)\s*P/i);
  if (m) return m[1] + "p";
  if (/4K|UHD/i.test(s)) return "2160p";
  if (/1440|2K/i.test(s)) return "1440p";
  return "Unknown";
}

function extractSeasonHtml(html, season) {
  html = decodeHtml(html);
  var headingRe = /(<h[1-6][^>]*>|<strong[^>]*>|<span[^>]*>)[\s\S]{0,100}?(?:Season|Saison|Staffel)\s*0*(\d+)\b/gi;
  var marks = [], m;
  while ((m = headingRe.exec(html)) !== null) marks.push({ index: m.index, season: parseInt(m[2], 10) });
  var startIdx = -1;
  for (var i = 0; i < marks.length; i++) {
    if (marks[i].season === season && startIdx === -1) startIdx = i;
  }
  if (startIdx === -1) return null;
  var startPos = marks[startIdx].index, endPos = html.length;
  for (var j = 0; j < marks.length; j++) {
    if (marks[j].index > startPos && marks[j].season !== season) { endPos = marks[j].index; break; }
  }
  return html.substring(startPos, endPos);
}

function extractArchiveLinks(html, season) {
  var scoped = season != null ? extractSeasonHtml(html, season) : html;
  if (!scoped) return [];
  var links = [];
  var re = /href="(https?:\/\/mdrive\.lol\/archive\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(scoped)) !== null) {
    var label = m[2].replace(/<[^>]+>/g, "").trim();
    if (season != null && /zip/i.test(label)) continue;
    var quality = parseQuality(label);
    if (quality === "480p") continue;
    var sm = label.match(/\[([\d.]+\s*(?:MB|GB|TB))\]/i);
    links.push({ url: m[1], quality: quality, size: sm ? "[" + sm[1] + "]" : "" });
  }
  return links;
}

function extractHostLinks(archiveUrl, episode) {
  return fetchText(archiveUrl, { headers: { Referer: MAIN_URL + "/" }, timeout: 12000 }).then(function (html) {
    if (!html) return [];
    var links = [];
    var re = /https?:\/\/hubcloud\.[a-z0-9.-]+\/drive\/[a-z0-9_-]+/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      if (episode != null) {
        var preceding = html.substring(Math.max(0, m.index - 300), m.index);
        var epRe = /\b(?:EP|Episode)\s*0*(\d+)\b/gi;
        var em, lastEp = -1;
        while ((em = epRe.exec(preceding)) !== null) lastEp = parseInt(em[1], 10);
        if (lastEp === -1 || lastEp !== episode) continue;
      }
      links.push({ url: m[0] });
    }
    return links;
  });
}

function extractSearchRecoverLinks(html) {
  var links = [];
  var re = /href="(https?:\/\/hubcloud\.[a-z]+\/drive\/search-recover\.php\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var rawUrl = m[1].replace(/&amp;/g, "&");
    var label = m[2].replace(/<[^>]+>/g, "").trim();
    var preceding = html.slice(Math.max(0, m.index - 400), m.index)
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    var sm = (label + " " + preceding).match(/\[([\d.]+\s*(?:MB|GB|TB))\]/i);
    links.push({ url: rawUrl, quality: parseQuality(label + " " + preceding),
      size: sm ? "[" + sm[1] + "]" : "" });
  }
  return links;
}

function callSearchRecoverApi(fromAc, query, refererUrl) {
  var hubcloudHost;
  try { hubcloudHost = new URL(refererUrl).hostname; } catch (e) { return Promise.resolve([]); }
  if (!/^hubcloud\.[a-z]+$/i.test(hubcloudHost)) return Promise.resolve([]);
  var params = new URLSearchParams({ api: "search", q: query, page: "1", from_ac: fromAc, _mdcb: String(Date.now()) });
  var apiUrl = "https://" + hubcloudHost + "/drive/search-recover.php?" + params.toString();
  if (!isSafeHttpsUrl(apiUrl)) return Promise.resolve([]);
  return fetchWithTimeout(apiUrl, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: refererUrl },
  }, 12000).then(function (res) {
    return res.ok ? res.json() : null;
  }).then(function (json) {
    return (json && json.hits) || [];
  }).catch(function () { return []; });
}

function resolveSearchRecoverLinks(srLinks, episode, expectedTitle, season) {
  var results = [], seen = {};
  var jobs = srLinks.map(function (link) {
    var fromAc = null, queryB64 = null;
    try {
      var u = new URL(link.url);
      fromAc = u.searchParams.get("from_ac");
      queryB64 = u.searchParams.get("q");
    } catch (e) { return Promise.resolve(); }
    if (!fromAc) return Promise.resolve();
    var query = queryB64 ? b64decode(queryB64) : "";
    return callSearchRecoverApi(fromAc, query, link.url).then(function (hits) {
      hits.forEach(function (hit) {
        if (!hit.url || seen[hit.url]) return;
        var fn = String(hit.file_name || "").toLowerCase();
        if (/\.(zip|rar|7z|tar|gz|nfo|srt|ass|sub)$/i.test(fn)) return;
        if (expectedTitle && !textMatchesTitle(hit.file_name || "", expectedTitle)) return;
        if (episode != null) {
          var se = fn.match(/\bS0*(\d{1,3})E0*(\d{1,3})\b/i);
          if (se) {
            if ((season != null && parseInt(se[1], 10) !== season) || parseInt(se[2], 10) !== episode) return;
          } else {
            var em = fn.match(/[se]\d+[ex]0*(\d+)|episode\s*0*(\d+)|ep\.?\s*0*(\d+)/i);
            if (em && parseInt(em[1] || em[2] || em[3], 10) !== episode) return;
          }
        }
        seen[hit.url] = true;
        var hq = hit.file_name ? parseQuality(hit.file_name) : "Unknown";
        results.push({ url: hit.url,
          quality: hq !== "Unknown" ? hq : (link.quality !== "Unknown" ? link.quality : (query ? parseQuality(query) : "Unknown")),
          size: hit.size ? "[" + hit.size + "]" : link.size });
      });
    });
  });
  return Promise.all(jobs).then(function () { return results; });
}

function isGoogleDriveUrl(raw) {
  try {
    var host = new URL(raw).hostname.toLowerCase();
    return host === "drive.google.com" || host === "drive.usercontent.google.com" ||
      host === "docs.google.com" || host.slice(-20) === ".googleusercontent.com";
  } catch (e) { return false; }
}

function resolveHubcloud(hubUrl, quality, size, expectedTitle) {
  function collectFrom(decoded, out) {
    var m;
    var fslv2Re = /href="(https?:\/\/fsl\.gigabytes\.icu[^"]+)"/gi;
    while ((m = fslv2Re.exec(decoded)) !== null) out.push({ url: m[1], type: "FSLv2" });
    var minTok = String(new Date().getMinutes());
    var fslRe = /href="(https?:\/\/(?:pub-[a-z0-9]+\.r2\.dev|[a-z0-9.]+\.(?:buzz|beer))[^"]+)"/gi;
    while ((m = fslRe.exec(decoded)) !== null) {
      var raw = m[1];
      out.push({ url: raw.indexOf("?token=") !== -1 ? raw : raw + "1" + minTok, type: "FSL" });
    }
    var vidRe = /href="(https?:\/\/[^"]+\.(?:mkv|mp4|avi|webm)\?token=\d+[^"]*)"/gi;
    while ((m = vidRe.exec(decoded)) !== null) {
      if (!expectedTitle || textMatchesTitle(decodeURIComponent(m[1]), expectedTitle)) {
        out.push({ url: m[1], type: "FSL" });
      }
    }
    var r2Re = /(?:href="|host:\s*['"])(https?:\/\/[a-z0-9.-]*\.r2\.cloudflarestorage\.com\/[^"'\s]+)/gi;
    while ((m = r2Re.exec(decoded)) !== null) out.push({ url: m[1], type: "R2" });
    var wRe = /href="(https?:\/\/[a-z0-9.-]+\.workers\.dev\/[^"]+)"/gi;
    while ((m = wRe.exec(decoded)) !== null) {
      var wurl = m[1];
      if (/\.zip(?:["?]|$)/i.test(wurl)) continue;
      if (/\.(mkv|mp4|avi|webm)/i.test(wurl)) out.push({ url: wurl, type: "Workers" });
    }
    var pxRe = /href="(https?:\/\/pixel\.hubcloud\.[a-z]+\/\?id=[^"]+)"/gi;
    while ((m = pxRe.exec(decoded)) !== null) out.push({ url: m[1], type: "Pixel" });
    var ids = {}, hasIds = false;
    var pxScriptRe = /pxl\s*=\s*["']https?:\/\/pixeldrain\.(?:dev|com)\/u\/([^/"']+)["']/gi;
    while ((m = pxScriptRe.exec(decoded)) !== null) { ids[m[1]] = true; hasIds = true; }
    var pxHrefRe = /href="https?:\/\/pixeldrain\.(?:dev|com)\/u\/([^/"?#]+)"/gi;
    while ((m = pxHrefRe.exec(decoded)) !== null) { ids[m[1]] = true; hasIds = true; }
    if (hasIds) for (var id in ids) out.push({ url: "https://pixeldrain.dev/api/file/" + id + "?download", type: "PixelDrain" });
    var gpdlRe = /href="(https?:\/\/gpdl\d*\.hubcloud\.[a-z]+\/\?id=[^"]+)"/gi;
    while ((m = gpdlRe.exec(decoded)) !== null) out.push({ url: m[1], type: "GPDL" });
  }

  return fetchText(hubUrl, { headers: { Cookie: "xla=s4t", Referer: ARCHIVE_DOMAIN + "/" }, timeout: 12000 })
    .then(function (page1) {
      if (!page1) return [];
      var nextUrl = null;
      var vm = page1.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/);
      if (vm) nextUrl = vm[1];
      else {
        var am = page1.match(/<a\s+id="download"\s+(?:x-href|href)="([^"]+)"/);
        if (am) nextUrl = am[1];
      }
      if (!nextUrl) return [];
      if (nextUrl.indexOf("http") !== 0) {
        var dec = b64decode(nextUrl);
        if (dec) nextUrl = dec; else return [];
      }
      return fetchText(nextUrl, { headers: { Cookie: "xla=s4t", Referer: hubUrl }, timeout: 15000 })
        .then(function (page2) {
          if (!page2) return [];
          var found = [];
          collectFrom(decodeHtml(page2), found);
          var good = found.filter(function (f) { return !isGoogleDriveUrl(f.url); });
          var pd = good.filter(function (f) { return f.type === "PixelDrain"; });
          var picked = pd.length ? pd : good;
          var seen = {}, out = [];
          picked.forEach(function (f) {
            if (seen[f.url]) return;
            seen[f.url] = true;
            out.push({ url: f.url, quality: quality, size: size });
          });
          return out;
        });
    }).catch(function () { return []; });
}

// ---- main ----
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  var isSeries = type === "series";
  if (isSeries && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);

  return resolveDomain().then(function () {
  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta || !meta.title) return [];
    var title = meta.title, year = meta.year, imdbId = meta.imdb;

    function matchSeriesPage(hit, html) {
      if (!isSeries || seasonNum == null) return html;
      return extractSeasonHtml(html, seasonNum) !== null ? html : null;
    }

    // Pass 1: IMDB id
    function pass1() {
      if (!imdbId || imdbId.indexOf("tt") !== 0) return Promise.resolve(null);
      return searchSite(imdbId).then(function (hits) {
        var chain = Promise.resolve(null);
        hits.forEach(function (hit) {
          chain = chain.then(function (found) {
            if (found) return found;
            if (hit.imdb !== imdbId) return null;
            if (isSeries && seasonNum != null && !titleIncludesSeason(hit.title, seasonNum)) return null;
            function done(html) {
              if (!html) return null;
              var ok = matchSeriesPage(hit, html);
              return ok ? { hit: hit, html: html, verified: true } : null;
            }
            if (hit.content) return done(hit.content);
            return fetchText(resolveHref(hit.href), { headers: { Referer: MAIN_URL + "/" }, timeout: 12000 }).then(done);
          });
        });
        return chain;
      });
    }

    // Pass 2: title
    function pass2() {
      var q = title.replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim() || title;
      return searchSite(q).then(function (hits) {
        var cands = hits.filter(function (h) {
          return !isSeries || seasonNum == null || titleIncludesSeason(h.title, seasonNum);
        });
        var best = null;
        for (var i = 0; i < cands.length; i++) {
          var h = cands[i];
          var clean = h.title.replace(/^Download\s*[-–:]?\s*/i, "").trim();
          if (normaliseTitleForMatch(extractBaseTitle(clean)) === normaliseTitleForMatch(title) &&
              (!year || !h.year || Math.abs(h.year - year) <= 1)) { best = h; break; }
        }
        if (!best) {
          for (var j = 0; j < cands.length; j++) {
            var h2 = cands[j];
            if (isStrictMatch(title, year, h2.title, h2.year)) { best = h2; break; }
          }
        }
        if (!best) {
          for (var k = 0; k < cands.length; k++) {
            var h3 = cands[k];
            if (textMatchesTitle(h3.title, title) &&
                (!year || !h3.year || Math.abs(h3.year - year) <= 1)) { best = h3; break; }
          }
        }
        if (!best) return null;
        function done(html) {
          if (!html) return null;
          var ok = matchSeriesPage(best, html);
          return ok ? { hit: best, html: html, verified: false } : null;
        }
        if (best.content) return done(best.content);
        return fetchText(resolveHref(best.href), { headers: { Referer: MAIN_URL + "/" }, timeout: 12000 }).then(done);
      });
    }

    return pass1().then(function (m) { return m || pass2(); }).then(function (matched) {
      if (!matched) return [];
      var html = matched.html;
      var baseTitle = extractBaseTitle(matched.hit.title);
      var jobs = [];

      function viaArchive() {
        var archives = extractArchiveLinks(html, isSeries ? seasonNum : undefined);
        var chain = Promise.resolve();
        archives.forEach(function (a) {
          chain = chain.then(function () {
            return extractHostLinks(a.url, isSeries ? episodeNum : undefined).then(function (hls) {
              hls.forEach(function (hl) { jobs.push({ url: hl.url, quality: a.quality, size: a.size }); });
            });
          });
        });
        return chain;
      }

      function viaRecover() {
        var srLinks = extractSearchRecoverLinks(html);
        if (!srLinks.length) return Promise.resolve();
        return resolveSearchRecoverLinks(srLinks, isSeries ? episodeNum : undefined, baseTitle, isSeries ? seasonNum : undefined)
          .then(function (rj) { jobs.push.apply(jobs, rj); });
      }

      return viaArchive().then(function () {
        return jobs.length ? Promise.resolve() : viaRecover();
      }).then(function () {
        if (!jobs.length) return [];
        var streams = [], seen = {};
        var BATCH = 4;
        var chain = Promise.resolve();
        for (var i = 0; i < jobs.length; i += BATCH) {
          (function (batch) {
            chain = chain.then(function () {
              return Promise.all(batch.map(function (job) {
                return resolveHubcloud(job.url, job.quality, job.size, baseTitle);
              })).then(function (lists) {
                lists.forEach(function (l) {
                  l.forEach(function (s) {
                    if (!seen[s.url]) { seen[s.url] = true; streams.push(s); }
                  });
                });
              });
            });
          })(jobs.slice(i, i + BATCH));
        }
        return chain.then(function () {
          var rank = { "2160p": 4, "1440p": 3.5, "1080p": 3, "720p": 2, "Unknown": 1 };
          streams.sort(function (a, b) { return (rank[b.quality] || 0) - (rank[a.quality] || 0); });
          return streams.map(function (s) {
            return { name: "MoviesDrive", title: baseTitle + " | " + s.quality + (s.size ? " " + s.size : ""),
              url: s.url, quality: s.quality, type: "direct" };
          });
        });
      });
    });
  }).catch(function () { return []; });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.MoviesDriveScraperModule = { getStreams: getStreams };
}
