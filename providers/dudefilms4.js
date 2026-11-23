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



// DudeFilms provider — ported 2026-11-06 (dudefilms2.js v1.0.1) from
// phisher98's CSX CineStream invokeDudefilms (com.megix, phisher98/CSX).
// Chain (IMDb-keyed, no title search to go wrong):
//   TMDB -> IMDb id (external_ids) -> dudefilms.church/?s=<imdbId>
//   -> post page (title gated) -> movie: a.maxbutton -> dflinks page
//   -> a.maxbutton -> source href; TV: h4 "Season N" -> sibling <p>
//   -> <a> -> a.maxbutton matching "Episode|Ep|E <n>" -> source href.
// Source hrefs resolve by host: hubcloud.* -> the plugin's HubCloud
// resolver (drive page -> gamerxyt -> PixelDrain/R2/Workers/FSL, with
// the dead-PixelDrain liveness drop); direct video files (.mkv/.mp4)
// are returned as-is. GoFile / Dotflix / GDFlix / GDTot / DoodStream
// sources are SKIPPED in v1 (GDFlix is Cloudflare-blocked, GDTot does
// not connect, the Dood video was deleted, the direct .mkv 500s) —
// HubCloud is the live path and is verified working below.
// Verified 2026-11-06 (sandbox): The Matrix search returns its post,
// but that old post's sources are all dead (PixelDrain negn6f gone,
// R2 403, Dood "Video not found", workers 500) — honestly 0 for it.
// Bhai Tera Star Hai 2026 (recent post): HubCloud -> gamerxyt ->
// R2 direct .mkv, GET Range 206 Matroska. So DudeFilms works for
// recent posts; old posts rot. Device test decides playback.

var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var MAIN_URL = "https://dudefilms.church";

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
      var d = j && j.dudefilms;
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
// DudeFilms post titles are formulaic: "The Matrix (1999) {Hindi-English}
// 480p – DFlinks – DudeFilms Links". The comparable title is the lead
// segment before the year bracket / dash.
function cleanSiteTitle(raw) {
  var t = String(raw || "").replace(/^download\s*/i, "");
  t = t.split("(")[0].split("|")[0].split(" – ")[0].split(" - ")[0];
  return t.replace(/\s+/g, " ").trim();
}
function yearOf(text) {
  var m = /\b(19|20)\d{2}\b/.exec(String(text || ""));
  return m ? parseInt(m[0], 10) : null;
}
function parseQuality(text) {
  var s = String(text || "");
  var m = /(2160|1440|1080|720|480)\s*P/i.exec(s);
  if (m) return m[1] + "p";
  if (/4K|UHD/i.test(s)) return "2160p";
  return "HD";
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
function tmdbImdbId(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return getJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_KEY, {}, 10000)
    .then(function (j) { return (j && j.imdb_id) ? j.imdb_id : null; })
    .catch(function () { return null; });
}

