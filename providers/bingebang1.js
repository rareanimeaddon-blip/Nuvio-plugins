/* BingeBang v1.0.0 — Nuvio provider for bingebang.sx (movies + TV).
   Converted from a user-supplied CloudStream-style file.
   Flow: TMDB (title/year/imdbId) -> /api/search/multi (exact gate v3) ->
   /play/ page (XOR block -> ticket) -> /api/player/sources (decrypt) ->
   /api/player/resolve per server (decrypt -> stream URL + Arabic subs).
   The site's /play/ page is Turnstile-challenged for datacenter IPs, so
   the sandbox cannot complete the chain; a real client (browser) loads
   the player page fine. Device is the judge for playback.
   No timers, no TextEncoder/TextDecoder, no WebCrypto, no Node APIs. */

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

// ---------- Pure-JS UTF-8 (the TV guest has no TextEncoder/TextDecoder) ----------
function utf8Encode(str) {
  str = String(str == null ? "" : str);
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var cp = str.charCodeAt(i);
    if (cp >= 0xd800 && cp < 0xdc00 && i + 1 < str.length) {
      var low = str.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) { cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00); i++; }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(out);
}
function utf8Decode(bytes) {
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
}

// ---------- Pure-JS base64url decode (no atob in the TV guest) ----------
var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64CharVal(c) {
  if (c === "=") return 0;
  var v = B64_ALPHABET.indexOf(c);
  return v < 0 ? 0 : v;
}
function b64UrlDecodeBytes(v) {
  var s = String(v || "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  while (s.length % 4) s += "=";
  var out = [];
  for (var i = 0; i < s.length; i += 4) {
    var c0 = b64CharVal(s.charAt(i)), c1 = b64CharVal(s.charAt(i + 1));
    var c2 = b64CharVal(s.charAt(i + 2)), c3 = b64CharVal(s.charAt(i + 3));
    var n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out.push((n >> 16) & 255);
    if (s.charAt(i + 2) !== "=") out.push((n >> 8) & 255);
    if (s.charAt(i + 3) !== "=") out.push(n & 255);
  }
  return new Uint8Array(out);
}

// ---------- SHA-256 (pure JS; Int32Array/Uint8Array/DataView are guest-safe) ----------
var K256 = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function sha256(bytes) {
  var len = bytes.length;
  var padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  var view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 4294967296));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);
  var H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  var w = new Int32Array(64);
  for (var off = 0; off < padded.length; off += 64) {
    for (var i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4);
    for (var j = 16; j < 64; j++) {
      var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (var k = 0; k < 64; k++) {
      var t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[k] + w[k]) | 0;
      var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  var out = new Uint8Array(32);
  var outView = new DataView(out.buffer);
  for (var m = 0; m < 8; m++) outView.setInt32(m * 4, H[m]);
  return out;
}

// ---------- Site constants + fetch helpers ----------
var BASE_URL = "https://bingebang.sx";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

function pageHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: BASE_URL + "/"
  };
}
function apiHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    Referer: BASE_URL + "/"
  };
}
function playerHeaders(playUrl, ticket) {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    Referer: playUrl,
    Origin: BASE_URL,
    "X-BB-Player": "1",
    "X-BB-Ticket": ticket
  };
}
function getText(url, headers) {
  return fetch(url, { headers: headers }).then(function (res) {
    if (!res.ok) throw new Error("http " + res.status);
    return res.text();
  });
}
function getJson(url, headers) {
  return getText(url, headers).then(function (t) { return JSON.parse(t); });
}
function absUrl(p) {
  if (!p || /^https?:/i.test(p)) return p;
  return p.charAt(0) === "/" ? BASE_URL + p : BASE_URL + "/" + p;
}

