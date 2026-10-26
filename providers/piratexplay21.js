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



// PirateXPlay scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: PirateXPlay provider — TMDB-slug site with multi-mirror embeds.
// Resolves: AWSStream (as-cdn), generic players, AbyssPlayer, Byse/Filemoon,
// GDMirrorbot mirrors.
//
// NOTE: set TMDB_API_KEY below (free key from themoviedb.org) — used to turn
// the TMDB ID Nuvio passes in into a title for searching.


// Pure-JS crypto block for Nuvio providers (TV-compat).
// The NuvioTVSmart (webOS) QuickJS guest has NO WebCrypto and no
// TextEncoder/TextDecoder. Everything here is dependency-free ES5-ish JS.
// Contents: UTF-8 codec shims (install only if missing), AES (128/192/256)
// block encrypt+decrypt with key expansion, CBC decrypt (PKCS#7), SHA-256,
// AES-GCM decrypt (12-byte IV, 128-bit tag, no AAD).

// ---------- UTF-8 shims ----------
if (typeof TextEncoder === "undefined") {
  globalThis.TextEncoder = function TextEncoder() {};
  globalThis.TextEncoder.prototype.encode = function (str) {
    str = String(str == null ? "" : str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var cp = str.codePointAt(i);
      if (cp > 0xffff) i++;
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return new Uint8Array(out);
  };
}
if (typeof TextDecoder === "undefined") {
  globalThis.TextDecoder = function TextDecoder() {};
  globalThis.TextDecoder.prototype.decode = function (bytes) {
    if (!bytes) return "";
    var out = "", i = 0;
    while (i < bytes.length) {
      var b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); i++; }
      else if ((b & 0xe0) === 0xc0 && i + 1 < bytes.length) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2; }
      else if ((b & 0xf0) === 0xe0 && i + 2 < bytes.length) { out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 3; }
      else if ((b & 0xf8) === 0xf0 && i + 3 < bytes.length) {
        var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); i += 4;
      } else i++;
    }
    return out;
  };
}

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var BASE_URL = "https://piratexplay.cc";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};
var RESOLVE_TIMEOUT = 12000;

