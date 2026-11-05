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

// Nepu scraper for Nuvio (movies, shows, anime, cartoons).
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Ported from the CloudStream Nepu provider in
// github.com/KSHITIJ8473/raghav (NepuProvider.kt, by csksy).
// Source site: https://nepu.io
//
// Chain (all plain HTTP, no timers, no JS execution):
//   TMDB title (+ year for movies)
//     -> GET /ajax/posts?q=<title-with-spaces-as-dashes> (XHR headers)
//        JSON {data: [{name, image, url}]} -> exact-gate the name,
//        keep only /movie/ (movies) or /show/ (TV) URLs
//     -> GET detail page -> title + "Release Date" year (movies),
//        or the episode list (.episodes > div.tab-pane; season from
//        the pane id digits, episode number from .episode) for TV
//     -> GET the episode page (TV) or the detail page itself (movie)
//     -> a[data-embed] sources (id + label from .name/.source-selected)
//     -> POST /ajax/embed (form id=<data-embed>, X-Requested-With,
//        Referer = the page URL) -> relayManifestUrl = "..." in the
//        response text (\u0026 unescaped) -> M3U8 stream.
//        Quality comes from the source label (4K/Full HD/HD/SD/CAM).
//
// Anti-bot caveat (verified 2026-11-05): nepu.io answers the sandbox
// with a Cloudflare Managed Challenge (403 "Just a moment...") on
// every endpoint, even with the source's own UA. The CloudStream
// source gets past the site's guards with (a) a native Anubis PoW
// solver (SHA-256 grinding, for the Anubis layer) and (b) an
// interactive WebView that lets the user pass the browser check.
// Neither can run in the Nuvio QuickJS guest (no WebCrypto, no
// WebView, no user interaction during a provider call), so the PoW
// solver and the WebView path are NOT ported. The provider sends no
// session cookies (the guest has no persistent cookie store) and
// fails open ([]) if the site answers with a challenge page. Whether
// it works on a real device depends on whether Cloudflare challenges
// the device's own network: the sandbox's datacenter egress is
// challenged, a residential/mobile IP may pass. Device test decides.
// Subtitles are NOT ported: the source fetches them via
// POST /ajax/subtitlecached, but subtitle passthrough was fully
// reverted in the plugin at 1.2.110 and is not re-proposed here.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var BASE_URL = "https://nepu.io";
// The source's own UA (Chrome 155, Pixel 9): a current browser UA.
var UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";

// ---------- helpers ----------

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
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

function fetchJson(url, referer, timeoutMs) {
  return fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer || BASE_URL + "/",
    },
  }, timeoutMs || 12000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function postForm(url, fields, extraHeaders, timeoutMs) {
  // Form body built by hand: no URLSearchParams in provider code.
  var body = fields.map(function (kv) {
    return encodeURIComponent(kv[0]) + "=" + encodeURIComponent(kv[1]);
  }).join("&");
  var headers = {
    "User-Agent": UA,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "*/*",
  };
  if (extraHeaders) {
    for (var k in extraHeaders) headers[k] = extraHeaders[k];
  }
  return fetchWithTimeout(url, {
    method: "POST",
    headers: headers,
    body: body,
  }, timeoutMs || 12000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function foldAccents(s) {
  var map = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
    "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
    "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
    "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function (ch) { return map[ch] || ch; });
}

// Exact-title gate (zero-mismatch): every distinctive word of the TMDB title
// must appear as a whole word in the candidate, and the word sets must be
// near-identical (dice >= 0.8) once release/season noise words are dropped.
// Kills false hits like "Breaking Bad" -> "The Bad Guys: Breaking In".
var TITLE_NOISE = { the: 1, a: 1, an: 1, with: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, subtitle: 1, subtitles: 1, subs: 1, multi: 1, audio: 1, complete: 1,
  hevc: 1, x264: 1, x265: 1, h264: 1, webdl: 1, hdtv: 1, bluray: 1, brrip: 1, hdrip: 1,
  "480p": 1, "720p": 1, "1080p": 1, "1440p": 1, "2160p": 1, "4k": 1, uhd: 1, hd: 1,
  watch: 1, download: 1, online: 1, sony: 1, yay: 1, uncensored: 1, uncut: 1, hungama: 1, tamil: 1, telugu: 1 };
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

// Nepu lists anime with a [SUB]/[DUB] prefix ("[SUB] Attack on Titan").
// Strip it before gating so the TMDB title can match exactly.
function cleanSiteTitle(t) {
  return String(t || "").replace(/^\s*\[(sub|dub)\]\s*/i, "").trim();
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

// TMDB alternative titles (e.g. "Shin Chan" for "Crayon Shin-chan"):
// the site often lists a show under an alias, so when the canonical
// name fails the exact gate, each Latin-script alias gets the same try.
function tmdbAltTitles(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/alternative_titles?api_key=" + TMDB_API_KEY, {}, 12000
  ).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return [];
      var arr = j.results || j.titles || [];
      var out = [], seen = {};
      arr.forEach(function (it) {
        var t = (it && typeof it.title === "string") ? it.title.trim() : "";
        if (!t) return;
        if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0e00-\u0e7f\u0590-\u05ff\u0600-\u06ff\u0370-\u03ff\u0530-\u058f]/.test(t)) return;
        var k = t.toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        out.push(t);
      });
      out.sort(function (a, b) { return a.length - b.length; });
      return out.slice(0, 4);
    })
    .catch(function () { return []; });
}

