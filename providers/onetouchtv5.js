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


// OneTouchTV provider — rebuilt 2026-10-20 (onetouchtv2.js).
// v1 could never run in Nuvio: AES via WebCrypto (crypto.subtle), Abort-
// Controller timeouts, TextEncoder/TextDecoder, and it never set
// global.getStreams. This build does AES-256-CBC decryption in pure JS
// (tables generated at load), decodes the API's custom base64 variant and
// UTF-8 by hand, and matches titles with the exact-title gate instead of
// the old 0.45 fuzzy scorer (which happily matched lookalike titles).
// API: https://api3.devcorp.me, responses are AES-256-CBC encrypted JSON.

var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var MAIN_URL = "https://api3.devcorp.me";
var AES_KEY_STR = "im72charPasswordofdInitVectorStm"; // 32 bytes
var AES_IV_STR = "im72charPassword"; // 16 bytes
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var FETCH_HEADERS = { "User-Agent": UA, Referer: "https://onetouchtv.xyz/" };

function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {};
  var headers = {};
  for (var k in FETCH_HEADERS) headers[k] = FETCH_HEADERS[k];
  if (options.headers) for (var k2 in options.headers) headers[k2] = options.headers[k2];
  options.headers = headers;
  return fetch(url, options);
}
function getJson(url, timeoutMs) {
  return fetchWithTimeout(url, {}, timeoutMs || 10000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}

// ---------- pure-JS AES-256 (decrypt direction) ----------
function gfMul(a, b) {
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
var SBOX = [], INV_SBOX = [], MUL9 = [], MUL11 = [], MUL13 = [], MUL14 = [];
(function buildTables() {
  // generate the AES S-box via GF inverse + affine transform
  var inv = new Array(256).fill(0);
  for (var a = 1; a < 256; a++) {
    for (var b = 1; b < 256; b++) {
      if (gfMul(a, b) === 1) { inv[a] = b; break; }
    }
  }
  function rotl(x, n) { return ((x << n) | (x >> (8 - n))) & 0xff; }
  for (var i = 0; i < 256; i++) {
    var s = inv[i] ^ rotl(inv[i], 1) ^ rotl(inv[i], 2) ^ rotl(inv[i], 3) ^ rotl(inv[i], 4) ^ 0x63;
    SBOX[i] = s;
    INV_SBOX[s] = i;
    MUL9[i] = gfMul(i, 9); MUL11[i] = gfMul(i, 11);
    MUL13[i] = gfMul(i, 13); MUL14[i] = gfMul(i, 14);
  }
})();
function expandKey(keyBytes) {
  var Nk = keyBytes.length / 4, Nr = Nk + 6, w = [];
  for (var i = 0; i < keyBytes.length; i++) w[i] = keyBytes[i];
  var rcon = 1;
  for (var j = Nk; j < 4 * (Nr + 1); j++) {
    var temp = [w[4 * (j - 1)], w[4 * (j - 1) + 1], w[4 * (j - 1) + 2], w[4 * (j - 1) + 3]];
    if (j % Nk === 0) {
      temp = [SBOX[temp[1]] ^ rcon, SBOX[temp[2]], SBOX[temp[3]], SBOX[temp[0]]];
      rcon = gfMul(rcon, 2);
    } else if (Nk > 6 && j % Nk === 4) {
      temp = [SBOX[temp[0]], SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]]];
    }
    for (var t = 0; t < 4; t++) w[4 * j + t] = w[4 * (j - Nk) + t] ^ temp[t];
  }
  return { w: w, Nr: Nr };
}
function decryptBlock(roundKeys, input, offset) {
  var w = roundKeys.w, Nr = roundKeys.Nr, s = new Array(16), i, r, c, tmp;
  for (i = 0; i < 16; i++) s[i] = input[offset + i] ^ w[16 * Nr + i];
  for (r = Nr - 1; r >= 1; r--) {
    // InvShiftRows + InvSubBytes
    var t = new Array(16);
    for (c = 0; c < 4; c++) {
      for (var row = 0; row < 4; row++) {
        t[c * 4 + row] = INV_SBOX[s[((c - row + 4) % 4) * 4 + row]];
      }
    }
    for (i = 0; i < 16; i++) s[i] = t[i] ^ w[16 * r + i];
    // InvMixColumns
    for (c = 0; c < 4; c++) {
      var a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
      s[c * 4] = MUL14[a0] ^ MUL11[a1] ^ MUL13[a2] ^ MUL9[a3];
      s[c * 4 + 1] = MUL9[a0] ^ MUL14[a1] ^ MUL11[a2] ^ MUL13[a3];
      s[c * 4 + 2] = MUL13[a0] ^ MUL9[a1] ^ MUL14[a2] ^ MUL11[a3];
      s[c * 4 + 3] = MUL11[a0] ^ MUL13[a1] ^ MUL9[a2] ^ MUL14[a3];
    }
  }
  var out = new Array(16);
  for (c = 0; c < 4; c++) {
    for (var row2 = 0; row2 < 4; row2++) {
      out[c * 4 + row2] = INV_SBOX[s[((c - row2 + 4) % 4) * 4 + row2]] ^ w[c * 4 + row2];
    }
  }
  return out;
}
var KEY_EXP = null;
function aesCbcDecrypt(bytes) {
  if (!KEY_EXP) {
    var kb = [];
    for (var i = 0; i < AES_KEY_STR.length; i++) kb.push(AES_KEY_STR.charCodeAt(i) & 0xff);
    KEY_EXP = expandKey(kb);
  }
  var iv = [];
  for (var j = 0; j < 16; j++) iv.push(AES_IV_STR.charCodeAt(j) & 0xff);
  var out = [];
  var prev = iv;
  for (var off = 0; off + 16 <= bytes.length; off += 16) {
    var block = decryptBlock(KEY_EXP, bytes, off);
    for (var k = 0; k < 16; k++) out.push(block[k] ^ prev[k]);
    prev = Array.prototype.slice.call(bytes.slice(off, off + 16));
  }
  // PKCS#7 unpad
  if (out.length) {
    var pad = out[out.length - 1];
    if (pad >= 1 && pad <= 16) out = out.slice(0, out.length - pad);
  }
  return out;
}
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64ToBytes(s) {
  // API's custom base64 variant: "-_." -> "/", "@" -> "+"
  s = s.replace(/-_\./g, "/").replace(/@/g, "+").replace(/\s+/g, "");
  var bytes = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === "=") break;
    var v = B64.indexOf(ch);
    if (v === -1) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
  }
  return bytes;
}
function utf8Decode(bytes) {
  var out = "", i = 0;
  while (i < bytes.length) {
    var b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); i++; }
    else if ((b & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2;
    } else if ((b & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 3;
    } else if ((b & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); i += 4;
    } else i++;
  }
  return out;
}
function decryptToJson(encoded) {
  var plain = aesCbcDecrypt(b64ToBytes(encoded));
  return JSON.parse(utf8Decode(plain));
}

