/* CineVood (cinevood.net) Nuvio provider — ported as cinevood3 v1.0.2
 *
 * v1.0.2 (2026-11-05): detail fallback — the phone gets http 403 from
 * Cloudflare on post HTML pages (root + search pass), so when the detail
 * HTML fetch throws, fetch the same post via the site's public wp-json
 * API (posts?slug=...) and run the identical button extraction on
 * content.rendered (verified: same 10 buttons + h6 labels for Brand New
 * Day). HTML path untouched; fallback triggers on throw only.
 *
 * Source: CNCVerse CineVoodProvider .cs3 v8 (com.cncverse.cinevood),
 * DEX-extracted 2026-11-04 (androguard). CNCVerse is a trusted source in
 * the user's dev network. Inspected clean: NO ad-gate/shortlink code, NO
 * user tokens. One embedded TMDB key in the DEX was swapped for the guest
 * TMDB_API_KEY global (Dulo precedent). The DEX's donation-stats GET and
 * interactive Cloudflare WebView solve were NOT ported (not playback).
 *
 * Ported provider: "CineVood" (cinevood.net, API search). The package's
 * second provider ("CineVood Mirror", one.1cinevood.beer, WordPress) is
 * NOT ported here — separate provider, can follow later.
 *
 * Chain (P2, faithful to the DEX):
 *   TMDB title+year -> GET {site}/search.php?q=<title>&page=<n>
 *     -> hits[].document (filter post_type "post", drop XXX/Trailer/18+)
 *     -> exact gate (title + year) -> permalink
 *   -> GET detail page -> h6 labels + anchors -> Btns, filtered to
 *     hubcloud|filepress|filebee|gdflix|gdlink (+ oxxfile, see below)
 *   -> per Btn, serialized routing (DEX used parallel fan-out):
 *     hubcloud -> hubCloud(): drive id -> generation page (var url='..')
 *       which itself carries the final file links (R2 signed URLs,
 *       pixeldrain liveness-checked, gpdl links; hbplay pages skipped)
 *     gdflix/gdlink -> gdFlix(): Name/Size items -> Instant DL (GET to
 *       final URL) / CLOUD DOWNLOAD (url= param decode); R2 emitted
 *     filepress/filebee -> Filepress.getUrl(): page -> api/file/get
 *       -> POST api/file/downlaod {method, id} -> POST
 *       api/file/downlaod2/ -> final file URLs
 *
 * LIVE STATUS (probed 2026-11-04, sandbox):
 * - Search + detail pages fetch fine (200). Brand New Day 2026 carries
 *   real DEX-host buttons (hubcloud.ist, new1.filepress.lat, gdflix.dev).
 * - Filepress is CHALLENGE-WALLED: its page answers 403 (challenge) and
 *   its API answers CHALLENGE_REQUIRED + attemptId. A TV guest cannot
 *   solve that, so filepress rows fail open (contribute 0). Its API
 *   origin also moved new1 -> new3 (fetch follows redirects).
 * - Watch Online servers (2026-11-04): Vidara RESOLVED (POST
 *   vidaraa.cc/api/stream {filecode, device:"web", codecs:["h265"]}
 *   -> {streaming_url: HLS master + subtitles}); PlayMate 525s from
 *   sandbox (unvalidated, skipped); Vinovo loads Turnstile + reCAPTCHA
 *   (challenge-walled, skipped like filepress).
 * - hubcloud/filepress generators on oxxfile are 500 upstream right now.
 *
 * OxxFile (current format on some posts, e.g. Kantara 2025):
 *   detail anchors https://<sub>.oxxfile.info/s/<code> resolve via the
 *   Next.js API the page itself uses (found in its JS chunks, no JS
 *   execution needed):
 *     GET {origin}/api/s/<code>/ -> flags (hasCloudDownload/hasHubcloud/
 *       hasFilepress/hasViking/hasPixeldrain)
 *     hasCloudDownload -> POST {origin}/api/s/<code>/download/
 *       {driveType:"Drive 1"} -> {downloadLink} (direct file URL)
 *     hasHubcloud/hasFilepress -> POST {origin}/api/s/<code>/<svc>/
 *       {driveId:"dummy"} -> {hubcloudLink|filepressLink}, fed back
 *       through the matching resolver above
 *   PROBED 2026-11-04: cloud download DISABLED on all sampled files
 *   (hasCloudDownload:false -> /download 403s); hubcloud/filepress
 *   generators 500 upstream; viking links 404 (dead host); streamhg/
 *   vidhide have no API route (SPA fallback). So oxxfile buttons
 *   contribute 0 TODAY, but the resolver is live: when oxxfile's
 *   backends recover, those buttons start yielding streams with no
 *   new push. Viking links are NOT emitted (no resolver + observed
 *   dead). Pixeldrain skipped (async task flow + unavailable flags).
 *
 * Older formats NOT covered: zipylink wrappers (unreachable from
 * sandbox; shortener behavior unverified — never automated), gdtot
 * (domain parked/dead), multiup mirror pages (no direct stream).
 * Posts using only those formats return 0 by design (host filter).
 *
 * Series: episode mapping follows the DEX's S/E approach — buttons are
 * kept only when their h6 label marks this exact episode (S<n>E<m>,
 * "Season <n> Episode <m>", or "Episode <m>" on a season-matching
 * post); if no button marks the episode, [] is returned rather than
 * serving a wrong episode (zero-mismatch rule). KNOWN GAP (v1):
 * season-pack posts (e.g. Squid Game S01 "EP (01-09)") use oxxfile
 * /p/<code> pack links, which are NOT matched yet (only /s/ links
 * are), and their range labels don't mark a single episode — so
 * pack posts return [] honestly. /p/ pack resolution + range
 * matching is the follow-up, not guessed here.
 *
 * TV only? No — movies + TV (supportedTypes movie+tv). No timers, no
 * TextEncoder/WebCrypto, no Node APIs, no URLSearchParams for queries.
 */

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