// ---------- TMDB ----------

function tmdbMovie(tmdbId) {
  return fetchJson("https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + TMDB_API_KEY, null, 12000)
    .then(function (j) {
      if (!j) return null;
      var y = j.release_date ? parseInt(String(j.release_date).slice(0, 4), 10) : null;
      return { title: j.title || null, year: y || null };
    })
    .catch(function () { return null; });
}

function tmdbShow(tmdbId) {
  return fetchJson("https://api.themoviedb.org/3/tv/" + tmdbId + "?api_key=" + TMDB_API_KEY, null, 12000)
    .catch(function () { return null; });
}

// ---------- nepu.io chain ----------

// GET /ajax/posts?q=<title-with-spaces-as-dashes> (XHR headers).
// Returns [{name, url}] for /movie/ and /show/ results only.
function searchNepu(query) {
  var q = String(query || "").trim().replace(/\s+/g, "-");
  if (!q) return Promise.resolve([]);
  var url = BASE_URL + "/ajax/posts?q=" + encodeURIComponent(q);
  return fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
  }, 12000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function (j) {
    var arr = (j && j.data) || [];
    var out = [];
    arr.forEach(function (it) {
      var href = it && it.url ? String(it.url) : "";
      var name = it && it.name ? String(it.name).trim() : "";
      if (!href || !name) return;
      if (href.indexOf("/movie/") < 0 && href.indexOf("/show/") < 0) return;
      var abs = /^https?:\/\//i.test(href) ? href : BASE_URL + (href.charAt(0) === "/" ? href : "/" + href);
      out.push({ name: name, url: abs });
    });
    return out;
  }).catch(function () { return []; });
}