// ---------- encrypted API ----------
var cache = {};
var CACHE_TTL = 5 * 60 * 1000;
function fetchEncrypted(path, useCache) {
  var url = path.indexOf("https://") === 0 ? path : MAIN_URL + path;
  var entry = useCache === false ? null : cache[url];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return Promise.resolve(entry.data);
  function attempt(n) {
    return fetchWithTimeout(url, {}, 15000)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        var parsed = decryptToJson(text);
        var result = parsed && parsed.result;
        if (useCache !== false) cache[url] = { data: result, ts: Date.now() };
        return result;
      })
      .catch(function (err) {
        if (n < 2) {
          return attempt(n + 1);
        }
        throw err;
      });
  }
  return attempt(0);
}

// ---------- exact-title gate (v3, shared design) ----------
var TITLE_NOISE = { the: 1, a: 1, an: 1, with: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, subtitle: 1, subtitles: 1, subs: 1, multi: 1, audio: 1, complete: 1,
  hevc: 1, x264: 1, x265: 1, h264: 1, webdl: 1, hdtv: 1, bluray: 1, brrip: 1, hdrip: 1,
  "480p": 1, "720p": 1, "1080p": 1, "1440p": 1, "2160p": 1, "4k": 1, uhd: 1, hd: 1,
  watch: 1, download: 1, online: 1, sony: 1, yay: 1, uncensored: 1, uncut: 1, hungama: 1, tamil: 1, telugu: 1 };
var TAIL_JUNK = { mal: 1, ben: 1, jap: 1, kor: 1, chi: 1, eng: 1, hq: 1, dvdrip: 1, xvid: 1, aac: 1,
  proper: 1, repack: 1, extended: 1, unrated: 1, remastered: 1, dual: 1, web: 1, dl: 1 };
function isTailJunk(w) { return !!TAIL_JUNK[w] || /^\d{3,4}p$/.test(w) || /^\d+bit$/.test(w); }
var ACCENT_MAP = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
  "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
  "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
