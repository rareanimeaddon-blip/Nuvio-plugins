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



// HDHub4U scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: HDHub4U provider — Typesense search + multi-host resolver chain
// (HubCloud/HubDrive/PixelDrain/HUBCDN/HdStream4u/StreamTape/FileMoon/StreamWish).
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

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var FALLBACK_DOMAIN = "https://hdhub4u.glass";
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
var HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  Cookie: "xla=s4t",
};

var domainCache = null;

// ---------- helpers ----------

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function getText(url, timeoutMs, extraHeaders) {
  var headers = Object.assign({}, HEADERS, extraHeaders || {});
  return fetchWithTimeout(url, { headers: headers }, timeoutMs || 15000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function getJson(url, timeoutMs, extraHeaders) {
  var headers = Object.assign({}, HEADERS, extraHeaders || {});
  return fetchWithTimeout(url, { headers: headers }, timeoutMs || 15000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

// robust base64 decode (handles missing padding)
function b64decode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  var bin = atob(s);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64ToStr(s) {
  return new TextDecoder().decode(b64decode(s));
}

function rot13(str) {
  return String(str).replace(/[a-zA-Z]/g, function (ch) {
    var base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function hexToBytes(hex) {
  hex = String(hex).replace(/\s/g, "");
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function aesCbcDecryptHex(hexStr, keyStr, ivStr) {
  var keyBytes = new TextEncoder().encode(keyStr);
  var ivBytes = new TextEncoder().encode(ivStr);
  var dataBytes = hexToBytes(hexStr);
  var pt = aesCbcDecryptBytes(keyBytes, ivBytes, dataBytes);
  return Promise.resolve(new TextDecoder().decode(pt));
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/\s+details\s*$/i, "")
    .replace(/\b(720p|1080p|2160p|480p|4k|ds4k|hd|fhd|uhd|webrip|web-dl|webdl|bluray|blu-ray|hdtc|hdcam|hevc|x265|x264|avc|10bit|hdr10?|sdr|dv|dolby|atmos|dts|truehd|opus|dd[0-9.]+|aac|mp3|flac|ac3|hindi|english|dual|multi|audio|tamil|telugu|punjabi|malayalam|kannada|bengali|marathi|season\s*\d+|s\d{2}|e\d{2}|full\s*(?:movie|series)|all\s*episodes?|remux|dubbed|extended|theatrical|unrated|remastered|restored|imax|cam|ts|dvdrip|dvdscr|bdrip|brrip|hdrip|hdts|predvd|digital|hq|esubs|org|v\d+|nf|amzn|netflix|hotstar|jio|zee5|sony|primevideo|voot|proper|retail|final|web\s*series|bonus\s*episodes?|series)\b/gi, "")
    .replace(/[([–-]\s*(?:19[5-9]\d|20[0-2]\d)\s*[\])]?/g, " ")
    .replace(/\b(?:19[5-9]\d|20[0-2]\d)\b/g, "")
    .replace(/[|&/\\[\]()]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractYear(text) {
  var m = /\b(19[5-9]\d|20[0-2]\d)\b/.exec(String(text || ""));
  return m ? m[1] : undefined;
}

function extractQuality(text) {
  text = String(text || "");
  if (/2160p|4k/i.test(text)) return "2160p";
  if (/1080p/i.test(text)) return "1080p";
  if (/720p/i.test(text)) return "720p";
  if (/480p/i.test(text)) return "480p";
  return "HD";
}

function titleScore(a, b) {
  var na = cleanTitle(a).toLowerCase(), nb = cleanTitle(b).toLowerCase();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  var wa = na.split(/\s+/), wb = nb.split(/\s+/);
  var hit = 0;
  wa.forEach(function (w) { if (wb.indexOf(w) !== -1) hit++; });
  return (2 * hit) / (wa.length + wb.length);
}

// ---------- TMDB ----------

function tmdbTitle(tmdbId, mediaType) {
  if (!TMDB_API_KEY || TMDB_API_KEY === "<redacted>") return Promise.resolve(null);
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY,
    {}, 12000
  ).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j ? (j.title || j.name || null) : null; })
    .catch(function () { return null; });
}

function tmdbImdb(tmdbId, mediaType) {
  if (!TMDB_API_KEY || TMDB_API_KEY === "<redacted>") return Promise.resolve(null);
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY,
    {}, 12000
  ).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j && j.imdb_id ? j.imdb_id : null; })
    .catch(function () { return null; });
}

// ---------- domain ----------

function getActiveDomain() {
  if (domainCache) return Promise.resolve(domainCache);
  return getJson(DOMAINS_URL, 8000).then(function (d) {
    var domain = d && d.HDHUB4u ? String(d.HDHUB4u).trim() : "";
    domainCache = (domain && domain.indexOf("http") === 0) ? domain : FALLBACK_DOMAIN;
    return domainCache;
  }).catch(function () {
    domainCache = FALLBACK_DOMAIN;
    return domainCache;
  });
}

function rebaseUrl(url, activeDomain) {
  var base = activeDomain.replace(/\/+$/, "");
  if (url.indexOf("http") !== 0) return base + "/" + url.replace(/^\/+/, "");
  try {
    var u = new URL(url);
    if (/hdhub4u/i.test(u.hostname)) return base + u.pathname + u.search + u.hash;
  } catch (e) {}
  return url;
}

// ---------- search ----------
// Primary: Typesense JSON API. Fallback: HTML search page (regex-parsed).

function searchSiteHtml(query, activeDomain) {
  var url = activeDomain.replace(/\/+$/, "") + "/?s=" + encodeURIComponent(query);
  return getText(url, 15000).then(function (html) {
    if (!html) return [];
    var items = [], seen = {};
    // <li class="thumb ..."><figure><a href="/slug/" aria-label="Title"...>
    var re = /<li[^>]*class="[^"]*thumb[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*?(?:aria-label="([^"]+)"|title="([^"]+)")/gi, m;
    while ((m = re.exec(html)) !== null) {
      var href = m[1], rawTitle = (m[2] || m[3] || "").replace(/&#0?38;/g, "&");
      if (!href || href === "#" || seen[href]) continue;
      if (/^\/category\/|^\/page\//i.test(href)) continue;
      seen[href] = 1;
      var fullUrl = href.indexOf("http") === 0 ? href : activeDomain.replace(/\/+$/, "") + href;
      var slug = fullUrl.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
      if (!slug) continue;
      items.push({ slug: slug, title: cleanTitle(rawTitle), year: extractYear(rawTitle + " " + slug), url: fullUrl });
      if (items.length >= 20) break;
    }
    return items;
  }).catch(function () { return []; });
}

function searchSite(query) {
  return getActiveDomain().then(function (activeDomain) {
    var apiUrl =
      "https://search.pingora.fyi/collections/post/documents/search" +
      "?q=" + encodeURIComponent(query) +
      "&query_by=post_title,category&query_by_weights=4,2" +
      "&sort_by=sort_by_date:desc&limit=20&highlight_fields=none&use_cache=true&page=1";
    return getJson(apiUrl, 10000, { Referer: FALLBACK_DOMAIN }).then(function (data) {
      var items = [];
      var hits = (data && data.hits) || [];
      hits.forEach(function (hit) {
        var doc = hit.document || {};
        if (!doc.permalink || !doc.post_title) return;
        var fullUrl = rebaseUrl(doc.permalink, activeDomain);
        var slug = fullUrl.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
        items.push({
          slug: slug,
          title: cleanTitle(doc.post_title),
          year: extractYear(doc.post_title),
          url: fullUrl,
        });
      });
      if (items.length > 0) return items;
      return searchSiteHtml(query, activeDomain);
    }).catch(function () { return searchSiteHtml(query, activeDomain); });
  });
}

// ---------- redirect link decode (s('o','...') obfuscation) ----------

function decodeRedirectPayload(combined) {
  try {
    var step1 = b64ToStr(combined);
    var step2 = b64ToStr(step1);
    var step3 = rot13(step2);
    var jsonStr = b64ToStr(step3);
    var json = JSON.parse(jsonStr);
    if (json.o) {
      var u = b64ToStr(json.o).trim();
      if (u.indexOf("http") === 0) return u;
    }
    return null;
  } catch (e) { return null; }
}

function getRedirectLinks(pageHtml) {
  var regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
  var combined = "", m;
  while ((m = regex.exec(pageHtml)) !== null) { combined += (m[1] || m[2] || ""); }
  if (!combined) return Promise.resolve(null);
  return Promise.resolve(decodeRedirectPayload(combined));
}

// ---------- host resolvers ----------

function detectHost(url) {
  var u = String(url).toLowerCase();
  if (u.indexOf("pixeldrain.com") !== -1 || u.indexOf("pixeldrain.dev") !== -1) return "PixelDrain";
  if (u.indexOf("streamtape.") !== -1) return "StreamTape";
  if (u.indexOf("hubcloud.") !== -1) return "HubCloud";
  if (u.indexOf("hubdrive.") !== -1) return "HubDrive";
  if (u.indexOf("hblinks.") !== -1 || u.indexOf("hubstreamdad.") !== -1) return "Hblinks";
  if (u.indexOf("hdstream4u.") !== -1 || u.indexOf("hubstream.") !== -1) return "HdStream4u";
  if (u.indexOf("hubcdn.") !== -1) return "HUBCDN";
  if (u.indexOf("filemoon.") !== -1) return "FileMoon";
  if (u.indexOf("streamwish.") !== -1 || u.indexOf("wishfast.") !== -1) return "StreamWish";
  if (u.indexOf("doodstream") !== -1 || /dood\./.test(u)) return "DoodStream";
  return "Direct";
}

function isArchiveFile(url) {
  return /\.(zip|rar|7z)(?:["'?]|$)/i.test(String(url).split("?")[0]);
}

function resolvePixelDrain(url) {
  var m = /\/file\/([a-zA-Z0-9]+)/.exec(url);
  if (!m) return Promise.resolve(null);
  var fileId = m[1];
  return getJson("https://pixeldrain.com/api/file/" + fileId + "/info", 7000).then(function (info) {
    if (info && info.success === true) return "https://pixeldrain.com/api/file/" + fileId + "?download";
    return null;
  }).catch(function () { return null; });
}

// extract all <a class="btn" href> links from html (regex, no cheerio)
function extractBtnLinks(html) {
  var out = [];
  var re = /<a[^>]*class="[^"]*btn[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    out.push({ href: m[1], label: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase() });
  }
  return out;
}

function resolveHubCloud(url) {
  var base = "";
  try { var u = new URL(url); base = u.protocol + "//" + u.host; } catch (e) {}
  function fetchPage(pageUrl) {
    return getText(pageUrl, 15000).catch(function () { return null; });
  }
  return fetchPage(url).then(function (html) {
    if (!html) return null;
    // #download element with x-href (base64) or href
    var dl = /<[^>]*id="download"[^>]*>/i.exec(html);
    var pageUrl = url;
    if (dl) {
      var tag = dl[0];
      var href = /href="([^"]+)"/i.exec(tag);
      var xhref = /x-href="([^"]+)"/i.exec(tag);
      var raw = href ? href[1] : (xhref ? b64ToStr(xhref[1]) : "");
      if (raw) pageUrl = raw.indexOf("http") === 0 ? raw : base + "/" + raw.replace(/^\//, "");
    }
    if (pageUrl !== url) return fetchPage(pageUrl);
    return html;
  }).then(function (html) {
    if (!html) return null;
    var buttons = extractBtnLinks(html);
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.href.indexOf("http") !== 0 && b.href.indexOf("//") !== 0) continue;
      var full = b.href.indexOf("//") === 0 ? "https:" + b.href : b.href;
      if (/fsl server|fslv2|s3 server|mega server|download file/.test(b.label)) return full;
      if (/pixeldra|pixel server|pixelserver/.test(b.label)) {
        return resolvePixelDrain(full).then(function (pd) { return pd || full; });
      }
    }
    for (var j = 0; j < buttons.length; j++) {
      if (buttons[j].href.indexOf("http") === 0) return buttons[j].href;
    }
    return null;
  });
}

function resolveHubDrive(url) {
  return getText(url, 15000).then(function (html) {
    if (!html) return null;
    // primary hubcloud button
    var m = /class="[^"]*btn-primary[^"]*btn-success1[^"]*"[^>]*href="([^"]+)"/i.exec(html) ||
            /href="([^"]+)"[^>]*class="[^"]*btn-primary[^"]*btn-success1/i.exec(html);
    var href = m ? m[1] : null;
    if (!href) {
      var re = /href="(https?:\/\/[^"]*hubcloud[^"]*)"/gi, mm;
      while ((mm = re.exec(html)) !== null) { href = mm[1]; break; }
    }
    if (href && href.indexOf("http") === 0) {
      if (/hubcloud/i.test(href)) return resolveHubCloud(href);
      return resolveLink(href, "HD").then(function (r) { return r ? r.url : null; });
    }
    return null;
  }).catch(function () { return null; });
}