var CV_SITE = "https://cinevood.net";
var CV_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
var CV_FP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var CV_TMDB_KEY = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";

function cvFetch(url, headers, body) {
  var opts = { headers: headers || {} };
  if (body !== undefined) { opts.method = "POST"; opts.body = body; }
  return fetch(url, opts);
}
function cvGetText(url, referer) {
  var headers = { "User-Agent": CV_UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };
  if (referer) headers["Referer"] = referer;
  return cvFetch(url, headers).then(function (resp) {
    if (!resp || resp.status !== 200) throw new Error("http " + (resp && resp.status));
    return resp.text();
  });
}
function cvGetJson(url, referer) {
  var headers = { "User-Agent": CV_UA, Accept: "application/json,*/*", "Accept-Language": "en-US,en;q=0.9" };
  if (referer) headers["Referer"] = referer;
  return cvFetch(url, headers).then(function (resp) {
    if (!resp || resp.status !== 200) throw new Error("http " + (resp && resp.status));
    return resp.json();
  });
}
function cvPostJson(url, referer, obj, ua) {
  var headers = { "User-Agent": ua || CV_UA, "Content-Type": "application/json", Accept: "application/json,*/*" };
  if (referer) headers["Referer"] = referer;
  return cvFetch(url, headers, JSON.stringify(obj || {})).then(function (resp) {
    if (!resp || (resp.status !== 200 && resp.status !== 201)) throw new Error("http " + (resp && resp.status));
    return resp.json();
  });
}
function cvOrigin(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/);
  return m ? m[1] : "";
}
function cvStripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-").trim();
}

/* ---------- exact gate (title + year) ---------- */
var CV_TITLE_NOISE = { the: 1, a: 1, an: 1, watch: 1, online: 1, download: 1,
  free: 1, hd: 1, full: 1, movie: 1, hindi: 1, english: 1, dubbed: 1, dual: 1,
  audio: 1, bluray: 1, webrip: 1, web: 1, dl: 1, hevc: 1, x264: 1, x265: 1,
  avc: 1, aac: 1, esub: 1, msub: 1, unrated: 1, hq: 1, hdtc: 1, cam: 1 };
