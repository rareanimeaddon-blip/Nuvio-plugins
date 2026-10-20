// HindMovies provider (hindmovie.one) — rebuilt 2026-10-20.
// Flow: TMDB -> wp-json search (exact-title gate + year) -> wp-json post ->
// per-quality download buttons (links/episode.joshapp.blog) -> file page
// (boldb.site / hshare.lol, server redirects to the landing page) ->
// GDShine button -> GDShine API -> direct worker file URL (verified 206/MKV).
// The old provider returned raw unsigned file-host URLs as "direct" streams
// and matched titles loosely (it served Love Lies Bleeding for Jawan);
// this rebuild resolves to verified direct files and gates titles exactly.

var BASE_URL = "https://hindmovie.one";
var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var REQ_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

function fetchWithTimeout(url, options, timeoutMs) {
  return Promise.race([
    fetch(url, options || {}),
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("Timeout")); }, timeoutMs || 12000);
    }),
  ]);
}
function getHtml(url, timeoutMs) {
  return fetchWithTimeout(url, { headers: REQ_HEADERS }, timeoutMs || 12000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}
function getJson(url, timeoutMs) {
  return fetchWithTimeout(url, { headers: REQ_HEADERS }, timeoutMs || 10000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}
function stripTags(s) {
  return String(s == null ? "" : s)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- exact-title gate (v3, shared design) ----------
var TITLE_NOISE = { the: 1, a: 1, an: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, multi: 1, audio: 1, complete: 1,
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
  if (q.join("") === c.join("")) return true; // one-word listings: "Shinchan" == "Shin Chan"
  var cset = {};
  c.forEach(function (w) { cset[w] = 1; });
  var contained = true;
  for (var i = 0; i < q.length; i++) if (!cset[q[i]]) { contained = false; break; }
  if (contained && (2 * q.length) / (q.length + c.length) >= 0.8) return true;
  // Release-junk tail: title words lead, only tech/release tokens follow.
  var stripped = [];
  for (var j = 0; j < c.length; j++) { if (!isTailJunk(c[j])) stripped.push(c[j]); }
  if (stripped.length && stripped.join("") === q.join("") && c.slice(0, stripped.length).join("") === q.join("")) return true;
  return false;
}
function titleScore(a, b) {
  var wa = exactWords(a), wb = exactWords(b);
  if (!wa.length || !wb.length) return 0;
  var hit = 0;
  wa.forEach(function (w) { if (wb.indexOf(w) !== -1) hit++; });
  return (2 * hit) / (wa.length + wb.length);
}
function yearOf(text) {
  var m = /\b(19|20)\d{2}\b/.exec(String(text || ""));
  return m ? parseInt(m[0], 10) : null;
}

// ---------- TMDB ----------
function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return getJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY, 10000)
    .then(function (j) {
      if (!j) return null;
      var title = j.title || j.name || null;
      if (!title) return null;
      var dateStr = j.release_date || j.first_air_date || "";
      return { title: title, year: yearOf(dateStr), imdbId: j.imdb_id || null };
    })
    .catch(function () { return null; });
}

// ---------- site search ----------
function findPost(meta) {
  var url = BASE_URL + "/wp-json/wp/v2/search?search=" + encodeURIComponent(meta.title) + "&per_page=20&_fields=id,title,url";
  return getJson(url, 10000).then(function (rows) {
    var cands = (Array.isArray(rows) ? rows : []).map(function (r) {
      return { postId: r.id, title: stripTags(r.title || ""), url: r.url || "" };
    });
    return pickPost(cands, meta);
  }).catch(function () { return null; }).then(function (found) {
    if (found) return found;
    // Fallback: HTML search results (<h2><a href>title</a>)
    return getHtml(BASE_URL + "/?s=" + encodeURIComponent(meta.title), 12000).then(function (html) {
      var cands = [], re = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, m;
      while ((m = re.exec(html)) !== null) {
        cands.push({ postId: null, title: stripTags(m[2]), url: m[1] });
      }
      return pickPost(cands, meta);
    }).catch(function () { return null; });
  });
}
function pickPost(cands, meta) {
  var best = null, bestRank = -1;
  cands.forEach(function (c) {
    if (!isExactTitle(meta.title, c.title)) return;
    var cy = yearOf(c.title);
    if (meta.year && cy && cy !== meta.year) return; // known-year mismatch = different release
    var rank = titleScore(c.title, meta.title) + (meta.year && cy === meta.year ? 0.5 : 0);
    if (rank > bestRank) { bestRank = rank; best = c; }
  });
  return best;
}
function getPostContent(post) {
  var url;
  if (post.postId) url = BASE_URL + "/wp-json/wp/v2/posts/" + post.postId + "?_fields=content,title";
  else {
    var slug = post.url.replace(/\/$/, "").split("/").pop();
    url = BASE_URL + "/wp-json/wp/v2/posts?slug=" + encodeURIComponent(slug) + "&_fields=content,title";
  }
  return getJson(url, 10000).then(function (data) {
    var p = Array.isArray(data) ? data[0] : data;
    if (!p || !p.content || !p.content.rendered) return null;
    return p.content.rendered;
  }).catch(function () { return null; });
}

// ---------- download buttons in a post ----------
function parseDownloads(html) {
  var h3s = [], hm;
  var h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  while ((hm = h3Re.exec(html)) !== null) h3s.push({ pos: hm.index, text: stripTags(hm[1]) });
  var out = [], bm;
  var btnRe = /<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"[^>]*>/gi;
  while ((bm = btnRe.exec(html)) !== null) {
    var label = "";
    for (var i = h3s.length - 1; i >= 0; i--) {
      if (h3s[i].pos < bm.index) { label = h3s[i].text; break; }
    }
    out.push({ label: label, url: bm[1] });
  }
  return out;
}

// ---------- file-host resolution ----------
function qualityFromText(text) {
  if (/2160|4k|uhd/i.test(text)) return "4K";
  if (/1080/.test(text)) return "1080p";
  if (/720/.test(text)) return "720p";
  if (/480/.test(text)) return "480p";
  if (/360/.test(text)) return "360p";
  return "HD";
}
function specsFromName(name) {
  var parts = [];
  var q = qualityFromText(name);
  if (q !== "HD") parts.push(q);
  if (/bluray|bdrip/i.test(name)) parts.push("BluRay");
  else if (/web[-.]?dl/i.test(name)) parts.push("Web-DL");
  else if (/webrip/i.test(name)) parts.push("WebRip");
  else if (/hdrip/i.test(name)) parts.push("HDRip");
  if (/x265|hevc/i.test(name)) parts.push("x265");
  else if (/x264|h264/i.test(name)) parts.push("x264");
  return parts.join(" ") || q;
}
function resolveGdshine(url) {
  var id = String(url).split("/").filter(Boolean).pop() || "";
  if (!id) return Promise.resolve(null);
  return getJson("https://gdshine.org/api/files/s/" + encodeURIComponent(id), 8000)
    .then(function (j) {
      var fid = j && j.data && j.data.id;
      if (!fid) return null;
      return fetchWithTimeout("https://gdshine.org/api/downloads/" + fid + "/via-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: "{}",
      }, 8000).then(function (r) { return r.ok ? r.json() : null; });
    })
    .then(function (j) { return (j && j.data && j.data.copyUrl) || null; })
    .catch(function () { return null; });
}
// fileUrl is a boldb.site / hshare.lol ?id=<file> link; fetching it lands on
// the download page (server-side redirect) whose buttons lead to the file.
function resolveFilePage(fileUrl, groupLabel) {
  return getHtml(fileUrl, 12000).then(function (html) {
    var nameM = /Name:\s*([^<\n\r]+)/i.exec(html);
    var fileName = nameM ? nameM[1].trim() : "";
    var sizeM = /\[(\d+(?:\.\d+)?\s*(?:GB|MB))\]/i.exec(groupLabel || "");
    var btns = [], re = /<a\b[^>]*href="([^"]+)"[^>]*>/gi, m;
    while ((m = re.exec(html)) !== null) {
      if (!/\bclass="[^"]*\bbtn\b/i.test(m[0])) continue;
      var href = m[1];
      if (!href || href === "#" || href.indexOf("javascript") === 0) continue;
      btns.push(href);
    }
    var jobs = btns.map(function (href) {
      if (/gdshine\./i.test(href)) {
        return resolveGdshine(href).then(function (direct) {
          if (!direct) return null;
          return {
            name: "HindMovies",
            title: specsFromName(fileName || groupLabel) + " · GDShine" + (sizeM ? " [" + sizeM[1] + "]" : ""),
            url: direct,
            quality: qualityFromText(fileName || groupLabel),
            type: "direct",
          };
        });
      }
      return Promise.resolve(null); // photos/hcloud/dead worker mirrors are not playable
    });
    return Promise.all(jobs).then(function (arr) {
      return arr.filter(function (x) { return !!x; });
    });
  }).catch(function () { return []; });
}
// mvlink page (links.joshapp.blog) -> the file-host anchor (?id=<video file>)
function resolveMvlink(mvlinkUrl, groupLabel) {
  return getHtml(mvlinkUrl, 12000).then(function (html) {
    var m = /href="([^"]*[?&]id=[^"]*\.(?:mkv|mp4|avi)[^"]*)"/i.exec(html)
      || /href="([^"]*(?:boldb\.site|hshare\.lol)[^"]*)"/i.exec(html);
    if (!m) return [];
    return resolveFilePage(m[1].replace(/&amp;/g, "&"), groupLabel);
  }).catch(function () { return []; });
}