// Detail-page attr blocks: .video-attr holds an .attr label and a .text
// value ("Release Date" -> "1999", "IMDB" -> "8.7", ...). Collect them.
function detailAttrs(html) {
  var out = {};
  var re = /class="attr"[^>]*>([^<]*)<\/[^>]+>[\s\S]{0,300}?class="text"[^>]*>([^<]*)</gi, m;
  while ((m = re.exec(html)) !== null) {
    var k = String(m[1] || "").trim().toLowerCase();
    var v = String(m[2] || "").trim();
    if (k && v && !out[k]) out[k] = v;
  }
  return out;
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Detail page: title (.detail-text h1, fallback first h1), year from the
// "Release Date" attr, and for shows the episode list. The episode
// panes (.episodes > div.tab-pane) carry the season in the pane id
// digits; each pane's links carry the episode number in .episode and
// the episode name in .name. Pane slices are cut at the next pane
// opening so nested divs cannot truncate the match.
function parseDetail(html, url) {
  var title = null;
  var m = /class="detail-text"[^>]*>[\s\S]{0,800}?<h1[^>]*>([^<]+)<\/h1>/i.exec(html);
  if (m) title = m[1].trim();
  if (!title) {
    m = /<h1[^>]*>([^<]+)<\/h1>/i.exec(html);
    if (m) title = m[1].trim();
  }
  var attrs = detailAttrs(html);
  var year = null;
  if (attrs["release date"]) {
    var y = parseInt(String(attrs["release date"]).slice(0, 4), 10);
    if (y) year = y;
  }
  var episodes = [];
  var paneRe = /<div[^>]*class="[^"]*tab-pane[^"]*"[^>]*\bid="([^"]*)"[^>]*>/gi, pm;
  var panes = [];
  while ((pm = paneRe.exec(html)) !== null) panes.push({ id: pm[1], index: pm.index + pm[0].length });
  for (var i = 0; i < panes.length; i++) {
    var start = panes[i].index;
    var end = (i + 1 < panes.length) ? panes[i + 1].index : html.length;
    var slice = html.slice(start, end);
    var digits = String(panes[i].id || "").replace(/\D/g, "");
    var season = digits ? parseInt(digits, 10) : 1;
    var aRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, am;
    while ((am = aRe.exec(slice)) !== null) {
      var inner = am[2];
      if (inner.indexOf("episode") < 0) continue;
      var epM = /class="episode"[^>]*>([^<]*)</i.exec(inner);
      if (!epM) continue;
      var numM = /(\d+)\s*$/.exec(String(epM[1] || "").trim());
      if (!numM) continue;
      var nameM = /class="name"[^>]*>([^<]*)</i.exec(inner);
      var href = am[1];
      var abs = /^https?:\/\//i.test(href) ? href : BASE_URL + (href.charAt(0) === "/" ? href : "/" + href);
      episodes.push({
        season: season,
        episode: parseInt(numM[1], 10),
        name: nameM ? nameM[1].trim() : "",
        url: abs,
      });
    }
  }
  return { title: title || "Unknown", year: year, episodes: episodes, url: url };
}

// a[data-embed] sources on a watch page: id + label (.name, else
// .source-selected, else "Source"), deduped by id.
function parseEmbeds(html) {
  var out = [], seen = {};
  var re = /<a\b[^>]*\bdata-embed="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var id = String(m[1] || "").trim();
    if (!id || seen[id]) continue;
    seen[id] = 1;
    var inner = m[2] || "";
    var lm = /class="name"[^>]*>([^<]*)</i.exec(inner) || /class="source-selected"[^>]*>([^<]*)</i.exec(inner);
    var label = lm ? String(lm[1] || "").trim() : "Source";
    out.push({ id: id, label: label || "Source" });
  }
  return out;
}

// POST /ajax/embed (form id=<data-embed>, X-Requested-With, Referer =
// the watch page) -> response text carries relayManifestUrl = "...".
function resolveEmbed(id, referer) {
  return postForm(BASE_URL + "/ajax/embed", [["id", id]], {
    "X-Requested-With": "XMLHttpRequest",
    Referer: referer,
  }, 12000).then(function (text) {
    var m = /relayManifestUrl\s*=\s*"([^"]+)"/.exec(text || "");
    if (!m) return null;
    var u = String(m[1]).replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (!u) return null;
    return /^https?:\/\//i.test(u) ? u : BASE_URL + (u.charAt(0) === "/" ? u : "/" + u);
  }).catch(function () { return null; });
}

