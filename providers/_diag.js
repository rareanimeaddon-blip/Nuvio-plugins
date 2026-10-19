/**
 * DIAGNOSTIC Provider - Tests each failing provider step-by-step
 * Returns diagnostic info as stream titles so you can see where it fails
 */

var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

function fetchWithTimeout(url, opts, ms) {
  opts = opts || {};
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, ms || 10000);
  opts.signal = controller.signal;
  return fetch(url, opts).then(function (res) {
    clearTimeout(timer);
    return res;
  }).catch(function (e) {
    clearTimeout(timer);
    throw e;
  });
}

function testUrl(label, url, opts) {
  var start = Date.now();
  return fetchWithTimeout(url, opts || {}, 10000).then(function (res) {
    var ms = Date.now() - start;
    return label + ": OK " + res.status + " (" + ms + "ms)";
  }).catch(function (e) {
    var ms = Date.now() - start;
    return label + ": FAIL " + (e.message || e) + " (" + ms + "ms)";
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var results = [];

  // Test 1: TMDB (baseline - should work since other providers use it)
  var p1 = testUrl("TMDB", "https://api.themoviedb.org/3/movie/603?api_key=" + TMDB_KEY);

  // Test 2: Cinejoy API
  var p2 = testUrl("Cinejoy", "https://api.wing.st/v1/search?q=test", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  // Test 3: HindMovies
  var p3 = testUrl("HindMovies", "https://hindmovie.one/?s=test", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  // Test 4: MeowTV API
  var p4 = testUrl("MeowTV-API", "https://api.meowtv.ru/altcha/challenge", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  // Test 5: AniDisk API
  var p5 = testUrl("AniDisk", "https://api.deadbase.host/api/v1/public/anime/search?q=test", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://anidisk.org",
      "Referer": "https://anidisk.org/"
    }
  });

  // Test 6: Goojara
  var p6 = testUrl("Goojara", "https://ww1.goojara.to/", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  // Test 7: ShowBox/FebBox
  var p7 = testUrl("FebBox", "https://www.febbox.com/", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  // Test 8: crypto.subtle availability
  var cryptoTest = "crypto.subtle: " + (typeof crypto !== "undefined" && crypto.subtle ? "AVAILABLE" : "MISSING");

  // Test 9: WebAssembly availability
  var wasmTest = "WebAssembly: " + (typeof WebAssembly !== "undefined" ? "AVAILABLE" : "MISSING");

  return Promise.all([p1, p2, p3, p4, p5, p6, p7]).then(function (tests) {
    var streams = [];
    streams.push({
      name: "DIAG",
      title: "=== Environment === | " + cryptoTest + " | " + wasmTest,
      url: "https://example.com/",
      quality: "diag",
      type: "direct"
    });
    tests.forEach(function (t, i) {
      streams.push({
        name: "DIAG",
        title: t,
        url: "https://example.com/",
        quality: "diag",
        type: "direct"
      });
    });
    return streams;
  }).catch(function (e) {
    return [{
      name: "DIAG",
      title: "DIAG FAILED: " + (e.message || e),
      url: "https://example.com/",
      quality: "diag",
      type: "direct"
    }];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