// ---------- main ----------
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta) return [];
    return findPost(meta).then(function (post) {
      if (!post) return [];
      return getPostContent(post).then(function (html) {
        if (!html) return [];
        var downloads = parseDownloads(html);
        if (!downloads.length) return [];
        if (type === "movie") {
          var picks = downloads.slice(0, 3);
          return Promise.all(picks.map(function (d) {
            return resolveMvlink(d.url, d.label);
          })).then(function (lists) {
            var out = [];
            lists.forEach(function (l) { out.push.apply(out, l); });
            return dedupe(out).slice(0, 6);
          });
        }
        // series: download buttons whose section header names the season
        if (seasonNum == null || episodeNum == null) return [];
        var seasonPicks = downloads.filter(function (d) {
          var sm = /season\s*(\d+)/i.exec(d.label || "");
          return sm && parseInt(sm[1], 10) === seasonNum;
        }).slice(0, 2);
        if (!seasonPicks.length) return [];
        return Promise.all(seasonPicks.map(function (d) {
          return getHtml(d.url, 12000).then(function (epHtml) {
            var re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, a, epUrl = null;
            while ((a = re.exec(epHtml)) !== null) {
              var em = /episode\s*0*(\d+)\b/i.exec(stripTags(a[2]));
              if (em && parseInt(em[1], 10) === episodeNum && /\.(mkv|mp4|avi)/i.test(a[1])) { epUrl = a[1]; break; }
            }
            if (!epUrl) return [];
            return resolveFilePage(epUrl.replace(/&amp;/g, "&"), d.label);
          }).catch(function () { return []; });
        })).then(function (lists) {
          var out = [];
          lists.forEach(function (l) { out.push.apply(out, l); });
          return dedupe(out).slice(0, 4);
        });
      });
    });
  }).catch(function () { return []; });
}
function dedupe(streams) {
  var seen = {}, out = [];
  streams.forEach(function (s) {
    if (s && s.url && !seen[s.url]) { seen[s.url] = 1; out.push(s); }
  });
  return out;
}

global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
