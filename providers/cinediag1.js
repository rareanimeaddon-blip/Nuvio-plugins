// CineCat Diag v1.0.0 — temporary, device-only diagnostic.
// Dulo is solved by network (2026-11-17 23:08: works on mobile data,
// blocked on the user's Wi-Fi IP). CineCat still gives 0 on BOTH
// wifi and mobile data, so it is a SEPARATE problem, not the IP block.
// This diag runs CineCat's exact chain (cinecat3 v1.0.5) shortened to
// 4 per-source probes, and reports each stage: TMDB, /sources list,
// siamese/burmese/bobtail/ragamuffin, and the ZCDN fast path.
// Run it on MOBILE DATA (where Dulo works, so the network is proven
// good there). Summary row is FIRST. Remove once the verdict lands.
var API = "https://edge.cinecat.eu";
var REFERER = "https://cinecat.eu/";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
function row(name, msg) {
  var t = "CINE-DIAG " + name + ": " + msg;
  return { name: t, title: t, url: "https://example.com/", quality: "Unknown", type: "hls" };
}
function probe(url, ms, headers) {
  var t0 = Date.now();
  var sig;
  try {
    if (typeof AbortController !== "undefined") {
      var ctl = new AbortController();
      if (typeof setTimeout === "function") setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms);
      sig = ctl.signal;
    }
  } catch (e) {}
  return fetch(url, { method: "GET", headers: headers, signal: sig })
    .then(function (r) { return r.text().then(function (t) { return { status: r.status, ms: Date.now() - t0, text: t }; }); })
    .catch(function (e) { return { status: "ERR:" + String((e && e.message) || e).slice(0, 30), ms: Date.now() - t0, text: "" }; });
}
function countStreams(text) {
  try { var j = JSON.parse(text); return (j && j.streams && j.streams.length) || 0; } catch (e) { return -1; }
}
function getStreams(tmdbId, mediaType, season, episode) {
  var t0 = Date.now();
  var id = tmdbId || "687163";
  var type = mediaType === "movie" ? "movie" : "tv";
  var key = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";
  var h = { "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": REFERER };
  return Promise.all([
    probe("https://api.themoviedb.org/3/" + type + "/" + id + "?api_key=" + key, 12000, {}),
    probe(API + "/sources", 12000, h)
  ]).then(function (r) {
    var tmdb = r[0], sources = r[1];
    var names = [];
    try { var j = JSON.parse(sources.text); if (j && j.sources) for (var i = 0; i < j.sources.length; i++) if (j.sources[i] && j.sources[i].name) names.push(j.sources[i].name); } catch (e) {}
    if (!names.length) names = ["siamese", "burmese", "bobtail", "ragamuffin"];
    var probes = ["siamese", "burmese", "bobtail", "ragamuffin"].map(function (nm) {
      var qs = "?tmdb=" + id + "&type=" + type;
      if (type === "tv") qs += "&season=1&episode=1";
      return probe(API + "/sources/" + nm + qs, 12000, h).then(function (x) { return { name: nm, status: x.status, ms: x.ms, n: countStreams(x.text) }; });
    });
    var zcdn = probe("https://zcdn1.2wwlgkfo-31a.workers.dev/cdn?tmdb=" + id + "&type=" + type, 12000, h).then(function (x) {
      var kind = "no-json";
      try { var j = JSON.parse(x.text); if (j) kind = (j.url && j.url.indexOf("/promo/") >= 0) ? "PROMO" : (j.ready ? "ready" : "not-ready"); } catch (e) {}
      return { status: x.status, ms: x.ms, kind: kind };
    });
    return Promise.all([Promise.all(probes), zcdn]).then(function (both) {
      var p = both[0], z = both[1];
      var total = 0;
      for (var i = 0; i < p.length; i++) total += (p[i].n > 0 ? p[i].n : 0);
      var el = ((Date.now() - t0) / 1000).toFixed(1);
      var rows = [];
      rows.push(row("SUMMARY", "TMDB=" + tmdb.status + " sources=" + sources.status + " (" + names.length + " names) streams=" + total + " zcdn=" + z.status + "/" + z.kind + " " + el + "s"));
      rows.push(row("TMDB", tmdb.status + " " + tmdb.ms + "ms"));
      rows.push(row("SOURCES", sources.status + " " + sources.ms + "ms names=" + names.slice(0, 6).join(",")));
      for (var k = 0; k < p.length; k++) rows.push(row(p[k].name.toUpperCase(), p[k].status + " " + p[k].ms + "ms streams=" + p[k].n));
      rows.push(row("ZCDN", z.status + " " + z.ms + "ms " + z.kind));
      return rows;
    });
  }).catch(function (e) {
    return [row("ERROR", String((e && e.message) || e).slice(0, 80))];
  });
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
