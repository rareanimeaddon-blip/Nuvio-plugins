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

// ---------- AES core (tables generated at load) ----------
function _gfMul(a, b) {
  var p = 0;
  for (var i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    var hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}
var _SBOX = [], _INV_SBOX = [], _M9 = [], _M11 = [], _M13 = [], _M14 = [];
(function _buildAesTables() {
  var inv = new Array(256).fill(0), a, b, i;
  for (a = 1; a < 256; a++) for (b = 1; b < 256; b++) if (_gfMul(a, b) === 1) { inv[a] = b; break; }
  function rotl(x, n) { return ((x << n) | (x >> (8 - n))) & 0xff; }
  for (i = 0; i < 256; i++) {
    var s = inv[i] ^ rotl(inv[i], 1) ^ rotl(inv[i], 2) ^ rotl(inv[i], 3) ^ rotl(inv[i], 4) ^ 0x63;
    _SBOX[i] = s; _INV_SBOX[s] = i;
    _M9[i] = _gfMul(i, 9); _M11[i] = _gfMul(i, 11); _M13[i] = _gfMul(i, 13); _M14[i] = _gfMul(i, 14);
  }
})();
function _expandKey(keyBytes) {
  var Nk = keyBytes.length / 4, Nr = Nk + 6, w = [], i;
  for (i = 0; i < keyBytes.length; i++) w[i] = keyBytes[i];
  var rcon = 1;
  for (var j = Nk; j < 4 * (Nr + 1); j++) {
    var temp = [w[4 * (j - 1)], w[4 * (j - 1) + 1], w[4 * (j - 1) + 2], w[4 * (j - 1) + 3]];
    if (j % Nk === 0) {
      temp = [_SBOX[temp[1]] ^ rcon, _SBOX[temp[2]], _SBOX[temp[3]], _SBOX[temp[0]]];
      rcon = _gfMul(rcon, 2);
    } else if (Nk > 6 && j % Nk === 4) {
      temp = [_SBOX[temp[0]], _SBOX[temp[1]], _SBOX[temp[2]], _SBOX[temp[3]]];
    }
    for (var t = 0; t < 4; t++) w[4 * j + t] = w[4 * (j - Nk) + t] ^ temp[t];
  }
  return { w: w, Nr: Nr };
}
function _encBlock(rk, input, offset) {
  var w = rk.w, Nr = rk.Nr, s = new Array(16), i, r, c;
  for (i = 0; i < 16; i++) s[i] = input[offset + i] ^ w[i];
  for (r = 1; r < Nr; r++) {
    var t = new Array(16);
    for (c = 0; c < 4; c++) for (var row = 0; row < 4; row++) t[c * 4 + row] = _SBOX[s[((c + row) % 4) * 4 + row]];
    for (c = 0; c < 4; c++) {
      var a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3];
      s[c * 4] = _gfMul(a0, 2) ^ _gfMul(a1, 3) ^ a2 ^ a3 ^ w[16 * r + c * 4];
      s[c * 4 + 1] = a0 ^ _gfMul(a1, 2) ^ _gfMul(a2, 3) ^ a3 ^ w[16 * r + c * 4 + 1];
      s[c * 4 + 2] = a0 ^ a1 ^ _gfMul(a2, 2) ^ _gfMul(a3, 3) ^ w[16 * r + c * 4 + 2];
      s[c * 4 + 3] = _gfMul(a0, 3) ^ a1 ^ a2 ^ _gfMul(a3, 2) ^ w[16 * r + c * 4 + 3];
    }
  }
  var out = new Array(16);
  for (c = 0; c < 4; c++) for (var row2 = 0; row2 < 4; row2++) out[c * 4 + row2] = _SBOX[s[((c + row2) % 4) * 4 + row2]] ^ w[16 * Nr + c * 4 + row2];
  return out;
}
function _decBlock(rk, input, offset) {
  var w = rk.w, Nr = rk.Nr, s = new Array(16), i, r, c;
  for (i = 0; i < 16; i++) s[i] = input[offset + i] ^ w[16 * Nr + i];
  for (r = Nr - 1; r >= 1; r--) {
    var t = new Array(16);
    for (c = 0; c < 4; c++) for (var row = 0; row < 4; row++) t[c * 4 + row] = _INV_SBOX[s[((c - row + 4) % 4) * 4 + row]];
    for (i = 0; i < 16; i++) s[i] = t[i] ^ w[16 * r + i];
    for (c = 0; c < 4; c++) {
      var a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
      s[c * 4] = _M14[a0] ^ _M11[a1] ^ _M13[a2] ^ _M9[a3];
      s[c * 4 + 1] = _M9[a0] ^ _M14[a1] ^ _M11[a2] ^ _M13[a3];
      s[c * 4 + 2] = _M13[a0] ^ _M9[a1] ^ _M14[a2] ^ _M11[a3];
      s[c * 4 + 3] = _M11[a0] ^ _M13[a1] ^ _M9[a2] ^ _M14[a3];
    }
  }
  var out = new Array(16);
  for (c = 0; c < 4; c++) for (var row2 = 0; row2 < 4; row2++) out[c * 4 + row2] = _INV_SBOX[s[((c - row2 + 4) % 4) * 4 + row2]] ^ w[c * 4 + row2];
  return out;
}
function _toArr(u8) { var a = []; for (var i = 0; i < u8.length; i++) a.push(u8[i]); return a; }
function _toU8(arr) { return new Uint8Array(arr); }
// AES-CBC decrypt (PKCS#7 unpad). keyBytes/ivBytes/cipherBytes: Uint8Array. Returns Uint8Array.
function aesCbcDecryptBytes(keyBytes, ivBytes, cipherBytes) {
  var rk = _expandKey(_toArr(keyBytes));
  var out = [], prev = _toArr(ivBytes), i, k;
  for (var off = 0; off + 16 <= cipherBytes.length; off += 16) {
    var block = _decBlock(rk, cipherBytes, off);
    for (k = 0; k < 16; k++) out.push(block[k] ^ prev[k]);
    prev = _toArr(cipherBytes.subarray ? cipherBytes.subarray(off, off + 16) : cipherBytes.slice(off, off + 16));
  }
  if (out.length) {
    var pad = out[out.length - 1];
    if (pad >= 1 && pad <= 16) out = out.slice(0, out.length - pad);
  }
  return _toU8(out);
}

// ---------- SHA-256 (returns Uint8Array(32)) ----------
function sha256BytesPure(inputBytes) {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  function rr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  var msg = Array.prototype.slice.call(inputBytes);
  var bitLen = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  // 64-bit length (inputs here are small; high 32 bits handled properly anyway)
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
  var out = new Uint8Array(32);
  for (var i = 0; i < 8; i++) {
    out[4 * i] = (H[i] >>> 24) & 255; out[4 * i + 1] = (H[i] >>> 16) & 255;
    out[4 * i + 2] = (H[i] >>> 8) & 255; out[4 * i + 3] = H[i] & 255;
  }
  return out;
}