// ---------- helpers ----------

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function fetchHtml(url, referer, timeoutMs) {
  var headers = Object.assign({}, HEADERS, { Referer: referer || BASE_URL + "/" });
  return fetchWithTimeout(url, { headers: headers }, timeoutMs || 20000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function b64decode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  var bin = atob(s);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function absoluteUrl(href, base) {
  base = base || BASE_URL;
  if (!href) return "";
  if (href.indexOf("http") === 0) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  return base + (href.charAt(0) === "/" ? href : "/" + href);
}

function normTitle(t) {
  return String(t || "").toLowerCase().replace(/[:\-–—]/g, " ").replace(/[^\w\s]/g, "").replace(/\b(the|a|an)\b/g, "").replace(/\s+/g, " ").trim();
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
var TITLE_NOISE = { the: 1, a: 1, an: 1, with: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, subtitle: 1, subtitles: 1, subs: 1, multi: 1, audio: 1, complete: 1,
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
  normTitle(foldAccents(String(t).toLowerCase())).split(" ").forEach(function (w) {
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
  var contained = true;
  for (var i = 0; i < q.length; i++) if (c.indexOf(q[i]) === -1) { contained = false; break; }
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

// TMDB alternative titles (e.g. "Shin Chan" for "Crayon Shin-chan"):
// the catalog often lists a show under an alias, so when the canonical
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
        if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0e00-\u0e7f\u0590-\u05ff\u0600-\u06ff]/.test(t)) return;
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

function buildSearchQueries(title) {
  var queries = [title];
  var words = title.split(/\s+/);
  if (words.length > 1) {
    queries.push(words.slice(1).join(" "));
    if (words.length > 2) queries.push(words.slice(0, 2).join(" "));
  }
  var ci = title.indexOf(":");
  if (ci > 2) queries.push(title.slice(0, ci).trim());
  var nh = title.replace(/-/g, "");
  if (nh !== title) queries.push(nh);
  var seen = {}, out = [];
  queries.forEach(function (q) { if (q.length > 1 && !seen[q]) { seen[q] = 1; out.push(q); } });
  return out;
}

// ---------- search (JSON API) ----------

function searchAnime(query) {
  var url = BASE_URL + "/api/search-ajax.php?keyword=" + encodeURIComponent(query);
  return fetchWithTimeout(url, { headers: HEADERS }, 15000).then(function (res) {
    if (!res.ok) return [];
    return res.json();
  }).then(function (data) {
    if (!data || data.status !== "success" || !Array.isArray(data.data)) return [];
    return data.data.map(function (item) {
      var tmdb = item.tmdb || {};
      var type = tmdb.type === "movies" ? "movies" : "series";
      var slug = tmdb.url || "";
      return {
        type: type, slug: slug, title: tmdb.title || "",
        detailUrl: BASE_URL + "/" + type + "/" + slug,
      };
    }).filter(function (c) { return c.slug && c.title; });
  }).catch(function () { return []; });
}

// ---------- embed resolvers ----------

// ---------- Dean Edwards packer unpacker (pure JS) ----------
// Many embed hosts (StreamRuby, Ravok/AWStream family) hide the JWPlayer
// setup inside eval(function(p,a,c,k,e,d){...}) packed scripts.
function readJsString(s, i) {
  var q = s.charAt(i), out = "", j = i + 1;
  while (j < s.length) {
    var ch = s.charAt(j);
    if (ch === "\\") {
      var n = s.charAt(j + 1);
      if (n === "x") { out += String.fromCharCode(parseInt(s.substr(j + 2, 2), 16)); j += 4; }
      else if (n === "u") { out += String.fromCharCode(parseInt(s.substr(j + 2, 4), 16)); j += 6; }
      else { out += n; j += 2; }
      continue;
    }
    if (ch === q) return { value: out, end: j + 1 };
    out += ch; j++;
  }
  return { value: out, end: j };
}
function packerToken(c, a) {
  var out = "", rem = c;
  do {
    var d = rem % a;
    out = (d > 35 ? String.fromCharCode(d + 29) : d.toString(36)) + out;
    rem = Math.floor(rem / a);
  } while (rem > 0);
  return out;
}
function unpackPackedAll(html) {
  var marker = "eval(function(p,a,c,k,e,d)";
  var results = [], pos = 0;
  while (true) {
    var idx = html.indexOf(marker, pos);
    if (idx === -1) break;
    var argsStart = html.indexOf("}(", idx);
    if (argsStart === -1) break;
    var i = argsStart + 2, fail = false;
    if (html.charAt(i) !== "'" && html.charAt(i) !== '"') break;
    var p = readJsString(html, i); i = p.end;
    while (html.charAt(i) === " " || html.charAt(i) === ",") i++;
    var aMatch = /^(\d+)/.exec(html.slice(i, i + 6));
    if (!aMatch) break;
    var radix = parseInt(aMatch[1], 10); i += aMatch[1].length;
    while (html.charAt(i) === " " || html.charAt(i) === ",") i++;
    var cMatch = /^(\d+)/.exec(html.slice(i, i + 6));
    if (!cMatch) break;
    var count = parseInt(cMatch[1], 10); i += cMatch[1].length;
    while (html.charAt(i) === " " || html.charAt(i) === ",") i++;
    if (html.charAt(i) !== "'" && html.charAt(i) !== '"') break;
    var kw = readJsString(html, i);
    var words = kw.value.split("|");
    var payload = p.value;
    for (var c = count - 1; c >= 0; c--) {
      var token = packerToken(c, radix);
      var replacement = words[c] || token;
      var esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      payload = payload.replace(new RegExp("\\b" + esc + "\\b", "g"), String(replacement).replace(/\$/g, "$$$$"));
    }
    results.push(payload);
    pos = kw.end;
  }
  return results;
}

var GENERIC_PATTERNS = [
  /file\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/,
  /source\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/,
  /"file"\s*:\s*"([^"]+\.m3u8[^"]*?)"/,
  /src\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/,
  /var\s+urlPlay\s*=\s*["']([^"']+\.m3u8[^"']*?)["']/,
  /<source[^>]+src=["']([^"']+\.m3u8[^"']*?)["']/,
  /"(https?:\/\/[^"]+\.m3u8(?:[?#][^"]*)?)"/,
  /(https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*)/,
  /file\s*:\s*["']([^"']+\.mp4[^"']*?)["']/,
  /"file"\s*:\s*"([^"]+\.mp4[^"]*?)"/,
  /"(https?:\/\/[^"]+\.mp4(?:[?#][^"]*)?)"/,
];
function findStreamInTexts(texts) {
  for (var t = 0; t < texts.length; t++) {
    var text = String(texts[t]).replace(/\\\//g, "/");
    for (var i = 0; i < GENERIC_PATTERNS.length; i++) {
      var m = GENERIC_PATTERNS[i].exec(text);
      if (m && m[1] && m[1].indexOf("undefined") === -1) return m[1];
    }
  }
  return null;
}
function extractGenericPlayer(url, referer) {
  return fetchHtml(url, referer, 15000).then(function (html) {
    if (!html) return null;
    var found = findStreamInTexts([html].concat(unpackPackedAll(html)));
    if (found) return found;
    // challenge pages bounce via JS redirect — follow it once and retry
    var redir = /window\.location\.replace\(["']([^"']+)["']\)/.exec(html) || /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/.exec(html);
    if (redir && redir[1] && redir[1].indexOf("http") === 0 && redir[1] !== url) {
      return fetchHtml(redir[1], url, 15000).then(function (html2) {
        if (!html2) return null;
        return findStreamInTexts([html2].concat(unpackPackedAll(html2)));
      }).catch(function () { return null; });
    }
    return null;
  }).catch(function () { return null; });
}

// Subtitles: AWS/Ravok embed player pages carry kind:"captions" tracks
// (packed JWPlayer config). extractAWSStream stashes them by video URL;
// both stream-construction sites below attach the stash entry.
// kind filter is essential: thumbnail sprites also arrive as .vtt tracks.
function parseCaptionTracks(html) {
  var texts = [html || ""].concat(unpackPackedAll(html || ""));
  var out = [], seen = {};
  for (var ti = 0; ti < texts.length; ti++) {
    var re = /\{[^{}]*kind["']?\s*:\s*["']captions["'][^{}]*\}/g;
    var m;
    while ((m = re.exec(texts[ti])) !== null) {
      var obj = m[0];
      var f = /file["']?\s*:\s*["']([^"']+)["']/.exec(obj);
      if (!f || seen[f[1]]) continue;
      seen[f[1]] = true;
      var l = /label["']?\s*:\s*["']([^"']+)["']/.exec(obj);
      var lg = /language["']?\s*:\s*["']([^"']+)["']/.exec(obj);
      out.push({ url: f[1].split("\\/").join("/"), language: lg ? lg[1] : (l ? l[1] : "Unknown"), name: l ? l[1] : (lg ? lg[1] : "Subtitle") });
    }
  }
  return out;
}
var AWS_SUBS = {};

function extractAWSStream(url, referer) {
  try {
    var base = new URL(url).origin;
    var hash = new URL(url).searchParams.get("data") || url.split("/").filter(Boolean).pop() || "";
    if (!hash) return Promise.resolve(null);
    var apiUrl = base + "/player/index.php?data=" + hash + "&do=getVideo";
    return fetchWithTimeout(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": HEADERS["User-Agent"],
        Referer: referer, Origin: base,
      },
      body: "hash=" + encodeURIComponent(hash) + "&r=" + encodeURIComponent(referer),
    }, 15000).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      return (data && data.videoSource) || null;
    }).then(function (videoUrl) {
      if (!videoUrl) return null;
      return fetchWithTimeout(url, {
        headers: { "User-Agent": HEADERS["User-Agent"], Referer: referer },
      }, 15000).then(function (r) { return r.ok ? r.text() : ""; })
      .catch(function () { return ""; })
      .then(function (html) {
        var subs = parseCaptionTracks(html);
        if (subs.length) AWS_SUBS[videoUrl] = subs;
        return videoUrl;
      });
    }).catch(function () { return null; });
  } catch (e) { return Promise.resolve(null); }
}

// Abyss storage (sssrr.org /sora/) 403s without the player referer -
// the same rule the AniDisk provider lives by (probe-verified: bare
// 403, with Referer a 302 to the file). AbyssPlayer streams previously
// carried no headers and failed at playback; other servers are fine
// bare and are left untouched.
var ABYSS_PLAYBACK_HEADERS = { Referer: "https://player.abyssplayer.com/", "User-Agent": HEADERS["User-Agent"] };
function isAbyssStorageUrl(u) { return /\/sora\//i.test(u || "") || /sssrr\.org/i.test(u || ""); }
function abyssify(stream) {
  stream.headers = ABYSS_PLAYBACK_HEADERS;
  stream.behaviorHints = { notWebReady: true, proxyHeaders: { request: ABYSS_PLAYBACK_HEADERS } };
  return stream;
}

function isAbyssPlayerUrl(url) {
  return /(?:^|\/\/)(?:www\.)?abyssplayer\.com\//i.test(url);
}

// The /sora/ source URL answers a 302 to a per-session tunnel host.
// Players commonly drop custom headers across a cross-host redirect,
// so the tunnel request arrives bare and is refused - resolve the
// redirect HERE (same device, same network) and hand the player the
// final URL directly, headers still attached.
// Race a promise against a wall-clock deadline WITHOUT timers
// (the TV guest has none, and a fetch that never settles must not
// be able to hold a result hostage - on the phone app, fetches of
// the Abyss storage URLs can hang silently inside the fetch bridge;
// the 1.2.52 on-device diagnostic showed the chain reaching the
// decoded sources and then never returning).
function withDeadline(promise, ms) {
  var box = { done: false, value: undefined };
  promise.then(function (v) { box.done = true; box.value = v; }, function () { box.done = true; });
  var t0 = Date.now();
  function check() {
    if (box.done) return box.value;
    if (Date.now() - t0 >= ms) return undefined;
    return Promise.resolve().then(check);
  }
  return Promise.resolve().then(check);
}

function abyssPickFinal(res, url) {
  var finalUrl = url;
  try { var loc = res && res.headers && res.headers.get ? res.headers.get("location") : null; if (loc) finalUrl = loc; } catch (e) {}
  if (finalUrl === url && res && res.url && res.url !== url) finalUrl = res.url;
  try { if (res && res.body && res.body.cancel) res.body.cancel(); } catch (e) {}
  return finalUrl;
}
function resolveAbyssFinalUrl(url) {
  // HEAD first (the endpoint answers with the bare 302, no body),
  // each attempt deadline-wrapped: a stuck fetch falls back to the
  // original URL instead of swallowing the stream entry.
  var hdrs = { "User-Agent": HEADERS["User-Agent"], Referer: "https://player.abyssplayer.com/" };
  var head = fetchWithTimeout(url, { method: "HEAD", headers: hdrs }, 12000)
    .then(function (res) { return abyssPickFinal(res, url); })
    .catch(function () { return "__ERR__"; });
  return withDeadline(head, 6000).then(function (u) {
    if (u === undefined) return url; // fetch stuck in the bridge
    if (u !== "__ERR__") return u;
    var gh = { "User-Agent": hdrs["User-Agent"], Referer: hdrs.Referer, Range: "bytes=0-0" };
    var get = fetchWithTimeout(url, { headers: gh }, 12000)
      .then(function (res) { return abyssPickFinal(res, url); })
      .catch(function () { return url; });
    return withDeadline(get, 6000).then(function (u2) { return u2 || url; });
  }).catch(function () { return url; });
}

function extractAbyssPlayerSources(url) {
  var headers = {
    "User-Agent": HEADERS["User-Agent"],
    Origin: "https://playhydrax.com",
    Referer: "https://playhydrax.com/",
  };
  return fetchWithTimeout(url, { headers: headers }, 15000).then(function (res) {
    if (!res.ok) return [];
    return res.text();
  }).then(function (html) {
    var m = /const\s+datas\s*=\s*"([^"]*)"/.exec(html);
    if (!m || !m[1]) return [];
    return fetchWithTimeout("https://enc-dec.app/api/dec-abyss", {
      method: "POST",
      headers: Object.assign({}, headers, { "Content-Type": "application/json" }),
      body: JSON.stringify({ text: m[1] }),
    }, 15000).then(function (res) {
      if (!res.ok) return [];
      return res.json();
    }).then(function (decoded) {
      var sources = (decoded && decoded.result && decoded.result.sources) || [];
      var mapped = sources.filter(function (s) { return s.status !== false && s.url; })
        .map(function (s, i) {
          var label = (s.type || ("Stream " + (i + 1))).trim();
          if (s.codec) label += " · " + String(s.codec).toUpperCase();
          return { label: label, videoUrl: s.url };
        });
      // Resolve the redirects SEQUENTIALLY under a total time
      // budget: on slow networks an unbounded parallel burst of
      // tunnel fetches could eat the provider's whole search
      // budget and the Abyss entries never surfaced at all.
      // Whatever is unresolved when the budget ends keeps its
      // original URL - the entries always come back.
      var resolved = mapped.map(function (s) { return { label: s.label, videoUrl: s.videoUrl }; });
      var chain = Promise.resolve(null);
      var t0 = Date.now();
      mapped.forEach(function (s, i) {
        chain = chain.then(function () {
          if (Date.now() - t0 > 20000) return null;
          return resolveAbyssFinalUrl(s.videoUrl).then(function (u) {
            resolved[i] = { label: s.label, videoUrl: u };
            return null;
          });
        });
      });
      return chain.then(function () { return resolved; });
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}

function aesGcmDecrypt(parts, ivB64, payloadB64, version) {
  try {
    var n = parseInt(version, 10);
    var selected = [];
    if (n >= 1 && n <= 20) {
      [n, 31 - n].forEach(function (idx) {
        if (idx >= 1 && idx <= parts.length && parts[idx - 1]) selected.push(parts[idx - 1]);
      });
    } else {
      selected = parts.filter(Boolean);
    }
    if (!selected.length) return Promise.resolve(null);
    var keyBytes = selected.map(b64decode);
    var total = keyBytes.reduce(function (a, b) { return a + b.length; }, 0);
    var keyBuf = new Uint8Array(total), off = 0;
    keyBytes.forEach(function (b) { keyBuf.set(b, off); off += b.length; });
    var iv = b64decode(ivB64);
    var cipherWithTag = b64decode(payloadB64);
    return crypto.subtle.importKey("raw", keyBuf, "AES-GCM", false, ["decrypt"]).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, cipherWithTag);
    }).then(function (buf) {
      var obj = JSON.parse(new TextDecoder().decode(buf));
      return (obj.sources && obj.sources[0] && obj.sources[0].url) || null;
    }).catch(function () { return null; });
  } catch (e) { return Promise.resolve(null); }
}

function extractBysePlayer(url, referer) {
  var hm = /\/e\/([a-zA-Z0-9]+)\/?/.exec(url);
  if (!hm) return Promise.resolve(null);
  var base = "";
  try { base = new URL(url).origin; } catch (e) { return Promise.resolve(null); }
  var apiUrl = base + "/api/videos/" + encodeURIComponent(hm[1]) + "/";
  return fetchWithTimeout(apiUrl, {
    headers: { "User-Agent": HEADERS["User-Agent"], Referer: referer, Origin: base },
  }, 15000).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (data) {
    if (!data || !data.playback) return null;
    var pb = data.playback;
    return aesGcmDecrypt(pb.key_parts || [], pb.iv, pb.payload, pb.version);
  }).catch(function () { return null; });
}

function extractGDMirrorbot(url, referer) {
  var base = "", sid = "";
  try {
    base = new URL(url).origin;
    sid = url.split("/").filter(Boolean).pop().split("?")[0] || "";
  } catch (e) { return Promise.resolve(null); }
  if (!sid) return Promise.resolve(null);
  return fetchWithTimeout(base + "/embedhelper.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": HEADERS["User-Agent"],
      Referer: url, Origin: base,
    },
    body: "sid=" + encodeURIComponent(sid),
  }, 15000).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (data) {
    if (!data) return null;
    var siteUrls = data.siteUrls || {};
    var mresult = {};
    if (typeof data.mresult === "string") {
      try { mresult = JSON.parse(new TextDecoder().decode(b64decode(data.mresult))); } catch (e) {}
    } else if (data.mresult && typeof data.mresult === "object") {
      mresult = data.mresult;
    }
    var keys = Object.keys(siteUrls).filter(function (k) { return mresult[k]; });
    var chain = Promise.resolve(null);
    keys.forEach(function (key) {
      chain = chain.then(function (done) {
        if (done) return done;
        var b = (siteUrls[key] || "").replace(/\/$/, "");
        var p = (mresult[key] || "").replace(/^\//, "");
        if (!b || !p) return null;
        var mirrorUrl = b.charAt(b.length - 1) === "#" ? b + p : b + "/" + p;
        return resolveEmbedUrl(mirrorUrl, url).catch(function () { return null; });
      });
    });
    return chain;
  }).catch(function () { return null; });
}

