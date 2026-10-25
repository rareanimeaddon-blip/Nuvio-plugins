// Cinegram (cinegram.tv) — streaming site, player backend is the
// vidsrc-style chain behind its play button (observed live 2026-10-25).
//
// Chain (all plain GETs, no JS execution needed):
//   1. TMDB details (guest key) -> title + year.
//   2. Cinegram search page /index.php?menu=search&query=<title> ->
//      result figures carry title, year and /movie/ or /tv/ links.
//      Exact gate (zero mismatch): normalized title must match and
//      year must fit (movies +/-1, series start year +/-1).
//   3. Player chain (TMDB-keyed, same as the site's own play button):
//      GET https://ythd.org/vs_src.php?type=movie&id=<tmdb>
//        (TV: ?type=tv&id=<tmdb>&season=<s>&episode=<e>)
//        Referer https://ythd.org/embed/<tmdb>
//        -> JSON {src: <stellar embed URL>}
//      GET stellar URL -> HTML holds /embed/player/...?vs=<token>
//      GET stellar inner player -> HTML holds window.CONFIG with
//        api (stream_urls URL) + apiToken (single-use, IP-bound,
//        minted at page render — so the chain is fetched fresh
//        on every call, exactly like the player's own refill rule).
//      GET api + &api_token=<token> -> {data: {stream_urls: [...]}}.
//   4. Per stream host: GET <origin>/generate.php -> token, stamped
//      onto the master URL (__TOKEN__ replace, else ?token= append),
//      mirroring the player's lazy just-in-time token fetch. Tokens
//      are IP-bound; on a device the whole chain runs from one IP,
//      so mint + use stay consistent.
//
// Known limits (device-judged, same class as vegamovies' vcloud hop):
//   - The stream_urls API rejects tokens minted for another IP, and
//     the sandbox egress IP rotates per request, so the final hop
//     403s from the sandbox by design — tvsim/harness can only
//     verify the chain through the CONFIG parse, not the streams.
//   - If data.stream_urls comes back as an encrypted string (WASM
//     ChaCha20 protection), the TV guest cannot decrypt it (no
//     WebAssembly) and the provider returns [] for that title.
//   - The player also runs a Turnstile check in browsers; whether
//     the API enforces it beyond the api_token is unknown —
//     again device-judged.
//
// TV rules: no timers, no TextEncoder/TextDecoder/WebCrypto, no
// Node APIs, no URL/URLSearchParams, no optional chaining, no
// matchAll. v5 fetch-retry prelude + chain-retry postlude v2.

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

var CG = "https://cinegram.tv";
var YTHD = "https://ythd.org";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

function isBlank(s) { return s == null || String(s).trim() === ""; }

function timeoutSignal(ms) {
  try {
    if (typeof AbortController === "undefined") return undefined;
    var ctl = new AbortController();
    if (typeof setTimeout === "function") {
      setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms);
    }
    return ctl.signal;
  } catch (e) { return undefined; }
}

async function httpText(url, referer, accept) {
  var res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      "Accept": accept || "text/html, */*",
      "Referer": referer || CG + "/home"
    },
    signal: timeoutSignal(25000)
  });
  var text = "";
  try { text = await res.text(); } catch (e) {}
  return { status: res.status, text: text };
}

async function httpJson(url, referer) {
  var r = await httpText(url, referer, "application/json, text/plain, */*");
  var json = null;
  try { json = JSON.parse(r.text); } catch (e) {}
  return { status: r.status, json: json, text: r.text };
}

async function tmdbDetails(tmdbId, type) {
  try {
    var kind = type === "movie" ? "movie" : "tv";
    var key = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";
    if (!key) return null;
    var r = await httpJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + key, "");
    if (r.json) return r.json;
  } catch (e) {}
  return null;
}

// Exact-title gate helpers (house pattern: normalized words, noise
// dropped, zero mismatch tolerance).
var TITLE_NOISE = { the: 1, a: 1, an: 1, with: 1, season: 1, seasons: 1,
  episode: 1, episodes: 1, ep: 1, english: 1, hindi: 1, dub: 1, dubbed: 1,
  sub: 1, subbed: 1, subtitle: 1, subtitles: 1, subs: 1, multi: 1,
  audio: 1, complete: 1, hevc: 1, x264: 1, x265: 1, h264: 1, webdl: 1,
  hdtv: 1, bluray: 1, brrip: 1, hdrip: 1, "480p": 1, "720p": 1,
  "1080p": 1, "1440p": 1, "2160p": 1, "4k": 1, uhd: 1, hd: 1,
  watch: 1, download: 1, online: 1, free: 1 };