// ---------- AES-GCM decrypt (12-byte IV, tag appended or separate, no AAD) ----------
// encrypted: Uint8Array = ciphertext || tag(16). Returns Uint8Array plaintext. Throws on bad tag.
function _ghashMul(x, y) {
  var z = new Array(16).fill(0), v = Array.prototype.slice.call(y), i, j;
  for (i = 0; i < 16; i++) {
    for (j = 7; j >= 0; j--) {
      if ((x[i] >> j) & 1) { for (var k = 0; k < 16; k++) z[k] ^= v[k]; }
      var lsb = v[15] & 1;
      for (var m = 15; m > 0; m--) v[m] = ((v[m] >>> 1) | ((v[m - 1] & 1) << 7)) & 0xff;
      v[0] = (v[0] >>> 1) & 0xff;
      if (lsb) v[0] ^= 0xe1;
    }
  }
  return z;
}
function _ghash(H, data) {
  var y = new Array(16).fill(0);
  for (var off = 0; off < data.length; off += 16) {
    for (var i = 0; i < 16; i++) y[i] ^= (data[off + i] || 0);
    y = _ghashMul(y, H);
  }
  return y;
}
function aesGcmDecryptBytes(keyBytes, ivBytes, ctAndTag) {
  if (ctAndTag.length < 16) throw new Error("gcm: too short");
  var ct = ctAndTag.subarray(0, ctAndTag.length - 16);
  var tag = ctAndTag.subarray(ctAndTag.length - 16);
  var rk = _expandKey(_toArr(keyBytes));
  var H = _encBlock(rk, new Array(16).fill(0), 0);
  var J0 = _toArr(ivBytes).concat([0, 0, 0, 1]);
  // GHASH over ciphertext + length block (AAD empty)
  var ghInput = _toArr(ct);
  while (ghInput.length % 16 !== 0) ghInput.push(0);
  var bitLen = ct.length * 8;
  var lenBlock = new Array(16).fill(0);
  lenBlock[11] = (bitLen >>> 24) & 255; lenBlock[12] = (bitLen >>> 16) & 255;
  lenBlock[13] = (bitLen >>> 8) & 255; lenBlock[14] = 0; lenBlock[15] = bitLen & 255;
  // length block: high 64 bits = AAD bits (0), low 64 bits = C bits
  lenBlock = new Array(16).fill(0);
  lenBlock[8] = 0; lenBlock[9] = 0; lenBlock[10] = 0; lenBlock[11] = 0;
  lenBlock[12] = (bitLen >>> 24) & 255; lenBlock[13] = (bitLen >>> 16) & 255;
  lenBlock[14] = (bitLen >>> 8) & 255; lenBlock[15] = bitLen & 255;
  var S = _ghash(H, ghInput.concat(lenBlock));
  var EJ0 = _encBlock(rk, J0, 0);
  for (var i = 0; i < 16; i++) {
    if ((S[i] ^ EJ0[i]) !== tag[i]) throw new Error("gcm: invalid tag");
  }
  // CTR decryption starting at inc32(J0)
  var counter = J0.slice();
  var out = new Uint8Array(ct.length);
  for (var off = 0; off < ct.length; off += 16) {
    // inc32
    var n = ((counter[12] << 24) | (counter[13] << 16) | (counter[14] << 8) | counter[15]) >>> 0;
    n = (n + 1) >>> 0;
    counter[12] = (n >>> 24) & 255; counter[13] = (n >>> 16) & 255; counter[14] = (n >>> 8) & 255; counter[15] = n & 255;
    var ks = _encBlock(rk, counter, 0);
    for (var j = 0; j < 16 && off + j < ct.length; j++) out[off + j] = ct[off + j] ^ ks[j];
  }
  return out;
}

// MultiMovies scraper for Nuvio — v1.0.7 core (multimovies8)
// Remade 2026-10-23 from phisher98's MultiMoviesProvider CloudStream
// plugin v55 (user-supplied .cs3, DEX-reconstructed; spec in
// test/multimovies-cs3-spec.md). The old core scraped vidly.pro, which
// the site no longer uses — playback failed. This core follows the
// site itself (domain from phisher98's domains.json), reads its server
// grid, and runs the plugin's own chains:
//   modiplay embeds   -> switchServer scrape / proxy.php + MMPacker
//   iqsmartgames /
//   filesforever      -> MMGdmirror (mymovieapi/myseriesapi ->
//                        embedhelper2 -> per-site wish/filemoon embeds
//                        -> MMPacker)
//   nxsha embeds      -> encrypted-parameter API (OpenSSL AES)
//   vidout embeds     -> Watchout2025 GitHub HLS catalogs
//   vidbolt embeds    -> VidBolt /api/resolve (proven in ZXCStream)
//   everything else   -> MMPacker, then a plain .m3u8 page scrape
// Standalone: no vidly.pro, no proxy services, no PenguPlay.
// TV rules: no timers, no TextEncoder/TextDecoder/WebCrypto reliance
// (pure-JS MD5/AES from the tvcompat block + md5Hex below).

var PROVIDER = "MultiMovies";
var MM_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
var MM_TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : "439c478a771f35c05022f9feabcca01c";
var MM_DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var MM_FALLBACK_DOMAINS = ["https://m1.multimovies.courses", "https://multimovies.garden", "https://multimovies.cloud"];
var MM_GH_API = "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/";
var _mmDomain = null;

function mmHeaders(extra) {
  var h = { "User-Agent": MM_UA, "Accept-Language": "en-US,en;q=0.9" };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}
// GET/POST text; resolves {ok, status, url, text} or null on failure.
function mmFetch(url, options) {
  options = options || {};
  var opts = { method: options.method || "GET", headers: mmHeaders(options.headers) };
  if (options.body != null) opts.body = options.body;
  return fetch(url, opts).then(function (res) {
    return res.text().then(function (text) {
      return { ok: !!res.ok, status: res.status, url: res.url || url, text: text || "" };
    }, function () { return { ok: !!res.ok, status: res.status, url: res.url || url, text: "" }; });
  }).catch(function () { return null; });
}
function mmGet(url, referer) {
  var h = referer ? { Referer: referer } : null;
  return mmFetch(url, { headers: h });
}
function mmPostForm(url, fields, referer, extraHeaders) {
  var parts = [];
  for (var k in fields) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(fields[k]));
  var h = { "Content-Type": "application/x-www-form-urlencoded" };
  if (referer) h.Referer = referer;
  if (extraHeaders) for (var k2 in extraHeaders) h[k2] = extraHeaders[k2];
  return mmFetch(url, { method: "POST", headers: h, body: parts.join("&") });
}
function deEsc(s) {
  return String(s == null ? "" : s).replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/&amp;/g, "&");
}
function hostOf(url) {
  var m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#:]+)/.exec(String(url || ""));
  return m ? m[1].toLowerCase() : "";
}
function originOf(url) {
  var m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/.exec(String(url || ""));
  return m ? (m[1].toLowerCase() + "://" + m[2]) : "";
}
function absUrl(base, value) {
  value = String(value == null ? "" : value).trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  var b = String(base || "").replace(/\/+$/, "");
  if (value.charAt(0) === "/") {
    var o = originOf(b);
    return o ? o + value : value;
  }
  return b + "/" + value;
}
function resolveRel(baseUrl, rel) {
  rel = String(rel || "").trim();
  if (!rel) return "";
  if (/^https?:\/\//i.test(rel)) return rel;
  var o = originOf(baseUrl);
  if (rel.indexOf("//") === 0) return "https:" + rel;
  if (rel.charAt(0) === "/") return o + rel;
  var path = String(baseUrl).slice(o.length);
  var dir = path.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  return o + dir + rel;
}
function rx1(re, s) { var m = re.exec(String(s || "")); return m ? m[1] : null; }
function qualityFromText(text) {
  var s = String(text || "");
  if (/\b(4k|2160p?)\b/i.test(s)) return "2160p";
  if (/\b1440p?\b/i.test(s)) return "1440p";
  if (/\b1080p?\b/i.test(s)) return "1080p";
  if (/\b720p?\b/i.test(s)) return "720p";
  if (/\b480p?\b/i.test(s)) return "480p";
  if (/\b360p?\b/i.test(s)) return "360p";
  return "HD";
}
function qualityNum(q) {
  var m = /(\d{3,4})p/.exec(String(q || ""));
  return m ? parseInt(m[1], 10) : 0;
}
function isHttp(u) { return typeof u === "string" && /^https?:\/\//i.test(u); }

function makeStream(serverLabel, url, quality, filename, ctx) {
  // filename (gofile file name) is intentionally not carried into the
  // label: the formatter's fields are title/quality/season/episode/
  // audio/subs/size/extra/server only.
  var o = { source: PROVIDER, title: ctx && ctx.meta ? ctx.meta.title : "",
    quality: quality || "HD", server: serverLabel, url: url };
  if (ctx && ctx.mediaType === "tv") { o.season = ctx.season; o.episode = ctx.episode; }
  var lbl = formatStreamLabel(o);
  return { name: lbl, title: lbl, url: url, quality: quality || "HD" };
}
function withHeaders(stream, headers) {
  stream.headers = headers;
  stream.behaviorHints = { notWebReady: true, proxyHeaders: { request: headers } };
  return stream;
}
function dedupeStreams(streams) {
  var seen = {}, out = [];
  (streams || []).forEach(function (s) {
    if (s && isHttp(s.url) && !seen[s.url]) { seen[s.url] = 1; out.push(s); }
  });
  return out;
}

// ---------------- TMDB ----------------
function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return mmFetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + MM_TMDB_KEY + "&append_to_response=external_ids")
    .then(function (r) {
      if (!r || !r.ok) return null;
      var j = null;
      try { j = JSON.parse(r.text); } catch (e) { return null; }
      if (!j) return null;
      var dateStr = j.release_date || j.first_air_date || "";
      return {
        title: j.title || j.name || "",
        year: dateStr ? parseInt(dateStr.slice(0, 4), 10) : null,
        imdb: (j.external_ids && j.external_ids.imdb_id) || j.imdb_id || "",
      };
    });
}
function tmdbAltTitles(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return mmFetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/alternative_titles?api_key=" + MM_TMDB_KEY)
    .then(function (r) {
      if (!r || !r.ok) return [];
      var j = null;
      try { j = JSON.parse(r.text); } catch (e) { return []; }
      var arr = (j && (j.results || j.titles)) || [];
      var out = [], seen = {};
      arr.forEach(function (it) {
        var t = it && typeof it.title === "string" ? it.title.trim() : "";
        if (!t) return;
        if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0e00-\u0e7f\u0590-\u05ff\u0600-\u06ff]/.test(t)) return;
        var k = t.toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        out.push(t);
      });
      out.sort(function (a, b) { return a.length - b.length; });
      return out.slice(0, 4);
    }).catch(function () { return []; });
}

