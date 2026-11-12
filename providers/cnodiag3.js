/* CNO Diag 3 — device test to find why CNO buffers on the phone (2026-11-12).
   Returns 4 labelled variants of the same title so the user can tell which (if any) plays.
   A = master URL + headers | B = master URL, no headers
   C = direct 1080p variant + headers | D = direct 1080p variant, no headers
   TV-guest safe: no timers, no TextEncoder/WebCrypto. Remove after the verdict. */
var CNO_BASE = "https://cno.to";
var CNO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
function cnH(referer) { return { "User-Agent": CNO_UA, "Referer": referer || (CNO_BASE + "/"), "Accept": "*/*" }; }
function cnSH() { return { "User-Agent": CNO_UA, "Referer": CNO_BASE + "/" }; }
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var s = seasonNum || 1, e = episodeNum || 1;
  var mid = type === "tv" ? ("/tv/" + tmdbId + "/" + s + "/" + e) : ("/movie/" + tmdbId);
  var masterUrl = CNO_BASE + "/api/s/21" + mid + "?v=3";
  return fetch(masterUrl, { headers: cnH(CNO_BASE + "/") }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (text) {
    if (!text || text.indexOf("#EXTM3U") === -1) return [];
    var var1080 = "";
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("1080") !== -1 && lines[i + 1] && lines[i + 1].indexOf("http") === 0) { var1080 = lines[i + 1].trim(); break; }
    }
    var out = [];
    out.push({ name: "CNO Diag A", title: "CNO Diag A - Master + headers", size: "Diag A - Master + headers", url: masterUrl, quality: "HD", type: "direct", headers: cnSH() });
    out.push({ name: "CNO Diag B", title: "CNO Diag B - Master, no headers", size: "Diag B - Master, no headers", url: masterUrl, quality: "HD", type: "direct" });
    if (var1080) {
      out.push({ name: "CNO Diag C", title: "CNO Diag C - 1080p variant + headers", size: "Diag C - 1080p + headers", url: var1080, quality: "1080p", type: "direct", headers: cnSH() });
      out.push({ name: "CNO Diag D", title: "CNO Diag D - 1080p variant, no headers", size: "Diag D - 1080p, no headers", url: var1080, quality: "1080p", type: "direct" });
    }
    return out;
  }).catch(function () { return []; });
}
if (typeof module !== "undefined" && module.exports) { module.exports = { getStreams: getStreams }; } else { global.CNODiag3Module = { getStreams: getStreams }; }