var ACCENT_MAP = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
  "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
  "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
function foldAccents(s) {
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function (ch) { return ACCENT_MAP[ch] || ch; });
}
function normWords(s) {
  var out = [];
  var parts = foldAccents(String(s || "").toLowerCase()).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ");
  for (var i = 0; i < parts.length; i++) {
    var w = parts[i];
    if (!w || TITLE_NOISE[w] || /^\d+$/.test(w) || /^s\d{1,2}e\d{1,2}$/.test(w) || /^e\d{1,2}$/.test(w)) continue;
    out.push(w);
  }
  return out;
}
function titleMatches(candidate, wanted) {
  var a = normWords(candidate), b = normWords(wanted);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  var set = {};
  for (var i = 0; i < a.length; i++) set[a[i]] = 1;
  var hit = 0;
  for (var j = 0; j < b.length; j++) { if (set[b[j]]) hit++; }
  // Every distinctive word of the wanted title must be present, and
  // the word sets must be near-identical (dice >= 0.8).
  if (hit !== b.length) return false;
  return (2 * hit) / (a.length + b.length) >= 0.8;
}

function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " "); }

// Parse cinegram search figures: <a class="hthis" href="/movie/...|/tv/..."
// title="... online free"> ... figure text holds rating, year, type.
function parseSearch(html) {
  var out = [];
  var re = /<a class="hthis" href="([^"]+)" title="([^"]*)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1], rawTitle = m[2];
    var seg = html.slice(m.index, Math.min(html.length, m.index + 3000));
    var text = stripTags(seg).replace(/\s+/g, " ");
    var ym = text.match(/\b(19\d{2}|20\d{2})\b/);
    var title = rawTitle.replace(/\s+online free\s*$/i, "").trim();
    out.push({ href: href, title: title, year: ym ? parseInt(ym[1], 10) : null });
  }
  return out;
}

function originOf(url) {
  var m = /^https?:\/\/[^\/]+/.exec(String(url || ""));
  return m ? m[0] : "";
}

function qualityFromUrl(url, label) {
  var s = String(label || "") + " " + String(url || "");
  var m = s.match(/\b(2160|1440|1080|720|480|360)\s*p\b/i);
  if (m) return m[1] + "p";
  if (/\b4K\b/i.test(s)) return "2160p";
  return "Auto";
}

// Player.js parseToken: JSON token object -> token field, else raw text.
function parseToken(text) {
  if (text == null) return "";
  var t = String(text).trim();
  if (t && (t.charAt(0) === "{" || t.charAt(0) === "[")) {
    try {
      var j = JSON.parse(t);
      if (typeof j === "string") return j;
      if (j && typeof j === "object") return j.token || j.data || j.string || j.result || "";
    } catch (e) {}
  }
  return t;
}

