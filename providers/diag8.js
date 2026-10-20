// TV DIAG v8 - measure status-0 flakiness + verify an in-provider fetch retry wrapper.
var KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var TMDB_URL = "https://api.themoviedb.org/3/tv/30623?api_key=" + KEY;
var rawFetch = fetch;
var counter = 0;
function installRetry() {
  var raw = fetch;
  var wrapped = function (url, opts) {
    counter++;
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
  try { fetch = wrapped; } catch (e) {}
  try { if (typeof globalThis !== "undefined") globalThis.fetch = wrapped; } catch (e) {}
  return fetch === wrapped;
}
function sixSequential(useRetry) {
  var statuses = [];
  var chain = Promise.resolve();
  var f = useRetry ? fetch : rawFetch;
  for (var i = 0; i < 6; i++) {
    (function () {
      chain = chain.then(function () {
        return f(TMDB_URL, {}).then(function (r) {
          statuses.push(r.status);
          return r.text();
        }, function (e) { statuses.push("REJ"); });
      });
    })();
  }
  return chain.then(function () { return statuses.join(","); });
}
function entry(name, msg) { return { name: "D8 " + name + ": " + msg, url: "https://example.com/" }; }
function getStreams() {
  return sixSequential(false).then(function (plain) {
    var installed = installRetry();
    counter = 0;
    return sixSequential(true).then(function (retried) {
      return [
        entry("PLAIN x6", plain),
        entry("RETRY x6", retried),
        entry("OVERRIDE", installed ? ("installed, counter after calls=" + counter) : "FAILED to install")
      ];
    });
  }).catch(function (e) {
    return [entry("ERROR", String((e && e.message) || e).slice(0, 80))];
  });
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
