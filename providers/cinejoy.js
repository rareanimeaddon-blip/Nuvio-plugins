// Cinejoy scraper for Nuvio
// Standalone, sandbox-compatible (WebCrypto for AES-GCM, no Node APIs).
// Source: Cinejoy provider — creates an encrypted session via enc-dec.app,
// POSTs to api.wing.st/api.shegu.st, decrypts the AES-GCM sealed response.

var ENCRYPTION_URL = "https://enc-dec.app/api/enc-cinejoy";
var API_BASES = ["https://api.wing.st", "https://api.shegu.st"];
var CINEJOY_SERVERS = ["Nebula", "Lisbon", "solara", "athnes"];

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
var CINEJOY_URL = "https://cinejoy.pk";
var REQUEST_HEADERS = {
  "User-Agent": USER_AGENT,
  Origin: CINEJOY_URL,
  Referer: CINEJOY_URL + "/",
};

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 20000);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function base64ToBytes(value) {
  var normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  var bin = atob(normalized);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return bytes;
}

// AES-GCM decrypt: WebCrypto expects ciphertext||tag concatenated.
function aesGcmDecrypt(encryptedData, keyBytes, aadBytes) {
  if (encryptedData.length < 12 + 16) throw new Error("Cinejoy: incomplete encrypted response");
  var iv = encryptedData.subarray(0, 12);
  var ciphertext = encryptedData.subarray(12, encryptedData.length - 16);
  var tag = encryptedData.subarray(encryptedData.length - 16);
  var combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);
  var alg = { name: "AES-GCM", iv: iv, tagLength: 128 };
  if (aadBytes && aadBytes.length) alg.additionalData = aadBytes;
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"])
    .then(function (key) { return crypto.subtle.decrypt(alg, key, combined); })
    .then(function (pt) { return new TextDecoder().decode(pt); });
}

function createEncryptedSession(tmdbId, mediaType, server, season, episode) {
  var target = "https://api.shegu.xyz/?type=" + mediaType + "&tmdb=" + encodeURIComponent(tmdbId) +
    "&server=" + encodeURIComponent(server);
  if (mediaType === "series") target += "&season=" + season + "&episode=" + episode;
  var proxyUrl = ENCRYPTION_URL + "?url=" + encodeURIComponent(target);
  return fetchWithTimeout(proxyUrl, { headers: { "User-Agent": USER_AGENT } }, 10000)
    .then(function (r) {
      if (!r.ok) throw new Error("Cinejoy session encoder HTTP " + r.status);
      return r.json();
    })
    .then(function (payload) {
      var session = payload && payload.result;
      if (!payload || payload.status !== 200 || typeof (session && session.data) !== "string" ||
          typeof (session.state && session.state.responseKey) !== "string" ||
          typeof (session.state && session.state.aad) !== "string") {
        throw new Error((payload && payload.error) || "Cinejoy: incomplete session");
      }
      var body = base64ToBytes(session.data);
      var responseKey = base64ToBytes(session.state.responseKey);
      var aad = base64ToBytes(session.state.aad);
      if (!body.length || [16, 24, 32].indexOf(responseKey.length) === -1) {
        throw new Error("Cinejoy: invalid cryptographic data");
      }
      return { body: body, responseKey: responseKey, aad: aad };
    });
}

function extractHlsVariants(playlist, playlistUrl) {
  var variants = [];
  var pendingHeight = null;
  playlist.split("\n").forEach(function (rawLine) {
    var line = rawLine.trim();
    if (line.indexOf("#EXT-X-STREAM-INF:") === 0) {
      var m = /RESOLUTION=\d+x(\d+)/i.exec(line);
      pendingHeight = m ? Number(m[1]) : 0;
    } else if (line && line.charAt(0) !== "#" && pendingHeight !== null) {
      try { variants.push({ height: pendingHeight, url: new URL(line, playlistUrl).toString() }); } catch (e) {}
      pendingHeight = null;
    }
  });
  return variants;
}

function normalizeQuality(rawValue) {
  var v = String(rawValue || "").toLowerCase();
  if (v.indexOf("2160") !== -1 || v.indexOf("4k") !== -1) return "4K";
  if (v.indexOf("1080") !== -1 || v.indexOf("fhd") !== -1) return "1080p";
  return null;
}

