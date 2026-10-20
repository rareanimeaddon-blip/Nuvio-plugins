// DooFlix scraper for Nuvio
// Standalone, sandbox-compatible (WebCrypto for SHA-256 + AES-256-GCM).
// Source: DooFlix provider — fetches XPass embed, decrypts the signed data
// endpoint (key = SHA-256("spv3-data-response|BUILD|pathname|token")),
// then resolves playlist JSON. NOTE: the source addon's server-side relay
// for region-locked hosts is not available on-device; direct URLs are returned.


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

var XPASS_BASE = "https://play.xpass.top";
var XPASS_DATA_BUILD = "spv3-build-1787821613-50e5fc97c9dce367";
var STREAM_REFERER = "https://streamsrcs.2embed.cc/";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var EMBED_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "*/*",
  Referer: STREAM_REFERER,
};

var ALLOWED_SOURCE_HOSTNAMES = { "vip.1x2.space": true, "mol.1x2.space": true };

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 10000);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function base64UrlToBytes(value) {
  var normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  var bin = atob(normalized);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return bytes;
}

function sha256Bytes(str) {
  return Promise.resolve(sha256BytesPure(new TextEncoder().encode(str)));
}

function aesGcmDecrypt(encrypted, keyBytes) {
  if (encrypted.length <= 12 + 16) throw new Error("DooFlix: response too short");
  var iv = encrypted.subarray(0, 12);
  var ctAndTag = encrypted.subarray(12);
  var pt = aesGcmDecryptBytes(keyBytes, iv, ctAndTag);
  return Promise.resolve(new TextDecoder().decode(pt));
}

function tmdbToImdb(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY, {}, 10000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j && j.imdb_id ? j.imdb_id : null; })
    .catch(function () { return null; });
}

function getSetCookieHeader(response) {
  try {
    var getSet = response.headers.getSetCookie;
    if (typeof getSet !== "function") return undefined;
    var cookies = getSet.call(response.headers) || [];
    if (!cookies.length) return undefined;
    return cookies.map(function (c) { return c.split(";")[0]; })
      .filter(function (c) { return c.length > 0; }).join("; ");
  } catch (e) { return undefined; }
}

function extractPrimaryPath(html) {
  var m = /"playlist"\s*:\s*"(\/[^"]+)"/.exec(html);
  return m ? m[1] : null;
}

function extractDataUrl(html) {
  var m = /\bdataUrl\s*=\s*["']([^"']+)["']/.exec(html);
  return m ? m[1] : null;
}

function extractBackups(html) {
  var start = html.indexOf("var backups=");
  if (start < 0) return [];
  var arrayStart = html.indexOf("[", start);
  if (arrayStart < 0) return [];
  var depth = 0, arrayEnd = -1;
  for (var i = arrayStart; i < html.length; i++) {
    if (html[i] === "[") depth++;
    if (html[i] === "]") { depth--; if (depth === 0) { arrayEnd = i; break; } }
  }
  if (arrayEnd < 0) return [];
  try {
    var entries = JSON.parse(html.slice(arrayStart, arrayEnd + 1));
    return entries.filter(function (e) {
      return e && e.dl !== true && typeof e.name === "string" && typeof e.url === "string" && e.url.length > 0;
    }).map(function (e) { return { name: e.name, url: e.url }; });
  } catch (e) { return []; }
}

function decryptDataResponse(raw, dataUrl) {
  var trimmed = raw.trim();
  if (trimmed.charAt(0) === "{") {
    try {
      var errObj = JSON.parse(trimmed);
      if (typeof errObj.error === "string") throw new Error("DooFlix: " + errObj.error);
    } catch (e) {
      if (e.message.indexOf("DooFlix:") === 0) throw e;
    }
  }
  var endpoint;
  try { endpoint = new URL(dataUrl, XPASS_BASE); } catch (e) { throw new Error("DooFlix: bad dataUrl"); }
  var token = endpoint.searchParams.get("token");
  if (!token || token.split(".").length !== 2 || !/^[0-9a-f]{64}$/i.test(token.split(".")[1])) {
    throw new Error("DooFlix: invalid XPass data token");
  }
  var keyMaterial = "spv3-data-response|" + XPASS_DATA_BUILD + "|" + endpoint.pathname + "|" + token;
  var encrypted = base64UrlToBytes(trimmed);
  return sha256Bytes(keyMaterial).then(function (key) {
    return aesGcmDecrypt(encrypted, key);
  }).then(function (plaintext) {
    var entries = JSON.parse(plaintext);
    if (!Array.isArray(entries)) throw new Error("DooFlix: not a backup list");
    return entries.filter(function (e) {
      return e && typeof e === "object" && e.dl !== true &&
        typeof e.name === "string" && typeof e.url === "string" && e.url.length > 0;
    });
  });
}