function isByseHost(url) {
  return /bysezejataos\.com|bysetayico\.com|moonembd\.online|moonfeel\.online|moonfast\.online|filemoon\.(sx|to|in)/.test(url);
}
function isAWSHost(url) {
  return /awstream\.net|as-cdn\d+\.top|awstream|ravok\.buzz/.test(url);
}
function isGDMirrorHost(url) {
  return /gdmirrorbot|techinmind|iqsmartgames\.com/.test(url);
}

function isRubyHost(url) {
  return /rubystm\.com|streamruby\./i.test(url);
}

// StreamRuby's embed page is a click-to-play form: POST op=embed to /dl with
// the file code, then the real player (with the m3u8) is in the packed script
// of the response.
function extractStreamRuby(embedUrl, referer) {
  var code = "";
  try { code = embedUrl.split("/").filter(Boolean).pop().split("?")[0]; } catch (e) {}
  if (!code) return Promise.resolve(null);
  var origin = "https://rubystm.com";
  try { origin = new URL(embedUrl).origin; } catch (e) {}
  return fetchWithTimeout(origin + "/dl", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": HEADERS["User-Agent"],
      Referer: embedUrl,
    },
    body: "op=embed&file_code=" + encodeURIComponent(code) + "&auto=1&referer=",
  }, 15000).then(function (res) {
    if (!res.ok) return null;
    return res.text();
  }).then(function (html) {
    if (!html) return null;
    var texts = [html].concat(unpackPackedAll(html));
    for (var i = 0; i < texts.length; i++) {
      var m = /https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/.exec(String(texts[i]).replace(/\\\//g, "/"));
      if (m) return m[0];
    }
    return null;
  }).catch(function () { return null; });
}

function resolveEmbedUrl(embedUrl, referer) {
  if (embedUrl.indexOf("piratexplay.cc") !== -1) {
    try {
      var u = new URL(embedUrl);
      var inner = u.searchParams.get("url");
      if (inner) return resolveEmbedUrl(inner.indexOf("//") === 0 ? "https:" + inner : inner, embedUrl);
    } catch (e) {}
    return extractGenericPlayer(embedUrl, referer);
  }
  if (isAbyssPlayerUrl(embedUrl)) {
    return extractAbyssPlayerSources(embedUrl).then(function (ss) {
      return ss.length ? ss[0].videoUrl : null;
    });
  }
  if (isByseHost(embedUrl)) return extractBysePlayer(embedUrl, referer);
  if (isRubyHost(embedUrl)) return extractStreamRuby(embedUrl, referer);
  if (isAWSHost(embedUrl)) return extractAWSStream(embedUrl, referer);
  if (isGDMirrorHost(embedUrl)) return extractGDMirrorbot(embedUrl, referer);
  return extractGenericPlayer(embedUrl, referer);
}

// ---------- page parsing (regex, no cheerio) ----------

function parseServerButtons(html) {
  var names = [];
  var re = /<button[^>]*class="[^"]*server-btn[^"]*"[^>]*data-server="(\d+)"[^>]*>([\s\S]*?)<\/button>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var idx = parseInt(m[1], 10);
    var label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || ("Server " + (idx + 1));
    names[isNaN(idx) ? names.length : idx] = label;
  }
  return names;
}

