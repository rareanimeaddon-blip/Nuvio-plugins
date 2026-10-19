// AniDisk scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: AniDisk Stremio addon — anidisk.org via api.deadbase.host,
// Hydrax (Abyss) embed decryption (MD5 + AES-256-CTR), segment URL generation.
//
// NOTE: Abyss serves video as 2MB segments via /sora/ URLs. This scraper
// returns the segment-0 URL for the best quality source. The /sora/ endpoint
// requires Referer: https://player.abyssplayer.com/ (verified: returns 200
// with that referer, 403 without). If Nuvio's player doesn't send a Referer,
// playback may fail — the URL itself and the token are valid.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438"; // working public key from source addon

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var API_BASE = "https://api.deadbase.host/api/v1/public";
var SITE_ORIGIN = "https://anidisk.org";
var CHUNK_SIZE = 2097152;

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function apiHeaders(extra) {
  var h = {
    "user-agent": UA,
    origin: SITE_ORIGIN,
    referer: SITE_ORIGIN + "/",
    accept: "application/json"
  };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}

function apiGet(path) {
  return fetchWithTimeout(API_BASE + path, { headers: apiHeaders() }, 20000)
    .then(function (r) {
      if (r.status === 404) { var e = new Error("not found"); e.status = 404; throw e; }
      if (!r.ok) throw new Error("AniDisk API HTTP " + r.status);
      return r.json();
    });
}

// ---- pure-JS MD5 (verified against Node/Python on RFC vectors) ----
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
  var bytes = String(value).split("").map(function (ch) {
    return /\d/.test(ch) ? parseInt(ch, 10) : ch.charCodeAt(0);
  });
  return md5Hex(new Uint8Array(bytes));
}

// ---- AES-256-CTR via WebCrypto (matches Node aes-256-ctr) ----
function aesCtr(dataBytes, keyHex) {
  var keyBytes = new TextEncoder().encode(keyHex); // 32-byte ASCII hex
  var iv = keyBytes.slice(0, 16);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, false, ["encrypt", "decrypt"])
    .then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 128 }, key, dataBytes);
    })
    .then(function (buf) { return new Uint8Array(buf); });
}

function b64encode(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ---- title matching (ported from anidisk.ts) ----
function words(value) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function normalizeTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function scoreHit(animeName, title) {
  var normalizedName = normalizeTitle(animeName);
  var normalizedTitle = normalizeTitle(title);
  if (!normalizedName || !normalizedTitle) return -1;
  if (normalizedName === normalizedTitle) return 100;
  if (normalizedTitle.indexOf(normalizedName) !== -1) return 90;
  if (normalizedName.indexOf(normalizedTitle) !== -1) {
    return 60 + (30 * normalizedTitle.length) / normalizedName.length;
  }
  var candidateWords = {};
  words(animeName).forEach(function (w) { candidateWords[w] = 1; });
  var overlap = words(title).filter(function (w) { return candidateWords[w]; }).length;
  if (overlap === 0) return -1;
  return 40 + 10 * overlap - Math.min(20, Math.abs(normalizedName.length - normalizedTitle.length) / 2);
}
function queryVariants(title) {
  var clean = title.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  var titleWords = clean.split(" ").filter(Boolean);
  var variants = [clean];
  if (titleWords.length > 1) variants.push(titleWords.slice(1).join(" "));
  titleWords.forEach(function (w) {
    if (w.length >= 4 && variants.indexOf(w) === -1) variants.push(w);
  });
  return variants.filter(Boolean).slice(0, 5);
}
function hasRequestedType(hit, type) {
  var isMovie = (hit.type || "").trim().toLowerCase() === "movie";
  return type === "movie" ? isMovie : !isMovie;
}
function pickSlug(hits, title, type) {
  var normalizedTitle = normalizeTitle(title);
  var titleWords = {};
  words(title).filter(function (w) { return w.length >= 4; }).forEach(function (w) { titleWords[w] = 1; });
  var pool = hits.filter(function (h) { return hasRequestedType(h, type); });
  var best = null, bestScore = -1;
  pool.forEach(function (hit) {
    var candidateWords = {};
    words(hit.anime_name).filter(function (w) { return w.length >= 4; }).forEach(function (w) { candidateWords[w] = 1; });
    var extraWords = 0;
    for (var w in candidateWords) {
      if (titleWords[w] || normalizedTitle.indexOf(w) !== -1) continue;
      extraWords++;
    }
    if (extraWords >= 2) return;
    var score = scoreHit(hit.anime_name, title);
    if (score > bestScore) { best = hit; bestScore = score; }
  });
  return bestScore >= 0 && best ? best.slug : null;
}

function searchAnime(query) {
  return apiGet("/anime/search?q=" + encodeURIComponent(query))
    .then(function (value) {
      if (!Array.isArray(value)) return [];
      return value.filter(function (item) {
        return item && typeof item.slug === "string" && /^[a-z0-9-]+$/i.test(item.slug) &&
               typeof item.anime_name === "string" && typeof item.type === "string";
      });
    });
}

function searchAnimeAll(title, type) {
  var variants = queryVariants(title);
  var seen = {};
  var hits = [];
  function addHits(results) {
    results.forEach(function (hit) {
      if (!seen[hit.slug]) { seen[hit.slug] = 1; hits.push(hit); }
    });
  }
  var chain = Promise.resolve();
  variants.forEach(function (query, idx) {
    chain = chain.then(function () {
      if (hits.length >= 20) return;
      return searchAnime(query).then(function (results) {
        addHits(results);
      }).catch(function () {});
    });
  });
  return chain.then(function () { return hits; });
}

function tmdbTitle(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY,
    { headers: { Accept: "application/json", "User-Agent": UA } }, 10000
  ).then(function (r) { return r.ok ? r.json() : null; })
   .then(function (j) { return j ? (j.title || j.name) : null; })
   .catch(function () { return null; });
}

