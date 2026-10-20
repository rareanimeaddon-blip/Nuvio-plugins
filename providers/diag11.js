// TV DIAG v11 - crowd simulation: run the CURRENT shipped failing providers
// concurrently (like a real search) and report per-provider verdicts packed
// 3-per-line so the TV's 3 visible slots show all of them.
var RAW = "https://raw.githubusercontent.com/rareanimeaddon-blip/Nuvio-plugins/refs/heads/main/providers/";
var realFetch = fetch;
function loadAndRun(file, args) {
  var nFetch = 0;
  var traced = function (url, opts) { nFetch++; return realFetch(url, opts); };
  return realFetch(RAW + file).then(function (r) { return r.text(); }).then(function (src) {
    var mod = { exports: {} };
    var before = (typeof globalThis !== "undefined") ? globalThis.getStreams : undefined;
    var factory = new Function("module", "exports", "fetch", "console", src);
    factory(mod, mod.exports, traced, console);
    var fn = (mod.exports && mod.exports.getStreams) ||
      ((typeof globalThis !== "undefined" && globalThis.getStreams !== before) ? globalThis.getStreams : null);
    if (typeof globalThis !== "undefined" && globalThis.getStreams !== before) { try { delete globalThis.getStreams; } catch (e) { globalThis.getStreams = before; } }
    if (typeof fn !== "function") return { file: file, out: "NOFN", n: nFetch, secs: 0 };
    var t0 = Date.now();
    return Promise.resolve().then(function () { return fn.apply(null, args); }).then(function (res) {
      return { file: file, out: "r=" + (Array.isArray(res) ? res.length : "?"), n: nFetch, secs: Math.round((Date.now() - t0) / 100) / 10 };
    }, function (e) {
      return { file: file, out: "THREW", n: nFetch, secs: Math.round((Date.now() - t0) / 100) / 10 };
    });
  }).catch(function (e) {
    return { file: file, out: "LOADFAIL", n: nFetch, secs: 0 };
  });
}
var JOBS = [
  ["anidisk8.js", ["30623", "tv", 1, 1], "anidisk"],
  ["animesalt3.js", ["30623", "tv", 1, 1], "animesalt"],
  ["piratexplay8.js", ["46260", "tv", 1, 1], "piratex"],
  ["toonworld6.js", ["30623", "tv", 1, 1], "toonworld"],
  ["rareanime6.js", ["30623", "tv", 1, 1], "rareanime"],
  ["kartoons3.js", ["30623", "tv", 1, 1], "kartoons"],
  ["moviebox4.js", ["603", "movie"], "moviebox"],
  ["streamflix7.js", ["603", "movie"], "streamflix"],
  ["onetouchtv4.js", ["603", "movie"], "onetouch*"]
];
function getStreams() {
  // 3 waves of 3 concurrent providers (fits one 60s test slot; still a crowd)
  var results = [];
  var chain = Promise.resolve();
  for (var w = 0; w < JOBS.length; w += 3) {
    (function (wave) {
      chain = chain.then(function () {
        return Promise.all(wave.map(function (j) { return loadAndRun(j[0], j[1]); })).then(function (rs) {
          rs.forEach(function (r) { results.push(r); });
        });
      });
    })(JOBS.slice(w, w + 3));
  }
  return chain.then(function () {
    var rs = results;
    var cells = rs.map(function (r, i) {
      return JOBS[i][2] + " " + r.out + "/" + r.n + "f/" + r.secs + "s";
    });
    var out = [];
    for (var i = 0; i < cells.length; i += 3) {
      out.push({ name: "D11: " + cells.slice(i, i + 3).join(" | "), url: "https://example.com/" });
    }
    return out;
  });
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