function parseIframes(html) {
  var urls = [];
  var re = /<div[^>]*id="options-(\d+)"[^>]*>[\s\S]*?<iframe[^>]*(?:src|data-src)="([^"]+)"[^>]*>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var idx = parseInt(m[1], 10), src = m[2];
    if (!src || src === "about:blank") continue;
    urls[isNaN(idx) ? urls.length : idx] = absoluteUrl(src);
  }
  if (!urls.length) {
    var re2 = /<iframe[^>]*(?:src|data-src)="([^"]+)"[^>]*>/gi;
    while ((m = re2.exec(html)) !== null) {
      if (m[1] && m[1] !== "about:blank") urls.push(absoluteUrl(m[1]));
    }
  }
  return urls.filter(Boolean);
}

function isPiratexplayOwnPlayer(url) {
  return url.indexOf("piratexplay.cc") !== -1 && url.indexOf("/player/") !== -1;
}

var ALLOWED_MODAL = { fm: 1, gdmirr: 1, hyd: 1, abyss: 1, abyssplayer: 1 };

function extractModalSources(url, referer) {
  return fetchHtml(url, referer, 20000).then(function (html) {
    var candidates = [];
    // <div class="server-option ..." data-link="..." data-language="...">
    // (attributes may span multiple lines)
    var re = /class="server-option[^"]*"[\s\S]*?data-link="([^"]+)"[\s\S]*?data-language="([^"]+)"/gi, m;
    var re2 = /data-language="([^"]+)"[\s\S]{0,200}?data-link="([^"]+)"/gi;
    var seen = {};
    while ((m = re.exec(html)) !== null) {
      var link = m[1], label = m[2].trim().toLowerCase();
      if (link && label && ALLOWED_MODAL[label] && !seen[link]) { seen[link] = 1; candidates.push({ label: label, link: link }); }
    }
    while ((m = re2.exec(html)) !== null) {
      var label2 = m[1].trim().toLowerCase(), link2 = m[2];
      if (link2 && label2 && ALLOWED_MODAL[label2] && !seen[link2]) { seen[link2] = 1; candidates.push({ label: label2, link: link2 }); }
    }
    var jobs = candidates.map(function (c) {
      var embedUrl = absoluteUrl(c.link, BASE_URL);
      var displayLabel = (c.label === "hyd" || c.label === "abyss" || c.label === "abyssplayer") ? "AbyssPlayer" : c.label.toUpperCase();
      if (isAbyssPlayerUrl(embedUrl)) {
        return withTimeout(extractAbyssPlayerSources(embedUrl), RESOLVE_TIMEOUT).then(function (ss) {
          return ss.map(function (s) {
            return { label: displayLabel + " · " + s.label, videoUrl: s.videoUrl };
          });
        });
      }
      return withTimeout(resolveEmbedUrl(embedUrl, url), RESOLVE_TIMEOUT).then(function (vu) {
        return vu ? [{ label: displayLabel, videoUrl: vu, subtitles: AWS_SUBS[vu] }] : [];
      });
    });
    return collectJobs(jobs);
  }).catch(function () { return []; });
}

