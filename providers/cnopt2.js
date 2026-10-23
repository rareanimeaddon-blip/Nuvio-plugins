/* __FETCH_RETRY_PRELUDE__ v5 (webOS TV): the TV plugin fetch service
   intermittently returns status-0 transport failures, sometimes in
   host-specific dead windows lasting tens of seconds. Wrap the global
   fetch: retry a rejection or status-0 up to 4 attempts with SHORT
   spin pauses (0.3/0.9/2s, ~3.2s span, no timers exist in the guest).
   Longer window-spanning is left to the chain-retry postlude, which
   re-runs the whole provider chain seconds later. v3's ~31s ladder
   blew the per-provider budget on long chains; v4's instant retries
   all landed inside dead windows and regressed medium chains. */
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

/* CNO PlayTest - hands the app PLAYER the CNO playlists directly, with
   NO header block, to learn whether the player itself can fetch the
   vault mirrors (the fetch bridge can; the players are a different
   stack and playback is failing on both phone and TV).
   P1/P2: variant playlists bare. P3: variant on the swapped mirror.
   P4: the master bare - exactly the proposed cno fix. S1/S2: fresh
   variant statuses (bare vs provider headers) for the same run. */
var CP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var CP_BASE = "https://cno.to";

function cpFetch(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (r) {
    return r.text().then(function (t) { return { status: r.status, text: t || "" }; });
  }).catch(function () { return { status: 0, text: "" }; });
}
function cpHost(u) { var m = /^https?:\/\/([^\/]+)/.exec(u); return m ? m[1] : "?"; }
function cpRes(u, masterText) {
  var re = new RegExp(cpHost(u).replace(/\./g, "\\.") + "[^\\n]*RESOLUTION=\\d+x(\\d+)", "");
  var inf = /RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g, mm;
  while ((mm = inf.exec(masterText))) { if (mm[2].trim() === u) return mm[1]; }
  return "?";
}
function cpEntry(title, url) {
  return { name: title, title: title, url: url, quality: "HD", type: "direct" };
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var master = type === "tv"
    ? (CP_BASE + "/api/s/21/tv/" + tmdbId + "/" + (seasonNum || 1) + "/" + (episodeNum || 1) + "?v=3")
    : (CP_BASE + "/api/s/21/movie/" + tmdbId + "?v=3");
  return cpFetch(master, { "User-Agent": CP_UA, "Referer": CP_BASE + "/" }).then(function (m) {
    var variants = [], resOf = {};
    var inf = /RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g, mm;
    while ((mm = inf.exec(m.text || ""))) { var u = mm[2].trim(); if (/^https?:\/\//i.test(u)) { variants.push(u); resOf[u] = mm[1]; } }
    if (!variants.length) return [cpEntry("CNO P0 no variants master=" + m.status, master)];
    var v1 = variants[0], v2 = variants.length > 1 ? variants[1] : variants[0];
    var swapped = v2 === v1 ? v1 : v1.replace(cpHost(v1), cpHost(v2));
    return cpFetch(v1, {}).then(function (bare) {
      return cpFetch(v1, { "User-Agent": CP_UA, "Referer": CP_BASE + "/" }).then(function (hdr) {
        return [
          cpEntry("CNO S1 var bare=" + bare.status + " hdr=" + hdr.status, master),
          cpEntry("CNO P1 PLAY var" + (resOf[v1] || "?") + " " + cpHost(v1), v1),
          cpEntry("CNO P2 PLAY var" + (resOf[v2] || "?") + " " + cpHost(v2), v2),
          cpEntry("CNO P3 PLAY var" + (resOf[v1] || "?") + " swapped", swapped),
          cpEntry("CNO P4 PLAY master NOHDR", master)
        ];
      });
    });
  }).catch(function () { return [cpEntry("CNO P0 chain failed", master)]; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.CNOPlayScraperModule = { getStreams: getStreams };
}

/* __CHAIN_RETRY_POSTLUDE__ v2: in a full TV search, providers die when
   the fetch service drops a hop or sits in a dead window. If a chain
   comes back empty, re-run it - the re-run is naturally spaced by the
   first attempt's own duration, which spans the short windows. Up to
   3 attempts, gated on total elapsed (<20s for #2, <38s for #3) so a
   slow provider never overruns the app budget. */
(function () {
  try {
    var g = (typeof globalThis !== "undefined") ? globalThis : null;
    var orig = null;
    if (typeof module !== "undefined" && module.exports && typeof module.exports.getStreams === "function") orig = module.exports.getStreams;
    else if (g && typeof g.getStreams === "function") orig = g.getStreams;
    if (!orig || orig.__chainRetry) return;
    var wrapped = function () {
      var args = arguments;
      var t0 = Date.now();
      var tries = 0;
      var run = function () {
        tries++;
        return Promise.resolve().then(function () { return orig.apply(null, args); }).then(function (res) {
          var el = Date.now() - t0;
          if (Array.isArray(res) && res.length === 0 && ((tries === 1 && el < 20000) || (tries === 2 && el < 38000))) return run();
          return res;
        }, function () {
          var el = Date.now() - t0;
          if ((tries === 1 && el < 20000) || (tries === 2 && el < 38000)) return run();
          return [];
        });
      };
      return run();
    };
    wrapped.__chainRetry = true;
    if (typeof module !== "undefined" && module.exports) module.exports.getStreams = wrapped;
    if (g) { try { g.getStreams = wrapped; } catch (e) {} }
  } catch (e) {}
})();
