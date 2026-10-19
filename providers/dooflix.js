// DooFlix scraper for Nuvio
// Standalone, sandbox-compatible (WebCrypto for SHA-256 + AES-256-GCM).
// Source: DooFlix provider — fetches XPass embed, decrypts the signed data
// endpoint (key = SHA-256("spv3-data-response|BUILD|pathname|token")),
// then resolves playlist JSON. NOTE: the source addon's server-side relay
// for region-locked hosts is not available on-device; direct URLs are returned.

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
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str))
    .then(function (ab) { return new Uint8Array(ab); });
}

function aesGcmDecrypt(encrypted, keyBytes) {
  if (encrypted.length <= 12 + 16) throw new Error("DooFlix: response too short");
  var iv = encrypted.subarray(0, 12);
  var ct = encrypted.subarray(12, encrypted.length - 16);
  var tag = encrypted.subarray(encrypted.length - 16);
  var combined = new Uint8Array(ct.length + 16);
  combined.set(ct, 0);
  combined.set(tag, ct.length);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"])
    .then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv, tagLength: 128 }, key, combined);
    })
    .then(function (pt) { return new TextDecoder().decode(pt); });
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