function collectJobs(jobs) {
  // Wait for EVERY job. The old early-close rules (finish at 6+
  // streams, or when only one job was outstanding) kept discarding
  // whichever server branch was slowest that run - first the Abyss
  // job (1.2.47-53), then the FM/modal job (1.2.54). All branches
  // here are internally bounded, so waiting for all of them is
  // safe; a 35s elapsed emergency exit (checked as jobs settle)
  // still keeps one stuck branch from eating the app's budget.
  return new Promise(function (resolve) {
    if (!jobs.length) { resolve([]); return; }
    var out = [], settled = 0, done = false, t0 = Date.now();
    function finish() { if (done) return; done = true; resolve(out); }
    jobs.forEach(function (j) {
      Promise.resolve(j).then(function (r) {
        if (Array.isArray(r)) out.push.apply(out, r);
      }).catch(function () {}).then(function () {
        settled++;
        if (settled >= jobs.length) return finish();
        if (Date.now() - t0 >= 35000 && out.length >= 1) return finish();
      });
    });
  });
}

function withTimeout(promise, ms) {
  return promise;
}

function qualityFromUrl(url) {
  var m = /(\d{3,4})p/i.exec(url);
  return m ? m[1] + "p" : "Unknown";
}

// ---------- main fetch ----------

function fetchStreams(type, slug, season, episode, mediaTitle) {
  var episodeUrl, seriesPageUrl;
  if (type === "movies" || season == null || episode == null) {
    episodeUrl = BASE_URL + "/" + type + "/" + slug;
    seriesPageUrl = episodeUrl;
  } else {
    episodeUrl = BASE_URL + "/episode/" + slug + "-" + season + "x" + episode + "/";
    seriesPageUrl = BASE_URL + "/series/" + slug + "/";
  }
  return fetchHtml(episodeUrl, seriesPageUrl, 20000).then(function (html) {
    var serverNames = parseServerButtons(html);
    var iframeUrls = parseIframes(html);
    if (!iframeUrls.length) return [];

    var embeds = [];
    for (var i = 0; i < iframeUrls.length; i++) {
      var eu = iframeUrls[i];
      if (!eu) continue;
      var sn = serverNames[i] || ("Server " + (i + 1));
      // multi-language bundles carry data= base64 JSON [{language, link}]
      // (animesalt links, and piratexplay's own /proxy/multi.php)
      if (/animesalt\.(link|ac|cx)/.test(eu) || eu.indexOf("data=") !== -1) {
        try {
          var u = new URL(eu);
          var data = u.searchParams.get("data");
          if (data) {
            var pairs = JSON.parse(new TextDecoder().decode(b64decode(data)));
            if (Array.isArray(pairs) && pairs.length) {
              pairs.forEach(function (p) {
                if (p.language && p.link) embeds.push({ serverName: sn + " [" + p.language + "]", embedUrl: p.link });
              });
              continue;
            }
          }
        } catch (e) {}
      }
      embeds.push({ serverName: sn, embedUrl: eu });
    }

    var allowed = /awstream\.net|as-cdn\d+\.top|awstream|ravok\.|piratexplay\.cc\/proxy\/|emturbovid\.com|bysezejataos\.com|bysetayico\.com|moonembd\.online|moonfeel\.online|moonfast\.online|iqsmartgames\.com|gdmirrorbot|techinmind|filemoon\.(sx|to|in)|abyssplayer\.com|rubystm\.com|streamruby|vidstreaming\.xyz/i;
    var abyssJobs = [];
    var jobs = embeds.map(function (em) {
      if (isAbyssPlayerUrl(em.embedUrl)) {
        var aj = withTimeout(extractAbyssPlayerSources(em.embedUrl), RESOLVE_TIMEOUT).then(function (ss) {
          return ss.map(function (s) {
            var _pxLabel = formatStreamLabel({ source: "PirateXPlay", title: mediaTitle, quality: qualityFromUrl(s.videoUrl), season: season, episode: episode, server: "AbyssPlayer", url: s.videoUrl }); return abyssify({ name: _pxLabel, title: _pxLabel, url: s.videoUrl, quality: qualityFromUrl(s.videoUrl), type: "direct" });
          });
        });
        abyssJobs.push(aj);
        return aj;
      }
      // piratexplay's own multi-mirror player: extract FM/Gdmirr/Abyss from modal
      if (isPiratexplayOwnPlayer(em.embedUrl)) {
        return withTimeout(extractModalSources(em.embedUrl, episodeUrl), RESOLVE_TIMEOUT).then(function (ss) {
          return ss.map(function (s) {
            var _pxLabel2 = formatStreamLabel({ source: "PirateXPlay", title: mediaTitle, quality: qualityFromUrl(s.videoUrl), season: season, episode: episode, subtitles: (s.subtitles && s.subtitles.length ? s.subtitles : undefined), server: (s.label.split(" · ")[0] || "Server"), url: s.videoUrl }); var _st = { name: _pxLabel2, title: _pxLabel2, url: s.videoUrl, quality: qualityFromUrl(s.videoUrl), type: "direct" }; if (s.subtitles && s.subtitles.length) _st.subtitles = s.subtitles; if (s.label.indexOf("AbyssPlayer") !== -1 || isAbyssStorageUrl(s.videoUrl)) return abyssify(_st); if (s.label.indexOf("FM") === 0 || isByseHost(em.embedUrl)) return fmify(_st, em.embedUrl); return _st;
          });
        });
      }
      if (!allowed.test(em.embedUrl)) return Promise.resolve([]);
      return withTimeout(resolveEmbedUrl(em.embedUrl, episodeUrl), RESOLVE_TIMEOUT).then(function (videoUrl) {
        if (!videoUrl) return [];
        var _pxLabel3 = formatStreamLabel({ source: "PirateXPlay", title: mediaTitle, quality: qualityFromUrl(videoUrl), season: season, episode: episode, subtitles: (AWS_SUBS[videoUrl] && AWS_SUBS[videoUrl].length ? AWS_SUBS[videoUrl] : undefined), server: serverNameFromEmbed(em.embedUrl), url: videoUrl }); var _o = { name: _pxLabel3, title: _pxLabel3, url: videoUrl, quality: qualityFromUrl(videoUrl), type: "direct" }; if (AWS_SUBS[videoUrl] && AWS_SUBS[videoUrl].length) _o.subtitles = AWS_SUBS[videoUrl]; if (isAbyssStorageUrl(videoUrl)) return [abyssify(_o)]; if (isByseHost(em.embedUrl)) return [fmify(_o, em.embedUrl)]; return [_o];
      });
    });
    return collectJobs(jobs);
  }).catch(function () { return []; });
}

