// Dulo Diag v2 v1.0.0 — temporary, device-only.
// Diag v1 (2026-11-17, PHM on device): TMDB 200, resolve 503,
// doolo /sources 403 and all 4 per-source probes 403 in ~0.5s,
// total 0.9s. So the doolo API is BLOCKED for the app's fetch on
// the user's Wi-Fi IP — not slow, not a timeout. This round tests
// which variant, if any, gets past the block on the device:
//  - main site homepage (is dulo.mov itself reachable?)
//  - /sources with the provider's current headers (control)
//  - /sources with browser-like headers + watch-page Referer
//  - one per-source call with each header set
//  - CineCat /sources (same 403 class? CineCat is also 0 on device)
// Summary row is FIRST. Remove this entry once the verdict lands.
var API = "https://dulo.mov";
var DOOLO_API = "https://doolo.dulo.mov";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
function row(name, msg) {
  var t = "D2 " + name + ": " + msg;
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
    .then(function (r) { return r.text().then(function (t) { return { status: r.status, ms: Date.now() - t0, body: t.slice(0, 60) }; }); })
    .catch(function (e) { return { status: "ERR:" + String((e && e.message) || e).slice(0, 30), ms: Date.now() - t0, body: "" }; });
}
function getStreams(tmdbId, mediaType, season, episode) {
  var t0 = Date.now();
  var id = tmdbId || "687163";
  var type = mediaType === "movie" ? "movie" : "tv";
  var plain = { "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": API + "/" };
  var brow = { "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": API + "/watch/" + type + "/" + id, "Origin": API, "Accept-Language": "en-US,en;q=0.9", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-site" };
  var falconQs = "?tmdb=" + id + "&type=" + type;
  return Promise.all([
    probe(API + "/", 12000, plain),
    probe(DOOLO_API + "/sources", 12000, plain),
    probe(DOOLO_API + "/sources", 12000, brow),
    probe(DOOLO_API + "/sources/falcon" + falconQs, 12000, plain),
    probe(DOOLO_API + "/sources/falcon" + falconQs, 12000, brow),
    probe("https://edge.cinecat.eu/sources", 12000, plain)
  ]).then(function (r) {
    var home = r[0], src = r[1], srcB = r[2], fal = r[3], falB = r[4], cine = r[5];
    var el = ((Date.now() - t0) / 1000).toFixed(1);
    var rows = [];
    rows.push(row("SUMMARY", "home=" + home.status + " src=" + src.status + " srcBrow=" + srcB.status + " fal=" + fal.status + " falBrow=" + falB.status + " cine=" + cine.status + " " + el + "s"));
    rows.push(row("HOME dulo.mov", home.status + " " + home.ms + "ms"));
    rows.push(row("SRC plain", src.status + " " + src.ms + "ms " + src.body.replace(/[^A-Za-z0-9 .,:\/-]/g, "").slice(0, 40)));
    rows.push(row("SRC browser", srcB.status + " " + srcB.ms + "ms " + srcB.body.replace(/[^A-Za-z0-9 .,:\/-]/g, "").slice(0, 40)));
    rows.push(row("FALCON plain", fal.status + " " + fal.ms + "ms"));
    rows.push(row("FALCON browser", falB.status + " " + falB.ms + "ms"));
    rows.push(row("CINECAT src", cine.status + " " + cine.ms + "ms"));
    return rows;
  }).catch(function (e) {
    return [row("ERROR", String((e && e.message) || e).slice(0, 80))];
  });
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