function cvFoldAccents(s) {
  var map = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
    "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
    "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
    "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function (ch) { return map[ch] || ch; });
}
function cvNormTitle(v) {
  return cvFoldAccents(String(v || "").toLowerCase()).replace(/[^a-z0-9]/g, "");
}
function cvWords(v) {
  return cvFoldAccents(String(v || "").toLowerCase()).split(/[^a-z0-9]+/).filter(function (w) {
    return w && !CV_TITLE_NOISE[w] && !/^\d+$/.test(w) && !/^\d+p$/.test(w);
  });
}
function cvDice(a, b) {
  var sa = {}, i, inter = 0;
  for (i = 0; i < a.length; i++) sa[a[i]] = 1;
  for (i = 0; i < b.length; i++) { if (sa[b[i]]) inter++; }
  var total = a.length + b.length;
  if (total === 0) return 0;
  return (2 * inter) / total;
}
function cvTitleMatches(candidate, tmdbTitles) {
  var cn = cvNormTitle(candidate), cw = cvWords(candidate), i;
  for (i = 0; i < tmdbTitles.length; i++) {
    if (!tmdbTitles[i]) continue;
    if (cn && cn === cvNormTitle(tmdbTitles[i])) return true;
    var tw = cvWords(tmdbTitles[i]);
    if (cw.length && tw.length && cvDice(cw, tw) >= 0.8) return true;
  }
  return false;
}
function cvYearOf(title) {
  var m = String(title || "").match(/\((19\d{2}|20\d{2})\)/) || String(title || "").match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : null;
}
function cvQualityOf(label) {
  var m = String(label || "").match(/(\d{3,4})\s*p/i);
  return m ? m[1] + "p" : "Unknown";
}

/* ---------- TMDB (guest key) ---------- */
function cvTmdb(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + kind + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + CV_TMDB_KEY + "&language=en-US";
  return cvGetJson(url, null).then(function (data) {
    if (!data) throw new Error("tmdb empty");
    var title = data.title || data.name || data.original_title || data.original_name || "";
    var date = data.release_date || data.first_air_date || "";
    return { title: title, year: date ? date.slice(0, 4) : null };
  });
}

/* ---------- search ---------- */
var CV_BLOCKED_CATS = { "XXX": 1, "Trailer": 1, "18+ Adult": 1 };
function cvSearch(title) {
  var q = encodeURIComponent(title);
  var referer = CV_SITE + "/search.html?q=" + q;
  return cvGetJson(CV_SITE + "/search.php?q=" + q + "&page=1", referer).then(function (data) {
    var hits = (data && data.hits) || [], out = [], i, j;
    for (i = 0; i < hits.length; i++) {
      var doc = hits[i] && hits[i].document;
      if (!doc || doc.post_type !== "post") continue;
      var cats = doc.category || [], blocked = false;
      for (j = 0; j < cats.length; j++) { if (CV_BLOCKED_CATS[cats[j]]) { blocked = true; break; } }
      if (blocked) continue;
      out.push({ title: doc.post_title || "", permalink: doc.permalink || "", poster: doc.post_thumbnail || "" });
    }
    return out;
  });
}

/* ---------- detail buttons ---------- */
/* Walk the detail HTML in order: h6 text becomes the current label,
 * anchors become (label, href) pairs — the DEX's load() selection. */
function cvDetailButtons(html) {
  var btns = [], curLabel = "", re = /<h6[^>]*>([\s\S]{0,300}?)<\/h6>|<a[^>]+href=["']([^"']+)["'][^>]*>/gi, m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) { curLabel = cvStripTags(m[1]); continue; }
    var href = m[2];
    if (!href || /\.zip(\?|#|$)/i.test(href)) continue;
    if (/hubcloud|filepress|filebee|gdflix|gdlink/i.test(href)) {
      btns.push({ label: curLabel, url: href });
    } else if (/vidaraa\.cc\/e\/[A-Za-z0-9]+/i.test(href)) {
      btns.push({ label: curLabel, url: href, vidaraa: true });
    } else if (/oxxfile\.info\/s\/[A-Za-z0-9]+/i.test(href)) {
      btns.push({ label: curLabel, url: href, oxx: true });
    }
  }
  return btns;
}
function cvEpisodeMatches(label, title, season, episode) {
  var s = "S" + season + "E" + episode;
  var reSE = new RegExp("S" + season + "\\s*E" + episode + "\\b", "i");
  if (reSE.test(label) || reSE.test(title)) return true;
  var reSeasonEp = new RegExp("season\\s*" + season + "[^0-9]{0,20}episode\\s*" + episode + "\\b", "i");
  if (reSeasonEp.test(label)) return true;
  if (season === 1) {
    var reEp = new RegExp("\\bepisode\\s*" + episode + "\\b", "i");
    if (reEp.test(label)) return true;
  }
  return false;
}