// ---------------- exact-title gate (unchanged standard) ----------------
function normTitle(s) {
  // Bracketed/parenthetical edition tags are listing decoration, not
  // part of the title ("Breaking Bad (Now in Hindi)" IS Breaking Bad).
  // They are stripped from BOTH sides before the equality check, so
  // the zero-mismatch rule still applies to the title itself.
  var t = String(s || "").replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  return t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").replace(/^the /, "");
}
function isExactTitle(candidate, wanted) {
  return !!wanted && normTitle(candidate) === normTitle(wanted);
}

// ---------------- domain ----------------
function mmDomain() {
  if (_mmDomain) return Promise.resolve(_mmDomain);
  return mmFetch(MM_DOMAINS_URL).then(function (r) {
    var fromJson = null;
    if (r && r.ok) {
      try {
        var j = JSON.parse(r.text);
        if (j && typeof j.MultiMovies === "string" && isHttp(j.MultiMovies)) fromJson = j.MultiMovies.replace(/\/+$/, "");
      } catch (e) {}
    }
    var candidates = fromJson ? [fromJson].concat(MM_FALLBACK_DOMAINS) : MM_FALLBACK_DOMAINS.slice();
    var seen = {}, list = [];
    candidates.forEach(function (c) { if (!seen[c]) { seen[c] = 1; list.push(c); } });
    // Probe in order; the first host that answers the homepage wins.
    var step = function (i) {
      if (i >= list.length) { _mmDomain = list[0]; return _mmDomain; }
      return mmGet(list[i] + "/").then(function (resp) {
        if (resp && resp.status > 0 && resp.status < 500 && resp.text && resp.text.length > 200) { _mmDomain = list[i]; return _mmDomain; }
        return step(i + 1);
      });
    };
    return step(0);
  });
}

// ---------------- site search + gate ----------------
function parseSearchResults(html, domain) {
  var out = [];
  var chunks = String(html || "").split(/<article/i);
  for (var i = 1; i < chunks.length; i++) {
    var c = "<article" + chunks[i];
    var href = rx1(/href="([^"]*\/(?:movie|movies|series|tvshows)\/[^"]+)"/, c);
    if (!href) continue;
    var title = rx1(/poster-caption[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/, c)
      || rx1(/<a[^>]*class="[^"]*poster-art[^"]*"[^>]*>/, c) && rx1(/alt="([^"]+)"/, c)
      || rx1(/alt="([^"]+)"/, c)
      || rx1(/title="([^"]+)"/, c) || "";
    title = deEsc(title).replace(/\s+/g, " ").trim();
    var yearM = /\b(19|20)\d{2}\b/.exec(c.replace(/href="[^"]*"/g, ""));
    var year = yearM ? parseInt(yearM[0], 10) : null;
    out.push({ url: absUrl(domain, href), title: title, year: year });
  }
  return out;
}
function siteSearch(domain, title, year, mediaType) {
  var q = encodeURIComponent(title).replace(/%20/g, "+");
  return mmGet(domain + "/search?q=" + q, domain + "/").then(function (r) {
    if (!r || !r.ok) return null;
    var results = parseSearchResults(r.text, domain);
    for (var i = 0; i < results.length; i++) {
      var it = results[i];
      var isSeriesPage = /\/(series|tvshows)\//.test(it.url);
      if (mediaType === "tv" && !isSeriesPage && /\/(movie|movies)\//.test(it.url)) continue;
      if (mediaType === "movie" && isSeriesPage) continue;
      if (!isExactTitle(it.title, title)) continue;
      if (year && it.year) {
        if (mediaType === "tv") {
          // Series listings often carry a re-upload/dub year (the BB
          // Hindi listing says 2023 for a 2008 show); a listing cannot
          // predate the show, so only reject earlier years.
          if (it.year < year - 1) continue;
        } else if (Math.abs(it.year - year) > 1) continue;
      }
      return it;
    }
    return null;
  });
}
function findTitlePage(domain, meta, mediaType, tmdbId) {
  return siteSearch(domain, meta.title, meta.year, mediaType).then(function (hit) {
    if (hit) return hit;
    return tmdbAltTitles(tmdbId, mediaType).then(function (alts) {
      var chain = Promise.resolve(null);
      alts.forEach(function (alt) {
        chain = chain.then(function (found) {
          if (found) return found;
          return siteSearch(domain, alt, meta.year, mediaType);
        });
      });
      return chain;
    });
  });
}

// ---------------- episode picking (series pages) ----------------
function parseEpisodes(html, domain) {
  var out = [];
  var htmlS = String(html || "");
  // cinejoy cards
  var chunks = htmlS.split(/cinejoy-ep-card/);
  for (var i = 1; i < chunks.length; i++) {
    var c = chunks[i].slice(0, 4000);
    var href = rx1(/href="([^"]+)"/, c);
    if (!href) continue;
    var season = rx1(/data-season="(\d+)"/, c) || rx1(/\/season\/(\d+)/, c);
    var episode = rx1(/data-episode="(\d+)"/, c) || rx1(/\/episode\/(\d+)/, c) || rx1(/>E(\d+)</, c);
    var num = /(\d+)\s*-\s*(\d+)/.exec(rx1(/numerando[^>]*>([^<]+)</, c) || "");
    if (!season && num) season = num[1];
    if (!episode && num) episode = num[2];
    if (season && episode) out.push({ season: parseInt(season, 10), episode: parseInt(episode, 10), url: absUrl(domain, deEsc(href)) });
  }
  if (out.length) return out;
  // dooplay se-c lists
  var lis = htmlS.match(/<li[^>]*>[\s\S]*?<\/li>/g) || [];
  lis.forEach(function (li) {
    var href = rx1(/episodiotitle[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/, li) || rx1(/<a[^>]*href="([^"]+)"/, li);
    var num = /(\d+)\s*-\s*(\d+)/.exec(rx1(/numerando[^>]*>([^<]*)</, li) || "");
    if (href && num) out.push({ season: parseInt(num[1], 10), episode: parseInt(num[2], 10), url: absUrl(domain, deEsc(href)) });
  });
  return out;
}
function findEpisodePage(domain, seriesUrl, season, episode) {
  return mmGet(seriesUrl, domain + "/").then(function (r) {
    if (!r) return null;
    var eps = parseEpisodes(r.text, domain);
    for (var i = 0; i < eps.length; i++) if (eps[i].season === season && eps[i].episode === episode) return eps[i].url;
    // paged season view
    var sep = seriesUrl.indexOf("?") === -1 ? "?" : "&";
    return mmGet(seriesUrl + sep + "season=" + season, domain + "/").then(function (r2) {
      if (!r2) return null;
      var eps2 = parseEpisodes(r2.text, domain);
      for (var j = 0; j < eps2.length; j++) if (eps2[j].season === season && eps2[j].episode === episode) return eps2[j].url;
      return null;
    });
  });
}

