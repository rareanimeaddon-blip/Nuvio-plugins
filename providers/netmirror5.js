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


// NetMirror scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: NetMirror provider — net27.cc direct API + NewTV platform APIs
// (Netflix / Prime Video / Hotstar). The NewTV API endpoint is discovered
// via rotating checknewtv.php domains. Env defaults from the provider
// source are hardcoded below (TMDB key, net27.cc base).


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
var NETMIRROR_API = "https://net27.cc";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

var NEW_TV_DOMAINS_B64 = [
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
];

var PLATFORMS = [
  { id: "netflix", ott: "nf", label: "Netflix" },
  { id: "primevideo", ott: "pv", label: "Prime Video" },
  { id: "hotstar", ott: "hs", label: "Hotstar" },
];

function b64decode(s) {
  try {
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (e) { return ""; }
}

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function getJson(url, headers, timeoutMs) {
  return fetchWithTimeout(url, { headers: headers }, timeoutMs || 15000).then(function (r) {
    if (r.status === 429) throw new Error("rate limited: " + url);
    if (!r.ok) throw new Error("HTTP " + r.status + ": " + url);
    return r.json();
  });
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

function newTvHeaders(ott, extra) {
  var h = {
    "Cache-Control": "no-cache",
    "X-Requested-With": "NetmirrorNewTV v1.0",
    Accept: "application/json, text/plain, */*",
    Ott: ott,
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}

var resolvedApiUrl = "";
function resolveNewTvApi() {
  if (resolvedApiUrl) return Promise.resolve(resolvedApiUrl);
  var domains = [];
  for (var i = 0; i < NEW_TV_DOMAINS_B64.length; i++) {
    var d = b64decode(NEW_TV_DOMAINS_B64[i]).replace(/\/$/, "");
    if (d) domains.push(d);
  }
  var chain = Promise.resolve(null);
  domains.forEach(function (domain) {
    chain = chain.then(function (found) {
      if (found) return found;
      return fetchWithTimeout(domain + "/checknewtv.php", { headers: newTvHeaders("nf") }, 6000)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.token_hash) {
            var api = b64decode(data.token_hash).replace(/\/$/, "");
            if (api) { resolvedApiUrl = api; return api; }
          }
          return null;
        })
        .catch(function () { return null; });
    });
  });
  return chain.then(function (api) {
    if (!api) throw new Error("NetMirror NewTV discovery failed");
    return api;
  });
}

function toNuvio(name, label, url, quality) {
  return { name: name, title: label + " | " + quality, url: url, quality: quality, type: "direct" };
}

function qualityOf(resolution) {
  var n = parseInt(resolution, 10);
  return isFinite(n) && n >= 240 ? n + "p" : "Unknown";
}

function fetchNetflix(tmdbId, type, title, season, episode) {
  var base = NETMIRROR_API;
  var url = type === "series"
    ? base + "/api/embed-tmdb/" + tmdbId + "?type=tv&se=" + season + "&ep=" + episode
    : base + "/api/embed-tmdb/" + tmdbId;
  var headers = {
    Accept: "application/json, text/plain, */*",
    Referer: base + "/",
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
  };
  return getJson(url, headers, 20000).then(function (data) {
    if (!data || data.ok !== true) return [];
    var out = [];
    (data.streams || []).forEach(function (s) {
      if (!s.url) return;
      var q = qualityOf(s.resolution);
      out.push(toNuvio("NetMirror", title + " | Netflix", s.url, q));
    });
    if (!out.length && data.mp4) {
      out.push(toNuvio("NetMirror", title + " | Netflix", data.mp4, "Unknown"));
    }
    return out;
  }).catch(function () { return []; });
}

function parseNumber(value) {
  if (value == null) return null;
  var n = parseInt(String(value).replace(/[^\d]/g, ""), 10);
  return isFinite(n) ? n : null;
}

function parseSeasonLabel(value, fallback) {
  var m = /season\s*(\d+)/i.exec(value || "");
  return m ? Number(m[1]) : fallback;
}

