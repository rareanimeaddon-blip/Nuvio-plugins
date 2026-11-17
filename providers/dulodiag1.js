// Dulo Diag v1.0.0 — temporary, device-only diagnostic for Dulo.
// Reports, as stream rows, where Dulo stalls ON THE DEVICE.
// Real Dulo (dulo5) gives Matrix 4 / PHM 5 streams in tvsim but 0 on
// the user's device even with only Dulo enabled (isolation test
// 2026-11-17), so contention is ruled out. This diag runs the same
// chain, shortened to 4 per-source probes, and reports each stage:
// TMDB, resolve endpoint, /sources list, falcon/sparrow/egret/finch,
// total elapsed, and whether setTimeout/AbortController exist here.
// Summary row is FIRST (TV shows only the first rows). Remove this
// entry once the device verdict lands — it is not a real provider.
var API = "https://dulo.mov";
var DOOLO_API = "https://doolo.dulo.mov";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
function row(name, msg) {
  var t = "DULO-DIAG " + name + ": " + msg;
  return { name: t, title: t, url: "https://example.com/", quality: "Unknown", type: "hls" };
}
function timedFetch(url, ms, referer) {
  var t0 = Date.now();
  var sig;
  try {
    if (typeof AbortController !== "undefined") {
      var ctl = new AbortController();
      if (typeof setTimeout === "function") setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms);
      sig = ctl.signal;
    }
  } catch (e) {}
  return fetch(url, { method: "GET", headers: { "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": referer || API + "/" }, signal: sig })
    .then(function (r) { return r.text().then(function (t) { return { status: r.status, ms: Date.now() - t0, text: t }; }); })
    .catch(function (e) { return { status: "ERR:" + String((e && e.message) || e).slice(0, 40), ms: Date.now() - t0, text: "" }; });
}
function countStreams(text) {
  try { var j = JSON.parse(text); return (j && j.streams && j.streams.length) || 0; } catch (e) { return -1; }
}
function getStreams(tmdbId, mediaType, season, episode) {
  var t0 = Date.now();
  var id = tmdbId || "603";
  var type = mediaType === "movie" ? "movie" : "tv";
  var key = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";
  var tmdbUrl = "https://api.themoviedb.org/3/" + type + "/" + id + "?api_key=" + key;
  return Promise.all([
    timedFetch(tmdbUrl, 12000, ""),
    timedFetch(API + "/api/streams/resolve?tmdbId=" + id + "&type=" + type + "&progressive=true&title=The%20Matrix&year=1999", 15000, API + "/watch/" + type + "/" + id),
    timedFetch(DOOLO_API + "/sources", 15000, API + "/")
  ]).then(function (r) {
    var tmdb = r[0], resolve = r[1], sources = r[2];
    var names = [];
    try { var j = JSON.parse(sources.text); if (j && j.sources) for (var i = 0; i < j.sources.length; i++) if (j.sources[i] && j.sources[i].name) names.push(j.sources[i].name); } catch (e) {}
    if (!names.length) names = ["falcon", "sparrow", "egret", "finch"];
    var probes = ["falcon", "sparrow", "egret", "finch"].map(function (nm) {
      var qs = "tmdb=" + id + "&type=" + type;
      if (type === "tv") qs += "&season=1&episode=1";
      return timedFetch(DOOLO_API + "/sources/" + nm + "?" + qs, 15000, API + "/").then(function (x) { return { name: nm, status: x.status, ms: x.ms, n: countStreams(x.text) }; });
    });
    return Promise.all(probes).then(function (p) {
      var total = 0, parts = [];
      for (var i = 0; i < p.length; i++) { total += (p[i].n > 0 ? p[i].n : 0); parts.push(p[i].name + "=" + p[i].status + "/" + (p[i].n < 0 ? "?" : p[i].n)); }
      var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      var rt = "setTimeout=" + (typeof setTimeout === "function" ? "yes" : "no") + " Abort=" + (typeof AbortController !== "undefined" ? "yes" : "no");
      var rows = [];
      rows.push(row("SUMMARY", "TMDB=" + tmdb.status + " resolve=" + resolve.status + " sources=" + sources.status + " (" + names.length + " names) streams=" + total + " in " + elapsed + "s"));
      rows.push(row("TMDB", tmdb.status + " " + tmdb.ms + "ms"));
      rows.push(row("RESOLVE", resolve.status + " " + resolve.ms + "ms"));
      rows.push(row("SOURCES", sources.status + " " + sources.ms + "ms names=" + names.slice(0, 6).join(",")));
      for (var k = 0; k < p.length; k++) rows.push(row(p[k].name.toUpperCase(), p[k].status + " " + p[k].ms + "ms streams=" + p[k].n));
      rows.push(row("RUNTIME", rt + " elapsed=" + elapsed + "s"));
      return rows;
    });
  }).catch(function (e) {
    return [row("ERROR", String((e && e.message) || e).slice(0, 80))];
  });
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
