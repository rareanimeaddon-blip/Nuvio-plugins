/* Toonix (toonix.bond) Nuvio provider — ported as toonix1 v1.0.0
 *
 * Source: replitfree6-lang/Nuvio-streams providers/toonix.js v1.0.1
 * (same author as the Dulo port, judged on its own contents).
 * Inspected clean: NO ad-gate/shortlink code, NO user tokens, NO token
 * chain. The `t` value is the site's own stream token embedded in its
 * watch page (like a signed URL param), reused verbatim — it is NOT an
 * ad-shortlink completion and no ad view is automated.
 *
 * Site mechanics (from the source's DevTools-verified notes):
 *   - Watch page: https://toonix.bond/show/<slug>/<season>/<episode>
 *   - Stream API: GET /api/hydrax/<episodeId>?t=<ms>.<token>
 *     -> { qualities: [{label: "480p"|"360p", src: "<signed mp4 url>"}] }
 *   - The t token is SERVER-VALIDATED (forged tokens -> {"error":"expired"});
 *     it cannot be minted by the plugin, so the verbatim value embedded in
 *     the server-rendered watch page is reused. Signed media URLs expire
 *     (~6h), so everything is fetched fresh per resolve, never hardcoded.
 *   - Legacy server: direct archive.org MP4s baked into the watch page.
 *
 * Port changes vs source (plugin conventions, chain untouched):
 *   - v5 fetch-retry prelude spliced (TV status-0 retries, spin pauses).
 *   - Chain-retry postlude v2 appended.
 *   - Emoji stream-label formatter (1.2.109) applied to name AND title.
 *   - Embedded TMDB key replaced with the guest TMDB_API_KEY global.
 *   - ALL timer code removed (source used guarded setTimeout for aborts
 *     and a dead toonixSleep helper): the TV QuickJS guest has no timers
 *     at all, and the v5 prelude covers retry resilience instead.
 *   - Page-title gate added (see below): the source trusted any page a
 *     TMDB-derived slug fetched. The gate checks the watch page's own
 *     title against the TMDB titles and rejects on mismatch.
 *
 * SANDBOX NOTE: toonix.bond answers every sandbox request with 403
 * ("Your request was blocked"), even with the site's own headers, so
 * the live chain CANNOT be validated from here — same class as
 * vegamovies' device-judged vcloud hop. tvsim/harness runs from
 * sandbox are expected to return 0 cleanly (no guest errors). The
 * device test is the decider: refresh and try Toonix on Shinchan S1E1
 * (expect streams) and Breaking Bad S1E1 (expect 0).
 *
 * Page-title gate (zero-mismatch): the watch page's <title>/og:title/h1
 * is normalized and compared against the TMDB canonical + alternative
 * titles. Exact normalized equality passes; otherwise the noise-dropped
 * word sets must score dice >= 0.8. A page title that matches NOTHING
 * is rejected (returns [] for that candidate). If a page carries NO
 * parseable title at all, the gate falls back to the slug derivation +
 * server-validated episode token as evidence — this fallback is the one
 * residual mismatch risk (a slug collision), and it is why the device
 * negative control matters.
 *
 * TV only (mediaType "tv"). No optional chaining, no matchAll.
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

var TOONIX_SITE = "https://toonix.bond";
var TOONIX_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
var TOONIX_TMDB_KEY = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";

/* Timer-free fetch: the v5 prelude above owns retries. No AbortController
 * timeout is possible without timers; the app's 60s provider budget bounds
 * any hung hop, and the chain-retry postlude gates re-runs on elapsed. */
function toonixFetch(url, headers) {
  var opts = { headers: headers || {} };
  return fetch(url, opts);
}

function toonixGetText(url, referer) {
  var headers = {
    "User-Agent": TOONIX_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  };
  if (referer) headers["Referer"] = referer;
  return toonixFetch(url, headers).then(function (resp) {
    if (!resp || resp.status !== 200) throw new Error("http " + (resp && resp.status));
    return resp.text();
  });
}

function toonixGetJson(url, referer) {
  var headers = {
    "User-Agent": TOONIX_UA,
    Accept: "application/json,*/*",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  };
  if (referer) headers["Referer"] = referer;
  return toonixFetch(url, headers).then(function (resp) {
    if (!resp || resp.status !== 200) throw new Error("http " + (resp && resp.status));
    return resp.json();
  });
}

