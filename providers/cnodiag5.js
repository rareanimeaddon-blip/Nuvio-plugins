/* CNO Diag 5 — test the 4 mirror CDNs (2026-11-12).
   The CNO watch page lists 4 video hosts: lumenbox.top, starlantern.top,
   neonvase.top, prismdesk.top. The SAME video file is served from all 4
   (verified: identical 139898-byte 1080p variant on each, 200 with headers,
   403 bare). If lumenbox.top is the blocked one, another mirror may play.
   Returns the 1080p variant on each host, all with headers + proxyHeaders.
   TV-guest safe: no timers, no TextEncoder/WebCrypto. Remove after the verdict. */
var CNO_BASE = "https://cno.to";
var CNO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var CDNS = ["v.lumenbox.top", "v.starlantern.top", "v.neonvase.top", "v.prismdesk.top"];
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
    if (!var1080) return [];
    var out = [];
    var labels = ["Lumenbox", "Starlantern", "Neonvase", "Prismdesk"];
    for (var j = 0; j < CDNS.length; j++) {
      var u = var1080.replace(/^https:\/\/[^\/]+/, "https://" + CDNS[j]);
      out.push({ name: "CNO Diag " + labels[j], title: "CNO Diag " + labels[j] + " - 1080p mirror", size: "Diag " + labels[j] + " - 1080p mirror", url: u, quality: "1080p", type: "direct", headers: cnSH(), behaviorHints: { proxyHeaders: cnPH() } });
    }
    return out;
  }).catch(function () { return []; });
}
if (typeof module !== "undefined" && module.exports) { module.exports = { getStreams: getStreams }; } else { global.CNODiag5Module = { getStreams: getStreams }; }