// ---------- Site crypto: XOR block + payload decrypt ----------
function parseNumList(s) {
  return s.split(",").map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); });
}
function decryptXorBlock(html) {
  if (!html) return null;
  var km = /k\s*=\s*\[([0-9,\s]+)\]/.exec(html);
  var dm = /d\s*=\s*\[([0-9,\s]+)\]/.exec(html);
  if (!km || !dm) return null;
  var key = parseNumList(km[1]);
  var data = parseNumList(dm[1]);
  if (!key.length || !data.length) return null;
  var bytes = new Uint8Array(data.length);
  for (var i = 0; i < data.length; i++) bytes[i] = (data[i] ^ key[i % key.length]) & 255;
  return utf8Decode(bytes);
}
function decryptPayload(body, ticket) {
  var m = /"enc":"([^"]+)"/.exec(body);
  if (!m) return body;
  var raw;
  try { raw = b64UrlDecodeBytes(m[1]); } catch (e) { return body; }
  if (raw.length <= 48) return body;
  var payload = raw.subarray(16);
  var k = [199, 71, 13, 231, 255, 68, 237];
  var v = [254, 34, 63, 133, 200, 39, 217, 246, 38, 61, 129, 201, 32, 213, 242, 37, 62, 132, 206, 33, 218, 166, 126, 57, 129, 205, 113, 137, 247, 37, 53, 209];
  var seed = "";
  for (var i = 0; i < v.length; i++) seed += String.fromCharCode(v[i] ^ k[i % k.length]);
  var block = new Uint8Array(52);
  block.set(sha256(utf8Encode(seed + ticket)));
  block.set(raw.subarray(0, 16), 32);
  var counterView = new DataView(block.buffer, 48, 4);
  var out = new Uint8Array(payload.length);
  for (var pos = 0, counter = 0; pos < payload.length; pos += 32, counter++) {
    counterView.setUint32(0, counter);
    var stream = sha256(block);
    var n = Math.min(32, payload.length - pos);
    for (var j = 0; j < n; j++) out[pos + j] = payload[pos + j] ^ stream[j];
  }
  return utf8Decode(out);
}

// __EXACT_TITLE_GATE__ v3: the site's search is fuzzy — a query returns
// many keyword matches, so a row is accepted ONLY when its normalized
// title EQUALS the TMDB title (or a TMDB alternative title). No
// substring, no prefix, no first-row fallback — a title the site does
// not carry returns [] (honest 0). Normalization: lowercase, & -> and,
// non-alphanumerics -> space, collapse spaces, strip a leading the/a/an.
// For movies, a row that carries a year must match the TMDB year within
// 1 (same-title remakes). For series, within 2 (multi-year runs).
function normTitle(s) {
  var t = String(s || "").toLowerCase();
  t = t.replace(/&amp;/g, "and").replace(/&/g, "and");
  t = t.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(the|a|an)\s+/, "");
  return t;
}
function titlesEqual(a, b) {
  var na = normTitle(a), nb = normTitle(b);
  return !!na && !!nb && na === nb;
}
function rowYear(row) {
  var y = row.year || row.releaseYear || row.release_year || null;
  if (y) { var m = /(\d{4})/.exec(String(y)); if (m) return parseInt(m[1], 10); }
  var d = row.releaseDate || row.release_date || row.firstAirDate || "";
  if (d) { var m2 = /(\d{4})/.exec(String(d)); if (m2) return parseInt(m2[1], 10); }
  return null;
}
// Gate-safe alias recall: TMDB /alternative_titles, Latin-script only,
// shortest first, cap 4, each tried through the SAME exact gate.
function tmdbAltTitles(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetch(TMDB_API + "/" + kind + "/" + tmdbId + "/alternative_titles?api_key=" + TMDB_KEY)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return [];
      var list = j.titles || j.results || [];
      var out = [], seen = {};
      for (var i = 0; i < list.length; i++) {
        var t = String((list[i] && (list[i].title || list[i].name)) || "").trim();
        if (!t || seen[t]) continue;
        // Latin-script only: reject CJK / Cyrillic / Arabic / Hebrew ranges.
        if (/[\u0400-\u04FF\u4E00-\u9FFF\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F\u3040-\u30FF]/.test(t)) continue;
        if (!/[a-zA-Z]/.test(t)) continue;
        seen[t] = true; out.push(t);
      }
      out.sort(function (a, b) { return a.length - b.length; });
      return out.slice(0, 4);
    })
    .catch(function () { return []; });
}

// ---------- TMDB meta: title/year/imdbId (+ names + aliases for the gate) ----------
// imdbId comes from /external_ids for TV (/tv/{id} details carry none).
function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetch(TMDB_API + "/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !(j.title || j.name)) return null;
      var d = j.release_date || j.first_air_date || "";
      var meta = {
        title: j.title || j.name,
        year: d ? parseInt(d.slice(0, 4), 10) : null,
        imdbId: j.imdb_id || null,
        names: []
      };
      var seen = {};
      [j.title || j.name, j.original_title || j.original_name].forEach(function (n) {
        if (n && !seen[n]) { seen[n] = true; meta.names.push(n); }
      });
      var imdbP = Promise.resolve(null);
      if (mediaType === "tv") {
        imdbP = fetch(TMDB_API + "/tv/" + tmdbId + "/external_ids?api_key=" + TMDB_KEY)
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (e) { return (e && e.imdb_id) || null; })
          .catch(function () { return null; });
      }
      return Promise.all([imdbP, tmdbAltTitles(tmdbId, mediaType)]).then(function (parts) {
        if (parts[0]) meta.imdbId = parts[0];
        meta.aliases = parts[1] || [];
        return meta;
      });
    })
    .catch(function () { return null; });
}

