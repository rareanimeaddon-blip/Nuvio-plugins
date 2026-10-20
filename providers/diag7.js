// TV DIAG v7 - isolate TMDB header shape vs .json() parsing on the TV fetch path.
var KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var ANIDISK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var TMDB_URL = "https://api.themoviedb.org/3/tv/30623?api_key=" + KEY;
var DEAD_URL = "https://api.deadbase.host/api/v1/public/anime/search?q=Shin%20Chan";
function entry(name, msg) { return { name: "D7 " + name + ": " + msg, url: "https://example.com/" }; }
function probe(name, fn) {
  return fn().then(function (msg) { return entry(name, msg); })
    .catch(function (e) { return entry(name, "FAIL " + String((e && e.message) || e).slice(0, 70)); });
}
function viaJson(url, opts) {
  return fetch(url, opts).then(function (r) {
    return r.json().then(function (j) {
      return { status: r.status, ok: r.ok, json: j };
    });
  });
}
function getStreams() {
  var tests = [];
  tests.push(probe("TMDB anidisk-style .json()", function () {
    return viaJson(TMDB_URL, { headers: { "Accept": "application/json", "User-Agent": ANIDISK_UA } }).then(function (x) {
      return "HTTP " + x.status + " json=" + (x.json ? ("OK name=" + (x.json.name || x.json.title || "?")) : "NULL");
    });
  }));
  tests.push(probe("TMDB no-headers .json()", function () {
    return viaJson(TMDB_URL, {}).then(function (x) {
      return "HTTP " + x.status + " json=" + (x.json ? ("OK name=" + (x.json.name || x.json.title || "?")) : "NULL");
    });
  }));
  tests.push(probe("DEADBASE anidisk-style .json()", function () {
    return viaJson(DEAD_URL, { headers: { "User-Agent": ANIDISK_UA, "origin": "https://anidisk.org", "referer": "https://anidisk.org/", "accept": "application/json" } }).then(function (x) {
      var n = "?";
      if (x.json) { var h = Array.isArray(x.json) ? x.json : (x.json.results || x.json.data); if (Array.isArray(h)) n = h.length; }
      return "HTTP " + x.status + " json=" + (x.json ? "OK hits=" + n : "NULL");
    });
  }));
  tests.push(probe("TMDB anidisk-style .text()", function () {
    return fetch(TMDB_URL, { headers: { "Accept": "application/json", "User-Agent": ANIDISK_UA } }).then(function (r) {
      return r.text().then(function (t) {
        var nm = "?"; try { nm = JSON.parse(t).name || "?"; } catch (e) { nm = "PARSE-FAIL"; }
        return "HTTP " + r.status + " len=" + t.length + " name=" + nm;
      });
    });
  }));
  tests.push(probe("TMDB UA-only .json()", function () {
    return viaJson(TMDB_URL, { headers: { "User-Agent": ANIDISK_UA } }).then(function (x) {
      return "HTTP " + x.status + " json=" + (x.json ? "OK" : "NULL");
    });
  }));
  tests.push(probe("TMDB Accept-only .json()", function () {
    return viaJson(TMDB_URL, { headers: { "Accept": "application/json" } }).then(function (x) {
      return "HTTP " + x.status + " json=" + (x.json ? "OK" : "NULL");
    });
  }));
  return Promise.all(tests);
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