function foldAccents(s) {
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function (ch) { return ACCENT_MAP[ch] || ch; });
}
function exactWords(value) {
  var seen = {}, out = [];
  foldAccents(String(value).toLowerCase()).replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (w) {
    if (!w || TITLE_NOISE[w] || /^\d+$/.test(w) || /^s\d{1,2}(e\d{1,2})?$/.test(w) || /^e\d{1,2}$/.test(w)) return;
    if (!seen[w]) { seen[w] = 1; out.push(w); }
  });
  return out;
}
function isExactTitle(queryTitle, candTitle) {
  var q = exactWords(queryTitle), c = exactWords(candTitle);
  if (!q.length || !c.length) return false;
  if (q.join("") === c.join("")) return true;
  var cset = {};
  c.forEach(function (w) { cset[w] = 1; });
  var contained = true;
  for (var i = 0; i < q.length; i++) if (!cset[q[i]]) { contained = false; break; }
  if (contained && (2 * q.length) / (q.length + c.length) >= 0.8) return true;
  var stripped = [];
  for (var j = 0; j < c.length; j++) { if (!isTailJunk(c[j])) stripped.push(c[j]); }
  if (stripped.length && stripped.join("") === q.join("") && c.slice(0, stripped.length).join("") === q.join("")) return true;
  return false;
}

// ---------- TMDB ----------
function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return getJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY, 10000)
    .then(function (j) {
      if (!j || !(j.title || j.name)) return null;
      var d = j.release_date || j.first_air_date || "";
      return { title: j.title || j.name, year: d ? parseInt(d.slice(0, 4), 10) : null };
    })
    .catch(function () { return null; });
}

// ---------- matching ----------
function candYearOf(result) {
  if (result.year) { var y = parseInt(result.year, 10); if (isFinite(y)) return y; }
  var m = /\((\d{4})\)/.exec(String(result.title || ""));
  return m ? parseInt(m[1], 10) : null;
}
function candBaseTitle(result) {
  return String(result.title || "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
}
function bestMatch(results, meta, isTv, seasonNum) {
  var best = null;
  (results || []).forEach(function (r) {
    if (!r || !r.id || !r.title) return;
    var base = candBaseTitle(r);
    // For series, a "Season N" catalog entry belongs to that season only.
    var seasonM = /season\s*(\d+)\s*$/i.exec(base);
    var entrySeason = seasonM ? parseInt(seasonM[1], 10) : 1;
    var baseNoSeason = base.replace(/\s*season\s*\d+\s*$/i, "").trim();
    if (isTv && seasonNum != null && entrySeason !== seasonNum) return;
    if (!isExactTitle(meta.title, baseNoSeason)) return;
    var cy = candYearOf(r);
    if (meta.year && cy && Math.abs(cy - meta.year) > 1) return;
    if (!best) best = r;
  });
  return best;
}
function qualityLabel(q) {
  if (!q) return "HD";
  var s = String(q).toLowerCase();
  if (s.indexOf("2160") !== -1 || s.indexOf("4k") !== -1) return "2160p";
  if (s.indexOf("1080") !== -1) return "1080p";
  if (s.indexOf("720") !== -1) return "720p";
  if (s.indexOf("480") !== -1) return "480p";
  if (s.indexOf("360") !== -1) return "360p";
  return "HD";
}

// ---------- main ----------
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isTv = mediaType === "tv";
  if (isTv && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);
  var s = seasonNum || 1, ep = episodeNum || 1;
  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta) return [];
    var keywords = [meta.title];
    if (isTv && s > 1) keywords.unshift(meta.title + " Season " + s);
    var chain = Promise.resolve(null);
    keywords.forEach(function (kw) {
      chain = chain.then(function (found) {
        if (found) return found;
        return fetchEncrypted("/vod/search?keyword=" + encodeURIComponent(kw))
          .then(function (results) {
            if (!Array.isArray(results)) return null;
            return bestMatch(results, meta, isTv, isTv ? s : null);
          })
          .catch(function () { return null; });
      });
    });
    return chain.then(function (match) {
      if (!match) return [];
      return fetchEncrypted("/vod/" + match.id + "/detail").then(function (detail) {
        if (!detail || !detail.episodes || !detail.episodes.length) return [];
        var target = null;
        for (var i = 0; i < detail.episodes.length; i++) {
          var e = detail.episodes[i];
          if (!isTv || parseInt(e.episode, 10) === ep) { target = e; break; }
        }
        if (!target || target.playId == null) return [];
        return fetchEncrypted("/vod/" + match.id + "/episode/" + target.playId, false)
          .then(function (sd) {
            var sources = (sd && sd.sources) || [];
            var seen = {}, out = [];
            sources.forEach(function (src) {
              if (!src.url || seen[src.url]) return;
              seen[src.url] = 1;
              out.push({
                name: "OneTouchTV",
                title: candBaseTitle(match) + " | " + qualityLabel(src.quality),
                url: src.url,
                quality: qualityLabel(src.quality),
                type: /\.m3u8(\?|$)/i.test(src.url) ? "hls" : "direct",
              });
            });
            return out;
          })
          .catch(function () { return []; });
      }).catch(function () { return []; });
    });
  }).catch(function () { return []; });
}

global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