// ---------- Site search through the exact gate ----------
function searchWatchUrl(name, meta, isTv) {
  return getJson(BASE_URL + "/api/search/multi?query=" + encodeURIComponent(name), apiHeaders())
    .then(function (d) {
      var res = (d.results || []).filter(function (r) { return r && r.url && (r.media_type === "tv") === isTv; });
      var tol = isTv ? 2 : 1;
      for (var i = 0; i < res.length; i++) {
        var r = res[i];
        var t = r.title || r.name || "";
        if (!titlesEqual(t, name)) continue;
        if (meta.year) {
          var ry = rowYear(r);
          if (ry && Math.abs(ry - meta.year) > tol) continue;
        }
        return r.url;
      }
      return null;
    })
    .catch(function () { return null; });
}
function findWatchUrl(meta, isTv) {
  var queue = (meta.names || []).concat(meta.aliases || []);
  var chain = Promise.resolve(null);
  queue.forEach(function (name) {
    chain = chain.then(function (found) {
      if (found) return found;
      return searchWatchUrl(name, meta, isTv);
    });
  });
  return chain;
}

// ---------- Resolve ----------
function isArabicSub(s) {
  var code = String(s.lang || "").toLowerCase();
  var label = String(s.label || "");
  return code === "ar" || code === "ara" || /arab/i.test(label) || label.indexOf("عرب") !== -1;
}
function normalizeQuality(raw) {
  var s = String(raw || "").toLowerCase();
  if (s.indexOf("2160") !== -1 || s.indexOf("4k") !== -1) return { label: "2160p", rank: 4 };
  if (s.indexOf("1080") !== -1 || s.indexOf("full hd") !== -1) return { label: "1080p", rank: 3 };
  if (s.indexOf("720") !== -1 || s.indexOf(" hd") !== -1) return { label: "720p", rank: 2 };
  if (s.indexOf("480") !== -1) return { label: "480p", rank: 1 };
  return { label: "Auto", rank: 0 };
}
function resolveRaw(src, headers, ticket) {
  var attempts = 0;
  var tryOnce = function () {
    attempts++;
    return getText(BASE_URL + "/api/player/resolve?src=" + encodeURIComponent(src), headers)
      .then(function (body) {
        var r = JSON.parse(decryptPayload(body, ticket));
        if (r && r.url) return r;
        throw new Error("no url");
      })
      .catch(function (e) {
        // No timers in the guest: retry immediately once; the chain-retry
        // postlude spaces whole-chain re-runs.
        if (attempts < 2) return tryOnce();
        return null;
      });
  };
  return tryOnce();
}
function resolveServer(server, index, headers, ticket, ctx) {
  var src = server && server.source_url;
  if (!src) return Promise.resolve(null);
  return resolveRaw(src, headers, ticket).then(function (r) {
    if (!r) return null;
    var subtitles = [];
    var subs = r.subtitles || [];
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i];
      if (!s || !s.url || !isArabicSub(s)) continue;
      subtitles.push({ url: s.url, language: "Arabic", name: "Arabic" });
    }
    var label = server.label || ("Server " + (index + 1));
    var quality = normalizeQuality(server.quality || r.quality);
    var body = formatStreamSize({
      source: "BingeBang",
      title: ctx && ctx.title,
      year: ctx && ctx.year,
      season: ctx && ctx.season,
      episode: ctx && ctx.episode,
      quality: quality.label,
      server: label,
      subtitles: subtitles,
      url: r.url
    });
    return {
      name: "BingeBang",
      title: "BingeBang",
      size: body,
      url: r.url,
      quality: quality.label,
      headers: { Referer: BASE_URL + "/", "User-Agent": USER_AGENT },
      subtitles: subtitles
    };
  }).catch(function () { return null; });
}

// v4 stream formatter: heading = provider name, multi-line body in the
// `size` field (title/year, season/episode, quality, server, subtitles).
// Only fields that exist are shown.
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

