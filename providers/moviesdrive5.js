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


// MoviesDrive provider — rebuilt 2026-10-20 (moviesdrive2.js).
// The v1 file could never work in Nuvio: it never set global.getStreams,
// used AbortController and TextDecoder (absent in QuickJS), built HubCloud
// search queries from the site's own bloated link text ("Download Jawan –
// Netflix 2023 480p"), which makes HubCloud's fuzzy search return other
// movies, and filtered results against the site-parsed title "Jawan –
// Netflix", which no real filename can match.
// Flow now: dynamic domain (urls.json) -> Typesense search -> exact-title
// gate on the cleaned post title -> HubCloud search-recover API with a
// clean "{Title} {Year}" (or "{Title} S01E01") query -> hubcloud drive
// page -> gamerxyt page -> direct CDN links (workers.dev / PixelDrain / FSL).

var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var FALLBACK_DOMAINS = [
  "https://new3.moviesdrive.beer",
  "https://new2.moviesdrive.beer",
  "https://new1.moviesdrive.beer",
  "https://moviesdrives.cfd",
  "https://moviesdrives.mov",
];
var MAIN_URL = FALLBACK_DOMAINS[0];

function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {};
  options.headers = options.headers || {};
  if (!options.headers["User-Agent"]) options.headers["User-Agent"] = UA;
  return fetch(url, options);
}
function getText(url, headers, timeoutMs) {
  return fetchWithTimeout(url, { headers: headers || {} }, timeoutMs || 12000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}
function getJson(url, headers, timeoutMs) {
  return getText(url, headers, timeoutMs || 10000).then(function (t) {
    try { return JSON.parse(t); } catch (e) { return null; }
  });
}
function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); });
}
function resolveDomain() {
  return getJson("https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json",
    { Accept: "application/json" }, 8000)
    .then(function (j) {
      var d = j && j.moviesdrive;
      if (d && typeof d === "string" && d.indexOf("http") === 0) {
        MAIN_URL = d.replace(/\/+$/, "");
      }
      return MAIN_URL;
    })
    .catch(function () { return MAIN_URL; });
}

// ---------- exact-title gate (v3, shared design) ----------
var TITLE_NOISE = { the: 1, a: 1, an: 1, with: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, subtitle: 1, subtitles: 1, subs: 1, multi: 1, audio: 1, complete: 1,
  hevc: 1, x264: 1, x265: 1, h264: 1, webdl: 1, hdtv: 1, bluray: 1, brrip: 1, hdrip: 1,
  "480p": 1, "720p": 1, "1080p": 1, "1440p": 1, "2160p": 1, "4k": 1, uhd: 1, hd: 1,
  watch: 1, download: 1, online: 1, sony: 1, yay: 1, uncensored: 1, uncut: 1, hungama: 1, tamil: 1, telugu: 1 };
var TAIL_JUNK = { mal: 1, ben: 1, jap: 1, kor: 1, chi: 1, eng: 1, hq: 1, dvdrip: 1, xvid: 1, aac: 1,
  proper: 1, repack: 1, extended: 1, unrated: 1, remastered: 1, dual: 1, web: 1, dl: 1 };
function isTailJunk(w) { return !!TAIL_JUNK[w] || /^\d{3,4}p$/.test(w) || /^\d+bit$/.test(w); }
var ACCENT_MAP = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
  "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
  "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
function foldAccents(s) {
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function (ch) { return ACCENT_MAP[ch] || ch; });
}
function exactWords(value) {
  var seen = {}, out = [];
  foldAccents(String(value).toLowerCase()).replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (w) {
    if (!w || TITLE_NOISE[w] || /^\d+$/.test(w) || /^s\d{1,2}(e\d{1,2})?$/.test(w) || /^e\d{1,2}$/.test(w)) return;
    if (!seen[w]) { seen[w] = 1; out.push(w); }
  });
  return out;
}
function isExactTitle(queryTitle, candTitle) {
  var q = exactWords(queryTitle), c = exactWords(candTitle);
  if (!q.length || !c.length) return false;
  if (q.join("") === c.join("")) return true;
  var cset = {};
  c.forEach(function (w) { cset[w] = 1; });
  var contained = true;
  for (var i = 0; i < q.length; i++) if (!cset[q[i]]) { contained = false; break; }
  if (contained && (2 * q.length) / (q.length + c.length) >= 0.8) return true;
  var stripped = [];
  for (var j = 0; j < c.length; j++) { if (!isTailJunk(c[j])) stripped.push(c[j]); }
  if (stripped.length && stripped.join("") === q.join("") && c.slice(0, stripped.length).join("") === q.join("")) return true;
  return false;
}
// The site's post titles are formulaic: "Download Jawan – Netflix (2023) ...".
// The comparable title is the lead segment before the year bracket / dash.
function cleanSiteTitle(raw) {
  var t = String(raw || "").replace(/^download\s*/i, "");
  t = t.split("(")[0].split("|")[0].split(" – ")[0].split(" - ")[0];
  return t.replace(/\s+/g, " ").trim();
}
function yearOf(text) {
  var m = /\b(19|20)\d{2}\b/.exec(String(text || ""));
  return m ? parseInt(m[0], 10) : null;
}