function isAllowedSource(sourceFile) {
  try { return !!ALLOWED_SOURCE_HOSTNAMES[new URL(sourceFile).hostname]; }
  catch (e) { return false; }
}

function fetchPlaylistStreams(playlistUrl, embedUrl, sourceLabel) {
  return fetchWithTimeout(playlistUrl, { headers: Object.assign({}, EMBED_HEADERS, { Referer: embedUrl }) }, 15000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (json) {
      if (!json) return [];
      var now = Math.floor(Date.now() / 1000);
      var streams = [];
      (json.playlist || []).forEach(function (item) {
        (item.sources || []).forEach(function (source) {
          if (!source.file) return;
          if (/\/video\/error\b/i.test(source.file) || source.file.trim() === "/video/error") return;
          var exp = /[?&]e=(\d+)/.exec(source.file);
          if (exp && parseInt(exp[1], 10) < now) return;
          if (!isAllowedSource(source.file)) return;
          var label = source.label || sourceLabel || "HD";
          streams.push({
            name: "DooFlix",
            title: label + " HLS | DooFlix",
            url: source.file,
            quality: /(\d{3,4})p/i.exec(label) ? /(\d{3,4})p/i.exec(label)[1] + "p" : "Unknown",
            type: "direct",
          });
        });
      });
      return streams;
    }).catch(function () { return []; });
}

function getXpassStreams(imdbId, kind, season, episode) {
  var embedUrl = kind === "movie"
    ? XPASS_BASE + "/e/movie/" + encodeURIComponent(imdbId)
    : XPASS_BASE + "/e/tv/" + encodeURIComponent(imdbId) + "/" + season + "/" + episode;
  return fetchWithTimeout(embedUrl, { headers: EMBED_HEADERS }, 30000)
    .then(function (r) {
      if (!r.ok) throw new Error("embed fetch failed");
      var cookie = getSetCookieHeader(r);
      return r.text().then(function (html) { return { html: html, cookie: cookie }; });
    })
    .then(function (obj) {
      var html = obj.html;
      var requests = [];
      var tried = {};
      var primaryPath = extractPrimaryPath(html);
      var dataUrl = extractDataUrl(html);
      if (primaryPath) { tried[primaryPath] = true; requests.push({ path: primaryPath }); }
      extractBackups(html).forEach(function (b) {
        if (!tried[b.url] && requests.length < 8) { tried[b.url] = true; requests.push({ path: b.url, label: b.name }); }
      });
      var chain = Promise.resolve();
      if (dataUrl) {
        chain = chain.then(function () {
          var headers = Object.assign({}, EMBED_HEADERS, { Referer: embedUrl });
          if (obj.cookie) headers.Cookie = obj.cookie;
          var fullUrl;
          try { fullUrl = new URL(dataUrl, XPASS_BASE).href; } catch (e) { return; }
          return fetchWithTimeout(fullUrl, { headers: headers }, 30000)
            .then(function (r) { return r.ok ? r.text() : null; })
            .then(function (text) {
              if (!text) return;
              return decryptDataResponse(text, dataUrl).then(function (backups) {
                backups.forEach(function (b) {
                  if (!tried[b.url] && requests.length < 8) { tried[b.url] = true; requests.push({ path: b.url, label: b.name }); }
                });
              }).catch(function () {});
            }).catch(function () {});
        });
      }
      return chain.then(function () {
        if (!requests.length) return [];
        return Promise.all(requests.map(function (req) {
          var url = req.path.charAt(0) === "/" ? XPASS_BASE + req.path : req.path;
          // only fetch playlist JSON for xpass paths; absolute backup URLs are direct
          if (req.path.charAt(0) !== "/") {
            return isAllowedSource(req.path) ? [{
              name: "DooFlix", title: (req.label || "HD") + " | DooFlix",
              url: req.path, quality: "Unknown", type: "direct",
            }] : [];
          }
          return fetchPlaylistStreams(url, embedUrl, req.label);
        }));
      }).then(function (all) {
        var seen = {}, out = [];
        all.forEach(function (arr) {
          arr.forEach(function (s) { if (!seen[s.url]) { seen[s.url] = true; out.push(s); } });
        });
        return out;
      });
    }).catch(function () { return []; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return tmdbToImdb(tmdbId, mediaType).then(function (imdbId) {
    if (!imdbId) return [];
    if (kind === "movie") return getXpassStreams(imdbId, "movie");
    return getXpassStreams(imdbId, "tv", seasonNum || 1, episodeNum || 1);
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.DooFlixScraperModule = { getStreams: getStreams };
}
