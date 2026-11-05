// nepudiag3.js v1.0.2 — Nepu PLAIN-FETCH diag (ONE-TIME, remove after).
// Why: the v5 prelude kills a fetch that takes longer than ~0.6-1.5s
// per attempt, and nepu.io answers slowly (Cloudflare edge). A plain
// fetch with NO timeout race gives the server as long as it needs
// (up to the app's own 60s provider limit). This version probes the
// provider's search with a plain fetch, three ways:
//   A: nepu.io search, provider headers (the exact provider request)
//   B: nepu.io search, FULL browser headers (real Chrome XHR set)
//   C: nepu.to search, provider headers
//   D: nepu.io home, plain UA
// If any search returns 200 + JSON, the fix is plain fetch (and/or
// browser headers) in nepu1.js. If they return 403, the site is
// challenging the app for real and there is no fix. If nothing appears
// after a minute, the fetches hung (also a block).
// NOTE: this diag can take up to ~60s to finish. Wait for it.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";

function tmdbTitle(tmdbId, mediaType) {
  var path = mediaType === "tv" ? "/tv/" : "/movie/";
  return fetch("https://api.themoviedb.org/3" + path + tmdbId + "?api_key=" + TMDB_API_KEY, {
    headers: { "User-Agent": UA },
  }).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (j) {
    if (!j) return null;
    return j.title || j.name || null;
  }).catch(function () { return null; });
}

// Plain fetch, no timeout race. Resolves with status + body head, or
// status 0 on a real failure. If the server never answers, this stays
// pending until the app's provider limit kills it.
function probe(url, headers) {
  return fetch(url, { headers: headers }).then(function (res) {
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
    var searchUrlIO = "https://nepu.io/ajax/posts?q=" + encodeURIComponent(q);
    var searchUrlTO = "https://nepu.to/ajax/posts?q=" + encodeURIComponent(q);
    var provHeaders = {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    };
    // Full set a real mobile Chrome sends for the site's own search XHR.
    var browserHeaders = {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://nepu.io/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Sec-CH-UA": "\"Chromium\";v=\"155\", \"Google Chrome\";v=\"155\", \"Not-A.Brand\";v=\"99\"",
      "Sec-CH-UA-Mobile": "?1",
      "Sec-CH-UA-Platform": "\"Android\"",
    };
    return Promise.all([
      probe(searchUrlIO, provHeaders),
      probe(searchUrlIO, browserHeaders),
      probe(searchUrlTO, provHeaders),
      probe("https://nepu.io/", { "User-Agent": UA }),
    ]).then(function (r) {
      var a = r[0], b = r[1], c = r[2], d = r[3];
      function isJson(p) { return p.status === 200 && /^\s*\{/.test(p.head) && /data/.test(p.head); }
      var verdict;
      if (isJson(a)) verdict = "NEPU-DIAG: PLAIN FETCH WORKS on .io - use plain fetch";
      else if (isJson(b)) verdict = "NEPU-DIAG: BROWSER HEADERS WORK on .io - use those headers";
      else if (isJson(c)) verdict = "NEPU-DIAG: PLAIN FETCH WORKS on .to - switch to .to";
      else if (a.status === 403 || b.status === 403) verdict = "NEPU-DIAG: STILL 403 - site blocks the app for real";
      else verdict = "NEPU-DIAG: NO 200 - io " + a.status + " hdr " + b.status + " to " + c.status;
      var rows = [];
      rows.push({ name: verdict, title: verdict, url: "https://nepu.io/", quality: "Unknown", type: "hls" });
      var ra = "A IO " + a.status + ": " + a.head;
      rows.push({ name: ra, title: ra, url: searchUrlIO, quality: "Unknown", type: "hls" });
      var rb = "B HDR " + b.status + ": " + b.head;
      rows.push({ name: rb, title: rb, url: searchUrlIO, quality: "Unknown", type: "hls" });
      var rc = "C TO " + c.status + ": " + c.head;
      rows.push({ name: rc, title: rc, url: searchUrlTO, quality: "Unknown", type: "hls" });
      var rd = "D HOME " + d.status + ": " + d.head;
      rows.push({ name: rd, title: rd, url: "https://nepu.io/", quality: "Unknown", type: "hls" });
      return rows;
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.NepuDiagScraperModule = { getStreams: getStreams };
}