function getEpisodes(api, postData, ott, requestedSeason) {
  var seasons = postData.season || [];
  var selectedIdx = -1, requestedIdx = -1;
  for (var i = 0; i < seasons.length; i++) {
    if (seasons[i].selected) selectedIdx = i;
    if (requestedSeason != null && parseSeasonLabel(seasons[i].s, i + 1) === requestedSeason) requestedIdx = i;
  }
  var targetIdx = requestedIdx >= 0 ? requestedIdx : selectedIdx;
  var targetSeason = seasons[targetIdx];
  var targetSeasonId = targetSeason ? targetSeason.id : (postData.nextPageSeason || null);
  var fallbackSeason = requestedSeason != null ? requestedSeason : (targetIdx >= 0 ? targetIdx + 1 : null);

  function collect(page, out) {
    (page.episodes || []).forEach(function (ep) {
      if (!ep || !ep.id) return;
      var seasonFromInfo = null;
      if (ep.info) {
        for (var k = 0; k < ep.info.length; k++) {
          var m = /\bS(\d+)\b/i.exec(ep.info[k] || "");
          if (m) { seasonFromInfo = m[1]; break; }
        }
      }
      out.push({
        id: ep.id,
        s: parseNumber(ep.sNum) != null ? parseNumber(ep.sNum)
           : parseNumber(ep.s) != null ? parseNumber(ep.s)
           : parseNumber(seasonFromInfo) != null ? parseNumber(seasonFromInfo)
           : fallbackSeason,
        ep: parseNumber(ep.ep) != null ? parseNumber(ep.ep) : parseNumber(ep.epNum),
      });
    });
  }

  var result = [];
  function fetchPages(seasonId, page, pagesLeft) {
    if (!seasonId || pagesLeft <= 0) return Promise.resolve();
    return getJson(api + "/newtv/episodes.php?id=" + encodeURIComponent(seasonId) + "&page=" + page,
        newTvHeaders(ott), 15000)
      .then(function (data) {
        collect(data || {}, result);
        if (data && data.nextPageShow === 1) {
          return fetchPages(seasonId, (data.nextPage || page + 1), pagesLeft - 1);
        }
      })
      .catch(function () {});
  }

  var useDirect = targetSeasonId && !(targetIdx >= 0 && targetIdx === selectedIdx);
  var start = useDirect
    ? fetchPages(targetSeasonId, 1, 5)
    : Promise.resolve().then(function () { collect({ episodes: postData.episodes }, result); });
  return start.then(function () { return result; });
}

function fetchPlatform(p, title, type, season, episode) {
  var api, firstId;
  return resolveNewTvApi().then(function (a) {
    api = a;
    return getJson(api + "/newtv/search.php?s=" + encodeURIComponent(title), newTvHeaders(p.ott), 15000);
  }).then(function (searchData) {
    var first = searchData && searchData.searchResult && searchData.searchResult[0];
    if (!first || !first.id) throw new Error("no search hit");
    firstId = first.id;
    return getJson(api + "/newtv/post.php?id=" + encodeURIComponent(first.id),
      newTvHeaders(p.ott, { Lastep: "", Usertoken: "" }), 15000);
  }).then(function (postData) {
    if (type === "series") {
      return getEpisodes(api, postData || {}, p.ott, season).then(function (episodes) {
        for (var i = 0; i < episodes.length; i++) {
          if (episodes[i].s === season && episodes[i].ep === episode) return episodes[i].id;
        }
        throw new Error("episode not found");
      });
    }
    if ((postData && postData.type === "t") || ((postData.episodes || []).filter(Boolean).length > 0)) {
      throw new Error("is a series page");
    }
    return (postData && postData.main_id) || firstId;
  }).then(function (targetId) {
    return getJson(api + "/newtv/player.php?id=" + encodeURIComponent(targetId),
      newTvHeaders(p.ott, { Usertoken: "" }), 15000);
  }).then(function (player) {
    var status = String((player && player.status) || "").toLowerCase();
    if (!player || !player.video_link || (status !== "ok" && status !== "otp")) return [];
    return [toNuvio("NetMirror", title + " | " + p.label, player.video_link, "Unknown")];
  }).catch(function () { return []; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  if (type === "series" && (seasonNum == null || episodeNum == null)) {
    return Promise.resolve([]);
  }
  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    return fetchNetflix(tmdbId, type, title, seasonNum, episodeNum).then(function (direct) {
      var jobs = PLATFORMS.filter(function (p) {
        return p.id !== "netflix" || direct.length === 0;
      }).map(function (p) {
        return fetchPlatform(p, title, type, seasonNum, episodeNum);
      });
      return Promise.all(jobs).then(function (lists) {
        var out = direct.slice();
        lists.forEach(function (l) { out.push.apply(out, l); });
        var seen = {}, deduped = [];
        out.forEach(function (s) {
          if (!s.url || seen[s.url]) return;
          seen[s.url] = true;
          deduped.push(s);
        });
        return deduped;
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.NetMirrorScraperModule = { getStreams: getStreams };
}