// ---------- TMDB ----------
function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return getJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY, {}, 10000)
    .then(function (j) {
      if (!j || !(j.title || j.name)) return null;
      var d = j.release_date || j.first_air_date || "";
      return { title: j.title || j.name, year: d ? parseInt(d.slice(0, 4), 10) : null };
    })
    .catch(function () { return null; });
}

// ---------- site search ----------
function searchTypesense(base, query) {
  return getJson(base + "/search.php?q=" + encodeURIComponent(query) + "&per_page=10",
    { Referer: base + "/" }, 9000)
    .then(function (j) {
      var hits = (j && j.hits) || [], out = [];
      hits.forEach(function (h) {
        var doc = h.document || {};
        if (!doc.permalink || !doc.post_title) return;
        out.push({ title: decodeHtml(doc.post_title), href: doc.permalink, year: yearOf(doc.post_title), content: null });
      });
      return out;
    })
    .catch(function () { return []; });
}
function searchWp(base, query) {
  return getJson(base + "/wp-json/wp/v2/posts?search=" + encodeURIComponent(query) +
    "&per_page=15&_fields=title,link,content", { Accept: "application/json" }, 10000)
    .then(function (json) {
      if (!json || !json.length) return [];
      return json.map(function (post) {
        var title = decodeHtml(String(post.title.rendered || "").replace(/<[^>]+>/g, ""));
        return { title: title, href: post.link, year: yearOf(title),
          content: post.content && post.content.rendered ? post.content.rendered : null };
      });
    })
    .catch(function () { return []; });
}
function searchSite(query) {
  var bases = [MAIN_URL];
  FALLBACK_DOMAINS.forEach(function (b) { if (bases.indexOf(b) === -1 && bases.length < 3) bases.push(b); });
  var chain = Promise.resolve([]);
  bases.forEach(function (base) {
    chain = chain.then(function (found) {
      if (found.length) return found;
      return searchTypesense(base, query).then(function (r) {
        if (r.length) MAIN_URL = base;
        return r;
      });
    });
  });
  return chain.then(function (r) {
    return r.length ? r : searchWp(MAIN_URL, query);
  });
}
function pickPost(hits, meta, isSeries, seasonNum) {
  var best = null;
  hits.forEach(function (h) {
    var base = cleanSiteTitle(h.title);
    if (!isExactTitle(meta.title, base)) return;
    if (meta.year && h.year && Math.abs(h.year - meta.year) > 1) return;
    if (isSeries && seasonNum != null && !new RegExp("season\\s*0*" + seasonNum + "\\b", "i").test(h.title)
        && !/season\s*\d+\s*[-–]\s*\d+/i.test(h.title) && !/complete/i.test(h.title)) {
      // series post that names other seasons only: still usable if it's a
      // complete-pack post; otherwise prefer ones naming our season
      if (best) return;
    }
    if (!best) best = h;
  });
  return best;
}

// ---------- hubcloud search-recover ----------
function extractRecoverInfo(html) {
  var fromAcs = [], seen = {}, m;
  var re = /hubcloud\.[a-z]+\/drive\/search-recover\.php\?[^"'\s]*/gi;
  while ((m = re.exec(html)) !== null) {
    var url = m[0].replace(/&amp;/g, "&");
    var fm = /from_ac=([^&]+)/.exec(url);
    if (fm && !seen[fm[1]]) { seen[fm[1]] = 1; fromAcs.push(fm[1]); }
    if (fromAcs.length >= 2) break;
  }
  return fromAcs;
}
function recoverSearch(fromAc, query) {
  var url = "https://hubcloud.ist/drive/search-recover.php?api=search&q=" + encodeURIComponent(query) +
    "&page=1&from_ac=" + encodeURIComponent(fromAc) + "&_mdcb=" + Date.now();
  return getJson(url, { Accept: "application/json", Referer: "https://hubcloud.ist/" }, 12000)
    .then(function (j) { return (j && j.hits) || []; })
    .catch(function () { return []; });
}
function fileNameMatches(fileName, meta, isSeries, seasonNum, episodeNum) {
  var fn = String(fileName || "");
  if (/\.(zip|rar|7z|tar|gz|nfo|srt|ass|sub)$/i.test(fn)) return false;
  var words = exactWords(meta.title);
  var fnWords = {};
  foldAccents(fn.toLowerCase()).replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (w) { fnWords[w] = 1; });
  for (var i = 0; i < words.length; i++) if (!fnWords[words[i]]) return false;
  if (isSeries && seasonNum != null && episodeNum != null) {
    var se = /\bS0*(\d{1,3})E0*(\d{1,3})\b/i.exec(fn);
    if (se) return parseInt(se[1], 10) === seasonNum && parseInt(se[2], 10) === episodeNum;
    var em = /episode\s*0*(\d{1,3})\b/i.exec(fn);
    if (em) return parseInt(em[1], 10) === episodeNum;
    return false; // series hits must identify the episode
  }
  return true;
}
function parseQuality(text) {
  var s = String(text || "");
  var m = /(2160|1440|1080|720|480)\s*P/i.exec(s);
  if (m) return m[1] + "p";
  if (/4K|UHD/i.test(s)) return "2160p";
  return "HD";
}