// ---- Abyss/Hydrax extraction ----
function extractAbyssSources(embedUrl) {
  var hostname = "";
  try { hostname = new URL(embedUrl).hostname.toLowerCase(); } catch (e) { return Promise.reject(new Error("bad url")); }
  if (hostname !== "player.abyssplayer.com" && !hostname.endsWith(".abyssplayer.com") &&
      hostname !== "abysscdn.com" && !hostname.endsWith(".abysscdn.com")) {
    return Promise.reject(new Error("unsupported embed"));
  }
  return fetchWithTimeout(embedUrl, {
    headers: { "user-agent": UA, referer: "https://anidisk.org/" }
  }, 25000).then(function (r) {
    if (!r.ok) throw new Error("Abyss HTTP " + r.status);
    return r.text();
  }).then(function (html) {
    var m = /const\s+datas\s*=\s*"([^"]*)"/.exec(html);
    if (!m) throw new Error("datas not found");
    var metadata = JSON.parse(atob(m[1])); // atob gives latin1 binary string
    if (typeof metadata.slug !== "string" || typeof metadata.md5_id !== "number" ||
        typeof metadata.user_id !== "number" || typeof metadata.media !== "string") {
      throw new Error("bad metadata shape");
    }
    var mediaKey = metadata.user_id + ":" + metadata.slug + ":" + metadata.md5_id;
    var encBytes = new Uint8Array(metadata.media.length);
    for (var i = 0; i < metadata.media.length; i++) encBytes[i] = metadata.media.charCodeAt(i) & 0xff;
    return aesCtr(encBytes, keyForString(mediaKey)).then(function (dec) {
      var payload = JSON.parse(new TextDecoder().decode(dec));
      var sources = (payload.mp4 && payload.mp4.sources) || [];
      sources = sources.filter(function (s) {
        return s && typeof s.label === "string" && Number.isSafeInteger(s.res_id) &&
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

function rankSources(sources) {
  function rank(label) {
    var q = parseInt(label, 10);
    return isFinite(q) ? q : 0;
  }
  return sources.slice().sort(function (a, b) {
    return rank(b.label) - rank(a.label) || b.size - a.size;
  });
}

function qualityLabel(label) {
  var m = /(\d{3,4})/.exec(label || "");
  return m ? m[1] + "p" : "Unknown";
}

// ---- main ----
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  var isSeries = type === "series";
  if (isSeries && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);

  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    return searchAnimeAll(title, type).then(function (hits) {
      var slug = pickSlug(hits, title, type);
      if (!slug) return [];
      var serverPath = isSeries
        ? "/anime/" + encodeURIComponent(slug) + "/season/" + seasonNum + "/episode/" + episodeNum
        : "/anime/" + encodeURIComponent(slug);
      return apiGet(serverPath).then(function (data) {
        var servers = (data && data.watch_servers) || [];
        servers = servers.filter(function (s) {
          return s && typeof s.name === "string" && Number.isSafeInteger(s.link_server_id) && s.link_server_id > 0;
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
            var ranked = rankSources(video.sources);
            // Build one stream per source (top 3), each with its segment-0 URL
            var jobs = ranked.slice(0, 3).map(function (src) {
              return segmentToken(video.md5_id, src.res_id, src.size, 0).then(function (token) {
                var url = "https://" + src.sub + ".sssrr.org/sora/" + src.size + "/" + token;
                return {
                  name: "AniDisk",
                  title: title + " | " + src.label + "p",
                  url: url,
                  quality: qualityLabel(src.label),
                  type: "direct"
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
} else {
  global.AniDiskScraperModule = { getStreams: getStreams };
}
