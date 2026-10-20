// TV DIAG v3 - probes hosts from inside the TV runtime and reports statuses as stream names.
var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var ANIDISK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var GOOJARA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
function race(url, opts, ms) {
  return Promise.race([
    fetch(url, opts || {}),
    new Promise(function (_, rej) { setTimeout(function () { rej(new Error("TIMEOUT")); }, ms); })
  ]);
}
function probe(name, fn) {
  return fn().then(function (msg) { return { name: "DIAG " + name + ": " + msg, url: "https://example.com/" }; })
    .catch(function (e) { return { name: "DIAG " + name + ": FAIL " + String((e && e.message) || e).slice(0, 60), url: "https://example.com/" }; });
}
function getText(url, headers, ms) {
  return race(url, { headers: headers || {} }, ms || 15000).then(function (r) {
    return r.text().then(function (t) { return { status: r.status, ok: r.ok, url: r.url || "", headers: r.headers, body: t }; });
  });
}
function echoUA(tag, headers) {
  return getText("https://httpbin.org/headers", headers, 15000).then(function (r) {
    var ua = "";
    try { ua = JSON.parse(r.body).headers["User-Agent"] || "?"; } catch (e) { ua = "unparsed"; }
    return "HTTP " + r.status + " UA=[" + ua.slice(0, 70) + "]";
  }).catch(function (e) {
    return getText("https://postman-echo.com/get", headers, 15000).then(function (r) {
      var ua = "";
      try { ua = JSON.parse(r.body).headers["user-agent"] || "?"; } catch (e2) { ua = "unparsed"; }
      return "HTTP " + r.status + " UA=[" + ua.slice(0, 70) + "]";
    });
  });
}
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var tests = [];
  tests.push(probe("ECHO anidisk-style (lowercase ua)", function () {
    return echoUA("a", { "user-agent": ANIDISK_UA, "origin": "https://anidisk.org", "referer": "https://anidisk.org/", "accept": "application/json" });
  }));
  tests.push(probe("ECHO goojara-style (proper UA)", function () {
    return echoUA("g", { "User-Agent": GOOJARA_UA, "Accept": "text/html" });
  }));
  tests.push(probe("DEADBASE lowercase-ua", function () {
    return getText("https://api.deadbase.host/api/v1/public/anime/search?q=Shin%20Chan",
      { "user-agent": ANIDISK_UA, "origin": "https://anidisk.org", "referer": "https://anidisk.org/", "accept": "application/json" }).then(function (r) {
      var hit = r.body.indexOf("shin") >= 0 ? " has-shin" : " no-shin";
      return "HTTP " + r.status + " len=" + r.body.length + hit + " body=" + r.body.slice(0, 60).replace(/\s+/g, " ");
    });
  }));
  tests.push(probe("DEADBASE proper-UA", function () {
    return getText("https://api.deadbase.host/api/v1/public/anime/search?q=Shin%20Chan",
      { "User-Agent": ANIDISK_UA, "origin": "https://anidisk.org", "referer": "https://anidisk.org/", "accept": "application/json" }).then(function (r) {
      var hit = r.body.indexOf("shin") >= 0 ? " has-shin" : " no-shin";
      return "HTTP " + r.status + " len=" + r.body.length + hit + " body=" + r.body.slice(0, 60).replace(/\s+/g, " ");
    });
  }));
  tests.push(probe("GOOJARA home", function () {
    return getText("https://ww1.goojara.to/", { "User-Agent": GOOJARA_UA, "Accept": "text/html" }).then(function (r) {
      var chk = r.body.indexOf("_3chk") >= 0 ? " has_3chk" : " no_3chk";
      var ins = r.body.indexOf("data-ins") >= 0 ? " has_data-ins" : " no_data-ins";
      var sc = "";
      try { sc = r.headers.get("set-cookie") ? " has_cookie" : " no_cookie"; } catch (e) { sc = " cookie?"; }
      return "HTTP " + r.status + " len=" + r.body.length + chk + ins + sc;
    });
  }));
  tests.push(probe("TMDB control", function () {
    return getText("https://api.themoviedb.org/3/movie/603?api_key=" + TMDB_KEY, {}).then(function (r) {
      return "HTTP " + r.status + " len=" + r.body.length;
    });
  }));
  return Promise.all(tests);
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