// ---------- HTML helpers ----------
// Extract every <a> as {href, cls, text}, robust to attribute order.
function extractAnchors(html) {
  var out = [], m;
  var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(html)) !== null) {
    var attrs = m[1] || "";
    var hrefM = /href\s*=\s*"([^"]*)"/i.exec(attrs) || /href\s*=\s*'([^']*)'/i.exec(attrs);
    var clsM = /class\s*=\s*"([^"]*)"/i.exec(attrs) || /class\s*=\s*'([^']*)'/i.exec(attrs);
    out.push({ href: hrefM ? hrefM[1] : "", cls: clsM ? clsM[1] : "", text: m[2] || "" });
  }
  return out;
}
function maxbuttonHrefs(html) {
  var out = [], seen = {};
  extractAnchors(html).forEach(function (a) {
    if (a.cls && a.cls.indexOf("maxbutton") !== -1 && a.href && a.href.indexOf("http") === 0 && !seen[a.href]) {
      seen[a.href] = 1;
      out.push(a.href);
    }
  });
  return out;
}
// TV: find the <h4> naming "Season N", then walk the run of consecutive
// sibling <p> blocks after it and collect their <a> hrefs.
function findSeasonLinks(html, season) {
  var out = [], seen = {};
  var re = /<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, m;
  var seasonRe = new RegExp("Season\\s*0*" + season + "\\b", "i");
  while ((m = re.exec(html)) !== null) {
    var txt = decodeHtml(m[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!seasonRe.test(txt)) continue;
    var after = html.slice(m.index + m[0].length);
    var run = /^\s*((?:<p\b[^>]*>[\s\S]*?<\/p>\s*)+)/i.exec(after);
    if (!run) continue;
    extractAnchors(run[1]).forEach(function (a) {
      if (a.href && a.href.indexOf("http") === 0 && !seen[a.href]) { seen[a.href] = 1; out.push(a.href); }
    });
  }
  return out;
}

// ---------- hubcloud drive resolution (shared with MoviesDrive) ----------
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
  var vidRe = /href="(https?:\/\/[^\"]+\.(?:mkv|mp4|avi|webm)\?token=\d+[^"]*)"/gi;
  while ((m = vidRe.exec(page)) !== null) out.push({ url: m[1], type: "Direct" });
  return out.filter(function (f) {
    return !/drive\.google\.com|docs\.google\.com/.test(f.url);
  });
}
// 2026-10-28: pixeldrain files get deleted (negn6f = 404 not_found) while
// hub pages keep listing them; shipping them yields dead rows. Probe each
// PixelDrain id via /api/file/<id>/info and drop only ids the API
// positively reports as gone (HTTP 404 or success:false). Fail open: any
// other check error keeps the link, so a transient failure never deletes
// a good row. Non-PixelDrain links are never probed.
function checkPixeldrainAlive(link) {
  var m = /api\/file\/([A-Za-z0-9_-]+)/.exec(link.url);
  var id = m ? m[1] : null;
  if (!id) return Promise.resolve(link);
  return getText("https://pixeldrain.dev/api/file/" + id + "/info", {}, 8000).then(function (t) {
    try {
      var j = JSON.parse(t);
      if (j && j.success === false) return null;
    } catch (e) {}
    return link;
  }).catch(function (e) {
    if (/HTTP 404/.test(String(e && e.message))) return null;
    return link;
  });
}
function resolveHubcloud(hubUrl, referer) {
  return getText(hubUrl, { Cookie: "xla=s4t", Referer: referer || "https://hubcloud.ist/" }, 12000)
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
          var rest = found.filter(function (f) { return f.type !== "PixelDrain"; });
          if (!pd.length) return found;
          return Promise.all(pd.map(checkPixeldrainAlive)).then(function (checked) {
            var live = checked.filter(function (x) { return !!x; });
            return live.length ? live : rest;
          });
        });
    })
    .catch(function () { return []; });
}

