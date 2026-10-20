// TV DIAG v10 - final delayed-retry wrapper: raw fetch series + traced AniDisk.
var KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var TMDB_URL = "https://api.themoviedb.org/3/tv/30623?api_key=" + KEY;
var RAW_FILE = "https://raw.githubusercontent.com/rareanimeaddon-blip/Nuvio-plugins/refs/heads/main/providers/anidisk7.js";
var rawFetch = fetch;
var PAUSES = [800, 2000, 4000];
function spin(ms) { var end = Date.now() + ms; while (Date.now() < end) {} }
var lastAttempts = 0;
function wrappedFetch(url, opts) {
  var tries = 0;
  var attempt = function () {
    tries++;
    lastAttempts = tries;
    return rawFetch(url, opts).then(function (r) {
      if (r && r.status === 0 && tries <= PAUSES.length) { spin(PAUSES[tries - 1]); return attempt(); }
      return r;
    }, function (e) {
      if (tries <= PAUSES.length) { spin(PAUSES[tries - 1]); return attempt(); }
      throw e;
    });
  };
  return attempt();
}
function entry(name, msg) { return { name: "D10 " + name + ": " + msg, url: "https://example.com/" }; }
function sixWrapped() {
  var out = [];
  var chain = Promise.resolve();
  for (var i = 0; i < 6; i++) {
    (function () {
      chain = chain.then(function () {
        lastAttempts = 0;
        return wrappedFetch(TMDB_URL, {}).then(function (r) {
          var a = lastAttempts;
          return r.text().then(function () { out.push(r.status + "(a" + a + ")"); });
        }, function () { out.push("REJ(a" + lastAttempts + ")"); });
      });
    })();
  }
  return chain.then(function () { return out.join(","); });
}
function tracedAnidisk() {
  var nFetch = 0;
  var traced = function (url, opts) {
    nFetch++;
    return wrappedFetch(url, opts);
  };
  return rawFetch(RAW_FILE).then(function (r) { return r.text(); }).then(function (src) {
    var mod = { exports: {} };
    var factory = new Function("module", "exports", "fetch", "console", src);
    factory(mod, mod.exports, traced, console);
    var fn = mod.exports && mod.exports.getStreams;
    if (typeof fn !== "function") return "LOAD FAIL";
    var t0 = Date.now();
    return Promise.resolve().then(function () { return fn("30623", "tv", 1, 1); }).then(function (res) {
      var secs = Math.round((Date.now() - t0) / 100) / 10;
      return "fetches=" + nFetch + " result=" + (Array.isArray(res) ? res.length : "?") + " in " + secs + "s";
    }, function (e) {
      return "THREW " + String((e && e.message) || e).slice(0, 50);
    });
  }).catch(function (e) { return "SRC FAIL " + String((e && e.message) || e).slice(0, 50); });
}
function getStreams() {
  return sixWrapped().then(function (six) {
    return tracedAnidisk().then(function (ani) {
      return [entry("WRAPPED x6", six), entry("ANIDISK wrapped", ani)];
    });
  }).catch(function (e) {
    return [entry("ERROR", String((e && e.message) || e).slice(0, 80))];
  });
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