// ---------------- JsPacker (Dean Edwards p.a.c.k.e.r) ----------------
function _baseNTok(c, a) {
  var digits = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (c < a) return digits.charAt(c);
  return _baseNTok(Math.floor(c / a), a) + digits.charAt(c % a);
}
function jsUnpack(html) {
  var m = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([^']*)'\.split\('\|'\)/.exec(String(html || ""));
  if (!m) return null;
  var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  var a = parseInt(m[2], 10), c = parseInt(m[3], 10), k = m[4].split("|");
  for (var i = c - 1; i >= 0; i--) {
    if (k[i]) {
      var tok = _baseNTok(i, a);
      p = p.replace(new RegExp("\\b" + tok + "\\b", "g"), k[i].replace(/\$/g, "$$$$"));
    }
  }
  return p;
}

// ---------------- MMPacker (packed wish-family embeds) ----------------
// Fetches the embed page, unpacks it, and emits the hls2/hls3/hls4
// masters with Referer = the embed origin, exactly as the plugin does.
function packerResolve(embedUrl, label, referer, qualityHint, ctx) {
  return mmGet(embedUrl, referer).then(function (r) {
    if (!r || !r.ok) return [];
    var unpacked = jsUnpack(r.text);
    if (!unpacked) return [];
    var origin = originOf(embedUrl);
    var out = [], seen = {};
    ["hls2", "hls3", "hls4"].forEach(function (key) {
      var v = rx1(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'), unpacked);
      if (!v) return;
      var u = deEsc(v);
      if (!/^https?:\/\//i.test(u)) u = absUrl(origin, u);
      // dash-hls-bridge.* URLs are structurally dead (proven in
      // multimovies7: the bridge 502s, its upstream lacks signing).
      if (!isHttp(u) || seen[u] || u.toLowerCase().indexOf("dash-hls-bridge.") !== -1) return;
      seen[u] = 1;
      var s = makeStream(label, u, qualityHint || qualityFromText(label), null, ctx);
      withHeaders(s, { Referer: origin, "User-Agent": MM_UA });
      out.push(s);
    });
    return out;
  }).catch(function () { return []; });
}

// ---------------- extractM3u8Links (plain page scrape) ----------------
function scrapeM3u8(embedUrl, label, referer, ctx) {
  return mmGet(embedUrl, referer).then(function (r) {
    if (!r || !r.ok) return [];
    var html = deEsc(r.text);
    var base = originOf(embedUrl) || embedUrl;
    var found = [], seen = {};
    var re1 = /https?:\/\/[^"'<>\s\\]+\.m3u8[^"'<>\s\\]*/g, m;
    while ((m = re1.exec(html)) !== null) { if (!seen[m[0]] && m[0].toLowerCase().indexOf("dash-hls-bridge.") === -1) { seen[m[0]] = 1; found.push(m[0]); } }
    var re2 = /["']([^"']+\.m3u8[^"']*)["']/g;
    while ((m = re2.exec(html)) !== null) {
      var u = absUrl(base, m[1]);
      if (isHttp(u) && !seen[u] && u.toLowerCase().indexOf("dash-hls-bridge.") === -1) { seen[u] = 1; found.push(u); }
    }
    var q = qualityFromText(label);
    return found.map(function (u) {
      var s = makeStream(label, u, q, null, ctx);
      withHeaders(s, { Referer: base, "User-Agent": MM_UA });
      return s;
    });
  }).catch(function () { return []; });
}
function genericResolve(embedUrl, label, referer, ctx) {
  return packerResolve(embedUrl, label, referer, null, ctx).then(function (streams) {
    if (streams.length) return streams;
    return scrapeM3u8(embedUrl, label, referer, ctx);
  });
}

// ---------------- modiplay ----------------
// Emits per-variant links from an already-fetched master playlist
// (the proxy.php path). Referer = the modiplay base.
function emitMaster(playlistText, playlistUrl, label, referer, ctx) {
  if (!playlistText || playlistText.indexOf("#EXTM3U") === -1) return [];
  var lines = playlistText.split("\n");
  var out = [], pendingRes = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
      var rm = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      pendingRes = rm ? { w: parseInt(rm[1], 10), h: parseInt(rm[2], 10) } : null;
    } else if (line && line.charAt(0) !== "#") {
      var u = resolveRel(playlistUrl, line);
      var q = "HD";
      if (pendingRes) {
        var hgt = pendingRes.h;
        q = hgt >= 2160 ? "2160p" : hgt >= 1440 ? "1440p" : hgt >= 720 ? "1080p" : hgt >= 480 ? "720p" : hgt >= 360 ? "480p" : "360p";
        if (pendingRes.w >= 3840) q = "2160p";
      }
      if (isHttp(u)) {
        var s = makeStream(label, u, q, null, ctx);
        withHeaders(s, { Referer: referer, "User-Agent": MM_UA });
        out.push(s);
      }
      pendingRes = null;
    }
  }
  if (!out.length && isHttp(playlistUrl)) {
    var s2 = makeStream(label, playlistUrl, qualityFromText(label), null, ctx);
    withHeaders(s2, { Referer: referer, "User-Agent": MM_UA });
    out.push(s2);
  }
  return out;
}
function modiplayProxyFile(base, platform, code, label, ctx) {
  var proxyUrl = base + "/proxy.php?p=" + platform + "&c=" + code + "&title=&site_ref=&noredirect=1";
  return mmGet(proxyUrl).then(function (r) {
    if (!r || !r.ok) return [];
    var src = rx1(/var\s+src\s*=\s*"([^"]+)"/, r.text);
    if (!src) return [];
    var absSrc = absUrl(base, deEsc(src));
    return mmGet(absSrc).then(function (pl) {
      if (!pl || !pl.ok) return [];
      return emitMaster(pl.text, absSrc, label, base, ctx);
    });
  }).catch(function () { return []; });
}
function modiplayResolve(embedUrl, label, siteReferer, ctx) {
  var origin = originOf(embedUrl);
  if (!origin) return Promise.resolve([]);
  return mmGet(embedUrl, siteReferer).then(function (r) {
    if (!r || !r.ok) return packerResolve(embedUrl, label, siteReferer, null, ctx);
    var html = r.text;
    var jobs = [];
    // spec form: switchServer('code','embed','name','platform','x')
    var seenCode = {}, sm;
    var reSw = /switchServer\('([^']+)','([^']+)','([^']*)','([^']*)','([^']*)'\)/g;
    while ((sm = reSw.exec(html)) !== null) {
      if (seenCode[sm[1]]) continue;
      seenCode[sm[1]] = 1;
      (function (code, embed, sname, platform) {
        var display = label + " • " + (sname || platform || "Server");
        var target = null;
        if (/^https?:\/\//i.test(embed)) target = deEsc(embed);
        else if (platform === "filemoon" || platform === "byse") target = "https://filemoon.sx/e/" + code;
        var job = target
          ? genericResolve(target, display, origin, ctx)
          : Promise.resolve([]);
        jobs.push(job.then(function (st) {
          if (st.length) return st;
          return modiplayProxyFile(origin, platform, code, display, ctx);
        }).catch(function () { return modiplayProxyFile(origin, platform, code, display, ctx); }));
      })(sm[1], sm[2], sm[3], sm[4]);
    }
    // live form: direct proxy.php links in the page
    var seenProxy = {}, pm;
    var rePx = /(?:https?:\/\/[^"'<>\s]+)?\/proxy\.php\?p=([a-z0-9]+)&(?:amp;)?c=([^"'<>\s&]+)/gi;
    while ((pm = rePx.exec(html)) !== null) {
      var key = pm[1] + ":" + pm[2];
      if (seenProxy[key]) continue;
      seenProxy[key] = 1;
      (function (platform, code) {
        jobs.push(modiplayProxyFile(origin, platform, decodeURIComponent(code), label + " • " + platform, ctx).catch(function () { return []; }));
      })(pm[1], pm[2]);
    }
    if (!jobs.length) return packerResolve(embedUrl, label, siteReferer, null, ctx);
    return Promise.all(jobs).then(function (results) {
      var out = [];
      results.forEach(function (st) { out = out.concat(st || []); });
      return out;
    });
  }).catch(function () { return []; });
}

// ---------------- MMGdmirror (iqsmartgames / filesforever) ----------------
var GD_PLATFORMS = {
  smwh: ["streamhg", "StreamHG"], flls: ["earnvids", "EarnVids"], flmn: ["filemoon", "Filemoon"],
  rpmshre: ["rpmshare", "RPMShare"], rpmshare: ["rpmshare", "RPMShare"], upnshr: ["upnshare", "UpnShare"],
  strmp2: ["streamp2p", "StreamP2P"], skstm: ["seekstreaming", "SeekStreaming"],
};
function gdShortenName(filename) {
  if (!filename) return "";
  var qs = {}, qRe = /(2160p|1080[pi]?|720[pi]?|480[pi]?|4k|HDCAM|Hdtc|CAM)/gi, m, qList = [];
  while ((m = qRe.exec(filename)) !== null) { var q = m[1].toUpperCase(); if (!qs[q]) { qs[q] = 1; qList.push(q); } }
  var ls = {}, lRe = /(HINDI|ENGLISH|JAPANESE|TAMIL|TELUGU|KANNADA|MALAYALAM|MULTI)/gi, lList = [];
  while ((m = lRe.exec(filename)) !== null) { var l = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(); if (!ls[l]) { ls[l] = 1; lList.push(l); } }
  var parts = [];
  if (qList.length) parts.push(qList.join(" "));
  if (lList.length) parts.push(lList.join("/"));
  return parts.length ? parts.join(" • ") : String(filename).slice(0, 40);
}
function gdPostHelper(playerBase, sid, v2) {
  var path = v2 ? "/embedhelper2.php" : "/embedhelper.php";
  var fields = v2 ? { sid: sid, UserFavSite: "", currentDomain: "[]" } : { sid: sid };
  var extra = v2 ? null : { "X-Requested-With": "XMLHttpRequest" };
  return mmPostForm(playerBase + path, fields, playerBase + "/evid/" + sid, extra)
    .then(function (r) { return r && r.ok ? r.text : null; });
}
// One sid -> per-site streams. sources{} (plain siteUrl/suffix) comes
// from the helper response itself; mresult (base64) carries code->fileId.
function gdResolveSid(playerBase, sid, filename, label, referer, modiplayBase, ctx) {
  var suffix = filename ? " • " + gdShortenName(filename) : "";
  var qHint = filename ? qualityFromText(filename) : null;
  return gdPostHelper(playerBase, sid, true).then(function (text) {
    var helper = null;
    if (text) { try { helper = JSON.parse(text); } catch (e) { helper = null; } }
    if (!helper) {
      // GDMirrorbot dialect fallback (embedhelper.php, siteUrls shape)
      return gdPostHelper(playerBase, sid, false).then(function (t2) {
        var h2 = null;
        if (t2) { try { h2 = JSON.parse(t2); } catch (e) {} }
        if (!h2 || !h2.siteUrls) return [];
        var mr = h2.mresult, sitesObj = null;
        if (typeof mr === "string") { try { sitesObj = JSON.parse(b64DecodeText(mr)); } catch (e) {} }
        else if (mr && typeof mr === "object") sitesObj = mr;
        if (!sitesObj) return [];
        var jobs = [];
        for (var key in h2.siteUrls) {
          if (!sitesObj[key]) continue;
          (function (k2, base, fid) {
            var full = String(base).replace(/\/+$/, "") + "/" + String(fid).replace(/^\/+/, "");
            var disp = label + " • " + k2 + suffix;
            jobs.push(genericResolve(full, disp, referer, ctx).catch(function () { return []; }));
          })(key, h2.siteUrls[key], sitesObj[key]);
        }
        return Promise.all(jobs).then(function (rs) { var o = []; rs.forEach(function (x) { o = o.concat(x || []); }); return o; });
      });
    }
    var codes = {};
    if (typeof helper.mresult === "string") {
      var dec = b64DecodeText(helper.mresult);
      var cm, reC = /"([a-z0-9]+)"\s*:\s*"([a-z0-9]+)"/g;
      while ((cm = reC.exec(dec)) !== null) codes[cm[1]] = cm[2];
    }
    var sources = helper.sources || {};
    var jobs = [];
    var gdSeen = {};
    for (var code in codes) {
      if (gdSeen[code]) continue;
      gdSeen[code] = 1;
      (function (cd, fileId) {
        var plat = GD_PLATFORMS[cd];
        var srcInfo = sources[cd] || {};
        var siteUrl = typeof srcInfo.siteUrl === "string" ? deEsc(srcInfo.siteUrl) : "";
        var suffix2 = typeof srcInfo.embed_suffix === "string" ? deEsc(srcInfo.embed_suffix) : "";
        var display = label + " • " + (plat ? plat[1] : (srcInfo.friendlyName || cd)) + suffix;
        var job;
        if (siteUrl) {
          var embedUrl = siteUrl + fileId + suffix2;
          // The 7 gdmirror platforms are all packed-player hosts: the
          // packer is the productive step (the plugin never raw-scrapes
          // these), then filemoon.sx for Filemoon, then the modiplay
          // proxy as the rescue path.
          job = packerResolve(embedUrl, display, referer, qHint, ctx);
          if (plat && plat[0] === "filemoon") {
            job = job.then(function (st) {
              return st.length ? st : genericResolve("https://filemoon.sx/e/" + fileId, display, referer, ctx);
            });
          }
        } else if (plat && plat[0] === "filemoon") {
          job = genericResolve("https://filemoon.sx/e/" + fileId, display, referer, ctx);
        } else {
          job = Promise.resolve([]);
        }
        jobs.push(job.then(function (st) {
          if (st.length || !modiplayBase || !plat) return st;
          return modiplayProxyFile(modiplayBase, plat[0], fileId, display, ctx);
        }).catch(function () { return []; }));
      })(code, codes[code]);
    }
    return Promise.all(jobs).then(function (rs) { var o = []; rs.forEach(function (x) { o = o.concat(x || []); }); return o; });
  }).catch(function () { return []; });
}
function gdmirrorResolve(embedUrl, label, modiplayBase, siteReferer, ctx) {
  return mmGet(embedUrl, siteReferer).then(function (r) {
    if (!r || !r.ok) return [];
    var html = r.text;
    var finalOrigin = originOf(r.url) || originOf(embedUrl);
    var finalId = rx1(/let\s+FinalID\s*=\s*"([^"]+)"/, html);
    var gdmrfid = rx1(/id="gdmrfid"\s+value="([^"]+)"/, html) || rx1(/value="([^"]+)"\s+id="gdmrfid"/, html);
    var apiUrl = rx1(/let\s+api_url\s*=\s*"([^"]+)"/, html) || "";
    var myKey = rx1(/let\s+myKey\s*=\s*"([^"]+)"/, html) || "";
    var pairsP;
    if (gdmrfid && (apiUrl || myKey)) {
      pairsP = Promise.resolve([[gdmrfid, ""]]);
    } else if (finalId) {
      var idType = rx1(/let\s+idType\s*=\s*"([^"]+)"/, html) || "imdbid";
      var season = rx1(/let\s+season\s*=\s*"([^"]+)"/, html);
      var epname = rx1(/let\s+epname\s*=\s*"([^"]+)"/, html);
      var apiBase = apiUrl || finalOrigin;
      var apiCall = season != null
        ? apiBase + "/myseriesapi?" + idType + "=" + encodeURIComponent(finalId) + "&season=" + season + "&epname=" + encodeURIComponent(epname || "") + "&key=" + myKey
        : apiBase + "/mymovieapi?" + idType + "=" + encodeURIComponent(finalId) + "&key=" + myKey;
      // The site API domain-guards on the embed page as Referer.
      pairsP = mmGet(apiCall, embedUrl).then(function (ar) {
        if (!ar || !ar.ok) return [];
        if (ar.text.indexOf("\"success\"") === -1 && ar.text.indexOf("fileslug") === -1) return [];
        if (ar.text.indexOf("\"success\":false") !== -1) return [];
        var slugs = [], names = [], sm;
        var reS = /"fileslug"\s*:\s*"([^"]+)"/g;
        while ((sm = reS.exec(ar.text)) !== null) slugs.push(sm[1]);
        var reN = /"filename"\s*:\s*"([^"]+)"/g;
        while ((sm = reN.exec(ar.text)) !== null) names.push(sm[1]);
        return slugs.slice(0, 3).map(function (s, i) { return [s, names[i] || ""]; });
      });
    } else if (gdmrfid) {
      pairsP = Promise.resolve([[gdmrfid, ""]]);
    } else {
      return [];
    }
    // player_base wins; otherwise the page's OWN final origin (the
    // filesforever embed redirects onto the gdmirror host, whose
    // /evid/ + embedhelper2 endpoints are the ones that answer) —
    // modiplayBase is only the spec's last resort.
    var playerBase = rx1(/let\s+player_base\s*=\s*"([^"]+)"/, html) || apiUrl || finalOrigin || modiplayBase;
    if (!playerBase) return [];
    playerBase = playerBase.replace(/\/+$/, "");
    return pairsP.then(function (pairs) {
      if (!pairs || !pairs.length) return [];
      var jobs = pairs.map(function (pr) {
        return gdResolveSid(playerBase, pr[0], pr[1], label, siteReferer, modiplayBase, ctx).catch(function () { return []; });
      });
      return Promise.all(jobs).then(function (rs) { var o = []; rs.forEach(function (x) { o = o.concat(x || []); }); return o; });
    });
  }).catch(function () { return []; });
}
function b64DecodeText(b64) {
  try {
    var bin = atob(String(b64).replace(/\s+/g, ""));
    var out = "";
    for (var i = 0; i < bin.length; i++) out += "%" + ("0" + bin.charCodeAt(i).toString(16)).slice(-2);
    return decodeURIComponent(out);
  } catch (e) {
    try { return atob(String(b64).replace(/\s+/g, "")); } catch (e2) { return ""; }
  }
}

