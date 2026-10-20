// TV DIAG v9 - headers vs time-window: interleaved headered/headerless fetches
// to the same URL, plus a spin-delayed retry after a status-0.
var KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var TMDB_URL = "https://api.themoviedb.org/3/tv/30623?api_key=" + KEY;
var HDR = { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" } };
function entry(name, msg) { return { name: "D9 " + name + ": " + msg, url: "https://example.com/" }; }
function spinWait(ms) {
  var end = Date.now() + ms;
  while (Date.now() < end) { /* burn - no timers on TV */ }
}
function one(opts) {
  return fetch(TMDB_URL, opts).then(function (r) {
    return r.text().then(function () { return r.status; });
  }, function () { return "REJ"; });
}
function series(pairs) {
  // pairs: array of [label, opts]; run sequentially, collect "label=status"
  var out = [];
  var chain = Promise.resolve();
  pairs.forEach(function (p) {
    chain = chain.then(function () {
      return one(p[1]).then(function (st) { out.push(p[0] + "=" + st); });
    });
  });
  return chain.then(function () { return out; });
}
function getStreams() {
  var pairs = [];
  for (var i = 0; i < 4; i++) { pairs.push(["H", HDR]); pairs.push(["N", {}]); }
  return series(pairs).then(function (res) {
    var hdr = res.filter(function (x) { return x[0] === "H"; }).map(function (x) { return x.slice(2); }).join(",");
    var nohdr = res.filter(function (x) { return x[0] === "N"; }).map(function (x) { return x.slice(2); }).join(",");
    // delayed retry: one headered fetch; if 0, spin 1.5s and retry; report both
    return one(HDR).then(function (first) {
      if (first !== 0 && first !== "REJ") return { hdr: hdr, nohdr: nohdr, delay: "first=" + first + " (no retry needed)" };
      spinWait(1500);
      return one(HDR).then(function (second) {
        return { hdr: hdr, nohdr: nohdr, delay: "first=" + first + " after1.5s=" + second };
      });
    });
  }).then(function (r) {
    return [
      entry("HEADERED x4", r.hdr),
      entry("NOHEADERS x4", r.nohdr),
      entry("DELAY-RETRY", r.delay)
    ];
  }).catch(function (e) {
    return [entry("ERROR", String((e && e.message) || e).slice(0, 80))];
  });
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
