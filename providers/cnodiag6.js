/* CNO Diag 6 — mobile User-Agent test (2026-11-12).
   All 4 CDNs buffered with a DESKTOP Chrome UA. The phone is a mobile device;
   a desktop UA from a mobile IP may look like a bot mismatch to Cloudflare.
   This diag uses the phone's own kind of UA (Android Chrome, OnePlus 12R).
   Tests the 1080p variant on Lumenbox and Starlantern with the mobile UA.
   TV-guest safe: no timers, no TextEncoder/WebCrypto. Remove after the verdict. */
var CNO_BASE = "https://cno.to";
var CNO_UA_MOBILE = "Mozilla/5.0 (Linux; Android 14; CPH2585) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
var CDNS = ["v.lumenbox.top", "v.starlantern.top"];
function cnH(referer) { return { "User-Agent": CNO_UA_MOBILE, "Referer": referer || (CNO_BASE + "/"), "Accept": "*/*" }; }
function cnSH() { return { "User-Agent": CNO_UA_MOBILE, "Referer": CNO_BASE + "/" }; }
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
    var labels = ["Lumenbox-MobileUA", "Starlantern-MobileUA"];
    for (var j = 0; j < CDNS.length; j++) {
      var u = var1080.replace(/^https:\/\/[^\/]+/, "https://" + CDNS[j]);
      out.push({ name: "CNO Diag " + labels[j], title: "CNO Diag " + labels[j] + " - mobile UA", size: "Diag " + labels[j] + " - mobile UA", url: u, quality: "1080p", type: "direct", headers: cnSH(), behaviorHints: { proxyHeaders: cnPH() } });
    }
    return out;
  }).catch(function () { return []; });
}
if (typeof module !== "undefined" && module.exports) { module.exports = { getStreams: getStreams }; } else { global.CNODiag6Module = { getStreams: getStreams }; }
