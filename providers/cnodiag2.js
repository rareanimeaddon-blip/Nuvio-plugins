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

/* CNO Diag v2 - isolates WHY the vault mirrors 403: round 1 showed the
   variant playlist returns 200 fetched BARE but 403 with the provider's
   browser UA + Referer headers. This round separates UA vs Referer on
   the variant, and tests a REAL first segment bare / ExoPlayer-UA /
   Referer-only. */
var CD2_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var CD2_EXO = "ExoPlayerLib/2.19.1 (Linux; Android 13) ExoPlayer";
var CD2_BASE = "https://cno.to";

function cd2Fetch(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (r) {
    return r.text().then(function (t) { return { status: r.status, text: t || "" }; });
  }).catch(function (e) { return { status: 0, text: "" }; });
}
function cd2Stream(title, url) {
  return { name: "CNO Diag", title: title, url: url, quality: "HD", type: "direct" };
}
function cd2FirstSeg(variantText, variantUrl) {
  var lines = variantText.split("\n"), count = 0, first = "";
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln || ln.charAt(0) === "#") continue;
    count++;
    if (!first) first = ln;
  }
  if (!first) return { form: "NONE", url: "", count: 0 };
  var form = /^https?:\/\//i.test(first) ? "ABS" : "REL";
  if (/#cno=\d+$/.test(first)) form += "+CNO";
  var clean = first.split("#")[0];
  var abs = /^https?:\/\//i.test(clean) ? clean : variantUrl.replace(/\/[^\/]*$/, "/") + clean;
  return { form: form, url: abs, count: count };
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var master = type === "tv"
    ? (CD2_BASE + "/api/s/21/tv/" + tmdbId + "/" + (seasonNum || 1) + "/" + (episodeNum || 1) + "?v=3")
    : (CD2_BASE + "/api/s/21/movie/" + tmdbId + "?v=3");
  var out = [];
  return cd2Fetch(master, { "User-Agent": CD2_UA, "Referer": CD2_BASE + "/" }).then(function (m) {
    var variants = [];
    (m.text || "").split("\n").forEach(function (ln) { ln = ln.trim(); if (/^https?:\/\//i.test(ln)) variants.push(ln); });
    if (!variants.length) { out.push(cd2Stream("D0 no variants master=" + m.status, master)); return out; }
    var V = variants[0];
    return cd2Fetch(V, {}).then(function (bare) {
      var seg = cd2FirstSeg(bare.text || "", V);
      out.push(cd2Stream("D1 variant bare=" + bare.status + " segs=" + seg.count + " form=" + seg.form, master));
      if (!seg.url) { out.push(cd2Stream("D2 no segment line", master)); return out; }
      return cd2Fetch(seg.url, {}).then(function (sBare) {
        out.push(cd2Stream("D2 segment bare=" + sBare.status + " bytes=" + (sBare.text ? sBare.text.length : 0), master));
        return cd2Fetch(V, { "User-Agent": CD2_UA }).then(function (vUa) {
          out.push(cd2Stream("D3 variant UAonly=" + vUa.status, master));
          return cd2Fetch(V, { "Referer": CD2_BASE + "/" }).then(function (vRef) {
            out.push(cd2Stream("D4 variant REFonly=" + vRef.status, master));
            return cd2Fetch(seg.url, { "User-Agent": CD2_EXO }).then(function (sExo) {
              out.push(cd2Stream("D5 segment ExoUA=" + sExo.status, master));
              return cd2Fetch(seg.url, { "Referer": CD2_BASE + "/" }).then(function (sRef) {
                out.push(cd2Stream("D6 segment REFonly=" + sRef.status, master));
                return out;
              });
            });
          });
        });
      });
    });
  }).catch(function () { return [cd2Stream("D0 diag chain failed", master)]; });
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