// ---------- mdrive.lol archive path (older posts) ----------
function extractArchiveLinks(html, season) {
  // Download sections are <h5> headings ("DOWNLOAD – SEASON 5 Complete"),
  // often in reverse season order; assign each archive link the season of
  // the last section heading before it.
  var marks = [], m;
  var headingRe = /<h[2-6][^>]*>[\s\S]{0,140}?Season\s*0*(\d+)\b/gi;
  while ((m = headingRe.exec(html)) !== null) marks.push({ index: m.index, season: parseInt(m[1], 10) });
  var links = [];
  var re = /href="(https?:\/\/mdrive\.lol\/archive\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(html)) !== null) {
    if (season != null) {
      var assigned = null;
      for (var i = 0; i < marks.length; i++) {
        if (marks[i].index <= m.index) assigned = marks[i].season;
        else break;
      }
      if (assigned !== season) continue;
    }
    var label = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (/zip/i.test(label)) continue;
    var sm = /\[([\d.]+\s*(?:MB|GB|TB))\]/i.exec(label);
    links.push({ url: m[1], quality: parseQuality(label), size: sm ? "[" + sm[1] + "]" : "" });
  }
  return links;
}
function extractHostLinks(archiveUrl, episode) {
  return getText(archiveUrl, { Referer: MAIN_URL + "/" }, 12000)
    .then(function (html) {
      if (!html) return [];
      var links = [], m;
      var re = /https?:\/\/hubcloud\.[a-z0-9.-]+\/drive\/[a-z0-9_-]+/gi;
      while ((m = re.exec(html)) !== null) {
        if (episode != null) {
          var preceding = html.substring(Math.max(0, m.index - 300), m.index);
          var epRe = /\b(?:EP|Episode)\s*0*(\d+)\b/gi, em, lastEp = -1;
          while ((em = epRe.exec(preceding)) !== null) lastEp = parseInt(em[1], 10);
          if (lastEp !== episode) continue;
        }
        links.push(m[0]);
      }
      return links;
    })
    .catch(function () { return []; });
}

// ---------- hubcloud drive resolution ----------
function collectFromPage(html) {
  var page = decodeHtml(html);
  var out = [], m;
  var pdRe = /pixeldrain\.(?:dev|com)\/u\/([A-Za-z0-9_-]+)/g;
  var pd = {};
  while ((m = pdRe.exec(page)) !== null) pd[m[1]] = 1;
  Object.keys(pd).forEach(function (id) {
    out.push({ url: "https://pixeldrain.dev/api/file/" + id + "?download", type: "PixelDrain" });
  });
  var wRe = /href="(https?:\/\/[a-z0-9.-]+\.workers\.dev\/[^"]+)"/gi;
  while ((m = wRe.exec(page)) !== null) {
    if (/\.zip(?:["?]|$)/i.test(m[1])) continue;
    if (/\.(mkv|mp4|avi|webm)/i.test(m[1])) out.push({ url: m[1], type: "Workers" });
  }
  var r2Re = /href="(https?:\/\/[a-z0-9.-]*(?:\.r2\.dev|\.r2\.cloudflarestorage\.com)\/[^"]+)"/gi;
  while ((m = r2Re.exec(page)) !== null) out.push({ url: m[1], type: "R2" });
  var fslRe = /href="(https?:\/\/fsl\.gigabytes\.icu[^"]+)"/gi;
  while ((m = fslRe.exec(page)) !== null) out.push({ url: m[1], type: "FSL" });
  var vidRe = /href="(https?:\/\/[^\"]+\.(?:mkv|mp4|avi|webm)\?token=\d+[^\"]*)"/gi;
  while ((m = vidRe.exec(page)) !== null) out.push({ url: m[1], type: "Direct" });
  return out.filter(function (f) {
    return !/drive\.google\.com|docs\.google\.com/.test(f.url);
  });
}
function resolveHubcloud(hubUrl) {
  return getText(hubUrl, { Cookie: "xla=s4t", Referer: MAIN_URL + "/" }, 12000)
    .then(function (page1) {
      if (!page1) return [];
      var nextUrl = null;
      var vm = /var\s+url\s*=\s*['"]([^'"]+)['"]/.exec(page1);
      if (vm) nextUrl = vm[1];
      else {
        var am = /<a\s+id="download"\s+(?:x-href|href)="([^"]+)"/.exec(page1);
        if (am) nextUrl = am[1];
      }
      if (!nextUrl || nextUrl.indexOf("http") !== 0) return [];
      return getText(nextUrl, { Cookie: "xla=s4t", Referer: hubUrl }, 12000)
        .then(function (page2) {
          if (!page2) return [];
          var found = collectFromPage(page2);
          var pd = found.filter(function (f) { return f.type === "PixelDrain"; });
          return pd.length ? pd : found;
        });
    })
    .catch(function () { return []; });
}