function resolveHblinks(url) {
  return getText(url, 15000).then(function (html) {
    if (!html) return null;
    // collect hub* links: prefer <h3>/<h5> anchors, fall back to any anchor
    var links = [];
    var re = /<h[35][^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/gi, m;
    while ((m = re.exec(html)) !== null) links.push(m[1]);
    if (!links.length) {
      var re2 = /<a[^>]*href="(https?:\/\/(?:hubcloud|hubdrive|hubcdn)[^"]+)"[^>]*>/gi;
      while ((m = re2.exec(html)) !== null) links.push(m[1]);
    }
    var chain = Promise.resolve(null);
    links.forEach(function (href) {
      chain = chain.then(function (done) {
        if (done) return done;
        var low = href.toLowerCase();
        if (low.indexOf("hubdrive") !== -1) return resolveHubDrive(href);
        if (low.indexOf("hubcloud") !== -1) return resolveHubCloud(href);
        if (low.indexOf("hubcdn") !== -1) return resolveHUBCDN(href);
        return resolveLink(href, "HD").then(function (r) { return r ? r.url : null; });
      });
    });
    return chain;
  }).catch(function () { return null; });
}

function resolveHUBCDN(url) {
  return getText(url, 15000).then(function (html) {
    if (!html) return null;
    var m = /reurl\s*=\s*"([^"]+)"/.exec(html);
    if (!m) return null;
    var encoded = m[1].split("?r=")[1];
    if (!encoded) return null;
    var decoded = b64ToStr(encoded);
    var link = decoded.indexOf("link=") !== -1 ? decoded.split("link=").pop().trim() : decoded.trim();
    return link.indexOf("http") === 0 ? link : null;
  }).catch(function () { return null; });
}