function fetchStreamsByTitle(title, stremioType, season, episode) {
  var pxpType = stremioType === "movie" ? "movies" : "series";
  var queries = buildSearchQueries(title);
  var chain = Promise.resolve(null);
  queries.forEach(function (q) {
    chain = chain.then(function (found) {
      if (found) return found;
      return searchAnime(q).then(function (cards) {
        if (!cards.length) return null;
        var typed = cards.filter(function (c) { return c.type === pxpType; });
        var pool = typed.length ? typed : cards;
        var best = null, bestScore = 0;
        pool.forEach(function (c) {
          if (!isExactTitle(title, c.title)) return; // zero-mismatch gate
          var s = titleScore(c.title, title);
          if (s > bestScore) { bestScore = s; best = c; }
        });
        return best;
      });
    });
  });
  return chain.then(function (best) {
    if (!best) return [];
    var targetSlug = best.slug;
    if (season != null) {
      var adjusted = best.slug.replace(/(-season-)\d+(-\d+)$/, "$1" + season + "$2");
      if (adjusted !== best.slug) targetSlug = adjusted;
    }
    return fetchStreams(best.type, targetSlug, season, episode, title);
  });
}

// Byse/Filemoon streams (the "FM" entries) went out bare and failed
// at playback - their SprintCDN links are minted for the embed
// session (the payload even binds the requester ASN and expires in
// ~15 min). Present the embed page as referer, like the real player.
var FM_PLAYBACK_UA = HEADERS["User-Agent"];
function fmify(stream, embedUrl) {
  var h = { Referer: embedUrl, "User-Agent": FM_PLAYBACK_UA };
  stream.headers = h;
  stream.behaviorHints = { notWebReady: true, proxyHeaders: { request: h } };
  return stream;
}