// ---------------- MMCrypto / MMNxsha ----------------
// md5Hex (pure JS, byte array -> hex) is spliced in by the build script
// from anidisk13 (vector-verified there and in the build).
function md5Hex(bytes) {
  function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
  function add(x, y) { return (x + y) | 0; }
  var s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
           5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
           4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
           6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  var K = [];
  for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  var msgLen = bytes.length;
  var bitLen = msgLen * 8;
  var paddedLen = (((msgLen + 8) >> 6) + 1) << 6;
  var padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[msgLen] = 0x80;
  var dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLen >>> 0, true);
  dv.setUint32(paddedLen - 4, Math.floor(bitLen / 4294967296), true);
  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (var off = 0; off < paddedLen; off += 64) {
    var M = [];
    for (var j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    var A = a0, B = b0, C = c0, D = d0;
    for (var k = 0; k < 64; k++) {
      var F, g;
      if (k < 16) { F = (B & C) | (~B & D); g = k; }
      else if (k < 32) { F = (D & B) | (~D & C); g = (5 * k + 1) % 16; }
      else if (k < 48) { F = B ^ C ^ D; g = (3 * k + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * k) % 16; }
      F = add(add(add(F, A), K[k]), M[g]);
      A = D; D = C; C = B;
      B = add(B, rl(F, s[k]));
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }
  function hex(n) {
    var h = "";
    for (var i = 0; i < 4; i++) {
      var b = (n >>> (i * 8)) & 0xff;
      h += (b < 16 ? "0" : "") + b.toString(16);
    }
    return h;
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}
function md5BytesOf(bytes) {
  var hex = md5Hex(bytes), out = [];
  for (var i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  return out;
}
function strToBytes(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var cp = s.codePointAt(i);
    if (cp > 0xffff) i++;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}
function bytesToStr(bytes) {
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
function b64EncodeBytes(bytes) {
  var bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64DecodeBytes(b64) {
  var s = String(b64 || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  var bin = atob(s), out = [];
  for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i));
  return out;
}
var NX_KEY = "S8x!Jk4ZP1uG8$my";
function evpBytesToKey(passwordBytes, salt, keyLen, ivLen) {
  var out = [], prev = [];
  while (out.length < keyLen + ivLen) {
    prev = md5BytesOf(prev.concat(passwordBytes, salt));
    out = out.concat(prev);
  }
  return { key: out.slice(0, keyLen), iv: out.slice(keyLen, keyLen + ivLen) };
}
function nxEncrypt(plainStr) {
  try {
    var salt = [];
    for (var i = 0; i < 8; i++) salt.push(Math.floor(Math.random() * 256));
    var kv = evpBytesToKey(strToBytes(NX_KEY), salt, 32, 16);
    var data = strToBytes(plainStr);
    // the plugin double-pads: manual PKCS7 first, cipher pads again
    var pad = 16 - (data.length % 16);
    for (var p = 0; p < pad; p++) data.push(pad);
    var pad2 = 16 - (data.length % 16);
    for (var p2 = 0; p2 < pad2; p2++) data.push(pad2);
    var rk = _expandKey(kv.key);
    var prev = kv.iv.slice(), out = [];
    for (var off = 0; off + 16 <= data.length; off += 16) {
      var block = [];
      for (var k = 0; k < 16; k++) block.push(data[off + k] ^ prev[k]);
      var enc = _encBlock(rk, block, 0);
      out = out.concat(enc);
      prev = enc;
    }
    var full = [83, 97, 108, 116, 101, 100, 95, 95].concat(salt, out); // "Salted__"
    return b64EncodeBytes(full);
  } catch (e) { return null; }
}
function nxDecrypt(dataB64) {
  try {
    var raw = b64DecodeBytes(dataB64);
    if (raw.length < 17) return null;
    if (bytesToStr(raw.slice(0, 8)) !== "Salted__") return null;
    var salt = raw.slice(8, 16);
    var kv = evpBytesToKey(strToBytes(NX_KEY), salt, 32, 16);
    var dec = aesCbcDecryptBytes(new Uint8Array(kv.key), new Uint8Array(kv.iv), new Uint8Array(raw.slice(16)));
    return bytesToStr(Array.prototype.slice.call(dec));
  } catch (e) { return null; }
}
function nxEncodeParams(params) {
  var m = {};
  for (var k in params) m[k] = params[k];
  m._req_ts = String(Date.now());
  var saltChars = "";
  for (var i = 0; i < 10; i++) saltChars += String.fromCharCode(97 + Math.floor(Math.random() * 36));
  m._req_salt = saltChars;
  var enc = nxEncrypt(JSON.stringify(m));
  if (!enc) return null;
  return enc.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function nxApiGet(path, params, referer) {
  var q = nxEncodeParams(params);
  if (!q) return Promise.resolve(null);
  return mmGet("https://nxsha.space" + path + "?q=" + encodeURIComponent(q), referer).then(function (r) {
    if (!r || !r.ok) return null;
    var hash = rx1(/"_hash"\s*:\s*"([^"]+)"/, r.text);
    if (!hash) return null;
    var plain = nxDecrypt(hash);
    if (!plain) return null;
    try { return JSON.parse(plain); } catch (e) { return null; }
  }).catch(function () { return null; });
}
function nxshaResolve(embedUrl, label, ctx) {
  var tmdbId = "", type = "movie", season = "", episode = "", imdbId = "";
  var tvM = /\/embed\/tv\/(\d+)\/(\d+)\/(\d+)/.exec(embedUrl);
  var mvM = /\/embed\/movie\/(tt\d+)/.exec(embedUrl);
  if (tvM) { tmdbId = tvM[1]; season = tvM[2]; episode = tvM[3]; type = "tv"; }
  else if (mvM) { imdbId = mvM[1]; }
  var startP;
  if (tmdbId) startP = Promise.resolve(tmdbId);
  else if (imdbId) {
    startP = mmGet("https://db.speedracelight.com/3/find/" + imdbId + "?external_source=imdb_id").then(function (r) {
      var id = r ? rx1(/"movie_results"\s*:\s*\[\s*\{[^}]*?"id"\s*:\s*(\d+)/, r.text) : null;
      if (!id) id = rx1(/\/embed\/movie\/(\d+)/, embedUrl);
      return id || "";
    }).catch(function () { return rx1(/\/embed\/movie\/(\d+)/, embedUrl) || ""; });
  } else return Promise.resolve([]);
  return startP.then(function (tid) {
    if (!tid) return [];
    var baseParams = { tmdbId: String(tid), imdb_id: imdbId, type: type, season: season, episode: episode };
    return nxApiGet("/api/servers", baseParams, embedUrl).then(function (resp) {
      var servers = (resp && resp.servers) || [];
      if (!servers.length) return [];
      var jobs = servers.map(function (srv) {
        if (!srv || srv.webSupport === false) return Promise.resolve([]);
        var sp = { ex_lang: "false", provider: srv.scraper || "", tmdbId: String(tid), imdb_id: imdbId, type: type, season: season, episode: episode };
        return nxApiGet("/api/sources", sp, embedUrl).then(function (sr) {
          var sources = (sr && sr.sources) || [];
          var out = [];
          sources.forEach(function (src) {
            if (!src || !isHttp(src.url)) return;
            var s = makeStream(label + " • " + (srv.name || "NX"), src.url, qualityFromText((src.quality || "") + " " + (src.label || "")), null, ctx);
            withHeaders(s, { Referer: "https://nxsha.space/", "User-Agent": MM_UA });
            out.push(s);
          });
          return out;
        }).catch(function () { return []; });
      });
      return Promise.all(jobs).then(function (rs) { var o = []; rs.forEach(function (x) { o = o.concat(x || []); }); return o; });
    });
  }).catch(function () { return []; });
}

// ---------------- MMVidout ----------------
function vidoutResolve(embedUrl, label, meta, mediaType, season, episode) {
  var masterP = null;
  if (mediaType === "tv") {
    var tvUrl = MM_GH_API + "hls/tv/" + meta.tmdbId + "/S" + season + ".json";
    masterP = mmGet(tvUrl).then(function (r) {
      if (!r || !r.ok) return null;
      return rx1(new RegExp('"' + episode + '"\\s*:\\s*"([^"]+)"'), r.text);
    });
  } else {
    var ids = [meta.tmdbId, meta.imdb].filter(Boolean);
    var tryId = function (i) {
      if (i >= ids.length) return Promise.resolve(null);
      return mmGet(MM_GH_API + "hls/movie/" + ids[i] + ".json").then(function (r) {
        if (!r || !r.ok) return tryId(i + 1);
        var v = rx1(/"url"\s*:\s*"([^"]+)"/, r.text) || rx1(/"master"\s*:\s*"([^"]+)"/, r.text) || rx1(/"stream"\s*:\s*"([^"]+)"/, r.text) || rx1(/(https?:[^"']+\.m3u8[^"']*)/, r.text);
        return v ? deEsc(v) : tryId(i + 1);
      });
    };
    masterP = tryId(0);
  }
  return masterP.then(function (master) {
    if (!master) return [];
    master = deEsc(master);
    var low = master.toLowerCase();
    var shape = (low.indexOf("/hls3/") !== -1) || low.indexOf(".m3u8") !== -1 || low.indexOf("/stream/") !== -1;
    // the catalog's entries are '#'-suffixed signed URLs; keep what is
    // shaped like an HLS master either way
    if (!shape) return [];
    var s = makeStream(label, master, qualityFromText(label), null, { meta: meta, mediaType: mediaType, season: season, episode: episode });
    withHeaders(s, { Referer: "https://vidout.pages.dev/", "User-Agent": MM_UA });
    return [s];
  }).catch(function () { return []; });
}

// ---------------- VidBolt (vidbolt embeds, ZXCStream-proven) ----------------
var VB_SERVERS = ["orion", "callisto", "fastva", "vega", "quantum", "quasar"];
function vidboltResolve(label, meta, mediaType, season, episode) {
  var jobs = VB_SERVERS.map(function (srv) {
    var u = "https://vidbolt.xyz/api/resolve?type=" + (mediaType === "tv" ? "tv" : "movie") + "&id=" + meta.tmdbId + "&prefer=" + srv;
    if (mediaType === "tv") u += "&s=" + season + "&e=" + episode;
    return mmFetch(u, { headers: { Referer: "https://vidbolt.xyz/" } }).then(function (r) {
      if (!r || !r.ok) return [];
      var j = null;
      try { j = JSON.parse(r.text); } catch (e) { return []; }
      // VidBolt API shape changed: the stream now lives at
      // j.stream.sources[0].url (an index.m3u8 master). The old
      // streamUrl/url/source.url fields are gone, so the old read
      // dropped every VidBolt stream. Ship the master as-is: it
      // carries EXT-X-MEDIA SUBTITLES renditions, so subtitles reach
      // the player automatically (same as zxcstream1's rousav master).
      // Old-shape fields kept as fallback for any server still on them.
      var srcObj = (j.stream && j.stream.sources && j.stream.sources[0]) || null;
      var src = (srcObj && srcObj.url) || (j && (j.streamUrl || j.url || (j.source && j.source.url)));
      if (!isHttp(src)) return [];
      var s = makeStream(label + " • " + srv, src, qualityFromText((j.quality || "") + " " + srv), null, { meta: meta, mediaType: mediaType, season: season, episode: episode });
      if (hostOf(src).indexOf("proxy.vidbolt.xyz") === -1) withHeaders(s, { Referer: "https://vidbolt.xyz/", "User-Agent": MM_UA });
      return [s];
    }).catch(function () { return []; });
  });
  return Promise.all(jobs).then(function (rs) { var o = []; rs.forEach(function (x) { o = o.concat(x || []); }); return o; });
}

// ---------------- Gofile (generic route, best-effort) ----------------
function gofileResolve(url, label, ctx) {
  var id = rx1(/\/(?:\?c=|d\/)([\da-zA-Z-]+)/, url);
  if (!id) return Promise.resolve([]);
  return mmFetch("https://api.gofile.io/accounts", { method: "POST", headers: { Referer: "https://gofile.io/" } }).then(function (r) {
    var token = null;
    if (r && r.ok) { try { token = JSON.parse(r.text).data.token; } catch (e) {} }
    if (!token) return [];
    var wtParts = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      "en-GB", token, String(Math.floor(Date.now() / 1000)), "gf2026x",
    ];
    var wtHex = "";
    try {
      var digest = sha256BytesPure(new Uint8Array(strToBytes(wtParts.join("::"))));
      Array.prototype.forEach.call(digest, function (b) { wtHex += ("0" + b.toString(16)).slice(-2); });
    } catch (e) { return []; }
    return mmFetch("https://api.gofile.io/contents/" + id + "?contentFilter=&page=1&pageSize=1000&sortField=name&sortDirection=1", {
      headers: {
        Referer: "https://gofile.io/", "User-Agent": wtParts[0],
        Authorization: "Bearer " + token, "X-BL": "en-GB", "X-Website-Token": wtHex,
      },
    }).then(function (r2) {
      if (!r2 || !r2.ok) return [];
      var j = null;
      try { j = JSON.parse(r2.text); } catch (e) { return []; }
      var children = j && j.data && j.data.children;
      if (!children) return [];
      var out = [];
      for (var cid in children) {
        var ch = children[cid];
        if (ch && ch.type === "file" && isHttp(ch.link)) {
          var s = makeStream(label, ch.link, qualityFromText(ch.name || ""), ch.name || null, ctx);
          withHeaders(s, { Referer: "https://gofile.io/", "User-Agent": MM_UA });
          out.push(s);
        }
      }
      return out;
    });
  }).catch(function () { return []; });
}