/* ---------- hubCloud ---------- */
/* Traced + live-verified 2026-11-04: the drive page's `var url`
 * IS the gamerxyt generation URL, and that page itself carries the
 * final file links (no separate #download hop — the DEX's "#download
 * href" note described an older layout). Kept anchors: R2 signed
 * file URLs, pixeldrain (liveness-checked, dead ids dropped), and
 * gpdl hubcloud links. hbplay player pages are skipped (their R2
 * file is already emitted directly). */
function cvHubCloud(url, label, referer) {
  var idm = String(url).match(/\/drive\/([A-Za-z0-9_-]+)/);
  if (!idm) return Promise.resolve([]);
  var origin = cvOrigin(url);
  var driveUrl = origin + "/drive/" + idm[1];
  return cvGetText(driveUrl, referer).then(function (page) {
    var gm = page.match(/var\s+url\s*=\s*'([^']+)'/);
    if (!gm) return [];
    var genUrl = gm[1];
    return cvGetText(genUrl, driveUrl).then(function (gen) {
      var out = [], seen = {}, am, href;
      var are = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
      var links = [];
      while ((am = are.exec(gen)) !== null) {
        href = am[1];
        if (!/^https?:\/\//i.test(href) || seen[href]) continue;
        seen[href] = true;
        if (/pixeldrain|cloudflarestorage|gpdl[^\/]*\.hubcloud/i.test(href)) links.push(href);
      }
      var checks = links.map(function (href) {
        if (/pixeldrain/i.test(href)) {
          var pid = href.match(/\/u\/([A-Za-z0-9]+)/);
          if (!pid) return Promise.resolve(null);
          /* Dead pixeldrain ids dropped (MoviesDrive lesson). A 404
           * or success:false is a definitive dead file -> drop. Any
           * other outcome (network error, status-0) fails open. */
          return cvFetch("https://pixeldrain.com/api/file/" + pid[1] + "/info", { "User-Agent": CV_UA }).then(function (resp) {
            if (!resp) return href;
            if (resp.status === 404) return null;
            if (resp.status !== 200) return href;
            return resp.json().then(function (info) {
              if (info && info.success === false) return null;
              return href;
            }).catch(function () { return href; });
          }).catch(function () { return href; });
        }
        return Promise.resolve(href);
      });
      return Promise.all(checks).then(function (kept) {
        for (var i = 0; i < kept.length; i++) {
          if (kept[i]) out.push({ url: kept[i], label: label, referer: genUrl });
        }
        return out;
      });
    });
  }).catch(function () { return []; });
}