function normalizeSubtitles(rawTracks) {
  if (!Array.isArray(rawTracks)) return [];
  var out = [];
  rawTracks.forEach(function (track) {
    var url = track && typeof track.url === "string" ? track.url.trim() : "";
    if (url) out.push({ id: url, url: url, lang: String(track.language || track.id || "en").toLowerCase() });
  });
  return out;
}

function resolveStreamItems(rawItems, server) {
  if (!Array.isArray(rawItems)) return Promise.resolve([]);
  var jobs = rawItems.map(function (rawItem) {
    if (!rawItem || typeof rawItem !== "object") return Promise.resolve([]);
    var subtitles = normalizeSubtitles(rawItem.captions);
    var streams = [];
    if (rawItem.type === "hls" && typeof rawItem.playlist === "string") {
      return fetchWithTimeout(rawItem.playlist, { headers: REQUEST_HEADERS }, 12000)
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (text) {
          if (!text) return [];
          extractHlsVariants(text, rawItem.playlist).forEach(function (v) {
            if (v.height !== 2160 && v.height !== 1080) return;
            var q = v.height === 2160 ? "4K" : "1080p";
            streams.push({ name: "Cinejoy", title: "Cinejoy " + server + " " + q, url: v.url, quality: q, type: "direct" });
          });
          return streams;
        }).catch(function () { return []; });
    }
    if (rawItem.type === "file" && rawItem.qualities && typeof rawItem.qualities === "object") {
      Object.keys(rawItem.qualities).forEach(function (rawQuality) {
        var q = normalizeQuality(rawQuality);
        var entry = rawItem.qualities[rawQuality];
        var url = entry && typeof entry.url === "string" ? entry.url : "";
        if (!q || url.indexOf("http") !== 0) return;
        streams.push({ name: "Cinejoy", title: "Cinejoy " + server + " " + q, url: url, quality: q, type: "direct" });
      });
    }
    return Promise.resolve(streams);
  });
  return Promise.all(jobs).then(function (all) {
    var seen = {};
    var out = [];
    all.forEach(function (arr) {
      arr.forEach(function (s) {
        if (!seen[s.url]) { seen[s.url] = true; out.push(s); }
      });
    });
    return out;
  });
}

function getStreamsFromServer(tmdbId, mediaType, season, episode, server) {
  return createEncryptedSession(tmdbId, mediaType, server, season, episode).then(function (session) {
    var attempt = function (i) {
      if (i >= API_BASES.length) return Promise.resolve(null);
      return fetchWithTimeout(API_BASES[i] + "/g", {
        method: "POST",
        body: session.body,
        headers: Object.assign({}, REQUEST_HEADERS, { "Content-Type": "application/octet-stream" }),
      }, 10000).then(function (r) {
        return r.ok ? r : attempt(i + 1);
      }).catch(function () { return attempt(i + 1); });
    };
    return attempt(0).then(function (response) {
      if (!response) return [];
      return response.arrayBuffer().then(function (ab) {
        var encrypted = new Uint8Array(ab);
        return aesGcmDecrypt(encrypted, session.responseKey, session.aad);
      }).then(function (plaintext) {
        var payload = JSON.parse(plaintext);
        return resolveStreamItems(payload && payload.data && payload.data.stream, server);
      });
    });
  }).catch(function () { return []; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var normalizedId = String(tmdbId == null ? "" : tmdbId).trim();
  if (!/^\d+$/.test(normalizedId)) return Promise.resolve([]);
  var mt = mediaType === "tv" ? "series" : "movie";
  if (mt !== "movie" && mt !== "series") return Promise.resolve([]);
  var season = seasonNum || 1, episode = episodeNum || 1;
  return Promise.all(CINEJOY_SERVERS.map(function (server) {
    return getStreamsFromServer(normalizedId, mt, season, episode, server);
  })).then(function (all) {
    var seen = {};
    var out = [];
    all.forEach(function (arr) {
      arr.forEach(function (s) {
        if (!seen[s.url]) { seen[s.url] = true; out.push(s); }
      });
    });
    return out;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.CinejoyScraperModule = { getStreams: getStreams };
}
