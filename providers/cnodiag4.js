/* CNO Diag 4 — device test for the proxyHeaders fix (2026-11-12).
   Diag 3 proved all 4 header/no-header x master/variant forms buffer on the
   phone (both networks, no VPN). MovieBox shows the player only gets headers
   via behaviorHints.proxyHeaders, not plain `headers`. This diag tests that.
   E = master + headers + proxyHeaders | F = 1080p variant + headers + proxyHeaders
   TV-guest safe: no timers, no TextEncoder/WebCrypto. Remove after the verdict. */
var CNO_BASE = "https://cno.to";
var CNO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
function cnH(referer) { return { "User-Agent": CNO_UA, "Referer": referer || (CNO_BASE + "/"), "Accept": "*/*" }; }
function cnSH() { return { "User-Agent": CNO_UA, "Referer": CNO_BASE + "/" }; }
function cnPH() { return { request: cnSH() }; }
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
    out.push({ name: "CNO Diag E", title: "CNO Diag E - Master + proxyHeaders", size: "Diag E - Master + proxyHeaders", url: masterUrl, quality: "HD", type: "direct", headers: cnSH(), behaviorHints: { proxyHeaders: cnPH() } });
    if (var1080) {
      out.push({ name: "CNO Diag F", title: "CNO Diag F - 1080p + proxyHeaders", size: "Diag F - 1080p + proxyHeaders", url: var1080, quality: "1080p", type: "direct", headers: cnSH(), behaviorHints: { proxyHeaders: cnPH() } });
    }
    return out;
  }).catch(function () { return []; });
}
if (typeof module !== "undefined" && module.exports) { module.exports = { getStreams: getStreams }; } else { global.CNODiag4Module = { getStreams: getStreams }; }
