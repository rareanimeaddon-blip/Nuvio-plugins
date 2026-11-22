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



// XPass scraper for Nuvio (xpass11.js v1.1.9) — RENAMED from DooFlix
// (dooflix11.js v1.1.0, same code) at the user's request: XPass is the
// service's original name. Standalone, sandbox-compatible (WebCrypto for
// SHA-256 + AES-256-GCM).
// v1.1.9: SUNSYNC HARDCODED. Device verdict (PHM on 1.2.245): the SubSync
// subtitle never appeared on the phone even though the sandbox attaches
// it — the runtime index fetch (raw.githubusercontent.com) does not
// complete on device, so BOTH the SubSync path and the best-effort
// fallback silently attach nothing. The 4 index titles' .srt URLs are
// now hardcoded, so their attach is a pure string operation with ZERO
// fetches and cannot fail on device. The index fetch stays as a fallback
// for future titles added to the index. The SubSync subtitle also now
// carries an explicit id. Best-effort + all XPass logic unchanged.
// v1.1.8: SUBTITLES (pilot). XPass rows carry no release name, so the
// release-matched helper attaches 0. New best-effort layer: the pre-synced
// SubSync subtitle (Sunsync index) wins when the title is in the index;
// else ONE best-effort pick per row from SubDL -> Wyzie -> mirror
// (resolution match, then popularity; Wyzie downloadCount/quality).
// SubDL download URLs are stripped of their api_key param (the file
// serves anonymously) so the attached URL never reveals a key.
// Best-effort is NOT a release-matched guarantee — the device test
// decides whether it is good enough. All XPass logic, gate, servers
// and the pattern allowlist unchanged.
// v1.1.7: worker hosts ROTATE, so the allowlist + redirector now match by
// pattern (cflul.ne<digits>, cfmix.<id>) instead of an enumerated list
// that broke at every rotation (ne3 -> ne4 -> ne9 -> ne6). VIP DROPPED:
// host-wide dead, its segment host mov3.4pa.top Cloudflare-403s every
// segment for every title. TIK kept (per-title: Malcolm's TikTok CDN
// objects are gone, Matrix plays fine). LUL ne6 verified live end to end
// for Malcolm S1E1 (tnmr master + segments 200).
// v1.1.0: MORE SERVERS. The embed's signed data endpoint lists ~26
// servers per title, but v1.0.0 only returned VIP 1: it capped playlist
// fetches at 8 (so MIX/LUL/BIG were never fetched) and its host allowlist
// kept only vip/mol. Probe-verified live on The Matrix and ADDED here:
// tik.1x2.space (TIK/FIL, direct HLS, 206 with xpass Referer),
// cflul.ne3.workers.dev (LUL, 302s to a live tnmr.org HLS master, 8h
// token — resolved server-side like MOL), cfmix.bx7.workers.dev (MIX,
// direct mp4, 200). NOT added (probe-verified dead/unproven):
// suprox.xpass.top (WIS 1, 404), cfbw.p2l.workers.dev (BIG, 404),
// se8x.clarvista.shop (VID 1, host unreachable). SAF/VXR/VRK return
// /video/error at the source (already filtered). Request cap raised 8→22
// so every listed server is fetched, not just the first 8.
// v1.1.1: LUL host moved cflul.ne3.workers.dev → ne4.workers.dev
// (the worker subdomain rotates); allowlist BOTH ne3 and ne4 so LUL
// streams are not dropped when the live subdomain changes.
// Source: XPass provider — fetches XPass embed, decrypts the signed data
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

var ALLOWED_SOURCE_HOSTNAMES = {
  "mol.1x2.space": true, "tik.1x2.space": true,
};
// Worker hosts ROTATE (LUL ne3 -> ne4 -> ne9 -> ne6, MIX bx7 -> p6l):
// an enumerated list breaks at every rotation and drops live servers.
// Match by pattern instead. VIP DROPPED 2026-11-20: host-wide dead —
// its segment host mov3.4pa.top Cloudflare-403s every segment for every
// title (Malcolm S1E1 + The Matrix, device-confirmed buffering). TIK is
// KEPT: per-title only (Malcolm's TikTok CDN objects are gone, Matrix
// plays fine — dropping it would kill working titles). BIG (cfbw),
// WIS (suprox) and FIL (cfd) are NOT added: probed dead (404/504).
// LUL is the live server for Malcolm S1E1 (tnmr master + segments 200).
function isWorkerHost(host) {
  return /^cflul\.ne\d+\.workers\.dev$/.test(host || "") || /^cfmix\.[a-z0-9]+\.workers\.dev$/.test(host || "");
}
// mol.1x2.space and cflul.ne3.workers.dev file URLs are REDIRECTORS:
// a live one 302s to the real signed HLS master (MOL → rotating
// prx-*.vmpx.online, 12h expiry; LUL → tnmr.org, 8h expiry, probe-verified
// still 200 after 60s). Master/variant/segments probe-verified 200 with
// the standard playback headers. The app player cannot follow that
// cross-host jump for an HLS master, so these streams failed at playback
// while VIP (direct 200) played. A dead mol entry 302s to the bare
// /playlist/ root instead (probe-verified stable); a dead LUL entry 404s.
// So: resolve each redirect here, emit the final master URL, and drop
// entries proven dead rather than handing the player a guaranteed failure.
// Resolution errors keep the original URL (unproven either way; the
// device may still succeed).
function isDeadPlaylistRoot(u) {
  try {
    var p = new URL(u);
    return p.hostname === "mol.1x2.space" && (p.pathname === "/playlist/" || p.pathname === "/playlist");
  } catch (e) { return false; }
}

function resolveRedirector(url) {
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
      if (status >= 400) return { url: null }; // proven dead (e.g. LUL 404)
      return { url: url };
    }).catch(function () { return { url: url }; });
  };
  return step();
}

