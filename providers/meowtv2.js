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

/* MeowTV (meowtv.ru) — REBUILT FROM SCRATCH (meowtv2, v1.0.0, 2026-11-28).
   Flow: Altcha PoW (pure-JS SHA-256) -> POST /streams/ticket (single-use
   ticket, header x-stream-ticket) -> GET /streams/movie|tv/{tmdb}?s={server}
   -> {n, d} -> pure-JS deobfuscate (NO WebAssembly; the TV guest has none).
   Decryption (reversed from the live site's own code, 2026-11-28, verified
   8/8 on live samples): key = SHA-256(K0 || UTF8(nonce)), K0 is the baked
   32-byte string below; plain[i] = base64decode(d)[i] XOR key[i % 32].
   Live servers (from the site's own bundle): peak (movieOnly), dcloud,
   acme, tik, hindi, english. Febbox is user-token-gated and skipped.
   The ?list=1 endpoint is tried first (one ticket returns every language
   for a server); the single-stream endpoint is the fallback. The site has
   a decoy path (decoy.invalid URLs) — those rows are skipped. One row per
   server, so every working server shows. No timers, no TextEncoder/
   TextDecoder, no WebCrypto, no atob/btoa in the guest. This version
   carries no subtitle attach yet (streams first); that is a follow-up. */
var MEOW_API = "https://api.meowtv.ru";
var MEOW_UA = "Mozilla/5.0 (Linux; Android 14; CPH2585) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
var MEOW_SERVERS = [
  { id: "peak",    label: "Peak",    movieOnly: true },
  { id: "dcloud",  label: "Dcloud" },
  { id: "acme",    label: "Acme" },
  { id: "tik",     label: "Tik" },
  { id: "hindi",   label: "Hindi" },
  { id: "english", label: "English" }
];

// ---- Pure-JS deobfuscate (meowtv_pure.js, verbatim) ----
// MeowTV pure-JS deobfuscate — NO WebAssembly, NO TextEncoder/TextDecoder,
// NO Buffer, NO atob, NO crypto.subtle. Plain ES5-ish JS for the Nuvio TV guest.
//
// Algorithm (reversed from the live site's own code, s-core-BZTY3g96.js +
// the WASM it loads; cross-checked against the Oct 2026 baked binary):
//   K0  = "10eE3wyyhkF38rwLFwisRYgwP2bbTL_Y"   (32 ASCII bytes, baked in the WASM
//         as three 32-byte constants A,B,C with K0[i] = A[i]^B[i]^C[i])
//   key = SHA-256( K0 || UTF8(nonce) )          (48-byte input, 32-byte digest)
//   plain[i] = base64decode(d)[i] XOR key[i % 32]
//   plaintext = UTF8-decode(plain)
// The API returns {n: 16-char hex nonce, d: base64 ciphertext}; the plaintext
// is JSON like {"url":"...","language":"..."}.

var MEOW_K0_STR = "10eE3wyyhkF38rwLFwisRYgwP2bbTL_Y";