function resolveHdStream4u(url) {
  var base = "";
  try { var u = new URL(url); base = u.protocol + "//" + u.host; } catch (e) { return Promise.resolve(null); }
  var hash = url.split("#").pop().split("/").pop() || "";
  if (!hash) return Promise.resolve(null);
  return getText(base + "/api/v1/video?id=" + encodeURIComponent(hash), 10000, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  }).then(function (encoded) {
    encoded = (encoded || "").trim();
    if (!encoded) return null;
    var KEY = "kiemtienmua911ca";
    var IVS = ["1234567890oiuytr", "0123456789abcdef"];
    var chain = Promise.resolve(null);
    IVS.forEach(function (iv) {
      chain = chain.then(function (done) {
        if (done) return done;
        return aesCbcDecryptHex(encoded, KEY, iv).catch(function () { return null; });
      });
    });
    return chain;
  }).then(function (decrypted) {
    if (!decrypted) return null;
    var m = /"source"\s*:\s*"([^"]+)"/.exec(decrypted);
    if (m) return m[1].replace(/\\\//g, "/").replace(/^https/, "http");
    return null;
  }).catch(function () { return null; });
}

function resolveGenericPlayer(url) {
  return getText(url, 15000, { Referer: url }).then(function (html) {
    if (!html) return null;
    var patterns = [
      /file\s*:\s*['"]([^'"]+\.(?:mp4|mkv|m3u8)[^'"]*)['"]/i,
      /"sources"\s*:\s*\[.*?"file"\s*:\s*"([^"]+)"/s,
      /<source[^>]+src=['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(html);
      if (m && m[1] && m[1].indexOf("http") === 0) return m[1];
    }
    return null;
  }).catch(function () { return null; });
}

