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

/* CNO Diag - temporary on-device probe for the CNO playback failure.
   Fetches, from inside the app: the master playlist (bare and with
   browser headers), each variant playlist on its vault mirror, the
   host-swapped variant, and the first segment - and reports the HTTP
   statuses and the segment-line shape as stream titles. */
var CD_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var CD_BASE = "https://cno.to";

function cdFetch(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (r) {
    return r.text().then(function (t) { return { status: r.status, text: t || "" }; });
  }).catch(function (e) { return { status: 0, text: "", err: String(e && e.message || e) }; });
}
function cdHost(u) { var m = /^https?:\/\/([^\/]+)/.exec(u); return m ? m[1] : "?"; }
function cdSegInfo(variantText, variantUrl) {
  var lines = variantText.split("\n");
  var map = /EXT-X-MAP:URI="([^"]+)"/.exec(variantText);
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln || ln.charAt(0) === "#") continue;
    var form = /^https?:\/\//i.test(ln) ? "ABS" : "REL";
    var cno = /#cno=\d+$/.test(ln) ? "+CNO" : "";
    var abs = /^https?:\/\//i.test(ln) ? ln : variantUrl.replace(/\/[^\/]*$/, "/") + ln;
    return { form: form + cno, segUrl: abs.split("#")[0], map: map ? map[1] : "" };
  }
  return { form: "NONE", segUrl: "", map: map ? map[1] : "" };
}
function cdStream(title, url) {
  return { name: "CNO Diag", title: title, url: url, quality: "HD", type: "direct" };
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var master = type === "tv"
    ? (CD_BASE + "/api/s/21/tv/" + tmdbId + "/" + (seasonNum || 1) + "/" + (episodeNum || 1) + "?v=3")
    : (CD_BASE + "/api/s/21/movie/" + tmdbId + "?v=3");
  var out = [];
  return cdFetch(master, {}).then(function (bare) {
    return cdFetch(master, { "User-Agent": CD_UA, "Referer": CD_BASE + "/" }).then(function (hdr) {
      out.push(cdStream("D1 master bare=" + bare.status + " hdr=" + hdr.status + " m3u8=" + (hdr.text.indexOf("#EXTM3U") === 0 ? "Y" : "N"), master));
      var variants = [];
      hdr.text.split("\n").forEach(function (ln) { ln = ln.trim(); if (/^https?:\/\//i.test(ln)) variants.push(ln); });
      if (!variants.length) { out.push(cdStream("D2 no variants in master", master)); return out; }
      var v1 = variants[0];
      var v2 = variants.length > 1 ? variants[1] : v1;
      return cdFetch(v1, { "User-Agent": CD_UA, "Referer": CD_BASE + "/" }).then(function (r1) {
        var info = r1.text ? cdSegInfo(r1.text, v1) : { form: "?", segUrl: "", map: "" };
        out.push(cdStream("D2 variant " + cdHost(v1) + "=" + r1.status + " seg=" + info.form + " map=" + (info.map ? "Y" : "N"), master));
        var segP = info.segUrl ? cdFetch(info.segUrl, { "User-Agent": CD_UA, "Referer": CD_BASE + "/" }) : Promise.resolve({ status: -1, text: "" });
        return segP.then(function (rs) {
          out.push(cdStream("D3 segment=" + rs.status + " bytes=" + (rs.text ? rs.text.length : 0), master));
          return cdFetch(v2, { "User-Agent": CD_UA, "Referer": CD_BASE + "/" }).then(function (r2) {
            out.push(cdStream("D4 variant2 " + cdHost(v2) + "=" + r2.status, master));
            var swapped = v1.replace(cdHost(v1), cdHost(v2));
            return cdFetch(swapped, { "User-Agent": CD_UA, "Referer": CD_BASE + "/" }).then(function (r3) {
              out.push(cdStream("D5 v1-on-v2host=" + r3.status, master));
              return cdFetch(v1, {}).then(function (r4) {
                out.push(cdStream("D6 variant bare=" + r4.status, master));
                return out;
              });
            });
          });
        });
      });
    });
  }).catch(function () { return [cdStream("D0 diag chain failed", master)]; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.CNODiagScraperModule = { getStreams: getStreams };
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