function meowUtf8Encode(str) {
  str = String(str == null ? "" : str);
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var cp = str.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      var lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00); i++; }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}
function meowUtf8Decode(bytes) {
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
var MEOW_B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function meowB64Decode(str) {
  str = String(str || "").replace(/[^A-Za-z0-9+/=]/g, "");
  var out = [], i = 0;
  function val(ch) { return ch === "=" ? 0 : MEOW_B64_ALPHABET.indexOf(ch); }
  while (i + 3 < str.length + 1 && i < str.length) {
    var c0 = val(str.charAt(i)), c1 = val(str.charAt(i + 1)), c2 = val(str.charAt(i + 2)), c3 = val(str.charAt(i + 3));
    if (isNaN(c0) || isNaN(c1)) break;
    var triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out.push((triple >> 16) & 0xff);
    if (str.charAt(i + 2) !== "=") out.push((triple >> 8) & 0xff);
    if (str.charAt(i + 3) !== "=") out.push(triple & 0xff);
    i += 4;
  }
  return out;
}

// SHA-256 (returns 32-byte array). Same algorithm as test/tvcompat-block.js
// sha256BytesPure, rewritten for plain arrays.
var MEOW_SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function meowSha256Bytes(inputBytes) {
  var K = MEOW_SHA256_K;
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  function rr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  var msg = inputBytes.slice();
  var bitLen = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  var hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
  msg.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
           (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  var w = new Array(64);
  for (var off = 0; off < msg.length; off += 64) {
    var t;
    for (t = 0; t < 16; t++) w[t] = ((msg[off + 4 * t] << 24) | (msg[off + 4 * t + 1] << 16) | (msg[off + 4 * t + 2] << 8) | msg[off + 4 * t + 3]) >>> 0;
    for (t = 16; t < 64; t++) {
      var s0 = (rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      var s1 = (rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (t = 0; t < 64; t++) {
      var S1 = (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      var S0 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      var temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  var out = [];
  for (var i = 0; i < 8; i++) {
    out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
  }
  return out;
}

// The deobfuscate replacement: nonce (16-char hex string), data (base64 string).
// Returns the plaintext string (JSON).
function meowDeobfuscate(nonce, data) {
  var k0 = meowUtf8Encode(MEOW_K0_STR);          // 32 bytes
  var nb = meowUtf8Encode(nonce);                // 16 bytes
  var key = meowSha256Bytes(k0.concat(nb));      // 32-byte digest
  var ct = meowB64Decode(data);
  var pt = [];
  for (var i = 0; i < ct.length; i++) pt.push(ct[i] ^ key[i % 32]);
  return meowUtf8Decode(pt);
}

// ---- Altcha PoW (pure JS; reuses the SHA-256 above) ----
function meowSha256Hex(str) {
  var b = meowSha256Bytes(meowUtf8Encode(str));
  var hex = "0123456789abcdef", out = "";
  for (var i = 0; i < b.length; i++) out += hex[(b[i] >>> 4) & 15] + hex[b[i] & 15];
  return out;
}
function meowB64Encode(str) {
  var out = "";
  for (var i = 0; i < str.length; i += 3) {
    var c1 = str.charCodeAt(i) & 255;
    var c2 = (i + 1 < str.length) ? str.charCodeAt(i + 1) & 255 : NaN;
    var c3 = (i + 2 < str.length) ? str.charCodeAt(i + 2) & 255 : NaN;
    var n = (c1 << 16) | ((isNaN(c2) ? 0 : c2) << 8) | (isNaN(c3) ? 0 : c3);
    out += MEOW_B64_ALPHABET[(n >>> 18) & 63] + MEOW_B64_ALPHABET[(n >>> 12) & 63]
      + (isNaN(c2) ? "=" : MEOW_B64_ALPHABET[(n >>> 6) & 63])
      + (isNaN(c3) ? "=" : MEOW_B64_ALPHABET[n & 63]);
  }
  return out;
}
function solveAltcha(c) {
  for (var n = 0; n <= c.maxnumber; n++) {
    if (meowSha256Hex(c.salt + n.toString()) === c.challenge) {
      return meowB64Encode(JSON.stringify({
        algorithm: c.algorithm,
        challenge: c.challenge,
        number: n,
        salt: c.salt,
        signature: c.signature
      }));
    }
  }
  throw new Error("MeowTV: failed to solve altcha");
}
function meowHeaders(extra) {
  var h = { "User-Agent": MEOW_UA, "Origin": "https://meowtv.ru", "Referer": "https://meowtv.ru/" };
  if (extra) { for (var k in extra) h[k] = extra[k]; }
  return h;
}
function getTicket() {
  return fetch(MEOW_API + "/altcha/challenge", { headers: meowHeaders() }).then(function (r) {
    if (!r.ok) throw new Error("MeowTV: altcha challenge failed (" + r.status + ")");
    return r.json();
  }).then(function (ch) {
    var altcha = solveAltcha(ch);
    return fetch(MEOW_API + "/streams/ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": MEOW_UA, "Origin": "https://meowtv.ru", "Referer": "https://meowtv.ru/" },
      body: JSON.stringify({ altcha: altcha })
    });
  }).then(function (r) {
    if (!r.ok) throw new Error("MeowTV: ticket fetch failed (" + r.status + ")");
    return r.json();
  }).then(function (j) { return j.ticket; });
}
function meowDecrypt(enc) {
  if (!enc || !enc.n || !enc.d) return null;
  try { return JSON.parse(meowDeobfuscate(enc.n, enc.d)); } catch (e) { return null; }
}
function meowStreamUrl(type, tmdbId, serverId, season, episode, ticket, list) {
  var path = type === "movie"
    ? "/streams/movie/" + tmdbId + "?s=" + encodeURIComponent(serverId)
    : "/streams/tv/" + tmdbId + "/" + season + "/" + episode + "?s=" + encodeURIComponent(serverId);
  if (list) path += "&list=1";
  return fetch(MEOW_API + path, {
    headers: meowHeaders({ "Referer": "https://meowtv.ru/play/" + type + "/" + tmdbId, "x-stream-ticket": ticket })
  }).then(function (r) {
    if (!r.ok) return null;
    return r.json();
  }).then(meowDecrypt).catch(function () { return null; });
}

// ---- Helpers ----
function normalizeMeowLanguage(raw) {
  var l = (raw || "").toLowerCase().trim();
  if (!l || l === "auto" || l === "multi" || l === "multi audio" || l === "multiple" || l === "mul") return "Multi Audio";
  if (l === "dual" || l === "dual audio") return "Dual Audio";
  if (l === "hindi" || l === "hi") return "Hindi";
  if (l === "english" || l === "en") return "English";
  if (l === "tamil" || l === "ta") return "Tamil";
  if (l === "telugu" || l === "te") return "Telugu";
  if (l === "japanese" || l === "ja") return "Japanese";
  if (l === "korean" || l === "ko") return "Korean";
  if (l === "bengali" || l === "bn") return "Bengali";
  if (l === "arabic" || l === "ar") return "Arabic";
  if (l === "chinese" || l === "zh") return "Chinese";
  if (l === "original" || l === "original audio") return "Original Audio";
  var r0 = raw || "";
  return r0.charAt(0).toUpperCase() + r0.slice(1);
}
function qualityFromUrl(url) {
  var u = (url || "").toLowerCase().split("?")[0];
  if (/\b(2160|4k)\b/.test(u)) return "2160p";
  if (/\b1080\b/.test(u)) return "1080p";
  if (/\b720\b/.test(u)) return "720p";
  if (/\b480\b/.test(u)) return "480p";
  if (/\b360\b/.test(u)) return "360p";
  return "Unknown";
}
var URL_TITLE_FILLER = {
  "season": 1, "complete": 1, "hindi": 1, "english": 1, "dubbed": 1, "part": 1,
  "web": 1, "hd": 1, "series": 1, "download": 1, "full": 1, "episodes": 1,
  "special": 1, "episode": 1, "collection": 1, "remastered": 1, "extended": 1,
  "edition": 1, "version": 1, "theatrical": 1, "directors": 1, "cut": 1
};
function urlTitleMismatch(url, requestedTitle) {
  var pathParts = ((url || "").split("?")[0]).split("/").filter(function (p) { return !!p; });
  var titleSlug = null;
  for (var i = 1; i < pathParts.length; i++) {
    if (/^[Ss]\d{2}[Ee]\d{2}/.test(pathParts[i])) { titleSlug = pathParts[i - 1] || null; break; }
  }
  if (!titleSlug) return false;
  function tokenise(s) {
    return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._\-+]/g, " ")
      .toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
      .filter(function (w) { return w.length >= 4; });
  }
  var reqWords = {};
  tokenise(requestedTitle).forEach(function (w) { reqWords[w] = 1; });
  var slugWords = tokenise(titleSlug);
  var reqCount = Object.keys(reqWords).length;
  if (slugWords.length === 0 || reqCount === 0) return false;
  for (var k in reqWords) {
    if (slugWords.indexOf(k) === -1) return true;
  }
  for (var j = 0; j < slugWords.length; j++) {
    if (!reqWords[slugWords[j]] && !URL_TITLE_FILLER[slugWords[j]]) return true;
  }
  return false;
}
function meowTmdbMeta(tmdbId, type) {
  var key = "";
  try { key = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : ""; } catch (e) {}
  if (!key) return Promise.resolve(null);
  var seg = type === "tv" ? "tv" : "movie";
  return fetch("https://api.themoviedb.org/3/" + seg + "/" + tmdbId + "?api_key=" + key, { headers: { "User-Agent": MEOW_UA } }).then(function (r) {
    return r.ok ? r.json() : null;
  }).then(function (d) {
    if (!d || !d.id) return null;
    var date = d.release_date || d.first_air_date || "";
    return { title: d.title || d.name || "", year: date ? parseInt(date.slice(0, 4), 10) || 0 : 0 };
  }).catch(function () { return null; });
}
function meowValidRow(data, title) {
  if (!data || !data.url) return null;
  var url = String(data.url);
  if (url.indexOf("http") !== 0) return null;
  if (url.indexOf("decoy.invalid") !== -1) return null;
  if (title && urlTitleMismatch(url, title)) return null;
  return data;
}
function meowRow(mediaTitle, year, seasonNum, episodeNum, srv, data) {
  var lang = normalizeMeowLanguage(data.language);
  var q = qualityFromUrl(data.url);
  var sz = formatStreamSize({ source: "MeowTV", title: mediaTitle, year: year, quality: q, season: seasonNum, episode: episodeNum, server: srv.label, audio: lang, url: data.url });
  return { name: "MeowTV", title: "MeowTV", size: sz, url: data.url, quality: q, type: "direct", headers: { "Referer": "https://meowtv.ru/", "Origin": "https://meowtv.ru" } };
}
function meowFetchServer(type, tmdbId, srv, season, episode, title, mediaTitle, year) {
  var seas = type === "tv" ? season : undefined, ep = type === "tv" ? episode : undefined;
  // One ticket + one list call per server; fall back to the single-stream
  // endpoint (fresh ticket) if the list gives no valid row.
  return getTicket().then(function (ticket) {
    return meowStreamUrl(type, tmdbId, srv.id, season, episode, ticket, true);
  }).then(function (data) {
    var rows = (data && data.streams) || (data && data.url ? [data] : []);
    for (var i = 0; i < rows.length; i++) {
      var v = meowValidRow(rows[i], title);
      if (v) return meowRow(mediaTitle, year, seas, ep, srv, v);
    }
    return getTicket().then(function (ticket2) {
      return meowStreamUrl(type, tmdbId, srv.id, season, episode, ticket2, false);
    }).then(function (single) {
      var v2 = meowValidRow(single, title);
      if (!v2) return null;
      return meowRow(mediaTitle, year, seas, ep, srv, v2);
    });
  }).catch(function () { return null; });
}

// ---- Main ----
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var id = parseInt(tmdbId, 10);
  if (!id) return Promise.resolve([]);
  if (type === "tv" && (!seasonNum || !episodeNum)) return Promise.resolve([]);
  var servers = MEOW_SERVERS.filter(function (s) { return !(s.movieOnly && type === "tv"); });
  return meowTmdbMeta(id, type).then(function (meta) {
    var title = meta && meta.title ? meta.title : null;
    var mediaTitle = title || "";
    var year = meta && meta.year ? meta.year : 0;
    return Promise.all(servers.map(function (srv) {
      return meowFetchServer(type, id, srv, seasonNum, episodeNum, title, mediaTitle, year);
    })).then(function (rows) {
      var out = [];
      for (var i = 0; i < rows.length; i++) if (rows[i]) out.push(rows[i]);
      return out;
    });
  }).catch(function (e) {
    console.log("[MeowTV] error: " + (e && e.message ? e.message : e));
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.MeowTVScraperModule = { getStreams: getStreams };
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