function resolveLink(url, qualityHint) {
  if (!url || url.indexOf("http") !== 0) return Promise.resolve(null);
  var host = detectHost(url);
  var p;
  switch (host) {
    case "PixelDrain": p = resolvePixelDrain(url); break;
    case "HubCloud": p = resolveHubCloud(url); break;
    case "HubDrive": p = resolveHubDrive(url); break;
    case "Hblinks": p = resolveHblinks(url); break;
    case "HdStream4u": p = resolveHdStream4u(url); break;
    case "HUBCDN": p = resolveHUBCDN(url); break;
    case "StreamTape":
    case "FileMoon":
    case "StreamWish":
    case "DoodStream": p = resolveGenericPlayer(url); break;
    case "Direct":
      p = Promise.resolve(/\.(mp4|mkv|avi|m3u8)/i.test(url) ? url : null);
      break;
    default: p = Promise.resolve(url);
  }
  return p.then(function (resolved) {
    if (!resolved) return null;
    return { url: resolved, quality: qualityHint || "HD", host: host };
  });
}

// ---------- extract streams from a content page ----------

var ALLOWED_DOMAINS_RE = /https?:\/\/(?:.*\.)?(hubcloud|hubdrive|hubstream|hdstream4u|hblinks|pixeldrain|pixeldrain\.dev|streamtape|filemoon|streamwish|wishfast|doodstream|dood\.|upstream|mixdrop|1fichier|mp4upload|gofile)\./i;

function extractAnchors(html, qualityFilter) {
  // returns [{url, text}] for <a href> anchors
  var out = [];
  var re = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (qualityFilter && !/480|720|1080|2160|4K/i.test(text)) continue;
    out.push({ url: m[1], text: text });
  }
  return out;
}