// ---------------- embed collection ----------------
function collectEmbeds(html) {
  var out = [], seen = {};
  function push(url, label) {
    url = deEsc(String(url || "").trim());
    if (!isHttp(url) || url.indexOf("{tmdbId}") !== -1 || seen[url]) return;
    seen[url] = 1;
    out.push({ url: url, label: (label || "Server").trim() || "Server" });
  }
  var htmlS = String(html || "");
  // server chips: <button ... class="...server-chip..." data-url="..."> ... <span class="server-name">X</span>
  var btnRe = /<button[^>]*server-chip[^>]*>([\s\S]*?)<\/button>/g, bm;
  var openRe = /<button[^>]*server-chip[^>]*>/;
  var allBtns = htmlS.match(/<button[^>]*server-chip[^>]*>[\s\S]*?<\/button>/g) || [];
  allBtns.forEach(function (block) {
    var open = openRe.exec(block);
    var url = open ? rx1(/data-url="([^"]+)"/, open[0]) : null;
    var name = rx1(/server-name[^>]*>([^<]+)</, block) || "Server";
    if (url) push(url, name);
  });
  void btnRe; void bm;
  // embedded JSON name/url pairs
  var jm, reJ = /"name"\s*:\s*"([^"]+)"[^}]*?"url"\s*:\s*"([^"]+)"/g;
  while ((jm = reJ.exec(htmlS)) !== null) push(jm[2], jm[1]);
  return out;
}
function dooplayEmbeds(html, domain, watchUrl) {
  var opts = [];
  var blocks = String(html || "").match(/<li[^>]*dooplay_player_option[^>]*>[\s\S]*?<\/li>/g) || [];
  blocks.forEach(function (b) {
    if (/id="[^"]*trailer/.test(b)) return;
    var post = rx1(/data-post="([^"]*)"/, b), nume = rx1(/data-nume="([^"]*)"/, b), type = rx1(/data-type="([^"]*)"/, b) || "movie";
    if (!post || !nume) return;
    var label = (rx1(/class="title"[^>]*>([^<]+)</, b) || "Source")
      .replace(/ - Recommended/gi, "").replace(/ Recommended/gi, "").replace(/GDMIRROR/gi, "GD Mirror").trim() || "Source";
    opts.push({ post: post.trim(), nume: nume.trim(), type: type.trim(), label: label });
  });
  if (!opts.length) return Promise.resolve([]);
  var jobs = opts.map(function (o) {
    return mmPostForm(domain + "/wp-admin/admin-ajax.php",
      { action: "doo_player_ajax", post: o.post, nume: o.nume, type: o.type },
      watchUrl, { "X-Requested-With": "XMLHttpRequest" }).then(function (r) {
        if (!r || !r.ok) return null;
        var u = rx1(/"embed_url"\s*:\s*"([^"]+)"/, r.text);
        return u ? { url: deEsc(u), label: o.label } : null;
      }).catch(function () { return null; });
  });
  return Promise.all(jobs).then(function (rs) {
    var seen = {}, out = [];
    rs.forEach(function (x) { if (x && isHttp(x.url) && !seen[x.url]) { seen[x.url] = 1; out.push(x); } });
    return out;
  });
}