// ---------- main ----------
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isSeries = mediaType === "tv";
  if (isSeries && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);
  return resolveDomain().then(function () {
    return tmdbMeta(tmdbId, mediaType);
  }).then(function (meta) {
    if (!meta) return [];
    return searchSite(meta.title).then(function (hits) {
      var post = pickPost(hits, meta, isSeries, seasonNum);
      if (!post) return [];
      var htmlP = post.content
        ? Promise.resolve(post.content)
        : getText(post.href.indexOf("http") === 0 ? post.href : MAIN_URL + post.href,
            { Referer: MAIN_URL + "/" }, 12000).catch(function () { return ""; });
      return htmlP.then(function (html) {
        if (!html) return [];
        // Two generations of posts: mdrive.lol archive buttons (older) and
        // hubcloud search-recover buttons (newer). Collect hub jobs from
        // whichever the post carries, then resolve them together.
        var jobs = [], seenJob = {};
        function addJob(hubUrl, quality, size) {
          if (!hubUrl || seenJob[hubUrl]) return;
          seenJob[hubUrl] = 1;
          jobs.push({ url: hubUrl, quality: quality || "HD", size: size || "" });
        }
        var archives = extractArchiveLinks(html, isSeries ? seasonNum : null);
        var archiveP = Promise.resolve();
        if (archives.length) {
          var picks = archives.slice(0, 3);
          archiveP = Promise.all(picks.map(function (a) {
            return extractHostLinks(a.url, isSeries ? episodeNum : null).then(function (hls) {
              hls.slice(0, 3).forEach(function (hu) { addJob(hu, a.quality, a.size); });
            });
          })).then(function () { return null; });
        }
        return archiveP.then(function () {
          if (jobs.length) return jobs;
          var fromAcs = extractRecoverInfo(html);
          if (!fromAcs.length) return jobs;
          var query = isSeries
            ? meta.title + " S" + (seasonNum < 10 ? "0" : "") + seasonNum + "E" + (episodeNum < 10 ? "0" : "") + episodeNum
            : meta.title + (meta.year ? " " + meta.year : "");
          return Promise.all(fromAcs.map(function (fa) { return recoverSearch(fa, query); }))
            .then(function (lists) {
              lists.forEach(function (l) {
                l.forEach(function (h) {
                  if (!fileNameMatches(h.file_name || "", meta, isSeries, seasonNum, episodeNum)) return;
                  addJob(h.url, parseQuality(h.file_name), h.size ? "[" + h.size + "]" : "");
                });
              });
              return jobs;
            });
        }).then(function (allJobs) {
          allJobs = allJobs.slice(0, 6);
          if (!allJobs.length) return [];
          var qRank = { "2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "HD": 0 };
          allJobs.sort(function (a, b) { return (qRank[b.quality] || 0) - (qRank[a.quality] || 0); });
          var out = [], seen2 = {};
          var chain = Promise.resolve();
          allJobs.forEach(function (job, idx) {
            if (idx % 2 !== 0) return;
            var pair = allJobs.slice(idx, idx + 2);
            chain = chain.then(function () {
              if (out.length >= 4) return null;
              return Promise.all(pair.map(function (jj) {
                return resolveHubcloud(jj.url).then(function (urls) { return { job: jj, urls: urls }; });
              })).then(function (resolved) {
                resolved.forEach(function (r) {
                  r.urls.forEach(function (u) {
                    if (seen2[u.url]) return;
                    seen2[u.url] = 1;
                    out.push({
                      name: "MoviesDrive",
                      title: meta.title + " | " + r.job.quality + (r.job.size ? " " + r.job.size : "") + " · " + u.type,
                      url: u.url,
                      quality: r.job.quality,
                      type: "direct",
                    });
                  });
                });
              });
            });
          });
          return chain.then(function () {
            out.sort(function (a, b) { return (qRank[b.quality] || 0) - (qRank[a.quality] || 0); });
            return out.slice(0, 8);
          });
        });
      });
    });
  }).catch(function () { return []; });
}

global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
