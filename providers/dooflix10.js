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
// Playback: the 1x2.space/4pa.top CDN chain (master, variants AND
// segments) 403s unless the player sends the xpass origin as Referer
// (probe-verified: bare 403, with Referer 200). Streams previously
// carried no headers, so both servers failed at playback everywhere.
var PLAYBACK_HEADERS = { Referer: "https://play.xpass.top/", "User-Agent": EMBED_HEADERS["User-Agent"] };
var PLAYBACK_HINTS = { notWebReady: true, proxyHeaders: { request: PLAYBACK_HEADERS } };

var ALLOWED_SOURCE_HOSTNAMES = { "vip.1x2.space": true, "mol.1x2.space": true };

// mol.1x2.space file URLs are REDIRECTORS: a live one 302s to the real
// signed HLS master on a rotating prx-*.vmpx.online host (12h expiry;
// master/variant/segments probe-verified 200 with the standard playback
// headers). The app player cannot follow that cross-host jump for an
// HLS master, so MOL streams failed at playback while VIP (direct 200)
// played. A dead mol entry 302s to the bare /playlist/ root instead
// (probe-verified stable: MOL 1 dead at the source, MOL 2 live, same
// minute, same network). So: resolve each mol redirect here, emit the
// final vmpx URL, and drop entries proven dead rather than handing the
// player a guaranteed failure. Resolution errors keep the original URL
// (unproven either way; the device may still succeed).
function isDeadPlaylistRoot(u) {
  try {
    var p = new URL(u);
    return p.hostname === "mol.1x2.space" && (p.pathname === "/playlist/" || p.pathname === "/playlist");
  } catch (e) { return false; }
}

function resolveMolRedirect(url) {
  var current = url;
  var hops = 0;
  var step = function () {
    return fetch(current, { headers: PLAYBACK_HEADERS, redirect: "manual" }).then(function (r) {
      if (!r) return { url: url };
      var status = r.status || 0;
      if (r.url && r.url !== current) {
        // the fetch bridge followed the redirect itself: judge the landing
        if (isDeadPlaylistRoot(r.url)) return { url: null };
        if (status >= 400) return { url: url };
        return { url: r.url };
      }
      if (status >= 300 && status < 400 && r.headers && typeof r.headers.get === "function") {
        var loc = r.headers.get("location");
        if (loc) {
          var next;
          try { next = new URL(loc, current).href; } catch (e) { return { url: url }; }
          if (isDeadPlaylistRoot(next)) return { url: null };
          if (hops < 4) { hops++; current = next; return step(); }
          return { url: next };
        }
      }
      if (status >= 200 && status < 300) return { url: current };
      return { url: url };
    }).catch(function () { return { url: url }; });
  };
  return step();
}

function resolveMolStreams(streams) {
  return Promise.all(streams.map(function (s) {
    var host = "";
    try { host = new URL(s.url).hostname; } catch (e) {}
    if (host !== "mol.1x2.space") return s;
    return resolveMolRedirect(s.url).then(function (res) {
      if (!res || !res.url) return null; // proven dead at the source
      s.url = res.url;
      return s;
    });
  })).then(function (arr) {
    return arr.filter(function (s) { return !!s; });
  });
}

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
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

function fetchPlaylistStreams(playlistUrl, embedUrl, sourceLabel, mediaTitle, kind, season, episode) {
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
          var dlbl = formatStreamLabel({ source: "DooFlix", title: mediaTitle, quality: /(\d{3,4})p/i.exec(label) ? /(\d{3,4})p/i.exec(label)[1] + "p" : "Unknown",
            season: kind === "tv" ? season : undefined, episode: kind === "tv" ? episode : undefined,
            server: sourceLabel, url: source.file });
          streams.push({
            name: dlbl,
            title: dlbl,
            url: source.file,
            quality: /(\d{3,4})p/i.exec(label) ? /(\d{3,4})p/i.exec(label)[1] + "p" : "Unknown",
            type: "direct",
            headers: PLAYBACK_HEADERS,
            behaviorHints: PLAYBACK_HINTS,
          });
        });
      });
      return streams;
    }).catch(function () { return []; });
}

function getXpassStreams(imdbId, kind, season, episode, mediaTitle) {
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
      // Subtitles: the embed page carries var suburl="https://sub.1x2.space/api/...";
      // that API returns cached .vtt entries. Fetch it concurrently with
      // the playlist chain; attach at dedupe (before resolveMolStreams).
      // Only status:"cached" entries are served; "failed" entries are skipped.
      var subsPromise = Promise.resolve([]);
      var subM = /suburl\s*=\s*["']([^"']+)["']/.exec(html);
      if (subM) {
        var subHeaders = Object.assign({}, EMBED_HEADERS, { Referer: embedUrl });
        if (obj.cookie) subHeaders.Cookie = obj.cookie;
        var fullSubUrl = null;
        try { fullSubUrl = new URL(subM[1], XPASS_BASE).href; } catch (e) {}
        if (fullSubUrl) {
          var subOrigin = "";
          try { subOrigin = new URL(fullSubUrl).origin; } catch (e) {}
          subsPromise = fetchWithTimeout(fullSubUrl, { headers: subHeaders }, 30000)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              var subs = [];
              (Array.isArray(j) ? j : []).forEach(function (e) {
                if (e && e.status === "cached" && e.url) {
                  var u = String(e.url);
                  if (u.charAt(0) === "/" && subOrigin) u = subOrigin + u;
                  subs.push({ url: encodeURI(u), language: e.language || e.label || "Unknown", name: e.label || e.language || "Subtitle" });
                }
              });
              return subs;
            }).catch(function () { return []; });
        }
      }
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
            var blbl = formatStreamLabel({ source: "DooFlix", title: mediaTitle, quality: "Unknown",
              season: kind === "tv" ? season : undefined, episode: kind === "tv" ? episode : undefined,
              server: req.label, url: req.path });
            return isAllowedSource(req.path) ? [{
              name: blbl, title: blbl,
              url: req.path, quality: "Unknown", type: "direct",
              headers: PLAYBACK_HEADERS, behaviorHints: PLAYBACK_HINTS,
            }] : [];
          }
          return fetchPlaylistStreams(url, embedUrl, req.label, mediaTitle, kind, season, episode);
        }));
      }).then(function (all) {
        var seen = {}, out = [];
        all.forEach(function (arr) {
          arr.forEach(function (s) { if (!seen[s.url]) { seen[s.url] = true; out.push(s); } });
        });
        return subsPromise.then(function (subs) {
          if (subs.length) out.forEach(function (s) { s.subtitles = subs; });
          return out;
        });
      }).then(function (out) { return resolveMolStreams(out); }).then(function (resolved) {
        resolved.forEach(function (st) {
          var srv = "";
          var segs = String(st.title || "").split(" • ");
          for (var i = segs.length - 1; i >= 0; i--) {
            if (segs[i].indexOf("🗄") === 0) { srv = segs[i].replace(/^[^ ]+ /, ""); break; }
          }
          var flbl = formatStreamLabel({ source: "DooFlix", title: mediaTitle, quality: st.quality,
            season: kind === "tv" ? season : undefined, episode: kind === "tv" ? episode : undefined,
            subtitles: st.subtitles, server: srv || undefined, url: st.url });
          st.name = flbl; st.title = flbl;
        });
        return resolved;
      });
    }).catch(function () { return []; });
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