// ---------- site chain ----------
function searchByImdb(imdbId) {
  var url = MAIN_URL + "/?s=" + encodeURIComponent(imdbId);
  return getText(url, { Referer: MAIN_URL + "/" }, 12000).then(function (html) {
    var out = [], seen = {};
    extractAnchors(html).forEach(function (a) {
      if (a.cls && a.cls.indexOf("simple-grid-grid-post-thumbnail-link") !== -1 && a.href && !seen[a.href]) {
        seen[a.href] = 1;
        out.push(a.href);
      }
    });
    return out;
  }).catch(function () { return []; });
}
function toStream(url, server, meta, quality, isSeries, seasonNum, episodeNum) {
  var sz = formatStreamSize({ source: "DudeFilms", title: meta.title, year: meta.year, quality: quality,
    season: isSeries ? seasonNum : undefined, episode: isSeries ? episodeNum : undefined,
    server: server || undefined, url: url });
  return { name: "DudeFilms", title: "DudeFilms", size: sz, url: url, quality: quality, type: "direct", _releaseTitle: meta.title + " " + (quality || "") };
}
function checkDirectAlive(url) {
  // Direct video files: probe with a 1-byte Range GET. 200/206 = alive.
  // 4xx/5xx = dead (the dl.*.workers.dev direct links 500 with CF
  // error 1101). Fail open on transport errors so a transient never
  // deletes a good row. Do NOT read the body: a 200 that ignores Range
  // would be the whole file.
  return fetchWithTimeout(url, { headers: { Range: "bytes=0-0" } }, 8000).then(function (r) {
    return (r.status === 200 || r.status === 206);
  }).catch(function () { return true; });
}
function resolveSource(href, referer, meta, quality, isSeries, seasonNum, episodeNum) {
  if (/hubcloud\./i.test(href)) {
    return resolveHubcloud(href, referer).then(function (urls) {
      return urls.map(function (u) { return toStream(u.url, u.type, meta, quality, isSeries, seasonNum, episodeNum); });
    }).catch(function () { return []; });
  }
  if (/\.(mkv|mp4|avi|webm)(?:[?#]|$)/i.test(href)) {
    return checkDirectAlive(href).then(function (alive) {
      return alive ? [toStream(href, "Direct", meta, quality, isSeries, seasonNum, episodeNum)] : [];
    });
  }
  return Promise.resolve([]);
}
function tryPost(postUrl, meta, isSeries, seasonNum, episodeNum) {
  return getText(postUrl, { Referer: MAIN_URL + "/" }, 12000).then(function (html) {
    if (!html) return [];
    var titleM = /<title>([\s\S]*?)<\/title>/i.exec(html);
    var rawTitle = titleM ? decodeHtml(titleM[1]) : "";
    var base = cleanSiteTitle(rawTitle);
    if (!isExactTitle(meta.title, base)) return [];
    if (!isSeries && meta.year) {
      var y = yearOf(rawTitle);
      if (y && Math.abs(y - meta.year) > 1) return [];
    }
    var quality = parseQuality(rawTitle);
    if (isSeries) {
      var seasonLinks = findSeasonLinks(html, seasonNum);
      var chain = Promise.resolve([]);
      seasonLinks.slice(0, 3).forEach(function (linkUrl) {
        chain = chain.then(function (got) {
          if (got && got.length) return got;
          return getText(linkUrl, { Referer: postUrl }, 12000).then(function (page) {
            if (!page) return [];
            var anchors = extractAnchors(page).filter(function (a) { return a.cls && a.cls.indexOf("maxbutton") !== -1; });
            var epRe = /(?:Episode|Ep|E)\s*(\d+)/i;
            for (var i = 0; i < anchors.length; i++) {
              var txt = decodeHtml(anchors[i].text || "").replace(/<[^>]+>/g, " ");
              var em = epRe.exec(txt);
              if (em && parseInt(em[1], 10) === episodeNum) {
                return resolveSource(anchors[i].href, linkUrl, meta, quality, isSeries, seasonNum, episodeNum);
              }
            }
            return [];
          }).catch(function () { return []; });
        });
      });
      return chain;
    }
    var links = maxbuttonHrefs(html);
    var chain2 = Promise.resolve([]);
    // Cap 2 dflinks pages: each is one quality, and the first page that
    // yields a live stream wins. Keeps the per-attempt cost down so the
    // chain-retry postlude still fits the 60s TV budget on empty titles.
    links.slice(0, 2).forEach(function (dfUrl) {
      chain2 = chain2.then(function (got) {
        if (got && got.length) return got;
        return getText(dfUrl, { Referer: postUrl }, 12000).then(function (page) {
          if (!page) return [];
          var hrefs = maxbuttonHrefs(page);
          var rc = Promise.resolve([]);
          hrefs.slice(0, 3).forEach(function (h) {
            rc = rc.then(function (acc) {
              return resolveSource(h, dfUrl, meta, quality, isSeries, seasonNum, episodeNum).then(function (r) { return acc.concat(r); });
            });
          });
          return rc;
        }).catch(function () { return []; });
      });
    });
    return chain2;
  }).catch(function () { return []; });
}
// Secret gist holding the user's tokens (same file the showbox/gramcinema
// tokens live in). SCRAPER_SETTINGS always wins; the gist is only read when
// a key is missing from settings. The keys are never in the repo.
var TOKEN_FILE_URL = 'https://gist.githubusercontent.com/rareanimeaddon-blip/6fc363ac74cb8921d61c07a2c6bb59d6/raw/gistfile1.txt';
var _fileTokens = null;
var _fileTokensPromise = null;
function loadTokenFile() {
  if (_fileTokens) return Promise.resolve(_fileTokens);
  if (_fileTokensPromise) return _fileTokensPromise;
  if (!TOKEN_FILE_URL) { _fileTokens = {}; return Promise.resolve(_fileTokens); }
  try {
    _fileTokensPromise = fetch(TOKEN_FILE_URL).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (j) { _fileTokens = j || {}; return _fileTokens; }).catch(function () { _fileTokens = {}; return _fileTokens; });
  } catch (e) { _fileTokens = {}; return Promise.resolve(_fileTokens); }
  return _fileTokensPromise;
}
function _setting(cfg, key) {
  try {
    if (cfg && cfg[key]) return String(cfg[key]).trim();
  } catch (e) {}
  return '';
}
function getSubdlKeys(cfg) {
  var k1 = _setting(cfg, 'subdlApiKey');
  var k2 = _setting(cfg, 'subdlApiKey2');
  if (k1 && k2) return Promise.resolve([k1, k2]);
  return loadTokenFile().then(function (t) {
    if (!k1) { try { if (t && t.subdlApiKey) k1 = String(t.subdlApiKey).trim(); } catch (e) {} }
    if (!k2) { try { if (t && t.subdlApiKey2) k2 = String(t.subdlApiKey2).trim(); } catch (e) {} }
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  }).catch(function () {
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  });
}
function getWyzieKeys(cfg) {
  var k1 = _setting(cfg, 'wyzieApiKey');
  var k2 = _setting(cfg, 'wyzieApiKey2');
  if (k1 && k2) return Promise.resolve([k1, k2]);
  return loadTokenFile().then(function (t) {
    if (!k1) { try { if (t && t.wyzieApiKey) k1 = String(t.wyzieApiKey).trim(); } catch (e) {} }
    if (!k2) { try { if (t && t.wyzieApiKey2) k2 = String(t.wyzieApiKey2).trim(); } catch (e) {} }
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  }).catch(function () {
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  });
}
// ---- Subtitle addon (Infinite Streams Subtitles, Cloudflare Worker) ----
// The provider asks the addon for this title's subtitles instead of
// calling SubDL/Wyzie/mirror directly. The addon returns its ranked list
// (Sunsync pre-synced first, then SubDL, Wyzie, mirror); the provider
// picks the best match per row with the existing token scorer, so each
// stream carries the subtitle that fits its own release. The addon needs
// the user's keys in the URL config to return SubDL/Wyzie results —
// without them it returns Sunsync + mirror only. Pure-JS base64url
// (no Buffer/btoa in the TV guest); keys are ASCII so one char = one byte.
var ADDON_BASE = 'https://infinite-subtitles.teghvirsingh-work.workers.dev';
function b64urlEncodeAscii(str) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  for (var i = 0; i < str.length; i += 3) {
    var c1 = str.charCodeAt(i) & 255;
    var c2 = (i + 1 < str.length) ? str.charCodeAt(i + 1) & 255 : NaN;
    var c3 = (i + 2 < str.length) ? str.charCodeAt(i + 2) & 255 : NaN;
    var n = (c1 << 16) | ((isNaN(c2) ? 0 : c2) << 8) | (isNaN(c3) ? 0 : c3);
    out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63] + (isNaN(c2) ? '=' : chars[(n >>> 6) & 63]) + (isNaN(c3) ? '=' : chars[n & 63]);
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function addonConfigStr(sdKeys, wzKeys) {
  var o = {};
  if (sdKeys && sdKeys[0]) o.s = sdKeys[0];
  if (sdKeys && sdKeys[1] && sdKeys[1] !== sdKeys[0]) o.s2 = sdKeys[1];
  if (wzKeys && wzKeys[0]) o.w = wzKeys[0];
  if (wzKeys && wzKeys[1] && wzKeys[1] !== wzKeys[0]) o.w2 = wzKeys[1];
  var has = o.s || o.s2 || o.w || o.w2;
  if (!has) return '';
  return b64urlEncodeAscii(JSON.stringify(o));
}
// One addon call per title; returns the addon's ranked English subtitles
// as {id, url, release} for the per-row matcher. [] on any failure.
function addonSubs(imdbId, isSeries, season, episode, cfg) {
  return Promise.all([getSubdlKeys(cfg), getWyzieKeys(cfg)]).then(function (ks) {
    var cfgStr = addonConfigStr(ks[0], ks[1]);
    var path = isSeries
      ? '/subtitles/series/' + imdbId + ':' + season + ':' + episode + '.json'
      : '/subtitles/movie/' + imdbId + '.json';
    var url = ADDON_BASE + (cfgStr ? '/' + cfgStr : '') + path;
    return fetch(url).then(function (r) {
      if (!r.ok) return [];
      return r.json();
    }).then(function (j) {
      var list = (j && j.subtitles) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        var lang = String(it.lang || '').toLowerCase();
        if (lang !== 'en' && lang !== 'eng') continue;
        var u2 = it.url || '';
        if (u2.indexOf('https://') !== 0) continue;
        var rel = it.movieReleaseName || it.subtitleFileName || '';
        if (!rel) continue;
        out.push({ id: it.id, url: u2, release: rel });
      }
      return out;
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}
function osTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (t) { return t.length > 0; });
}
function osGroup(name) {
  var s = String(name || '');
  // Last parenthesised chunk that is NOT just a year (e.g. "(2026)") — the
  // year is not a release group, and treating it as one makes every
  // same-year release "match" (+4). Skip pure years / pure numbers.
  var groups = s.match(/\(([^)]+)\)/g) || [];
  for (var gi = groups.length - 1; gi >= 0; gi--) {
    var g = groups[gi].replace(/[()]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s*4khdhub\s*$/, '').trim();
    if (!g) continue;
    if (/^\d{4}$/.test(g) || /^\d+$/.test(g)) continue;
    return g;
  }
  var m = s.match(/[-.]([A-Za-z][A-Za-z0-9]{1,})\s*$/);
  if (m) return m[1].toLowerCase();
  return '';
}
function osReleaseFeatures(name) {
  var toks = osTokens(name);
  var set = {};
  for (var i = 0; i < toks.length; i++) set[toks[i]] = true;
  var squashed = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  var source = '';
  if (squashed.indexOf('bluray') !== -1) source = 'bluray';
  else if (squashed.indexOf('webdl') !== -1) source = 'webdl';
  else if (squashed.indexOf('webrip') !== -1) source = 'webrip';
  else if (squashed.indexOf('hdtv') !== -1) source = 'hdtv';
  else if (squashed.indexOf('dvdrip') !== -1) source = 'dvdrip';
  else if (set['ts'] || set['telesync']) source = 'ts';
  return {
    group: osGroup(name),
    source: source,
    res: set['2160p'] ? '2160p' : set['1080p'] ? '1080p' : set['720p'] ? '720p' : set['480p'] ? '480p' : '',
    codec: (set['x265'] || set['hevc'] || squashed.indexOf('h265') !== -1) ? 'hevc' : (set['x264'] || set['avc'] || squashed.indexOf('h264') !== -1) ? 'avc' : '',
    imax: !!set['imax'],
    remux: !!set['remux']
  };
}
function osScore(fileF, subF) {
  var s = 0;
  if (fileF.group && subF.group && fileF.group === subF.group) s += 4;
  else if (fileF.group && subF.group) {
    var fg = fileF.group.split(' '), sg = subF.group.split(' ');
    for (var i = 0; i < fg.length; i++) { if (sg.indexOf(fg[i]) !== -1) { s += 2; break; } }
  }
  if (fileF.source && fileF.source === subF.source) s += 2;
  if (fileF.res && fileF.res === subF.res) s += 1;
  if (fileF.codec && fileF.codec === subF.codec) s += 1;
  if (fileF.imax && subF.imax) s += 1;
  if (fileF.remux && subF.remux) s += 1;
  return s;
}
function osBestMatch(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0;
  for (var k = 0; k < subs.length; k++) {
    var sc = osScore(ff, osReleaseFeatures(subs[k].release));
    if (sc > bestScore) { bestScore = sc; best = subs[k]; }
  }
  return (best && bestScore >= 4) ? best : null;
}
// Best subtitle by release fit, with no threshold — returns {sub, score}.
// Used as the fallback when osBestMatch finds nothing: the highest-scoring
// subtitle for this row's release (same resolution class at least) is
// far better than the addon's top-ranked one, which is ranked by source
// quality, not by how well it fits this row. A BluRay-synced subtitle on
// a CAM row scores 0 here and is never picked.
function osBestAny(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0;
  for (var k = 0; k < subs.length; k++) {
    var sf = osReleaseFeatures(subs[k].release);
    var sc = osScore(ff, sf);
    if (sc > bestScore) { bestScore = sc; best = subs[k]; }
  }
  if (!best) return null;
  return { sub: best, score: bestScore };
}
function osAttachSubtitles(rows, imdbId, isSeries, season, episode, cfg) {
  // Subtitles come ONLY from the Infinite Subtitles addon. One addon call
  // per title; the best subtitle for each row’s own release is attached
  // automatically. No direct SubDL/Wyzie/mirror calls from this provider.
  try {
    if (cfg && cfg.osSubtitles === false) return Promise.resolve(rows);
    if (!imdbId || !rows || !rows.length) return Promise.resolve(rows);
    var cleanup = function () {
      for (var c = 0; c < rows.length; c++) { try { delete rows[c]._rel; delete rows[c]._releaseTitle; } catch (e) {} }
      return rows;
    };
    var prep = function () {
      for (var i = 0; i < rows.length; i++) {
        var rel = rows[i]._releaseTitle || '';
        if (!rel && rows[i].url) {
          try { rel = decodeURIComponent(String(rows[i].url).split('/').pop() || '').replace(/.[^.]+$/, ''); } catch (e) {}
        }
        rows[i]._rel = rel;
      }
    };
    prep();
    return addonSubs(imdbId, isSeries, season, episode, cfg).then(function (adSubs) {
      for (var i = 0; i < rows.length; i++) {
        var hit = osBestMatch(rows[i]._rel, adSubs);
        if (!hit) {
          var any = osBestAny(rows[i]._rel, adSubs);
          if (any && any.score >= 1) hit = any.sub;
        }
        if (!hit && adSubs.length) {
          // No release fit at all (e.g. a 480p row when the addon only has
          // 1080p subtitles). The addon only returns subtitles for THIS
          // title, so the top-ranked non-Sunsync one is the right movie —
          // attach it, unless the row is a CAM/TS, where no proper-release
          // subtitle can match the recording's timing.
          var rl = (rows[i]._rel || '').toLowerCase();
          if (rl.indexOf('cam') === -1 && rl.indexOf('ts') === -1) {
            for (var k = 0; k < adSubs.length; k++) {
              var cand = adSubs[k];
              var cid = String(cand.id || '').toLowerCase();
              var crel = String(cand.release || '').toLowerCase();
              if (cid.indexOf('sunsync') === -1 && crel.indexOf('sunsync') === -1) { hit = cand; break; }
            }
          }
        }
        if (hit) rows[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
      }
      return cleanup();
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isSeries = mediaType === "tv";
  if (isSeries && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);
  return resolveDomain().then(function () {
    return Promise.all([tmdbMeta(tmdbId, mediaType), tmdbImdbId(tmdbId, mediaType)]);
  }).then(function (parts) {
    var meta = parts[0], imdbId = parts[1];
    if (!meta || !imdbId) return [];
    return searchByImdb(imdbId).then(function (posts) {
      var chain = Promise.resolve([]);
      posts.slice(0, 2).forEach(function (postUrl) {
        chain = chain.then(function (got) {
          if (got && got.length) return got;
          return tryPost(postUrl, meta, isSeries, seasonNum, episodeNum);
        });
      });
      return chain.then(function (streams) {
        var qRank = { "2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "HD": 0 };
        var seen = {}, out = [];
        streams.forEach(function (s) { if (!seen[s.url]) { seen[s.url] = 1; out.push(s); } });
        out.sort(function (a, b) { return (qRank[b.quality] || 0) - (qRank[a.quality] || 0); });
        return osAttachSubtitles(out.slice(0, 8), imdbId, isSeries, seasonNum, episodeNum, {
          osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
          subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
          subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
          year: meta.year || 0
        });
      });
    });
  }).catch(function () { return []; });
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

// __STREAM_LABEL_FORMATTER__ v4 (size): user-spec body — heading is the provider name (in `name`), body is the essential info.
// Body lines: 🎬 Title [(Year)] | 📂 Season N • 🎞️ Episode N (series only) | 💎 Quality | ⏱️ Runtime | 🔊 Audio | 💾 File size | 🗄️ Server | 💬 Subtitles.
// Only lines with data are shown. Pure string work, no timers, no TextEncoder, no fetch. Never throws.
function formatStreamSize(o) {
  try {
    o = o || {};
    function str(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
    function langName(v) {
      var k = str(v).toLowerCase();
      var map = { en: "English", eng: "English", english: "English", hi: "Hindi", hin: "Hindi", hindi: "Hindi",
        es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", ru: "Russian",
        ar: "Arabic", bn: "Bengali", zh: "Chinese", ja: "Japanese", ko: "Korean", ta: "Tamil", te: "Telugu",
        ml: "Malayalam", mr: "Marathi", pa: "Punjabi", ur: "Urdu", id: "Indonesian", ms: "Malay",
        vi: "Vietnamese", th: "Thai", tl: "Filipino", nl: "Dutch", sv: "Swedish", da: "Danish",
        fi: "Finnish", no: "Norwegian", pl: "Polish", tr: "Turkish", uk: "Ukrainian", cs: "Czech",
        el: "Greek", he: "Hebrew", ro: "Romanian", hu: "Hungarian" };
      if (map[k]) return map[k];
      return str(v);
    }
    var lines = [];
    var title = str(o.title);
    if (title) {
      var t = "🎬 " + title;
      var year = str(o.year);
      if (year) t += " (" + year + ")";
      lines.push(t);
    }
    if (o.season !== undefined && o.season !== null && String(o.season) !== "" &&
        o.episode !== undefined && o.episode !== null && String(o.episode) !== "")
      lines.push("📂 Season " + o.season + " • 🎞️ Episode " + o.episode);
    var q = str(o.quality);
    if (q && q.toLowerCase() !== "unknown") lines.push("💎 " + q);
    var rt = o.runtime;
    var rtMin = 0;
    if (typeof rt === "number" && rt > 0) rtMin = Math.round(rt);
    else if (typeof rt === "string" && /^\d+$/.test(rt.trim())) rtMin = parseInt(rt.trim(), 10);
    if (rtMin > 0) {
      var rh = Math.floor(rtMin / 60), rm = rtMin % 60;
      lines.push("⏱️ " + (rh > 0 ? rh + "h " + (rm < 10 ? "0" : "") + rm + "m" : rm + "m"));
    }
    var audio = o.audio;
    if (Array.isArray(audio)) audio = audio.filter(function (a) { return str(a); }).join(" / ");
    audio = str(audio);
    if (audio && audio.toLowerCase() !== "unknown") lines.push("🔊 " + audio);
    var size = str(o.size);
    if (size) lines.push("💾 " + size);
    var server = str(o.server);
    if (!server && str(o.url)) {
      var h = str(o.url).split("/")[2] || "";
      server = h.replace(/^www\./, "");
    }
    if (server) lines.push("🗄️ " + server);
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
      lines.push("💬 " + shown);
    }
    return lines.join("\n");
  } catch (e) { return ""; }
}

global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
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
