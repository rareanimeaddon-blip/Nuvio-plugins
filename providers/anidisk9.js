/* __FETCH_RETRY_PRELUDE__ v4 (webOS TV): the TV plugin fetch service
   intermittently returns status-0 transport failures. Wrap the global
   fetch so a rejection or status-0 response is retried up to 3 attempts.
   NON-BLOCKING on purpose: earlier spin-wait pauses stalled the shared
   fetch path and multiplied every hang to ~31s, blowing the app's
   per-provider budget in full searches. Immediate promise retries cost
   nothing when the route is healthy and still rescue isolated drops. */
(function () {
  try {
    var cur = (typeof fetch !== "undefined") ? fetch : null;
    if (!cur || cur.__nuvioRetry) return;
    var raw = cur;
    var wrapped = function (url, opts) {
      var tries = 0;
      var attempt = function () {
        tries++;
        return raw(url, opts).then(function (r) {
          if (r && r.status === 0 && tries < 3) return attempt();
          return r;
        }, function (e) {
          if (tries < 3) return attempt();
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


/**
 * AniDisk Nuvio Scraper
 * Source: anidisk.org via api.deadbase.host, Hydrax (Abyss) embeds.
 * Flow: TMDB title -> AniDisk search -> pick slug -> watch servers ->
 *       Hydrax resolve -> Abyss decrypt (MD5 + AES-256-CTR) -> segment URLs.
 *
 * Sandbox-safe: pure-JS MD5, WebCrypto AES-CTR, no Node APIs.
 * Segment URLs need Referer: https://player.abyssplayer.com/ (CDN 403s without it).
 */


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
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var API_BASE = "https://api.deadbase.host/api/v1/public";
var SITE_ORIGIN = "https://anidisk.org";
var CHUNK_SIZE = 2097152;
var REQ_TIMEOUT = 15000;

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function apiGet(path) {
  return fetchWithTimeout(API_BASE + path, {
    headers: {
      "User-Agent": UA,
      "origin": SITE_ORIGIN,
      "referer": SITE_ORIGIN + "/",
      "accept": "application/json"
    }
  }, REQ_TIMEOUT).then(function (r) {
    if (r.status === 404) { var e = new Error("not found"); e.status = 404; throw e; }
    if (!r.ok) throw new Error("AniDisk API HTTP " + r.status);
    return r.json();
  });
}

// ---------- pure-JS MD5 (hex of byte array) ----------
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

function keyForString(value) {
  return md5Hex(new TextEncoder().encode(value));
}

function keyForNumber(value) {
  var digits = String(value).split("").map(function (ch) {
    return /\d/.test(ch) ? parseInt(ch, 10) : ch.charCodeAt(0);
  });
  return md5Hex(new Uint8Array(digits));
}

// ---------- AES-256-CTR via pure JS (no WebCrypto) ----------
/**
 * Pure-JavaScript AES-256-CTR decryption (no WebCrypto, no Node.js APIs).
 * Sandbox-safe: uses only var, Uint8Array, Math.
 *
 * CTR mode: decryption == encryption (XOR plaintext/ciphertext with keystream).
 * Keystream block i = AES256_Encrypt(key, counter_i), counter starts at IV,
 * incremented as a 128-bit big-endian integer.
 */

var AES_SBOX = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
]);

var AES_RCON = new Uint8Array([
  0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36
]);

function aesRotWord(w) {
  return ((w << 8) | (w >>> 24)) >>> 0;
}

function aesSubWord(w) {
  return (
    (AES_SBOX[(w >>> 24) & 0xff] << 24) |
    (AES_SBOX[(w >>> 16) & 0xff] << 16) |
    (AES_SBOX[(w >>> 8) & 0xff] << 8) |
    (AES_SBOX[w & 0xff])
  ) >>> 0;
}

// AES-256 key expansion: 32-byte key -> 60 words (240 bytes)
function aes256ExpandKey(keyBytes) {
  var w = new Uint32Array(60);
  var i;
  for (i = 0; i < 8; i++) {
    w[i] = (
      (keyBytes[i * 4] << 24) |
      (keyBytes[i * 4 + 1] << 16) |
      (keyBytes[i * 4 + 2] << 8) |
      (keyBytes[i * 4 + 3])
    ) >>> 0;
  }
  for (i = 8; i < 60; i++) {
    var temp = w[i - 1];
    if (i % 8 === 0) {
      temp = aesSubWord(aesRotWord(temp)) ^ (AES_RCON[(i / 8) - 1] << 24);
    } else if (i % 8 === 4) {
      temp = aesSubWord(temp);
    }
    w[i] = (w[i - 8] ^ temp) >>> 0;
  }
  return w;
}

function aesAddRoundKey(state, w, round) {
  for (var c = 0; c < 4; c++) {
    var word = w[round * 4 + c];
    state[c * 4] ^= (word >>> 24) & 0xff;
    state[c * 4 + 1] ^= (word >>> 16) & 0xff;
    state[c * 4 + 2] ^= (word >>> 8) & 0xff;
    state[c * 4 + 3] ^= word & 0xff;
  }
}

function aesSubBytes(state) {
  for (var i = 0; i < 16; i++) state[i] = AES_SBOX[state[i]];
}

function aesShiftRows(state) {
  var t = new Uint8Array(16);
  t[0] = state[0];  t[4] = state[4];  t[8] = state[8];   t[12] = state[12];
  t[1] = state[5];  t[5] = state[9];  t[9] = state[13];  t[13] = state[1];
  t[2] = state[10]; t[6] = state[14]; t[10] = state[2];  t[14] = state[6];
  t[3] = state[15]; t[7] = state[3];  t[11] = state[7];  t[15] = state[11];
  for (var i = 0; i < 16; i++) state[i] = t[i];
}

function aesXtime(a) {
  return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
}

function aesMixColumns(state) {
  for (var c = 0; c < 4; c++) {
    var i = c * 4;
    var a0 = state[i], a1 = state[i + 1], a2 = state[i + 2], a3 = state[i + 3];
    var b0 = aesXtime(a0), b1 = aesXtime(a1), b2 = aesXtime(a2), b3 = aesXtime(a3);
    state[i]     = b0 ^ (b1 ^ a1) ^ a2 ^ a3;
    state[i + 1] = a0 ^ b1 ^ (b2 ^ a2) ^ a3;
    state[i + 2] = a0 ^ a1 ^ b2 ^ (b3 ^ a3);
    state[i + 3] = (b0 ^ a0) ^ a1 ^ a2 ^ b3;
  }
}

// Encrypt one 16-byte block with AES-256
function aes256EncryptBlock(block16, expandedKey) {
  var state = new Uint8Array(16);
  for (var i = 0; i < 16; i++) state[i] = block16[i];
  aesAddRoundKey(state, expandedKey, 0);
  for (var round = 1; round <= 13; round++) {
    aesSubBytes(state);
    aesShiftRows(state);
    aesMixColumns(state);
    aesAddRoundKey(state, expandedKey, round);
  }
  aesSubBytes(state);
  aesShiftRows(state);
  aesAddRoundKey(state, expandedKey, 14);
  return state;
}

function aesIncrementCounter(counter) {
  for (var i = 15; i >= 0; i--) {
    counter[i] = (counter[i] + 1) & 0xff;
    if (counter[i] !== 0) break;
  }
}

/**
 * AES-256-CTR decrypt (== encrypt). Pure JS.
 * @param {Uint8Array} keyBytes - 32 bytes
 * @param {Uint8Array} ivBytes  - 16-byte initial counter block
 * @param {Uint8Array} dataBytes - ciphertext (any length)
 * @returns {Uint8Array} plaintext
 */
function aesCtrDecrypt(keyBytes, ivBytes, dataBytes) {
  var expandedKey = aes256ExpandKey(keyBytes);
  var counter = new Uint8Array(16);
  var i;
  for (i = 0; i < 16; i++) counter[i] = ivBytes[i];
  var out = new Uint8Array(dataBytes.length);
  var offset = 0;
  while (offset < dataBytes.length) {
    var keystream = aes256EncryptBlock(counter, expandedKey);
    var n = Math.min(16, dataBytes.length - offset);
    for (i = 0; i < n; i++) {
      out[offset + i] = dataBytes[offset + i] ^ keystream[i];
    }
    offset += n;
    aesIncrementCounter(counter);
  }
  return out;
}

// Self-test with a fixed known-answer vector (generated via Node crypto):
// Key   = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
// IV    = f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff
// Plain = 6bc1bee22e409f96e93d7e117393172a
// Cipher= f9c1736f0dd61f5db354984533a1743e
function aesCtrSelfTest() {
  function hexToBytes(h) {
    var b = new Uint8Array(h.length / 2);
    for (var i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
    return b;
  }
  function bytesToHex(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) {
      var x = b[i].toString(16);
      if (x.length < 2) x = "0" + x;
      s += x;
    }
    return s;
  }
  var key = hexToBytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  var iv = hexToBytes("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
  var plain = hexToBytes("6bc1bee22e409f96e93d7e117393172a");
  var expectedCipher = "f9c1736f0dd61f5db354984533a1743e";
  var cipher = aesCtrDecrypt(key, iv, plain); // encrypt == decrypt in CTR
  var cipherHex = bytesToHex(cipher);
  var okEnc = cipherHex === expectedCipher;
  // Decrypt back
  var back = aesCtrDecrypt(key, iv, cipher);
  var okDec = bytesToHex(back) === "6bc1bee22e409f96e93d7e117393172a";
  // Multi-block round-trip (48 bytes, exercises counter increment)
  var big = new Uint8Array(48);
  for (var i = 0; i < 48; i++) big[i] = (i * 7 + 3) & 0xff;
  var enc = aesCtrDecrypt(key, iv, big);
  var dec = aesCtrDecrypt(key, iv, enc);
  var okRt = true;
  for (var j = 0; j < 48; j++) { if (dec[j] !== big[j]) { okRt = false; break; } }
  return { encryptMatchesNist: okEnc, decryptRoundTrip: okDec, multiBlockRoundTrip: okRt,
           gotCipher: cipherHex };
}

function aesCtr(dataBytes, keyHex) {
  var keyBytes = new TextEncoder().encode(keyHex); // 32 ASCII bytes
  var iv = keyBytes.slice(0, 16);
  return Promise.resolve(aesCtrDecrypt(keyBytes, iv, dataBytes));
}

function b64encode(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ---------- title matching (ported from anidisk.ts) ----------
function words(value) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function normalizeTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function scoreHit(animeName, title) {
  var nName = normalizeTitle(animeName), nTitle = normalizeTitle(title);
  if (!nName || !nTitle) return -1;
  if (nName === nTitle) return 100;
  if (nTitle.indexOf(nName) !== -1) return 90;
  if (nName.indexOf(nTitle) !== -1) return 60 + (30 * nTitle.length) / nName.length;
  var cw = {};
  words(animeName).forEach(function (w) { cw[w] = 1; });
  var overlap = words(title).filter(function (w) { return cw[w]; }).length;
  if (overlap === 0) return -1;
  return 40 + 10 * overlap - Math.min(20, Math.abs(nName.length - nTitle.length) / 2);
}
function queryVariants(title) {
  var clean = title.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  var tw = clean.split(" ").filter(Boolean);
  var variants = [clean];
  if (tw.length > 1) variants.push(tw.slice(1).join(" "));
  tw.forEach(function (w) {
    if (w.length >= 4 && variants.indexOf(w) === -1) variants.push(w);
  });
  return variants.filter(Boolean).slice(0, 5);
}
function isMovieType(hit) {
  return (hit.type || "").trim().toLowerCase() === "movie";
}
// Exact-title gate (zero-mismatch): every distinctive word of the TMDB title
// must appear as a whole word in the candidate name, and the word sets must
// be near-identical (dice >= 0.8) once release/season noise words are dropped.
// Kills partial-overlap false hits like "Young Sheldon" -> "Young Justice".
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
function exactWords(value) {
  var seen = {}, out = [];
  words(foldAccents(String(value).toLowerCase())).forEach(function (w) {
    if (!w || TITLE_NOISE[w] || /^\d+$/.test(w) || /^s\d{1,2}(e\d{1,2})?$/.test(w) || /^e\d{1,2}$/.test(w)) return;
    if (!seen[w]) { seen[w] = 1; out.push(w); }
  });
  return out;
}
var TAIL_JUNK = { mal: 1, ben: 1, jap: 1, kor: 1, chi: 1, eng: 1, hq: 1, dvdrip: 1, xvid: 1, aac: 1,
  proper: 1, repack: 1, extended: 1, unrated: 1, remastered: 1, dual: 1, web: 1, dl: 1 };
function isTailJunk(w) { return !!TAIL_JUNK[w] || /^\d{3,4}p$/.test(w) || /^\d+bit$/.test(w); }
function isExactTitle(queryTitle, candName) {
  var q = exactWords(queryTitle), c = exactWords(candName);
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
function pickSlug(hits, title, type) {
  var nTitle = normalizeTitle(title);
  var titleWords = {};
  words(title).filter(function (w) { return w.length >= 4; }).forEach(function (w) { titleWords[w] = 1; });
  var pool = hits.filter(function (h) {
    return type === "movie" ? isMovieType(h) : !isMovieType(h);
  });
  var best = null, bestScore = -1;
  pool.forEach(function (hit) {
    if (!isExactTitle(title, hit.anime_name)) return; // zero-mismatch gate
    var extra = 0;
    words(hit.anime_name).filter(function (w) { return w.length >= 4; }).forEach(function (w) {
      if (!titleWords[w] && nTitle.indexOf(w) === -1) extra++;
    });
    if (extra >= 2) return; // mismatch guard: reject unrelated subtitles/spin-offs
    var score = scoreHit(hit.anime_name, title);
    if (score > bestScore) { best = hit; bestScore = score; }
  });
  return bestScore >= 0 && best ? best.slug : null;
}

function searchAnime(query) {
  return apiGet("/anime/search?q=" + encodeURIComponent(query)).then(function (value) {
    if (!Array.isArray(value)) return [];
    return value.filter(function (item) {
      return item && typeof item.slug === "string" && /^[a-z0-9-]+$/i.test(item.slug) &&
             typeof item.anime_name === "string" && typeof item.type === "string";
    });
  });
}

function searchAnimeAll(title, type) {
  var variants = queryVariants(title);
  var seen = {}, hits = [];
  function addHits(results) {
    results.forEach(function (h) { if (!seen[h.slug]) { seen[h.slug] = 1; hits.push(h); } });
  }
  return Promise.all(variants.map(function (q) {
    return searchAnime(q).catch(function () { return null; });
  })).then(function (all) {
    all.forEach(function (results) { if (results) addHits(results); });
    if (hits.length > 20) hits.length = 20;
    return hits;
  });
}

function tmdbTitle(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY,
    { headers: { "Accept": "application/json", "User-Agent": UA } }, REQ_TIMEOUT
  ).then(function (r) { return r.ok ? r.json() : null; })
   .then(function (j) { return j ? (j.title || j.name || null) : null; })
   .catch(function () { return null; });
}

// ---------- Abyss / Hydrax extraction (ported from abyss.ts) ----------
function extractAbyssSources(embedUrl) {
  var hostname = "";
  try { hostname = new URL(embedUrl).hostname.toLowerCase(); }
  catch (e) { return Promise.reject(new Error("bad embed url")); }
  var ok = hostname === "abyssplayer.com" || hostname.endsWith(".abyssplayer.com") ||
           hostname === "abysscdn.com" || hostname.endsWith(".abysscdn.com");
  if (!ok) return Promise.reject(new Error("unsupported embed host"));

  return fetchWithTimeout(embedUrl, {
    headers: { "User-Agent": UA, "referer": "https://anidisk.org/" }
  }, REQ_TIMEOUT).then(function (r) {
    if (!r.ok) throw new Error("Abyss HTTP " + r.status);
    return r.text();
  }).then(function (html) {
    var m = /const\s+datas\s*=\s*"([^"]*)"/.exec(html);
    if (!m) throw new Error("datas not found");
    // base64 -> latin-1 binary string -> JSON (matches Buffer latin1 decode)
    var metadata = JSON.parse(atob(m[1]));
    if (typeof metadata.slug !== "string" || typeof metadata.md5_id !== "number" ||
        typeof metadata.user_id !== "number" || typeof metadata.media !== "string") {
      throw new Error("bad metadata shape");
    }
    var mediaKey = metadata.user_id + ":" + metadata.slug + ":" + metadata.md5_id;
    var enc = new Uint8Array(metadata.media.length);
    for (var i = 0; i < metadata.media.length; i++) enc[i] = metadata.media.charCodeAt(i) & 0xff;
    return aesCtr(enc, keyForString(mediaKey)).then(function (dec) {
      var payload = JSON.parse(new TextDecoder().decode(dec));
      var sources = (payload.mp4 && payload.mp4.sources) || [];
      sources = sources.filter(function (s) {
        return s && typeof s.label === "string" &&
               Number.isSafeInteger(s.res_id) &&
               Number.isSafeInteger(s.size) && s.size > 0 &&
               typeof s.sub === "string" && /^[a-z0-9]{1,63}$/i.test(s.sub);
      });
      if (!sources.length) throw new Error("no usable sources");
      return { md5_id: metadata.md5_id, sources: sources };
    });
  });
}

function segmentToken(md5Id, resId, size, index) {
  var path = "/mp4/" + md5Id + "/" + resId + "/" + size + "/" + CHUNK_SIZE + "/" + index;
  return aesCtr(new TextEncoder().encode(path), keyForNumber(size)).then(function (enc) {
    var first = b64encode(enc).replace(/=/g, "");
    return btoa(first).replace(/=/g, "");
  });
}

function qualityLabel(label) {
  var m = /(\d{3,4})/.exec(label || "");
  return m ? m[1] + "p" : "Unknown";
}

// ---------- main entry ----------
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  var isSeries = type === "series";
  if (isSeries && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);

  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    return searchAnimeAll(title, type).then(function (hits) {
      var slug = pickSlug(hits, title, type);
      if (!slug) return [];

      // Series: try requested season, fall back to season 1 (per anidisk.ts)
      var seasonPath = function (s) {
        return "/anime/" + encodeURIComponent(slug) + "/season/" + s + "/episode/" + episodeNum;
      };
      var serversPromise = isSeries
        ? apiGet(seasonPath(seasonNum)).catch(function (e) {
            if (e && e.status === 404 && seasonNum !== 1) return apiGet(seasonPath(1));
            throw e;
          })
        : apiGet("/anime/" + encodeURIComponent(slug));

      return serversPromise.then(function (data) {
        var servers = ((data && data.watch_servers) || []).filter(function (s) {
          return s && typeof s.name === "string" &&
                 Number.isSafeInteger(s.link_server_id) && s.link_server_id > 0;
        });
        var hydrax = null;
        for (var i = 0; i < servers.length; i++) {
          if (servers[i].name.trim().toLowerCase() === "hydrax") { hydrax = servers[i]; break; }
        }
        if (!hydrax) return [];
        return apiGet("/watch/" + hydrax.link_server_id + "/resolve").then(function (rdata) {
          var embedUrl = rdata && rdata.embed_url;
          if (typeof embedUrl !== "string" || !embedUrl) return [];
          return extractAbyssSources(embedUrl).then(function (video) {
            var ranked = video.sources.slice().sort(function (a, b) {
              var ra = parseInt(a.label, 10), rb = parseInt(b.label, 10);
              ra = isFinite(ra) ? ra : 0; rb = isFinite(rb) ? rb : 0;
              return rb - ra || b.size - a.size;
            });
            var jobs = ranked.slice(0, 3).map(function (src) {
              return segmentToken(video.md5_id, src.res_id, src.size, 0).then(function (token) {
                return {
                  name: "AniDisk",
                  title: title + " | " + src.label + "p",
                  url: "https://" + src.sub + ".sssrr.org/sora/" + src.size + "/" + token,
                  quality: qualityLabel(src.label),
                  type: "direct",
                  headers: { "Referer": "https://player.abyssplayer.com/" }
                };
              });
            });
            return Promise.all(jobs);
          });
        });
      }).catch(function () { return []; });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}

/* __CHAIN_RETRY_POSTLUDE__: full-search crowds on TV starve long chains;
   if the first attempt comes back empty fast (a dropped hop), run the
   whole chain once more. Bounded: only when attempt 1 took < 25s. */
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
      return Promise.resolve().then(function () { return orig.apply(null, args); }).then(function (res) {
        if (Array.isArray(res) && res.length === 0 && Date.now() - t0 < 25000) {
          return orig.apply(null, args);
        }
        return res;
      }, function () {
        if (Date.now() - t0 < 25000) return orig.apply(null, args);
        return [];
      });
    };
    wrapped.__chainRetry = true;
    if (typeof module !== "undefined" && module.exports) module.exports.getStreams = wrapped;
    if (g) { try { g.getStreams = wrapped; } catch (e) {} }
  } catch (e) {}
})();