var REDIRECTOR_HOSTNAMES = { "mol.1x2.space": true };
// LUL is a redirector (302 -> tnmr.org HLS master, 8h token) at ANY
// cflul.ne<digits> host; mol too. Other worker hosts (MIX) are direct.
function isRedirectorHost(host) {
  return host === "mol.1x2.space" || /^cflul\.ne\d+\.workers\.dev$/.test(host || "");
}

function resolveRedirectorStreams(streams) {
  return Promise.all(streams.map(function (s) {
    var host = "";
    try { host = new URL(s.url).hostname; } catch (e) {}
    if (!isRedirectorHost(host)) return s;
    return resolveRedirector(s.url).then(function (res) {
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
  if (encrypted.length <= 12 + 16) throw new Error("XPass: response too short");
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
      if (typeof errObj.error === "string") throw new Error("XPass: " + errObj.error);
    } catch (e) {
      if (e.message.indexOf("XPass:") === 0) throw e;
    }
  }
  var endpoint;
  try { endpoint = new URL(dataUrl, XPASS_BASE); } catch (e) { throw new Error("XPass: bad dataUrl"); }
  var token = endpoint.searchParams.get("token");
  if (!token || token.split(".").length !== 2 || !/^[0-9a-f]{64}$/i.test(token.split(".")[1])) {
    throw new Error("XPass: invalid XPass data token");
  }
  var keyMaterial = "spv3-data-response|" + XPASS_DATA_BUILD + "|" + endpoint.pathname + "|" + token;
  var encrypted = base64UrlToBytes(trimmed);
  return sha256Bytes(keyMaterial).then(function (key) {
    return aesGcmDecrypt(encrypted, key);
  }).then(function (plaintext) {
    var entries = JSON.parse(plaintext);
    if (!Array.isArray(entries)) throw new Error("XPass: not a backup list");
    return entries.filter(function (e) {
      return e && typeof e === "object" && e.dl !== true &&
        typeof e.name === "string" && typeof e.url === "string" && e.url.length > 0;
    });
  });
}

function isAllowedSource(sourceFile) {
  try { var h = new URL(sourceFile).hostname; return !!ALLOWED_SOURCE_HOSTNAMES[h] || isWorkerHost(h); }
  catch (e) { return false; }
}

function fetchPlaylistStreams(playlistUrl, embedUrl, sourceLabel, season, episode, mediaTitle, mediaYear, mediaRuntime) {
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
          var streamQuality = /(\d{3,4})p/i.exec(label) ? /(\d{3,4})p/i.exec(label)[1] + "p" : "Unknown";
          var streamSize = formatStreamSize({ title: mediaTitle, year: mediaYear, runtime: mediaRuntime, quality: streamQuality, season: season, episode: episode, source: "XPass", url: source.file });
          streams.push({
            name: "XPass",
            title: "XPass",
            size: streamSize,
            url: source.file,
            quality: streamQuality,
            type: "direct",
            headers: PLAYBACK_HEADERS,
            behaviorHints: PLAYBACK_HINTS,
          });
        });
      });
      return streams;
    }).catch(function () { return []; });
}

function getXpassStreams(imdbId, kind, season, episode, mediaTitle, mediaYear, mediaRuntime) {
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
        if (!tried[b.url] && requests.length < 22) { tried[b.url] = true; requests.push({ path: b.url, label: b.name }); }
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
                  if (!tried[b.url] && requests.length < 22) { tried[b.url] = true; requests.push({ path: b.url, label: b.name }); }
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
            if (!isAllowedSource(req.path)) return [];
            var backupSize = formatStreamSize({ title: mediaTitle, year: mediaYear, runtime: mediaRuntime, quality: "Unknown", season: kind === "tv" ? season : undefined, episode: kind === "tv" ? episode : undefined, source: "XPass", url: req.path });
            return [{
              name: "XPass", title: "XPass", size: backupSize,
              url: req.path, quality: "Unknown", type: "direct",
              headers: PLAYBACK_HEADERS, behaviorHints: PLAYBACK_HINTS,
            }];
          }
          return fetchPlaylistStreams(url, embedUrl, req.label, kind === "tv" ? season : undefined, kind === "tv" ? episode : undefined, mediaTitle, mediaYear, mediaRuntime);
        }));
      }).then(function (all) {
        var seen = {}, out = [];
        all.forEach(function (arr) {
          arr.forEach(function (s) { if (!seen[s.url]) { seen[s.url] = true; out.push(s); } });
        });
        return out;
      }).then(function (out) { return resolveRedirectorStreams(out); });
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



