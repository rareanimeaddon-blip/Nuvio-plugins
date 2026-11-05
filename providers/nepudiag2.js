// nepudiag2.js v1.0.1 — Nepu reachability diag (ONE-TIME, remove after).
// Update: the site also lives at nepu.to (nepu.net just 301s to nepu.io).
// This version probes the provider's exact search request on nepu.io AND
// nepu.to, plus nepu.to's homepage. If .to answers with real JSON, the
// provider can switch BASE_URL to nepu.to. If both fail, the app cannot
// reach the site at all and no provider code can fix it.
// The rows ARE the answer; no streams, no postlude.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";

// ---------- v5 fetch-retry prelude (verbatim) ----------
function fetchWithTimeout(url, options, timeoutMs) {
  timeoutMs = timeoutMs || 10000;
  var attempts = 0;
  var fetchOnce = function () {
    attempts++;
    return Promise.race([
      fetch(url, options || {}),
      new Promise(function (_, reject) {
        var t = 0.3 + attempts * 0.3; // 0.6s, 0.9s, 1.2s, 1.5s spin
        var spins = 0, spinMax = Math.round(t * 1000 / 30);
        var spin = function () {
          spins++;
          if (spins >= spinMax) reject(new Error("fetch-timeout"));
          else { var x = 0; for (var i = 0; i < 20000; i++) x += i; spin(); }
        };
        spin();
      }),
    ]).then(function (res) {
      if (res && res.status === 0 && attempts < 4) return fetchOnce();
      return res;
    }, function (err) {
      if (attempts < 4) return fetchOnce();
      throw err;
    });
  };
  return fetchOnce();
}
// ---------- end v5 prelude ----------

function tmdbTitle(tmdbId, mediaType) {
  var path = mediaType === "tv" ? "/tv/" : "/movie/";
  return fetchWithTimeout("https://api.themoviedb.org/3" + path + tmdbId + "?api_key=" + TMDB_API_KEY, {
    headers: { "User-Agent": UA },
  }, 12000).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (j) {
    if (!j) return null;
    return j.title || j.name || null;
  }).catch(function () { return null; });
}

function probe(url, headers) {
  return fetchWithTimeout(url, { headers: headers }, 15000).then(function (res) {
    return res.text().then(function (body) {
      return { status: res.status, head: String(body || "").replace(/\s+/g, " ").slice(0, 110) };
    });
  }).catch(function (e) {
    return { status: 0, head: "FETCH-FAILED " + String(e && e.message || e) };
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    var q = String(title || "The Matrix").trim().replace(/\s+/g, "-");
    var searchHeaders = {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    };
    return Promise.all([
      probe("https://nepu.io/ajax/posts?q=" + encodeURIComponent(q), searchHeaders),
      probe("https://nepu.to/ajax/posts?q=" + encodeURIComponent(q), searchHeaders),
      probe("https://nepu.to/", { "User-Agent": UA }),
    ]).then(function (r) {
      var ioS = r[0], toS = r[1], toH = r[2];
      var toWorks = toS.status === 200 && /^\s*\{/.test(toS.head) && /data/.test(toS.head);
      var verdict;
      if (toWorks) verdict = "NEPU-DIAG: nepu.to WORKS - switch provider to .to";
      else verdict = "NEPU-DIAG: BOTH BLOCKED - io " + ioS.status + " to " + toS.status;
      var rows = [];
      rows.push({ name: verdict, title: verdict, url: "https://nepu.to/", quality: "Unknown", type: "hls" });
      var a = "IO SEARCH " + ioS.status + ": " + ioS.head;
      rows.push({ name: a, title: a, url: "https://nepu.io/", quality: "Unknown", type: "hls" });
      var b = "TO SEARCH " + toS.status + ": " + toS.head;
      rows.push({ name: b, title: b, url: "https://nepu.to/ajax/posts?q=" + encodeURIComponent(q), quality: "Unknown", type: "hls" });
      var c = "TO HOME " + toH.status + ": " + toH.head;
      rows.push({ name: c, title: c, url: "https://nepu.to/", quality: "Unknown", type: "hls" });
      return rows;
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.NepuDiagScraperModule = { getStreams: getStreams };
}