async function stampHostToken(url) {
  try {
    var origin = originOf(url);
    if (!origin) return url;
    var r = await httpText(origin + "/generate.php", origin + "/", "text/plain, */*");
    var tk = parseToken(r.text);
    if (!tk) return url;
    if (url.indexOf("__TOKEN__") > -1) return url.split("__TOKEN__").join(tk);
    return url + (url.indexOf("?") > -1 ? "&" : "?") + "token=" + encodeURIComponent(tk);
  } catch (e) { return url; }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  var out = [];
  try {
    var type = mediaType === "movie" ? "movie" : "tv";
    var sNum = season == null || season === "" ? 1 : parseInt(season, 10);
    var eNum = episode == null || episode === "" ? 1 : parseInt(episode, 10);
    if (isNaN(sNum)) sNum = 1;
    if (isNaN(eNum)) eNum = 1;

    var details = await tmdbDetails(tmdbId, type);
    if (!details) return out;
    var title = details.title || details.name || "";
    var rd = details.release_date || details.first_air_date || "";
    var year = (rd && rd.length >= 4) ? parseInt(rd.slice(0, 4), 10) : null;
    if (!title) return out;
    var displayTitle = title + (type === "movie" ? "" : " S" + sNum + "E" + eNum);

    // Step 1: cinegram search + exact gate.
    var searchUrl = CG + "/index.php?menu=search&query=" + encodeURIComponent(title);
    var sr = await httpText(searchUrl, CG + "/home");
    if (sr.status !== 200 || !sr.text) return out;
    var cands = parseSearch(sr.text);
    var gateOk = false;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var isMovieLink = c.href.indexOf("/movie/") === 0;
      var isTvLink = c.href.indexOf("/tv/") === 0;
      if (type === "movie" && !isMovieLink) continue;
      if (type === "tv" && !isTvLink) continue;
      if (!titleMatches(c.title, title)) continue;
      if (year != null && c.year != null) {
        if (type === "movie") { if (Math.abs(c.year - year) > 1) continue; }
        else { if (Math.abs(c.year - year) > 1) continue; }
      }
      gateOk = true;
      break;
    }
    if (!gateOk) return out;

    // Step 2: ythd vs_src -> stellar embed URL.
    var vsUrl = YTHD + "/vs_src.php?type=" + type + "&id=" + encodeURIComponent(tmdbId);
    if (type === "tv") vsUrl += "&season=" + sNum + "&episode=" + eNum;
    var vs = await httpJson(vsUrl, YTHD + "/embed/" + tmdbId);
    var stellarUrl = (vs.json && vs.json.src) || "";
    if (!stellarUrl) return out;
    var stellarOrigin = originOf(stellarUrl);
    if (!stellarOrigin) return out;

    // Step 3: stellar page -> inner player path.
    var sp = await httpText(stellarUrl, YTHD + "/embed/" + tmdbId);
    if (sp.status !== 200 || !sp.text) return out;
    var pm = /\/embed\/player\/[^"'\s<>]+/.exec(sp.text);
    if (!pm) return out;
    var innerUrl = stellarOrigin + pm[0];

    // Step 4: inner player page -> CONFIG api + apiToken. Movies
    // carry "api" (already the full stream_urls URL); TV carries
    // "streamBase" (apiFor appends season/episode/stream_urls).
    var ip = await httpText(innerUrl, stellarUrl);
    if (ip.status !== 200 || !ip.text) return out;
    var am = /"api"\s*:\s*"([^"]+)"/.exec(ip.text);
    var sm = /"streamBase"\s*:\s*"([^"]+)"/.exec(ip.text);
    var tm = /"apiToken"\s*:\s*"([^"]+)"/.exec(ip.text);
    if (!am && !sm) return out;
    var apiUrl = (am ? am[1] : sm[1]).split("\\u0026").join("&");
    var apiToken = tm ? tm[1] : "";
    if (apiUrl.indexOf("stream_urls") === -1) {
      if (type === "tv") apiUrl += "&season=" + sNum + "&episode=" + eNum;
      apiUrl += "&stream_urls";
    }
    if (apiToken) apiUrl += (apiUrl.indexOf("?") > -1 ? "&" : "?") + "api_token=" + encodeURIComponent(apiToken);

    // Step 5: stream_urls API. A string (not an array) means the
    // WASM-encrypted form, which the TV guest cannot decrypt.
    var api = await httpJson(apiUrl, innerUrl);
    var urls = (api.json && api.json.data && api.json.data.stream_urls) || null;
    if (!Array.isArray(urls) || !urls.length) return out;

    // Step 6: per-host generate.php token stamp, then ship.
    var seen = {};
    for (var j = 0; j < urls.length; j++) {
      var raw = urls[j];
      var u = null, label = "";
      if (typeof raw === "string") u = raw;
      else if (raw && typeof raw === "object") { u = raw.url || raw.file || null; label = raw.label || raw.name || raw.quality || ""; }
      if (!u || seen[u]) continue;
      seen[u] = true;
      var stamped = await stampHostToken(u);
      var q = qualityFromUrl(stamped, label);
      var st = {
        name: "Cinegram • " + q,
        title: displayTitle,
        url: stamped,
        quality: q,
        type: /\.mp4(\?|$)/i.test(stamped) ? "mp4" : "m3u8"
      };
      out.push(st);
    }
  } catch (err) {
    // Return whatever was collected; a scraper must not throw.
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
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