// ---------- Subtitle addon (Infinite Streams Subtitles, Cloudflare Worker) ----------
// Secret gist holding the user's tokens (same file the showbox/gramcinema
// tokens live in). SCRAPER_SETTINGS always wins; the gist is only read when
// a key is missing from settings. The keys are never in the repo.
var TOKEN_FILE_URL = "https://gist.githubusercontent.com/rareanimeaddon-blip/6fc363ac74cb8921d61c07a2c6bb59d6/raw/gistfile1.txt";
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
  return "";
}
function getSubdlKeys(cfg) {
  var k1 = _setting(cfg, "subdlApiKey");
  var k2 = _setting(cfg, "subdlApiKey2");
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
  var k1 = _setting(cfg, "wyzieApiKey");
  var k2 = _setting(cfg, "wyzieApiKey2");
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
// The provider asks the addon for this title's subtitles instead of
// calling SubDL/Wyzie/mirror directly. The addon returns its ranked list
// (Sunsync pre-synced first, then SubDL, Wyzie, mirror); the provider
// picks the best match per row with the existing token scorer, so each
// stream carries the subtitle that fits its own release. Pure-JS base64url
// (no Buffer/btoa in the TV guest); keys are ASCII so one char = one byte.
var ADDON_BASE = "https://infinite-subtitles.teghvirsingh-work.workers.dev";
function b64urlEncodeAscii(str) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  for (var i = 0; i < str.length; i += 3) {
    var c1 = str.charCodeAt(i) & 255;
    var c2 = (i + 1 < str.length) ? str.charCodeAt(i + 1) & 255 : NaN;
    var c3 = (i + 2 < str.length) ? str.charCodeAt(i + 2) & 255 : NaN;
    var n = (c1 << 16) | ((isNaN(c2) ? 0 : c2) << 8) | (isNaN(c3) ? 0 : c3);
    out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63] + (isNaN(c2) ? "=" : chars[(n >>> 6) & 63]) + (isNaN(c3) ? "=" : chars[n & 63]);
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function addonConfigStr(sdKeys, wzKeys) {
  var o = {};
  if (sdKeys && sdKeys[0]) o.s = sdKeys[0];
  if (sdKeys && sdKeys[1] && sdKeys[1] !== sdKeys[0]) o.s2 = sdKeys[1];
  if (wzKeys && wzKeys[0]) o.w = wzKeys[0];
  if (wzKeys && wzKeys[1] && wzKeys[1] !== wzKeys[0]) o.w2 = wzKeys[1];
  var has = o.s || o.s2 || o.w || o.w2;
  if (!has) return "";
  return b64urlEncodeAscii(JSON.stringify(o));
}
// One addon call per title; returns the addon's ranked English subtitles
// as {id, url, release} for the per-row matcher. [] on any failure.
function addonSubs(imdbId, isSeries, season, episode, cfg) {
  return Promise.all([getSubdlKeys(cfg), getWyzieKeys(cfg)]).then(function (ks) {
    var cfgStr = addonConfigStr(ks[0], ks[1]);
    var path = isSeries
      ? "/subtitles/series/" + imdbId + ":" + season + ":" + episode + ".json"
      : "/subtitles/movie/" + imdbId + ".json";
    var url = ADDON_BASE + (cfgStr ? "/" + cfgStr : "") + path;
    return fetch(url).then(function (r) {
      if (!r.ok) return [];
      return r.json();
    }).then(function (j) {
      var list = (j && j.subtitles) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        var lang = String(it.lang || "").toLowerCase();
        if (lang !== "en" && lang !== "eng") continue;
        var u2 = it.url || "";
        if (u2.indexOf("https://") !== 0) continue;
        var rel = it.movieReleaseName || it.subtitleFileName || "";
        if (!rel) continue;
        out.push({ id: it.id, url: u2, release: rel });
      }
      return out;
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}
function osTokens(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(function (t) { return t.length > 0; });
}
function osGroup(name) {
  var s = String(name || "");
  // Last parenthesised chunk that is NOT just a year (e.g. "(2026)") — the
  // year is not a release group, and treating it as one makes every
  // same-year release "match" (+4). Skip pure years / pure numbers.
  var groups = s.match(/\(([^)]+)\)/g) || [];
  for (var gi = groups.length - 1; gi >= 0; gi--) {
    var g = groups[gi].replace(/[()]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s*4khdhub\s*$/, "").trim();
    if (!g) continue;
    if (/^\d{4}$/.test(g) || /^\d+$/.test(g)) continue;
    return g;
  }
  var m = s.match(/[-.]([A-Za-z][A-Za-z0-9]{1,})\s*$/);
  if (m) return m[1].toLowerCase();
  return "";
}
function osReleaseFeatures(name) {
  var toks = osTokens(name);
  var set = {};
  for (var i = 0; i < toks.length; i++) set[toks[i]] = true;
  var squashed = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  var source = "";
  if (squashed.indexOf("bluray") !== -1) source = "bluray";
  else if (squashed.indexOf("webdl") !== -1) source = "webdl";
  else if (squashed.indexOf("webrip") !== -1) source = "webrip";
  else if (squashed.indexOf("hdtv") !== -1) source = "hdtv";
  else if (squashed.indexOf("dvdrip") !== -1) source = "dvdrip";
  else if (set["ts"] || set["telesync"]) source = "ts";
  return {
    group: osGroup(name),
    source: source,
    res: set["2160p"] ? "2160p" : set["1080p"] ? "1080p" : set["720p"] ? "720p" : set["480p"] ? "480p" : "",
    codec: (set["x265"] || set["hevc"] || squashed.indexOf("h265") !== -1) ? "hevc" : (set["x264"] || set["avc"] || squashed.indexOf("h264") !== -1) ? "avc" : "",
    imax: !!set["imax"],
    remux: !!set["remux"]
  };
}
function osScore(fileF, subF) {
  var s = 0;
  if (fileF.group && subF.group && fileF.group === subF.group) s += 4;
  else if (fileF.group && subF.group) {
    var fg = fileF.group.split(" "), sg = subF.group.split(" ");
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
  // per title; the best subtitle for each row's own release is attached
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
        var rel = rows[i]._releaseTitle || "";
        if (!rel && rows[i].url) {
          try { rel = decodeURIComponent(String(rows[i].url).split("/").pop() || "").replace(/.[^.]+$/, ""); } catch (e) {}
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
          // No release fit at all. The addon only returns subtitles for
          // THIS title, so the top-ranked non-Sunsync one is the right
          // movie — attach it, unless the row is a CAM/TS, where no
          // proper-release subtitle can match the recording's timing.
          var rl = (rows[i]._rel || "").toLowerCase();
          if (rl.indexOf("cam") === -1 && rl.indexOf("ts") === -1) {
            for (var k = 0; k < adSubs.length; k++) {
              var cand = adSubs[k];
              var cid = String(cand.id || "").toLowerCase();
              var crel = String(cand.release || "").toLowerCase();
              if (cid.indexOf("sunsync") === -1 && crel.indexOf("sunsync") === -1) { hit = cand; break; }
            }
          }
        }
        if (hit) rows[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: "en" }];
      }
      return cleanup();
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

// ---------- getStreams ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (!/^\d+$/.test(String(tmdbId))) return [];
    var isTv = mediaType === "tv";
    if (isTv && (season == null || episode == null)) return [];
    var meta = await tmdbMeta(tmdbId, mediaType);
    if (!meta) return [];
    var watch = await findWatchUrl(meta, isTv);
    if (!watch) return [];
    var playBase = absUrl(watch).replace("/watch/", "/play/");
    var playUrl = isTv ? playBase + "/" + season + "/" + episode : playBase;
    var html = await getText(playUrl, pageHeaders());
    var cfg = decryptXorBlock(html);
    var tm = cfg && /ticket:\s*"([^"]+)"/.exec(cfg);
    if (!tm) return [];
    var ticket = tm[1];
    var headers = playerHeaders(playUrl, ticket);
    var body = await getText(BASE_URL + "/api/player/sources", headers);
    var servers = [];
    try { servers = JSON.parse(decryptPayload(body, ticket)).servers || []; } catch (e) { return []; }
    if (!servers.length) return [];
    var ctx = {
      title: meta.title || "",
      year: meta.year || null,
      season: isTv ? season : undefined,
      episode: isTv ? episode : undefined
    };
    var list = await Promise.all(servers.map(function (sv, i) { return resolveServer(sv, i, headers, ticket, ctx); }));
    var seen = {};
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!v || !v.url || seen[v.url]) continue;
      seen[v.url] = true;
      rows.push(v);
    }
    if (!rows.length) return [];
    var title = meta.title || "";
    for (var j = 0; j < rows.length; j++) {
      // No filename on these rows, so release = title + quality.
      if (!rows[j]._releaseTitle) rows[j]._releaseTitle = (title ? title + " " : "") + (rows[j].quality || "");
    }
    if (meta.imdbId) {
      var settings = (typeof SCRAPER_SETTINGS !== "undefined" && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS : {};
      return osAttachSubtitles(rows, meta.imdbId, isTv, isTv ? season : undefined, isTv ? episode : undefined, {
        osSubtitles: settings.osSubtitles,
        subdlApiKey: settings.subdlApiKey,
        subdlApiKey2: settings.subdlApiKey2,
        wyzieApiKey: settings.wyzieApiKey,
        wyzieApiKey2: settings.wyzieApiKey2,
        year: meta.year || 0
      });
    }
    for (var k = 0; k < rows.length; k++) { try { delete rows[k]._releaseTitle; } catch (e) {} }
    return rows;
  } catch (e) {
    return [];
  }
}

try { if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams; } catch (e) {}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };

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
