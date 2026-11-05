// nepudiag1.js v1.0.0 — Nepu reachability diag (ONE-TIME, remove after).
// Question it answers: does the Nuvio app's plain fetch reach nepu.io,
// or does the site's Cloudflare check block it (the browser passes
// because it runs JavaScript; the app's fetch cannot)?
// It fetches the same search the Nepu provider sends (/ajax/posts) plus
// the homepage, and reports the HTTP status + body head as stream rows.
// If the rows say 403 + "Just a moment", the app is blocked and no
// provider code can fix it. If they say 200 + real JSON, the fetch
// works and the bug is in the provider chain.
// No TMDB gate, no streams, no postlude — the rows ARE the answer.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var BASE_URL = "https://nepu.io";
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
      // TV fetch intermittently returns status 0 on a dead window:
      // retry fast, up to 4 tries.
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
      return { status: res.status, head: String(body || "").replace(/\s+/g, " ").slice(0, 120) };
    });
  }).catch(function (e) {
    return { status: 0, head: "FETCH-FAILED " + String(e && e.message || e) };
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    var q = String(title || "The Matrix").trim().replace(/\s+/g, "-");
    var searchUrl = BASE_URL + "/ajax/posts?q=" + encodeURIComponent(q);
    var searchHeaders = {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    };
    return Promise.all([
      probe(searchUrl, searchHeaders),
      probe(BASE_URL + "/", { "User-Agent": UA }),
    ]).then(function (r) {
      var s = r[0], h = r[1];
      var blocked = /just a moment/i.test(s.head) || /just a moment/i.test(h.head) || /challenge-platform/i.test(s.head) || /challenge-platform/i.test(h.head);
      var failed = (s.status === 0 && h.status === 0);
      var verdict;
      if (blocked) verdict = "NEPU-DIAG: APP IS BLOCKED - site shows Just a moment to the app";
      else if (failed) verdict = "NEPU-DIAG: FETCH FAILED - app could not reach site at all (status 0)";
      else verdict = "NEPU-DIAG: APP REACHES SITE - search " + s.status + " home " + h.status;
      var rows = [];
      rows.push({ name: verdict, title: verdict, url: BASE_URL + "/", quality: "Unknown", type: "hls" });
      var sRow = "SEARCH " + s.status + ": " + s.head;
      rows.push({ name: sRow, title: sRow, url: searchUrl, quality: "Unknown", type: "hls" });
      var hRow = "HOME " + h.status + ": " + h.head;
      rows.push({ name: hRow, title: hRow, url: BASE_URL + "/", quality: "Unknown", type: "hls" });
      return rows;
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.NepuDiagScraperModule = { getStreams: getStreams };
}
