// TV DIAG v6 - loads REAL provider files with a fetch tracer, runs them, reports traces.
var RAW = "https://raw.githubusercontent.com/rareanimeaddon-blip/Nuvio-plugins/refs/heads/main/providers/";
var realFetch = fetch;
function short(u) {
  try {
    var p = new URL(u);
    return p.hostname + (p.pathname.length > 26 ? p.pathname.slice(0, 26) + "~" : p.pathname);
  } catch (e) { return String(u).slice(0, 40); }
}
function traceProvider(tag, file, args) {
  var lines = [];
  var nFetch = 0;
  var tracedFetch = function (url, opts) {
    nFetch++;
    var idx = nFetch;
    var method = (opts && opts.method) || "GET";
    var t0 = Date.now();
    lines.push("#" + idx + " " + method + " " + short(url));
    return realFetch(url, opts).then(function (r) {
      lines[idx - 1] += " -> " + r.status + " " + Math.round((Date.now() - t0) / 100) / 10 + "s";
      return r;
    }, function (e) {
      lines[idx - 1] += " -> FAIL " + String((e && e.message) || e).slice(0, 40);
      throw e;
    });
  };
  return realFetch(RAW + file).then(function (r) { return r.text(); }).then(function (src) {
    var mod = { exports: {} };
    var before = (typeof globalThis !== "undefined") ? globalThis.getStreams : undefined;
    var factory = new Function("module", "exports", "fetch", "console", src);
    factory(mod, mod.exports, tracedFetch, console);
    var fn = (mod.exports && mod.exports.getStreams) ||
      ((typeof globalThis !== "undefined" && globalThis.getStreams !== before) ? globalThis.getStreams : null);
    if (typeof globalThis !== "undefined" && globalThis.getStreams !== before) { try { delete globalThis.getStreams; } catch (e) { globalThis.getStreams = before; } }
    if (typeof fn !== "function") return { tag: tag, summary: "LOAD FAIL: no getStreams", lines: lines };
    var t0 = Date.now();
    return Promise.resolve().then(function () { return fn.apply(null, args); }).then(function (res) {
      var secs = Math.round((Date.now() - t0) / 100) / 10;
      return { tag: tag, summary: "fetches=" + nFetch + " result=" + (Array.isArray(res) ? res.length : "?") + " in " + secs + "s", lines: lines };
    }, function (e) {
      var secs = Math.round((Date.now() - t0) / 100) / 10;
      return { tag: tag, summary: "fetches=" + nFetch + " THREW " + String((e && e.message) || e).slice(0, 50) + " in " + secs + "s", lines: lines };
    });
  }).catch(function (e) {
    return { tag: tag, summary: "SRC/LOAD FAIL " + String((e && e.message) || e).slice(0, 60), lines: lines };
  });
}
function getStreams() {
  var jobs = [
    traceProvider("ANIDISK", "anidisk7.js", ["30623", "tv", 1, 1]),
    traceProvider("PIRATEX", "piratexplay7.js", ["46260", "tv", 1, 1]),
    traceProvider("TOONWORLD", "toonworld5.js", ["30623", "tv", 1, 1])
  ];
  return Promise.all(jobs).then(function (rs) {
    var out = [];
    rs.forEach(function (r) { out.push({ name: "D6 " + r.tag + ": " + r.summary, url: "https://example.com/" }); });
    rs.forEach(function (r) {
      r.lines.slice(0, 14).forEach(function (l) { out.push({ name: "D6 " + r.tag + " " + l, url: "https://example.com/" }); });
    });
    return out;
  });
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