function toonixSlugify(name) {
  var s = String(name || "").toLowerCase();
  s = s.replace(/[''`]/g, "");
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/^-+/, "").replace(/-+$/, "");
  return s;
}

/* Extract the internal episodeId from the watch-page HTML. The page calls
 * /api/hydrax/<id> on load, so the id is in the server-rendered markup. */
function toonixExtractEpisodeId(html) {
  if (!html) return null;
  var patterns = [/\/api\/hydrax\/(\d{4,10})/, /hydrax\/(\d{4,10})/, /["']episode[Ii]d["']\s*[:=]\s*["']?(\d{4,10})/];
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m && m[1]) return m[1];
  }
  return null;
}

/* Extract the full server-issued t value (<ms>.<token>) from the watch-page
 * HTML. The token is validated server-side and cannot be forged, so the
 * plugin must reuse the verbatim value embedded in the page. */
function toonixExtractT(html) {
  if (!html) return null;
  var patterns = [
    /[?&]t=(\d{10,20}\.[A-Za-z0-9\-_]{40,50})/,
    /["']t["']\s*:\s*["'](\d{10,20}\.[A-Za-z0-9\-_]{40,50})["']/,
    /(\d{13}\.[A-Za-z0-9\-_]{43})/,
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m && m[1]) return m[1];
  }
  /* ms + token as separate adjacent fields, e.g. "ms":1793...,"token":"yr3B..." */
  var mp = html.match(/["']ms["']\s*:\s*(\d{13})\s*,\s*["']token["']\s*:\s*["']([A-Za-z0-9\-_]{43})["']/);
  if (mp && mp[1] && mp[2]) return mp[1] + "." + mp[2];
  return null;
}

/* Extract Legacy-server direct media URLs from the watch-page HTML.
 * Legacy serves plain public archive.org MP4s. Prefer the stable
 * https://archive.org/download/<item>/<path> form; fall back to
 * datanode (dn*.archive.org) URLs only if no /download/ URL is present. */
function toonixExtractLegacyUrls(html) {
  if (!html) return [];
  var found = [];
  var seen = {};
  function collect(re) {
    var m;
    while ((m = re.exec(html)) !== null) {
      var u = String(m[0]).replace(/[.,;!?)\]]+$/, "");
      if (u && !seen[u]) {
        seen[u] = true;
        found.push(u);
      }
    }
  }
  collect(/https:\/\/archive\.org\/download\/[^\s"'<>\\]+/g);
  if (found.length === 0) {
    collect(/https:\/\/[a-z0-9.-]+\.archive\.org\/[^\s"'<>\\]+/g);
  }
  return found;
}

/* ---------- page-title gate ---------- */
var TOONIX_TITLE_NOISE = { the: 1, a: 1, an: 1, watch: 1, online: 1, toonix: 1,
  episode: 1, episodes: 1, season: 1, seasons: 1, ep: 1, sub: 1, dubbed: 1, dub: 1,
  hindi: 1, english: 1, tamil: 1, telugu: 1, free: 1, hd: 1 };
function toonixFoldAccents(s) {
  var map = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
    "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
    "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
    "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function (ch) { return map[ch] || ch; });
}
function toonixNormTitle(v) {
  return toonixFoldAccents(String(v || "").toLowerCase()).replace(/[^a-z0-9]/g, "");
}
function toonixWords(v) {
  return toonixFoldAccents(String(v || "").toLowerCase()).split(/[^a-z0-9]+/).filter(function (w) {
    return w && !TOONIX_TITLE_NOISE[w] && !/^\d+$/.test(w);
  });
}
function toonixDice(a, b) {
  var sa = {}, sb = {}, i, inter = 0;
  for (i = 0; i < a.length; i++) sa[a[i]] = 1;
  for (i = 0; i < b.length; i++) { sb[b[i]] = 1; if (sa[b[i]]) inter++; }
  var total = a.length + b.length;
  if (total === 0) return 0;
  return (2 * inter) / total;
}
/* Candidate page titles from watch-page HTML: <title>, og:title,
 * twitter:title, <h1>. HTML entities in titles are decoded for the
 * common cases (&amp; &quot; &#39;). Returns [] when none found. */
function toonixExtractPageTitles(html) {
  if (!html) return [];
  var out = [], seen = {};
  function push(t) {
    if (!t) return;
    t = String(t).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]*>/g, "").trim();
    if (t && !seen[t]) { seen[t] = true; out.push(t); }
  }
  var m;
  m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (m) push(m[1]);
  m = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  if (m) push(m[1]);
  m = html.match(/<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']*)["']/i);
  if (m) push(m[1]);
  var h1 = html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i);
  if (h1) push(h1[1]);
  return out;
}
/* Returns true (pass), false (hard mismatch), or null (no title found
 * to judge by — caller falls back to slug + server token evidence). */
function toonixPageGate(pageTitles, tmdbTitles) {
  if (!pageTitles || pageTitles.length === 0) return null;
  var tmdbNorms = [], tmdbWordSets = [], i, j;
  for (i = 0; i < tmdbTitles.length; i++) {
    if (!tmdbTitles[i]) continue;
    tmdbNorms.push(toonixNormTitle(tmdbTitles[i]));
    tmdbWordSets.push(toonixWords(tmdbTitles[i]));
  }
  for (i = 0; i < pageTitles.length; i++) {
    var pn = toonixNormTitle(pageTitles[i]);
    for (j = 0; j < tmdbNorms.length; j++) {
      if (pn && tmdbNorms[j] && pn === tmdbNorms[j]) return true;
    }
    var pw = toonixWords(pageTitles[i]);
    for (j = 0; j < tmdbWordSets.length; j++) {
      if (pw.length && tmdbWordSets[j].length && toonixDice(pw, tmdbWordSets[j]) >= 0.8) return true;
    }
  }
  return false;
}

function toonixTmdbTitle(tmdbId) {
  var base =
    "https://api.themoviedb.org/3/tv/" +
    encodeURIComponent(String(tmdbId)) +
    "?api_key=" +
    TOONIX_TMDB_KEY +
    "&language=en-US";
  /* The site's slugs don't always match TMDB's primary title
   * (e.g. TMDB "Crayon Shin-chan" vs site slug "shin-chan"), so also pull
   * alternative titles and try every slug variant — each candidate page
   * still passes through the page-title gate above. */
  var altUrl =
    "https://api.themoviedb.org/3/tv/" +
    encodeURIComponent(String(tmdbId)) +
    "/alternative_titles?api_key=" +
    TOONIX_TMDB_KEY;
  return toonixGetJson(base, null).then(function (data) {
    if (!data) throw new Error("tmdb empty");
    var titles = [];
    if (data.name) titles.push(data.name);
    if (data.original_name) titles.push(data.original_name);
    return toonixGetJson(altUrl, null).then(
      function (alt) {
        if (alt && alt.results) {
          for (var i = 0; i < alt.results.length; i++) {
            if (alt.results[i] && alt.results[i].title) titles.push(alt.results[i].title);
          }
        }
        return { titles: titles, name: data.name || data.original_name || "" };
      },
      function () {
        return { titles: titles, name: data.name || data.original_name || "" };
      }
    );
  });
}

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
    if (mediaType !== "tv") return [];
    season = Number(season);
    episode = Number(episode);
    if (!tmdbId || !season || !episode) return [];

    var info = await toonixTmdbTitle(tmdbId);
    var candidates = [];
    var seen = {};
    var titles = info.titles || [];
    for (var ti = 0; ti < titles.length; ti++) {
      var sl = toonixSlugify(titles[ti]);
      if (sl && !seen[sl]) {
        seen[sl] = true;
        candidates.push(sl);
      }
    }
    if (candidates.length === 0) return [];

    var episodeId = null;
    var tVal = null;
    var watchUrl = null;
    var gatePageHtml = null;
    for (var i = 0; i < candidates.length && (!episodeId || !tVal); i++) {
      watchUrl = TOONIX_SITE + "/show/" + candidates[i] + "/" + season + "/" + episode;
      var html = null;
      try {
        html = await toonixGetText(watchUrl, TOONIX_SITE + "/");
      } catch (e) {
        html = null;
      }
      if (!html) continue;
      /* Page-title gate: a page whose own title matches no TMDB title
       * is a wrong show behind this slug — skip it entirely. */
      var gate = toonixPageGate(toonixExtractPageTitles(html), titles);
      if (gate === false) continue;
      if (!gatePageHtml) gatePageHtml = html;
      if (!episodeId) episodeId = toonixExtractEpisodeId(html);
      if (!tVal) tVal = toonixExtractT(html);
    }
    if (!watchUrl || !gatePageHtml) return [];

    var streams = [];
    var showLabel = info.name || ("TMDB " + tmdbId);

    /* SORA server via the hydrax API. Independent try/catch: if this path
     * fails, the Legacy extraction below still gets its chance. */
    if (episodeId && tVal) {
      try {
        var apiUrl = TOONIX_SITE + "/api/hydrax/" + episodeId + "?t=" + encodeURIComponent(tVal);
        var data = await toonixGetJson(apiUrl, watchUrl);
        if (data && !data.error && data.qualities && data.qualities.length) {
          for (var q = 0; q < data.qualities.length; q++) {
            var item = data.qualities[q];
            if (!item || !item.src) continue;
            var label = item.label || "Auto";
            var lbl = formatStreamLabel({ source: "Toonix", title: showLabel, quality: label, season: season, episode: episode, url: item.src });
            streams.push({
              name: lbl,
              title: lbl,
              url: item.src,
              quality: label,
              type: "mp4",
              headers: {
                Referer: TOONIX_SITE + "/",
                "User-Agent": TOONIX_UA,
              },
            });
          }
        }
      } catch (e) {}
    }

    /* Legacy server: direct archive.org MP4s from the gate-passing page. */
    var legacyUrls = toonixExtractLegacyUrls(gatePageHtml);
    for (var l = 0; l < legacyUrls.length; l++) {
      var lbl = formatStreamLabel({ source: "Toonix Legacy", title: showLabel, quality: "Auto", season: season, episode: episode, url: legacyUrls[l] });
      streams.push({
        name: lbl,
        title: lbl,
        url: legacyUrls[l],
        quality: "Auto",
        type: "mp4",
        headers: {
          Referer: TOONIX_SITE + "/",
          "User-Agent": TOONIX_UA,
        },
      });
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