function serverNameFromEmbed(u) {
  u = String(u || "").toLowerCase();
  if (u.indexOf("filemoon") !== -1 || u.indexOf("moon") !== -1) return "Filemoon";
  if (u.indexOf("streamruby") !== -1 || u.indexOf("rubystm") !== -1) return "StreamRuby";
  if (u.indexOf("byse") !== -1) return "Byse";
  if (u.indexOf("gdmirror") !== -1 || u.indexOf("techinmind") !== -1) return "GDMirror";
  if (u.indexOf("awstream") !== -1 || u.indexOf("as-cdn") !== -1) return "AWSStream";
  if (u.indexOf("emturbovid") !== -1) return "EmTurboVid";
  if (u.indexOf("vidstreaming") !== -1) return "VidStreaming";
  if (u.indexOf("abyssplayer") !== -1) return "AbyssPlayer";
  return "Server";
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
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var stremioType = mediaType === "tv" ? "series" : "movie";
  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    return fetchStreamsByTitle(title, stremioType, seasonNum, episodeNum).then(function (streams) {
      if (streams && streams.length) return streams;
      var t0 = Date.now();
      return tmdbAltTitles(tmdbId, mediaType).then(function (alts) {
        var chain = Promise.resolve([]);
        alts.forEach(function (alt) {
          chain = chain.then(function (got) {
            if ((got && got.length) || Date.now() - t0 > 40000) return got;
            return fetchStreamsByTitle(alt, stremioType, seasonNum, episodeNum);
          });
        });
        return chain;
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.PirateXPlayScraperModule = { getStreams: getStreams };
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