function qualityFromLabel(label) {
  // Resolution numbers first: the site's labels read "HD 1080p" /
  // "HD 720p", so the number is the truth (the source's word-only
  // mapping mislabels "HD 1080p" as 720p). Fall back to the words.
  var l = String(label || "");
  if (/2160p/i.test(l) || /4K/i.test(l) || /Ultra HD/i.test(l)) return "2160p";
  if (/1080p/i.test(l) || /Full HD/i.test(l)) return "1080p";
  if (/720p/i.test(l) || /\bHD\b/i.test(l)) return "720p";
  if (/480p/i.test(l) || /\bSD\b/i.test(l)) return "480p";
  if (/360p/i.test(l) || /CAM/i.test(l)) return "360p";
  return "Unknown";
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

// Resolve a watch page's embed sources into M3U8 streams.
function streamsFromWatchPage(pageUrl, title, season, episode) {
  return fetchHtml(pageUrl, BASE_URL + "/", 20000).then(function (html) {
    var embeds = parseEmbeds(html);
    if (!embeds.length) return [];
    return Promise.all(embeds.map(function (e) { return resolveEmbed(e.id, pageUrl); }))
      .then(function (urls) {
        var streams = [];
        urls.forEach(function (u, idx) {
          if (!u) return;
          var label = embeds[idx].label;
          var quality = qualityFromLabel(label);
          var lbl = formatStreamLabel({
            source: "Nepu", title: title, quality: quality,
            season: season, episode: episode, url: u, extra: label,
          });
          // Playback headers mirror the source: Origin + Referer +
          // UA. No session cookie exists in the guest; if the relay
          // host demands one, the row fails open on the player side.
          var ph = { "User-Agent": UA, Origin: BASE_URL, Referer: BASE_URL + "/" };
          streams.push({
            name: lbl,
            title: lbl,
            url: u,
            quality: quality,
            type: "hls",
            headers: ph,
            behaviorHints: { notWebReady: false, proxyHeaders: { request: ph } },
          });
        });
        return streams;
      });
  }).catch(function () { return []; });
}

// One title candidate: search -> pick the exact-gated result of the
// right kind -> detail page -> (movies: year gate, then the detail
// page's own embeds; TV: the S/E episode page's embeds).
function tryCandidate(candTitle, mediaType, season, episode, tmdbYear) {
  return searchNepu(candTitle).then(function (items) {
    var wantMovie = mediaType === "movie";
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var isMovie = it.url.indexOf("/movie/") >= 0;
      if (wantMovie !== isMovie) continue;
      if (!isExactTitle(candTitle, cleanSiteTitle(it.name))) continue;
      return it.url;
    }
    return null;
  }).then(function (detailUrl) {
    if (!detailUrl) return [];
    return fetchHtml(detailUrl, BASE_URL + "/", 20000).then(function (html) {
      var d = parseDetail(html, detailUrl);
      if (!isExactTitle(candTitle, cleanSiteTitle(d.title))) return [];
      if (mediaType === "movie") {
        if (tmdbYear && d.year && Math.abs(d.year - tmdbYear) > 1) return [];
        return streamsFromWatchPage(detailUrl, d.title, null, null);
      }
      var epUrl = null;
      for (var i = 0; i < d.episodes.length; i++) {
        if (d.episodes[i].season === season && d.episodes[i].episode === episode) { epUrl = d.episodes[i].url; break; }
      }
      if (!epUrl) return [];
      return streamsFromWatchPage(epUrl, d.title, season, episode);
    }).catch(function () { return []; });
  });
}

// ---------- main ----------

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isMovie = mediaType === "movie";
  var season = seasonNum || 1;
  var episode = episodeNum || 1;
  var metaP = isMovie ? tmdbMovie(tmdbId) : tmdbShow(tmdbId).then(function (s) {
    return s ? { title: s.name || null, year: null } : null;
  });
  return metaP.then(function (meta) {
    if (!meta || !meta.title) return [];
    var title = meta.title;
    return tmdbAltTitles(tmdbId, mediaType).then(function (alts) {
      var seen = {}, cands = [];
      [title].concat(alts || []).forEach(function (c) {
        var k = String(c || "").toLowerCase();
        if (c && !seen[k]) { seen[k] = 1; cands.push(c); }
      });
      var chain = Promise.resolve([]);
      cands.forEach(function (cand) {
        chain = chain.then(function (got) {
          if (got && got.length) return got;
          return tryCandidate(cand, mediaType, season, episode, meta.year);
        });
      });
      return chain;
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.NepuScraperModule = { getStreams: getStreams };
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