function extractStreams(pageUrl, season, episode, expectedImdbId) {
  return getText(pageUrl, 20000).then(function (html) {
    if (!html) return [];
    if (expectedImdbId) {
      var im = /imdb\.com\/title\/(tt\d{7,8})/i.exec(html);
      if (im && im[1] !== expectedImdbId) return [];
    }
    var isSeries = season != null && episode != null;
    var rawLinks = [];
    var seen = {};

    function push(url, ctx) {
      if (!url || url.indexOf("http") !== 0 || seen[url]) return;
      seen[url] = 1;
      rawLinks.push({ url: url, context: ctx || "" });
    }

    if (!isSeries) {
      // h3/h4 links with quality text
      var re = /<h[34][^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
      while ((m = re.exec(html)) !== null) {
        if (/480|720|1080|2160|4K/i.test(m[2])) push(m[1], m[2].replace(/<[^>]+>/g, " "));
      }
      if (rawLinks.length === 0) {
        extractAnchors(html, false).forEach(function (a) {
          if (ALLOWED_DOMAINS_RE.test(a.url)) push(a.url, a.text);
        });
      }
    } else {
      // series: find h3/h4 blocks mentioning Episode N
      var epMap = {};
      var hre = /<h[34][^>]*>([\s\S]*?)<\/h[34]>/gi, hm;
      var blocks = [];
      while ((hm = hre.exec(html)) !== null) blocks.push(hm[1]);
      blocks.forEach(function (block) {
        var epM = /EPiSODE\s*(\d+)/i.exec(block.replace(/<[^>]+>/g, " "));
        if (!epM) return;
        var epNum = parseInt(epM[1], 10);
        var are = /href="(https?:\/\/[^"]+)"/gi, am;
        while ((am = are.exec(block)) !== null) {
          (epMap[epNum] = epMap[epNum] || []).push(am[1]);
        }
      });
      var epLinks = epMap[episode] || [];
      if (epLinks.length === 0) {
        extractAnchors(html, false).forEach(function (a) {
          if (ALLOWED_DOMAINS_RE.test(a.url)) push(a.url, a.text);
        });
      } else {
        epLinks.forEach(function (u) { push(u, ""); });
      }
    }

    if (rawLinks.length === 0) return [];

    var jobs = rawLinks.slice(0, 10).map(function (link) {
      var finalUrl = link.url;
      var p = Promise.resolve(finalUrl);
      if (finalUrl.indexOf("?id=") !== -1) {
        p = getText(finalUrl, 15000).then(getRedirectLinks).then(function (d) { return d || finalUrl; }).catch(function () { return finalUrl; });
      }
      return p.then(function (fu) {
        var ctx = link.context + " " + pageUrl;
        var q = extractQuality(ctx);
        var sizeM = /[\[(]?(\d+\.?\d*\s*(?:GB|MB))[\])]?/i.exec(link.context);
        return resolveLink(fu, q).then(function (r) {
          if (!r || isArchiveFile(r.url)) return null;
          return {
            url: r.url,
            quality: r.quality,
            label: r.quality + " [" + r.host + "]",
            size: sizeM ? sizeM[1].replace(/\s+/, " ") : undefined,
          };
        });
      }).catch(function () { return null; });
    });
    return Promise.all(jobs).then(function (results) {
      return results.filter(function (r) { return !!r; });
    });
  }).catch(function () { return []; });
}

// ---------- main ----------

function pickBest(items, title, year) {
  var best = null, bestScore = -1;
  items.forEach(function (it) {
    var s = titleScore(it.title, title);
    if (year && it.year && year !== it.year) s -= 0.3;
    if (s > bestScore) { bestScore = s; best = it; }
  });
  return bestScore >= 0.4 ? best : null;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return Promise.all([tmdbTitle(tmdbId, mediaType), tmdbImdb(tmdbId, mediaType)]).then(function (vals) {
    var title = vals[0];
    if (!title) return [];
    var imdbId = vals[1];
    return searchSite(title).then(function (items) {
      if (!items.length) return [];
      var best = pickBest(items, title);
      if (!best) return [];
      return extractStreams(best.url, seasonNum, episodeNum, imdbId).then(function (streams) {
        return streams.map(function (s) {
          return {
            name: "HDHub4U",
            title: s.label + (s.size ? " " + s.size : "") + " | " + title,
            url: s.url,
            quality: /^\d+p$/.test(s.quality) ? s.quality : "Unknown",
            type: "direct",
          };
        });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.HDHub4UScraperModule = { getStreams: getStreams };
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