// ---------------- dispatch ----------------
function dispatchEmbed(embed, ctx) {
  var host = hostOf(embed.url);
  var label = embed.label;
  var siteRef = ctx.siteBase + "/";
  var safe = function (p) { return p.catch(function () { return []; }); };
  if (host.indexOf("modiplay") !== -1) return safe(modiplayResolve(embed.url, label, siteRef, ctx));
  if (host.indexOf("iqsmartgames") !== -1 || host.indexOf("filesforever") !== -1) return safe(gdmirrorResolve(embed.url, label, ctx.modiplayBase, siteRef, ctx));
  if (host.indexOf("nxsha.") !== -1) return safe(nxshaResolve(embed.url, label, ctx));
  if (host.indexOf("vidout") !== -1) return safe(vidoutResolve(embed.url, label, ctx.meta, ctx.mediaType, ctx.season, ctx.episode));
  if (host.indexOf("vidbolt") !== -1) return safe(vidboltResolve(label, ctx.meta, ctx.mediaType, ctx.season, ctx.episode));
  if (host.indexOf("gofile.io") !== -1) return safe(gofileResolve(embed.url, label, ctx));
  return safe(genericResolve(embed.url, label, siteRef, ctx));
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
  if (!/^\d+$/.test(String(tmdbId))) return Promise.resolve([]);
  if (mediaType !== "movie" && mediaType !== "tv") return Promise.resolve([]);
  if (mediaType === "tv" && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);
  return Promise.all([
    tmdbMeta(tmdbId, mediaType).catch(function () { return null; }),
    mmDomain().catch(function () { return null; }),
  ]).then(function (both) {
    var meta = both[0], domain = both[1];
    if (!meta || !meta.title || !domain) return [];
    meta.tmdbId = String(tmdbId);
    return findTitlePage(domain, meta, mediaType, tmdbId).then(function (hit) {
      if (!hit) return [];
      var watchP = mediaType === "movie"
        ? Promise.resolve(hit.url)
        : findEpisodePage(domain, hit.url, seasonNum, episodeNum);
      return watchP.then(function (watchUrl) {
        if (!watchUrl) return [];
        return mmGet(watchUrl, domain + "/").then(function (page) {
          if (!page || !page.ok) return [];
          var embeds = collectEmbeds(page.text);
          var embedsP = embeds.length ? Promise.resolve(embeds) : dooplayEmbeds(page.text, domain, watchUrl);
          return embedsP.then(function (list) {
            if (!list.length) return [];
            var modiplayBase = null;
            list.forEach(function (e) { if (!modiplayBase && hostOf(e.url).indexOf("modiplay") !== -1) modiplayBase = originOf(e.url); });
            var ctx = { siteBase: domain, modiplayBase: modiplayBase, meta: meta, mediaType: mediaType, season: seasonNum, episode: episodeNum };
            var jobs = list.slice(0, 8).map(function (e) { return dispatchEmbed(e, ctx); });
            return Promise.all(jobs).then(function (rs) {
              var out = [];
              rs.forEach(function (x) { out = out.concat(x || []); });
              return dedupeStreams(out);
            });
          });
        });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.MultiMoviesScraperModule = { getStreams: getStreams };
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
