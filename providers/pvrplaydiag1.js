// pvrplaydiag1.js v1.0.0 — PvrPlay reachability diag (ONE entry, update by version; remove after).
// Question it answers: does the Nuvio app's fetch reach the vidrift boot
// (https://embed.vidrift.in/api/boot/...) that the PvrPlay provider uses,
// or does it fail there (Cloudflare / host block / status-0)?
// The provider gives streams in tvsim (Matrix 7, PHM 8) but the phone on
// 1.2.157 AND on 1.2.158 (Referer removed from boot) still shows zero.
// So the failure is on the device side, not the Referer. This diag probes
// the exact boot call + TMDB + the video URL and reports the HTTP status
// + body head as stream rows. Row 1 is the verdict (summary first).
// No TMDB gate, no real streams — the rows ARE the answer.

var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var VIDRIFT = "https://embed.vidrift.in";
var MB_HOST = "https://mb.vidrift.net";
var PLAYBACK_REFERER = "https://embed.vidrift.in/";

// ---------- v5 fetch-retry prelude (verbatim from providers) ----------
(function () {
  try {
    var cur = (typeof fetch !== "undefined") ? fetch : null;
    if (!cur || cur.__nuvioRetry) return;
    var raw = cur;
    var PAUSES = [300, 900, 2000];
    function spin(ms) { var t = Date.now(); while (Date.now() - t < ms) {} }
    var wrapped = function (url, opts) {
      var tries = 0;
      var attempt = function () {
        tries++;
        return raw(url, opts).then(function (r) {
          if (r && r.status === 0 && tries < 4) { spin(PAUSES[tries - 1]); return attempt(); }
          return r;
        }, function (e) {
          if (tries < 4) { spin(PAUSES[tries - 1]); return attempt(); }
          throw e;
        });
      };
      return attempt();
    };
    wrapped.__nuvioRetry = true;
    try { fetch = wrapped; } catch (e) {}
    if (typeof globalThis !== "undefined") { try { globalThis.fetch = wrapped; } catch (e) {} }
  } catch (e) {}
})();

function probe(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (res) {
    return res.text().then(function (body) {
      var b = String(body || "");
      return { status: res.status, head: b.replace(/\s+/g, " ").slice(0, 140), full: b };
    });
  }).catch(function (e) {
    return { status: 0, head: "FETCH-FAILED " + String(e && e.message || e), full: "" };
  });
}
function probeJson(url, headers) {
  return probe(url, headers).then(function (r) {
    var streams = -1, tmdbEcho = "";
    try {
      var j = JSON.parse(r.full);
      if (j && j.meta) {
        tmdbEcho = String(j.meta.tmdbId || "");
        if (Array.isArray(j.meta.orionStreams)) streams = j.meta.orionStreams.length;
      }
    } catch (e) {}
    r.streams = streams;
    r.tmdbEcho = tmdbEcho;
    return r;
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isSeries = mediaType === "tv";
  var id = tmdbId || 603;
  var bootPath = isSeries
    ? "/api/boot/tv/" + id + "/" + (seasonNum || 1) + "/" + (episodeNum || 1)
    : "/api/boot/movie/" + id;
  var bootUrl = VIDRIFT + bootPath;
  var tmdbKind = isSeries ? "tv" : "movie";
  var tmdbUrl = "https://api.themoviedb.org/3/" + tmdbKind + "/" + id + "?api_key=" + TMDB_KEY;
  return Promise.all([
    // 1. boot WITHOUT Referer (what the fixed 1.2.158 provider sends)
    probeJson(bootUrl, { Accept: "application/json", "User-Agent": UA }),
    // 2. boot WITH the old Referer (did the Referer cause the phone 403?)
    probeJson(bootUrl, { Accept: "application/json", "User-Agent": UA, Referer: PLAYBACK_REFERER }),
    // 3. TMDB meta (does TMDB work on the phone at all?)
    probe(tmdbUrl, { "User-Agent": UA }),
  ]).then(function (r) {
    var b = r[0], br = r[1], t = r[2];
    var verdict;
    if (b.status === 200 && b.streams >= 0) {
      verdict = "PVR-DIAG: BOOT WORKS - " + b.streams + " streams, TMDB " + t.status;
    } else if (b.status === 403 || br.status === 403 || /just a moment|challenge-platform|attention required/i.test(b.head) || /just a moment|challenge-platform|attention required/i.test(br.head)) {
      verdict = "PVR-DIAG: APP IS BLOCKED - boot 403 / Cloudflare (no Referer " + b.status + ", with Referer " + br.status + ")";
    } else if (b.status === 0 && br.status === 0) {
      verdict = "PVR-DIAG: FETCH FAILED - app could not reach vidrift at all (status 0)";
    } else {
      verdict = "PVR-DIAG: BOOT FAILS - no Referer " + b.status + " (streams " + b.streams + "), with Referer " + br.status + ", TMDB " + t.status;
    }
    var rows = [];
    rows.push({ name: verdict, title: verdict, url: bootUrl, quality: "Unknown", type: "hls" });
    var bRow = "BOOT no-Referer " + b.status + " streams=" + b.streams + " tmdbEcho=" + (b.tmdbEcho || "?") + " :: " + b.head;
    rows.push({ name: bRow, title: bRow, url: bootUrl, quality: "Unknown", type: "hls" });
    var brRow = "BOOT with-Referer " + br.status + " streams=" + br.streams + " :: " + br.head;
    rows.push({ name: brRow, title: brRow, url: bootUrl, quality: "Unknown", type: "hls" });
    var tRow = "TMDB " + t.status + " :: " + t.head;
    rows.push({ name: tRow, title: tRow, url: tmdbUrl, quality: "Unknown", type: "hls" });
    return rows;
  }).catch(function () { return []; });
}

global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