// ===== Subtitle helper (inlined from test/subtitle_attach.js) =====
// SubDL PRIMARY -> Wyzie SECOND -> OpenSubtitles mirror BACKUP.
// Release-name matching only; XPass rows have no release name, so
// osAttachSubtitles attaches 0 here — the XPass best-effort layer
// below is what actually picks subtitles for this provider.
var OS_MIRROR = 'https://opensubtitles-v3.strem.io';
var SD_API = 'https://api.subdl.com/api/v2/subtitles/search';
var SD_DL = 'https://dl.subdl.com';
var WZ_API = 'https://sub.wyzie.io/search';
// Secret gist holding the user's tokens (same file the showbox/gramcinema
// tokens live in). SCRAPER_SETTINGS always wins; the gist is only read when
// a key is missing from settings. The keys are never in the repo.
var TOKEN_FILE_URL = 'https://gist.githubusercontent.com/rareanimeaddon-blip/6fc363ac74cb8921d61c07a2c6bb59d6/raw/gistfile1.txt';
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
  return '';
}
function getSubdlKeys(cfg) {
  var k1 = _setting(cfg, 'subdlApiKey');
  var k2 = _setting(cfg, 'subdlApiKey2');
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
  var k1 = _setting(cfg, 'wyzieApiKey');
  var k2 = _setting(cfg, 'wyzieApiKey2');
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
function osTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (t) { return t.length > 0; });
}
function osGroup(name) {
  var s = String(name || '');
  // Last parenthesised chunk that is NOT just a year (e.g. "(2026)") — the
  // year is not a release group, and treating it as one makes every
  // same-year release "match" (+4). Skip pure years / pure numbers.
  var groups = s.match(/\(([^)]+)\)/g) || [];
  for (var gi = groups.length - 1; gi >= 0; gi--) {
    var g = groups[gi].replace(/[()]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s*4khdhub\s*$/, '').trim();
    if (!g) continue;
    if (/^\d{4}$/.test(g) || /^\d+$/.test(g)) continue;
    return g;
  }
  var m = s.match(/[-.]([A-Za-z][A-Za-z0-9]{1,})\s*$/);
  if (m) return m[1].toLowerCase();
  return '';
}
function osReleaseFeatures(name) {
  var toks = osTokens(name);
  var set = {};
  for (var i = 0; i < toks.length; i++) set[toks[i]] = true;
  var squashed = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  var source = '';
  if (squashed.indexOf('bluray') !== -1) source = 'bluray';
  else if (squashed.indexOf('webdl') !== -1) source = 'webdl';
  else if (squashed.indexOf('webrip') !== -1) source = 'webrip';
  else if (squashed.indexOf('hdtv') !== -1) source = 'hdtv';
  else if (squashed.indexOf('dvdrip') !== -1) source = 'dvdrip';
  else if (set['ts'] || set['telesync']) source = 'ts';
  return {
    group: osGroup(name),
    source: source,
    res: set['2160p'] ? '2160p' : set['1080p'] ? '1080p' : set['720p'] ? '720p' : set['480p'] ? '480p' : '',
    codec: (set['x265'] || set['hevc'] || squashed.indexOf('h265') !== -1) ? 'hevc' : (set['x264'] || set['avc'] || squashed.indexOf('h264') !== -1) ? 'avc' : '',
    imax: !!set['imax'],
    remux: !!set['remux']
  };
}
function osScore(fileF, subF) {
  var s = 0;
  if (fileF.group && subF.group && fileF.group === subF.group) s += 4;
  else if (fileF.group && subF.group) {
    var fg = fileF.group.split(' '), sg = subF.group.split(' ');
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
function osMirrorSubs(imdbId, isSeries, season, episode) {
  var path = isSeries
    ? '/subtitles/series/' + imdbId + ':' + season + ':' + episode + '.json'
    : '/subtitles/movie/' + imdbId + '.json';
  return fetch(OS_MIRROR + path).then(function (r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function (j) {
    var list = (j && j.subtitles) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var lang = String(it.lang || '').toLowerCase();
      if (lang !== 'eng' && lang !== 'en') continue;
      var url = it.url || '';
      if (url.indexOf('https://') !== 0) continue;
      var host = '';
      try { host = new URL(url).hostname; } catch (e) {}
      if (host.indexOf('strem.io') === -1) continue;
      var rel = it.movieReleaseName || it.subtitleFileName || '';
      if (!rel) continue;
      out.push({ id: it.id, url: url, release: rel });
    }
    return out;
  }).catch(function () { return []; });
}
// Try each SubDL key in order; the first key that returns a usable list wins.
// A 401/429/non-ok response falls through to the next key. Returns [] if all fail.
// NOTE: the JSON parse is nested INSIDE the r.ok branch — a failed key's
// attempt() must return directly, not flow into the JSON-parsing .then()
// (that swallowed the good key's result: the array has no .subtitles).
function sdSearchSubs(imdbId, year, keys) {
  if (!keys || !keys.length) return Promise.resolve([]);
  var u = SD_API + '?imdb_id=' + encodeURIComponent(imdbId) + '&year=' + year + '&languages=en&type=movie';
  var idx = 0;
  var attempt = function () {
    if (idx >= keys.length) return Promise.resolve([]);
    var key = keys[idx++];
    return fetch(u, { headers: { 'Authorization': 'Bearer ' + key } }).then(function (r) {
      if (!r.ok) return attempt();
      return r.json().then(function (j) {
        var list = (j && j.subtitles) || [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var it = list[i] || {};
          if (String(it.language || '').toLowerCase() !== 'en') continue;
          var rel = it.release_name || '';
          var url = it.url || '';
          if (!rel || !url) continue;
          out.push({ id: it.id, url: SD_DL + url, release: rel });
        }
        if (!out.length) return attempt();
        return out;
      }).catch(function () { return attempt(); });
    }).catch(function () { return attempt(); });
  };
  return attempt();
}
// Wyzie search — ONE call per title (not per row); the result is reused
// across rows. The first still-needing row's release filename is passed via
// video= so Wyzie returns a match score (0-100) for that release. The key
// is a QUERY parameter, never a header. AI-translated rows are skipped.
// A 401/429/non-ok response falls through to the next key. Returns [] if all fail.
// The emitted url is a sub.wyzie.io/c/... link (tok param) — it does NOT
// reveal the API key, so it is safe to attach to a stream row.
function wzSearchSubs(imdbId, isSeries, season, episode, videoName, keys) {
  if (!keys || !keys.length) return Promise.resolve([]);
  var u = WZ_API + '?id=' + encodeURIComponent(imdbId) + '&language=en';
  if (isSeries) u += '&season=' + season + '&episode=' + episode;
  if (videoName) u += '&video=' + encodeURIComponent(videoName);
  var idx = 0;
  var attempt = function () {
    if (idx >= keys.length) return Promise.resolve([]);
    var key = keys[idx++];
    return fetch(u + '&key=' + encodeURIComponent(key)).then(function (r) {
      if (!r.ok) return attempt();
      return r.json().then(function (j) {
        var list = Array.isArray(j) ? j : [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var it = list[i] || {};
          if (it.ai) continue;
          var lang = String(it.language || '').toLowerCase();
          if (lang !== 'en' && lang !== 'eng') continue;
          var url = it.url || '';
          if (url.indexOf('https://sub.wyzie.io/') !== 0) continue;
          var rel = it.release || '';
          var rels = Array.isArray(it.releases) ? it.releases : [];
          if (!rel && !rels.length) continue;
          var ms = 0;
          try { if (it.match && typeof it.match.score === 'number') ms = it.match.score; } catch (e) {}
          out.push({ id: it.id, url: url, release: rel, releases: rels, hi: !!it.isHearingImpaired, format: String(it.format || '').toLowerCase(), matchScore: ms });
        }
        if (!out.length) return attempt();
        return out;
      }).catch(function () { return attempt(); });
    }).catch(function () { return attempt(); });
  };
  return attempt();
}
// Wyzie best match: score the release name AND every releases entry with the
// existing scorer, take the best. NOTE: Wyzie's own match.score is NOT used
// to force a match — it is too lenient for generic video filenames (a bare
// "Title Year 1080p h264" with no group/source scores 100 against many
// unrelated releases, which would attach the wrong subtitle). The
// release/releases token scorer is the matcher; video= only sorts results
// best-first. Prefer srt/vtt over other formats and non-HI over HI.
// Attach at >=4.
function wzBestMatch(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0, bestPref = -1;
  for (var k = 0; k < subs.length; k++) {
    var sub = subs[k];
    var sc = osScore(ff, osReleaseFeatures(sub.release || ''));
    var rels = sub.releases || [];
    for (var r = 0; r < rels.length; r++) {
      var s2 = osScore(ff, osReleaseFeatures(rels[r]));
      if (s2 > sc) sc = s2;
    }
    var pref = 0;
    if (sub.format === 'srt' || sub.format === 'vtt') pref += 2;
    if (!sub.hi) pref += 1;
    if (sc > bestScore || (sc === bestScore && sc >= 4 && pref > bestPref)) {
      bestScore = sc; best = sub; bestPref = pref;
    }
  }
  return (best && bestScore >= 4) ? best : null;
}
function osAttachSubtitles(rows, imdbId, isSeries, season, episode, cfg) {
  try {
    if (cfg && cfg.osSubtitles === false) return Promise.resolve(rows);
    if (!imdbId || !rows || !rows.length) return Promise.resolve(rows);
    var year = cfg && cfg.year ? cfg.year : 0;
    var cleanup = function () {
      for (var c = 0; c < rows.length; c++) { try { delete rows[c]._rel; delete rows[c]._releaseTitle; } catch (e) {} }
      return rows;
    };
    var prep = function () {
      for (var i = 0; i < rows.length; i++) {
        var rel = rows[i]._releaseTitle || '';
        if (!rel && rows[i].url) {
          try { rel = decodeURIComponent(String(rows[i].url).split('/').pop() || '').replace(/\.[^.]+$/, ''); } catch (e) {}
        }
        rows[i]._rel = rel;
      }
    };
    // 1. SubDL FIRST (primary). 2. Wyzie SECOND for rows SubDL missed.
    // 3. Mirror as BACKUP for rows SubDL and Wyzie missed.
    return getSubdlKeys(cfg).then(function (keys) {
      prep();
      var need = rows.slice();
      var useSubdl = function () {
        if (!keys.length) return Promise.resolve(need);
        return sdSearchSubs(imdbId, year, keys).then(function (sdSubs) {
          var still = [];
          for (var i = 0; i < need.length; i++) {
            var hit = osBestMatch(need[i]._rel, sdSubs);
            if (hit) need[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
            else still.push(need[i]);
          }
          return still;
        }).catch(function () { return need; });
      };
      var useWyzie = function (still) {
        if (!still.length) return Promise.resolve(still);
        return getWyzieKeys(cfg).then(function (wzKeys) {
          if (!wzKeys.length) return still;
          var videoName = '';
          for (var v = 0; v < still.length; v++) { if (still[v]._rel) { videoName = still[v]._rel; break; } }
          return wzSearchSubs(imdbId, isSeries, season, episode, videoName, wzKeys).then(function (wzSubs) {
            var rest = [];
            for (var i = 0; i < still.length; i++) {
              var hit = wzBestMatch(still[i]._rel, wzSubs);
              if (hit) still[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
              else rest.push(still[i]);
            }
            return rest;
          }).catch(function () { return still; });
        }).catch(function () { return still; });
      };
      return useSubdl().then(function (still) {
        return useWyzie(still);
      }).then(function (still) {
        if (!still.length) return cleanup();
        return osMirrorSubs(imdbId, isSeries, season, episode).then(function (mirrorSubs) {
          for (var j = 0; j < still.length; j++) {
            var hit2 = osBestMatch(still[j]._rel, mirrorSubs);
            if (hit2) still[j].subtitles = [{ id: String(hit2.id), url: hit2.url, lang: 'en' }];
          }
          return cleanup();
        }).catch(function () { return cleanup(); });
      });
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

// ===== XPass best-effort subtitles (pilot, v1.1.8) =====
// XPass rows carry NO release name (playlist JSON has only {file, type,
// label, id}; labels are server names or bare resolutions), so the
// release-matched helper (osAttachSubtitles) attaches 0. This layer picks
// ONE subtitle per row from SubDL -> Wyzie -> mirror by IMDb id (+ season/
// episode for TV), ranked by:
//   (a) resolution match with the row's quality (when the row has one),
//   (b) popularity/quality — Wyzie returns downloadCount + quality.score;
//       SubDL and the mirror return NO download counts, so for those the
//       API's return order is the only popularity signal,
//   (c) srt/vtt format preferred, non-HI preferred, Wyzie ai:true skipped.
// BEST-EFFORT, NOT a release-matched guarantee: without a release name
// the pick may occasionally be timed for a different release of the same
// title. The device test decides whether it is good enough in practice.
// Priority: the pre-synced SubSync subtitle (Sunsync index,
// ffsubsync-corrected) wins when the title is in the index — it is the
// most likely to actually be in sync. Best-effort only covers titles
// the index does not have. Cost: ONE search per title per source,
// reused across rows; a source is skipped for a row once an earlier
// source has attached for that row. Never throws.
function xpStripApiKey(u) {
  // SubDL download URLs carry ?api_key=<key> but the file serves fine
  // without it (verified: anonymous HEAD 200, range GET 200 — the
  // 300/day/IP anonymous limit the helper comment mentions). Strip it so
  // the attached subtitle URL (and its id) never reveal the API key.
  try {
    var s = String(u || '');
    var k = s.indexOf('api_key=');
    if (k === -1) return s;
    var start = k;
    if (start > 0 && (s.charAt(start - 1) === '?' || s.charAt(start - 1) === '&')) start--;
    var end = s.indexOf('&', k);
    var tail = (end === -1) ? '' : s.slice(end + 1);
    var head = s.slice(0, start);
    if (!tail) {
      if (head.charAt(head.length - 1) === '?' || head.charAt(head.length - 1) === '&') head = head.slice(0, -1);
      return head;
    }
    return head + (head.indexOf('?') === -1 ? '?' : '&') + tail;
  } catch (e) { return u; }
}
function xpSdSearchBE(imdbId, year, keys) {
  // SubDL best-effort search. Same endpoint/params as sdSearchSubs.
  // Captures hi + a stable id (SubDL items carry no id field).
  // Returns [{id, url, release, hi, idx}]. No download counts exist in
  // the SubDL response, so idx (return order) is the popularity signal.
  if (!keys || !keys.length) return Promise.resolve([]);
  var u = SD_API + '?imdb_id=' + encodeURIComponent(imdbId) + '&year=' + year + '&languages=en&type=movie';
  var idx = 0;
  var attempt = function () {
    if (idx >= keys.length) return Promise.resolve([]);
    var key = keys[idx++];
    return fetch(u, { headers: { 'Authorization': 'Bearer ' + key } }).then(function (r) {
      if (!r.ok) return attempt();
      return r.json().then(function (j) {
        var list = (j && j.subtitles) || [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var it = list[i] || {};
          if (String(it.language || '').toLowerCase() !== 'en') continue;
          var rel = it.release_name || '';
          var url = it.url || '';
          if (!rel || !url) continue;
          var cleanUrl = xpStripApiKey(SD_DL + url);
          var sid = it.id ? String(it.id) : ('sd-' + cleanUrl.split('/').pop());
          out.push({ id: sid, url: cleanUrl, release: rel, hi: !!it.hi, idx: i });
        }
        if (!out.length) return attempt();
        return out;
      }).catch(function () { return attempt(); });
    }).catch(function () { return attempt(); });
  };
  return attempt();
}
function xpWzSearchBE(imdbId, isSeries, season, episode, keys) {
  // Wyzie best-effort search. Same endpoint as wzSearchSubs but WITHOUT
  // video= (XPass has no release filename to pass). Captures downloadCount
  // + quality.score for popularity ranking, plus format/hi/ai.
  // Returns [{id, url, release, releases, hi, format, downloads, quality, idx}].
  if (!keys || !keys.length) return Promise.resolve([]);
  var u = WZ_API + '?id=' + encodeURIComponent(imdbId) + '&language=en';
  if (isSeries) u += '&season=' + season + '&episode=' + episode;
  var idx = 0;
  var attempt = function () {
    if (idx >= keys.length) return Promise.resolve([]);
    var key = keys[idx++];
    return fetch(u + '&key=' + encodeURIComponent(key)).then(function (r) {
      if (!r.ok) return attempt();
      return r.json().then(function (j) {
        var list = Array.isArray(j) ? j : [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var it = list[i] || {};
          if (it.ai) continue;
          var lang = String(it.language || '').toLowerCase();
          if (lang !== 'en' && lang !== 'eng') continue;
          var url = it.url || '';
          if (url.indexOf('https://sub.wyzie.io/') !== 0) continue;
          var rel = it.release || '';
          var rels = Array.isArray(it.releases) ? it.releases : [];
          if (!rel && !rels.length) continue;
          var dl = 0;
          try { if (typeof it.downloadCount === 'number') dl = it.downloadCount; } catch (e) {}
          var qs = 0;
          try { if (it.quality && typeof it.quality.score === 'number') qs = it.quality.score; } catch (e) {}
          out.push({ id: String(it.id), url: url, release: rel, releases: rels, hi: !!it.isHearingImpaired, format: String(it.format || '').toLowerCase(), downloads: dl, quality: qs, idx: i });
        }
        if (!out.length) return attempt();
        return out;
      }).catch(function () { return attempt(); });
    }).catch(function () { return attempt(); });
  };
  return attempt();
}
function xpMirrorSearchBE(imdbId, isSeries, season, episode) {
  // Mirror best-effort search. Same endpoint as osMirrorSubs.
  // Returns [{id, url, release, idx}]. No download counts exist in the
  // mirror response, so idx (return order) is the popularity signal.
  var path = isSeries
    ? '/subtitles/series/' + imdbId + ':' + season + ':' + episode + '.json'
    : '/subtitles/movie/' + imdbId + '.json';
  return fetch(OS_MIRROR + path).then(function (r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function (j) {
    var list = (j && j.subtitles) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var lang = String(it.lang || '').toLowerCase();
      if (lang !== 'eng' && lang !== 'en') continue;
      var url = it.url || '';
      if (url.indexOf('https://') !== 0) continue;
      var host = '';
      try { host = new URL(url).hostname; } catch (e) {}
      if (host.indexOf('strem.io') === -1) continue;
      var rel = it.movieReleaseName || it.subtitleFileName || '';
      if (!rel) continue;
      out.push({ id: String(it.id), url: url, release: rel, idx: i });
    }
    return out;
  }).catch(function () { return []; });
}
function xpRowRes(quality) {
  var q = String(quality || '').toLowerCase();
  if (q.indexOf('2160') !== -1) return '2160p';
  if (q.indexOf('1080') !== -1) return '1080p';
  if (q.indexOf('720') !== -1) return '720p';
  if (q.indexOf('480') !== -1) return '480p';
  if (q.indexOf('360') !== -1) return '360p';
  return '';
}
function xpKeyGt(a, b) {
  for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
function xpBestPick(rowQuality, cands) {
  // Rank one source's candidates for one row. Returns the best or null.
  // Key: resolution match (+1) > srt/vtt format (+1) > non-HI (+1),
  // then popularity (Wyzie downloadCount desc, quality.score desc),
  // then API return order (earlier = better). A candidate is pickable
  // even with no resolution match — the row quality is usually
  // "Unknown" on XPass, so there is often nothing to match against.
  if (!cands || !cands.length) return null;
  var want = xpRowRes(rowQuality);
  var best = null, bestKey = null;
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    var resHit = 0;
    if (want) {
      if (osReleaseFeatures(c.release || '').res === want) resHit = 1;
      else {
        var rels = c.releases || [];
        for (var r = 0; r < rels.length; r++) {
          if (osReleaseFeatures(rels[r]).res === want) { resHit = 1; break; }
        }
      }
    }
    var fmt = 0;
    if (c.format === 'srt' || c.format === 'vtt') fmt = 1;
    else if (!c.format && c.url) {
      var u = String(c.url).toLowerCase();
      if (u.indexOf('.srt') !== -1 || u.indexOf('.vtt') !== -1) fmt = 1;
    }
    var nonHi = c.hi ? 0 : 1;
    var dl = (typeof c.downloads === 'number') ? c.downloads : 0;
    var qs = (typeof c.quality === 'number') ? c.quality : 0;
    var key = [resHit, fmt, nonHi, dl, qs, -c.idx];
    if (!bestKey || xpKeyGt(key, bestKey)) { bestKey = key; best = c; }
  }
  return best;
}
function xpAttachBestEffort(rows, imdbId, isSeries, season, episode, cfg) {
  // Best-effort attachment for rows with no release name. ONE search per
  // title per source (SubDL -> Wyzie -> mirror), reused across rows. Per
  // row, the first source that yields a pick wins; at most ONE subtitle
  // per row. Never throws; returns rows unchanged on any failure.
  try {
    if (!imdbId || !rows || !rows.length) return Promise.resolve(rows);
    var year = cfg && cfg.year ? cfg.year : 0;
    var need = rows.slice();
    var useSubdl = function () {
      return getSubdlKeys(cfg).then(function (keys) {
        if (!keys.length) return need;
        return xpSdSearchBE(imdbId, year, keys).then(function (subs) {
          var still = [];
          for (var i = 0; i < need.length; i++) {
            var hit = xpBestPick(need[i].quality, subs);
            if (hit) need[i].subtitles = [{ id: hit.id, url: hit.url, lang: 'en' }];
            else still.push(need[i]);
          }
          return still;
        }).catch(function () { return need; });
      }).catch(function () { return need; });
    };
    var useWyzie = function (still) {
      if (!still.length) return Promise.resolve(still);
      return getWyzieKeys(cfg).then(function (keys) {
        if (!keys.length) return still;
        return xpWzSearchBE(imdbId, isSeries, season, episode, keys).then(function (subs) {
          var rest = [];
          for (var i = 0; i < still.length; i++) {
            var hit = xpBestPick(still[i].quality, subs);
            if (hit) still[i].subtitles = [{ id: hit.id, url: hit.url, lang: 'en' }];
            else rest.push(still[i]);
          }
          return rest;
        }).catch(function () { return still; });
      }).catch(function () { return still; });
    };
    var useMirror = function (still) {
      if (!still.length) return Promise.resolve(rows);
      return xpMirrorSearchBE(imdbId, isSeries, season, episode).then(function (subs) {
        for (var j = 0; j < still.length; j++) {
          var hit = xpBestPick(still[j].quality, subs);
          if (hit) still[j].subtitles = [{ id: hit.id, url: hit.url, lang: 'en' }];
        }
        return rows;
      }).catch(function () { return rows; });
    };
    return useSubdl().then(function (still) { return useWyzie(still); }).then(function (still) { return useMirror(still); });
  } catch (e) { return Promise.resolve(rows); }
}
function xpAttachSubtitles(rows, imdbId, tmdbId, kind, season, episode, year) {
  // XPass subtitle attachment (pilot). Priority:
  //   (1) SubSync pre-synced subtitle (Sunsync index, ffsubsync-corrected)
  //       when the title is in the index — the most likely to be in sync.
  //   (2) Best-effort pick (SubDL -> Wyzie -> mirror) for titles the
  //       index does not cover.
  // Never throws; returns rows unchanged on any failure. The SubSync
  // postlude wrapper still runs after this and fills any row left bare.
  try {
    if (!rows || !rows.length) return Promise.resolve(rows);
    var cfg = {
      osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
      subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
      subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
      wyzieApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.wyzieApiKey : undefined,
      wyzieApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.wyzieApiKey2 : undefined,
      year: year || 0
    };
    if (cfg.osSubtitles === false) return Promise.resolve(rows);
    var isSeries = (kind === 'tv');
    if (isSeries) { season = season || 1; episode = episode || 1; }
    var doBest = function () {
      return xpAttachBestEffort(rows, imdbId, isSeries, season, episode, cfg);
    };
    var SS = null;
    try {
      SS = (typeof globalThis !== 'undefined' && globalThis.SubSync) || (typeof global !== 'undefined' ? global.SubSync : null);
    } catch (e) { SS = null; }
    if (SS && typeof SS.getSubtitle === 'function') {
      try {
        var p = SS.getSubtitle(tmdbId, kind, 'en', season, episode);
        if (p && typeof p.then === 'function') {
          return p.then(function (sub) {
            if (sub) {
              for (var i = 0; i < rows.length; i++) {
                if (!rows[i].subtitles || !rows[i].subtitles.length) rows[i].subtitles = [sub];
              }
              return rows;
            }
            return doBest();
          }, function () { return doBest(); });
        }
        if (p) {
          for (var j = 0; j < rows.length; j++) {
            if (!rows[j].subtitles || !rows[j].subtitles.length) rows[j].subtitles = [p];
          }
          return Promise.resolve(rows);
        }
      } catch (e) {}
    }
    return doBest();
  } catch (e) { return Promise.resolve(rows); }
}


function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var titleP = fetchWithTimeout("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, {}, 10000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return { title: "", year: "", runtime: 0 };
      var t = j.title || j.name || "";
      var d = j.release_date || j.first_air_date || "";
      var rt = 0;
      if (typeof j.runtime === "number" && j.runtime > 0) rt = j.runtime;
      else if (Array.isArray(j.episode_run_time) && j.episode_run_time.length && j.episode_run_time[0] > 0) rt = j.episode_run_time[0];
      return { title: t, year: d ? String(d).slice(0, 4) : "", runtime: rt };
    }).catch(function () { return { title: "", year: "", runtime: 0 }; });
  // TV: show-level episode_run_time is often empty — fetch the episode itself for its runtime.
  var epRtP = Promise.resolve(0);
  if (kind === "tv") {
    epRtP = fetchWithTimeout("https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + (seasonNum || 1) + "/episode/" + (episodeNum || 1) + "?api_key=" + TMDB_API_KEY, {}, 10000)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && typeof j.runtime === "number" && j.runtime > 0) ? j.runtime : 0; })
      .catch(function () { return 0; });
  }
  return Promise.all([tmdbToImdb(tmdbId, mediaType), titleP, epRtP]).then(function (res) {
    var imdbId = res[0];
    var meta = res[1] || { title: "", year: "" };
    if (!meta.runtime && res[2] > 0) meta.runtime = res[2];
    if (!imdbId) return [];
    var rowsP = (kind === "movie")
      ? getXpassStreams(imdbId, "movie", undefined, undefined, meta.title, meta.year, meta.runtime)
      : getXpassStreams(imdbId, "tv", seasonNum || 1, episodeNum || 1, meta.title, meta.year, meta.runtime);
    return rowsP.then(function (rows) {
      return xpAttachSubtitles(rows, imdbId, tmdbId, kind, seasonNum, episodeNum, meta.year);
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.XPassScraperModule = { getStreams: getStreams };
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

// ===== SubSync helper (inlined from Sunsync helper/subsync.js) =====
// subsync.js — Nuvio provider helper for nuvio-subsync (GitHub-hosted).
//
// The sync service lives entirely on GitHub (no server, no paid account):
// a scheduled GitHub Action fetches subtitles from SubDL + Wyzie (free),
// syncs them with ffsubsync, and commits the synced .srt files + index.json
// to the nuvio-subsync repo. This helper reads that index and swaps the
// synced subtitle URL into a stream.
//
// Usage inside a provider's getStreams, after streams are resolved:
//   var sub = await SubSync.getSubtitle(tmdbId, mediaType, "en");
//   if (sub) { stream.subtitles = [sub]; }
//
// Or, to attach to every stream that has no subtitle yet:
//   var subs = await SubSync.getSubtitles(tmdbId, mediaType, "en");
//   streams.forEach(function (s) { if (!s.subtitles || !s.subtitles.length) s.subtitles = subs; });
//
// Rules (same as every Nuvio provider):
// - Never throws. Any failure returns null / [] and the provider carries on
//   with whatever subtitle it already had (or none).
// - Never blocks the stream list: the index fetch has a short timeout and
//   the result is cached in memory for the life of the provider call.
// - WebOS-safe: no setTimeout, no optional chaining, no matchAll, no .at().
//
// SET THIS to the repo that hosts the synced subtitles:
//   "https://raw.githubusercontent.com/rareanimeaddon-blip/Sunsync/main"
// Override at runtime with SubSync.setBase(url) (useful for tests).
var SUBSYNC_BASE = "https://raw.githubusercontent.com/rareanimeaddon-blip/Sunsync/main";
// HARDCODED Sunsync files (v1.1.9). The Sunsync index only covers 4
// titles and its runtime fetch does not complete on the user's phone
// (PHM on 1.2.245: no subtitle attached at all, sandbox attaches fine),
// so these 4 are baked in: the attach needs NO fetch and cannot fail on
// device. Keys are the index keys ("tmdbId:lang" movies,
// "tmdbId:s<season>e<episode>:lang" TV). The index fetch below stays as a
// fallback so future titles added to the index still work.
var SUBSYNC_HARDCODED = {
  "603:en": "synced/603-en.srt",
  "687163:en": "synced/687163-en.srt",
  "27205:en": "synced/27205-en.srt",
  "1396:s1e1:en": "synced/1396-s1e1-en.srt"
};

(function () {
  var indexCache = null;
  var indexPromise = null;

  function fetchWithTimeout(url, ms) {
    var timeoutMs = (typeof ms === "number" && ms > 0) ? ms : 3000;
    return new Promise(function (resolve) {
      var done = false;
      var start = Date.now();
      function finish(val) { if (!done) { done = true; resolve(val); } }
      function spin(ms2) { var t = Date.now(); while (Date.now() - t < ms2) {} }
      function attempt() {
        if (done) return;
        fetch(url, {}).then(function (r) {
          if (!r || !r.ok) { finish(null); return; }
          return r.text().then(function (t) { finish(t); }, function () { finish(null); });
        }, function () {
          if (!done && Date.now() - start < timeoutMs) { spin(150); attempt(); }
          else finish(null);
        });
      }
      attempt();
      // Hard cap: the spin loop above bounds the wait, but if fetch hangs
      // without settling, this resolves null on the next tick chain.
      setTimeoutSafe(0);
      function setTimeoutSafe() {
        if (typeof setTimeout === "function") {
          setTimeout(function () { finish(null); }, timeoutMs + 500);
        }
      }
    });
  }

  function getIndex() {
    if (indexCache) return Promise.resolve(indexCache);
    if (indexPromise) return indexPromise;
    indexPromise = fetchWithTimeout(SUBSYNC_BASE + "/index.json", 3000).then(function (text) {
      var parsed = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
      }
      indexCache = parsed || {};
      return indexCache;
    });
    return indexPromise;
  }

  // Returns one subtitle object {id, url, lang, label} for the synced file,
  // or null when this title/language has not been synced yet.
  // TV: pass season and episode — the index key is "tmdbId:s<season>e<episode>:lang"
  // (a series key would mix episodes). Movies: "tmdbId:lang".
  // HARDCODED FIRST (v1.1.9): the 4 index titles resolve synchronously
  // with no fetch, so they attach even when the runtime index fetch
  // fails on device. The index fetch is only a fallback for titles the
  // hardcoded map does not cover.
  function getSubtitle(tmdbId, mediaType, lang, season, episode) {
    var lg = lang || "en";
    try {
      var key = String(tmdbId) + ":" + lg;
      if (mediaType === "tv" && season != null && episode != null) {
        key = String(tmdbId) + ":s" + season + "e" + episode + ":" + lg;
      }
      var hardFile = SUBSYNC_HARDCODED[key];
      if (hardFile) {
        return Promise.resolve({
          id: "sunsync-" + key.replace(/:/g, "-"),
          url: SUBSYNC_BASE + "/" + hardFile,
          lang: lg,
          label: "Sunsync"
        });
      }
    } catch (e) {}
    return getIndex().then(function (index) {
      try {
        var key2 = String(tmdbId) + ":" + lg;
        if (mediaType === "tv" && season != null && episode != null) {
          key2 = String(tmdbId) + ":s" + season + "e" + episode + ":" + lg;
        }
        var entry = index ? index[key2] : null;
        if (!entry || !entry.file) return null;
        return {
          id: "sunsync-" + key2.replace(/:/g, "-"),
          url: SUBSYNC_BASE + "/" + entry.file,
          lang: lg,
          label: "Sunsync"
        };
      } catch (e) { return null; }
    }, function () { return null; });
  }

  function getSubtitles(tmdbId, mediaType, lang, season, episode) {
    return getSubtitle(tmdbId, mediaType, lang, season, episode).then(function (sub) {
      return sub ? [sub] : [];
    });
  }

  function setBase(url) {
    if (typeof url === "string" && url) {
      SUBSYNC_BASE = url.replace(/\/$/, "");
      indexCache = null;
      indexPromise = null;
    }
  }

  var api = { getSubtitle: getSubtitle, getSubtitles: getSubtitles, setBase: setBase };
  // (inlined into xpass: do NOT touch module.exports — xpass owns it)
  if (typeof globalThis !== "undefined") { try { globalThis.SubSync = api; } catch (e) {} }
  if (typeof global !== "undefined") { try { global.SubSync = api; } catch (e) {} }
})();

// __SUBSYNC__ — auto-attach the synced subtitle (Sunsync) to every stream
// that has none. Never throws; if the index has no entry for this title,
// or the fetch fails, streams are returned exactly as xpass resolved them.
(function () {
  try {
    var g = (typeof globalThis !== "undefined") ? globalThis : null;
    var SS = (g && g.SubSync) || (typeof global !== "undefined" ? global.SubSync : null);
    if (!SS || typeof SS.getSubtitle !== "function") return;
    var orig = null;
    if (typeof module !== "undefined" && module.exports && typeof module.exports.getStreams === "function") orig = module.exports.getStreams;
    else if (g && typeof g.getStreams === "function") orig = g.getStreams;
    if (!orig || orig.__subsync) return;
    var wrapped = function (tmdbId, mediaType, seasonNum, episodeNum) {
      return Promise.resolve().then(function () { return orig(tmdbId, mediaType, seasonNum, episodeNum); }).then(function (streams) {
        if (!streams || !streams.length) return streams;
        var sub = null;
        try {
          var p = SS.getSubtitle(tmdbId, mediaType, "en", seasonNum, episodeNum);
          if (p && typeof p.then === "function") {
            return p.then(function (s) {
              if (s) {
                for (var i = 0; i < streams.length; i++) {
                  var st = streams[i];
                  if (!st.subtitles || !st.subtitles.length) st.subtitles = [s];
                }
              }
              return streams;
            }, function () { return streams; });
          }
          sub = p;
        } catch (e) { sub = null; }
        if (sub) {
          for (var i = 0; i < streams.length; i++) {
            var st = streams[i];
            if (!st.subtitles || !st.subtitles.length) st.subtitles = [sub];
          }
        }
        return streams;
      }, function () { return []; });
    };
    wrapped.__subsync = true;
    if (typeof module !== "undefined" && module.exports) module.exports.getStreams = wrapped;
    if (g) { try { g.getStreams = wrapped; } catch (e) {} }
  } catch (e) {}
})();