/* ---------- gdFlix ---------- */
function cvGdFlix(url, label, referer) {
  return cvGetText(url, referer).then(function (page) {
    var jobs = [], am, href, text;
    var are = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
    while ((am = are.exec(page)) !== null) {
      href = am[1]; text = cvStripTags(am[2]);
      if (/instant/i.test(text)) {
        jobs.push(cvGetText(href, url).then(function () { return href; }).catch(function () { return href; }));
      } else if (/cloud download/i.test(text)) {
        var um = href.match(/[?&]url=([^&]+)/);
        if (um) {
          try { jobs.push(Promise.resolve(decodeURIComponent(um[1]))); } catch (e) {}
        }
      }
    }
    /* NOTE: Instant DL hrefs redirect to the file; the fetch service
     * follows redirects server-side, so the href itself is returned
     * when the hop cannot surface resp.url in this guest. The TV
     * player follows the same redirect at play time. */
    return Promise.all(jobs).then(function (urls) {
      var out = [], seen = {}, i, u;
      for (i = 0; i < urls.length; i++) {
        u = urls[i];
        if (!u || !/^https?:\/\//i.test(u) || seen[u]) continue;
        seen[u] = true;
        out.push({ url: u, label: label, referer: url });
      }
      return out;
    });
  }).catch(function () { return []; });
}

/* ---------- Filepress ---------- */
function cvFilepress(url, label, referer) {
  var pageUrl = url;
  return cvGetText(pageUrl, referer).then(function () {
    /* fetch follows redirects server-side; re-derive origin/id from
     * the button URL (filepress moved new1 -> new3; the API calls
     * below follow the same redirects). */
    var origin = cvOrigin(pageUrl);
    var idm = String(pageUrl).match(/\/file\/([A-Za-z0-9]+)/);
    if (!idm) return [];
    var id = idm[1];
    return cvGetJson(origin + "/api/file/get/" + id, pageUrl).then(function (info) {
      var data = (info && info.data) || {};
      var q = cvQualityOf(data.name || label);
      if (q === "Unknown") q = cvQualityOf(label);
      var tryKind = function (kind) {
        return cvPostJson(origin + "/api/file/downlaod", pageUrl, { method: kind, id: id }, CV_FP_UA).then(function (r1) {
          if (!r1 || r1.status === false) return null;
          var dlId = (r1.data && (r1.data.downloadId || r1.data.id)) || r1.downloadId;
          if (!dlId) return null;
          var tryBody = function (body) {
            return cvPostJson(origin + "/api/file/downlaod2/", pageUrl, body, CV_FP_UA).then(function (r2) {
              var arr = (r2 && (r2.data || r2.urls || r2.links)) || [];
              if (typeof arr === "string") arr = [arr];
              var out = [], i;
              for (i = 0; i < arr.length; i++) {
                var u = typeof arr[i] === "string" ? arr[i] : (arr[i].url || arr[i].link);
                if (u && /^https?:\/\//i.test(u)) out.push({ url: u.replace(/ /g, "%20"), label: label, quality: q, referer: pageUrl });
              }
              return out;
            }).catch(function () { return null; });
          };
          return tryBody({ downloadId: dlId }).then(function (o) {
            if (o && o.length) return o;
            return tryBody({ id: id, downloadId: dlId });
          });
        }).catch(function () { return null; });
      };
      return tryKind("cloudR2Downlaod").then(function (o) {
        if (o && o.length) return o;
        return tryKind("indexDownlaod");
      }).then(function (o) { return o || []; });
    });
  }).catch(function () { return []; });
}

/* ---------- OxxFile ---------- */
function cvOxxFile(url, label, referer) {
  var cm = String(url).match(/\/s\/([A-Za-z0-9]+)/);
  if (!cm) return Promise.resolve([]);
  var code = cm[1], origin = cvOrigin(url);
  return cvGetJson(origin + "/api/s/" + code + "/", referer).then(function (info) {
    if (!info) return [];
    var jobs = [];
    if (info.hasCloudDownload) {
      jobs.push(cvPostJson(origin + "/api/s/" + code + "/download/", referer, { driveType: "Drive 1" }).then(function (r) {
        if (r && r.downloadLink) return [{ url: r.downloadLink, label: label, referer: url }];
        return [];
      }).catch(function () { return []; }));
    }
    if (info.hasHubcloud) {
      jobs.push(cvPostJson(origin + "/api/s/" + code + "/hubcloud/", referer, { driveId: "dummy" }).then(function (r) {
        if (r && r.hubcloudLink) return cvHubCloud(r.hubcloudLink, label, url);
        return [];
      }).catch(function () { return []; }));
    }
    if (info.hasFilepress) {
      jobs.push(cvPostJson(origin + "/api/s/" + code + "/filepress/", referer, { driveId: "dummy" }).then(function (r) {
        if (r && r.filepressLink) return cvFilepress(r.filepressLink, label, url);
        return [];
      }).catch(function () { return []; }));
    }
    /* viking links observed dead (404) + no resolver; pixeldrain is
     * async + flagged unavailable on sampled files; streamhg/vidhide
     * have no API route on this deployment — all skipped by design. */
    if (!jobs.length) return [];
    return Promise.all(jobs).then(function (parts) {
      var out = [], i, j;
      for (i = 0; i < parts.length; i++) for (j = 0; j < parts[i].length; j++) out.push(parts[i][j]);
      return out;
    });
  }).catch(function () { return []; });
}

/* ---------- Vidara (Watch Online) ---------- */
/* POST vidaraa.cc/api/stream {filecode (from /e/<code>), device,
 * codecs} -> {streaming_url: HLS master}. Live-verified 2026-11-04
 * (Brand New Day code -> s1q2105 HLS + English VTT). Subtitles are
 * NOT passed through (1.2.110 passthrough stays reverted). */
function cvVidara(url, label, referer) {
  var cm = String(url).match(/\/e\/([A-Za-z0-9]+)/);
  if (!cm) return Promise.resolve([]);
  return cvPostJson("https://vidaraa.cc/api/stream", url, { filecode: cm[1], device: "web", codecs: ["h265"] }).then(function (r) {
    if (r && r.streaming_url && /^https?:\/\//i.test(r.streaming_url)) {
      return [{ url: r.streaming_url, label: label, referer: url, type: "hls" }];
    }
    return [];
  }).catch(function () { return []; });
}

/* ---------- formatter (1.2.109, verbatim) ---------- */
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

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (!tmdbId) return [];
    var isSeries = mediaType === "tv";
    season = Number(season) || 0;
    episode = Number(episode) || 0;
    if (isSeries && (!season || !episode)) return [];

    var meta = await cvTmdb(tmdbId, mediaType);
    var tmdbTitles = [meta.title];
    var hits = await cvSearch(meta.title);
    var chosen = null, i;
    for (i = 0; i < hits.length; i++) {
      if (!cvTitleMatches(hits[i].title, tmdbTitles)) continue;
      var hy = cvYearOf(hits[i].title);
      if (hy && meta.year && hy !== meta.year) continue;
      chosen = hits[i];
      break;
    }
    if (!chosen) return [];
    var detailUrl = chosen.permalink.charAt(0) === "/" ? CV_SITE + chosen.permalink : chosen.permalink;
    var btns;
    try {
      var html = await cvGetText(detailUrl, CV_SITE + "/");
      btns = cvDetailButtons(html);
    } catch (e) {
      /* Phone gets http 403 (Cloudflare) on post HTML while root +
       * search pass: same post via the site's public wp-json API. */
      var slug = detailUrl.replace(/\/+$/, "").split("/").pop();
      var posts = await cvGetJson(CV_SITE + "/wp-json/wp/v2/posts?slug=" + encodeURIComponent(slug), CV_SITE + "/");
      var content = posts && posts[0] && posts[0].content && posts[0].content.rendered ? posts[0].content.rendered : "";
      btns = cvDetailButtons(content);
    }
    if (isSeries) {
      var epBtns = [];
      for (i = 0; i < btns.length; i++) {
        if (cvEpisodeMatches(btns[i].label, chosen.title, season, episode)) epBtns.push(btns[i]);
      }
      /* Episode-specific post (title itself marks S<n>E<m>) -> all btns.
       * Otherwise only episode-marked btns; none marked -> [] (never
       * serve a wrong episode). */
      var titleMarksEp = new RegExp("S" + season + "\\s*E" + episode + "\\b", "i").test(chosen.title);
      if (titleMarksEp) epBtns = btns;
      if (!epBtns.length) return [];
      btns = epBtns;
    }
    var seen = {}, uniq = [];
    for (i = 0; i < btns.length; i++) {
      if (!seen[btns[i].url]) { seen[btns[i].url] = true; uniq.push(btns[i]); }
    }
    var raw = [];
    /* Buttons run in parallel (the DEX's fan-out): serial chains
     * measured 57s in tvsim, too close to the TV's 60s budget. */
    var jobs = uniq.map(function (b) {
      return (async function () {
        try {
          if (b.vidaraa) return await cvVidara(b.url, b.label, detailUrl);
          if (b.oxx) return await cvOxxFile(b.url, b.label, detailUrl);
          if (/hubcloud/i.test(b.url)) return await cvHubCloud(b.url, b.label, detailUrl);
          if (/gdflix|gdlink/i.test(b.url)) return await cvGdFlix(b.url, b.label, detailUrl);
          if (/filepress|filebee/i.test(b.url)) return await cvFilepress(b.url, b.label, detailUrl);
        } catch (e) {}
        return [];
      })();
    });
    var parts = await Promise.all(jobs);
    for (i = 0; i < parts.length; i++) {
      for (var j = 0; j < parts[i].length; j++) raw.push(parts[i][j]);
    }
    var streams = [], seenUrl = {};
    for (i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (!r.url || seenUrl[r.url]) continue;
      seenUrl[r.url] = true;
      var q = r.quality || cvQualityOf(r.label);
      var lbl = formatStreamLabel({ source: "CineVood", title: meta.title, quality: q, season: isSeries ? season : undefined, episode: isSeries ? episode : undefined, url: r.url });
      streams.push({ name: lbl, title: lbl, url: r.url, quality: q, type: r.type || "direct", headers: { "Referer": r.referer || detailUrl, "User-Agent": CV_UA } });
    }
    return streams;
  } catch (e) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
try {
  if (typeof global !== "undefined") global.getStreams = getStreams;
} catch (e) {}

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
