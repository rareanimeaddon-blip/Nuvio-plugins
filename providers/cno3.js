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

/* CNO (cno.to) - the site is a TMDB-keyed app with a JSON detail API that
   lists every playable source per title:
   - kind "hls" (own servers, e.g. "Server 21"): /api/s/{n}/movie/{tmdb}
     or /api/s/{n}/tv/{tmdb}/{s}/{e} on cno.to returns a master playlist
     (variants on rotating vault hosts). Master requires a non-bot UA
     (curl UA 403s; browser/ExoPlayer/webOS UAs 200, no referer needed).
   - kind "embed" Player 1 = CineSrc (cinesrc.st), whose player resolves
     via the Febbox-style API at fembox.aether.bar (NXDOMAIN at build
     time 2026-10-23 - resolver included, returns [] while it is down).
   - kind "embed" Player 2 = VidFast (vidfast.vc), obfuscated player with
     no public endpoint - embed page scrape fallback only.
   Gate: detail id echo + exact TMDB title match (the API serves TMDB's
   own records by ID; no search, no fuzzy). No timers, no
   TextEncoder/WebCrypto - TV guest safe. */
var CNO_BASE = "https://cno.to";
var CNO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var FEMBOX_BASE = "https://fembox.aether.bar";

function cnHeaders(referer) {
  return { "User-Agent": CNO_UA, "Referer": referer || (CNO_BASE + "/"), "Accept": "*/*" };
}
function cnFetchText(url, referer) {
  return fetch(url, { headers: cnHeaders(referer) }).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
}
function cnFetchJson(url, referer) {
  return cnFetchText(url, referer).then(function (t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } });
}
function cnNorm(s) {
  return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function cnTmdbMeta(tmdbId, type) {
  var key = "";
  try { key = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : ""; } catch (e) {}
  if (!key) return Promise.resolve(null);
  var seg = type === "tv" ? "tv" : "movie";
  return cnFetchJson("https://api.themoviedb.org/3/" + seg + "/" + tmdbId + "?api_key=" + key, "https://www.themoviedb.org/").then(function (d) {
    if (!d || !d.id) return null;
    var date = d.release_date || d.first_air_date || "";
    return { title: d.title || d.name || "", year: date ? parseInt(date.slice(0, 4), 10) || 0 : 0 };
  }).catch(function () { return null; });
}
/* The cno detail API is TMDB-keyed: /api/movie/{tmdbId} returns TMDB's own
   record (id echoed back) and /api/tv/{id}/episode/{s}/{e} the episode's
   source list. Gate = id echo + (when TMDB answers) exact normalized title
   equality against TMDB's canonical title. No fuzzy matching anywhere. */
function cnGate(detail, meta, tmdbId) {
  if (!detail || String(detail.id) !== String(tmdbId)) return false;
  if (meta && meta.title) {
    if (cnNorm(detail.title) !== cnNorm(meta.title)) return false;
    var dy = parseInt(detail.year, 10) || 0;
    if (meta.year && dy && Math.abs(dy - meta.year) > 1) return false;
  }
  return true;
}
function cnQualityFromMaster(text) {
  var best = 0;
  var re = /RESOLUTION=(\d+)x(\d+)/g, m;
  while ((m = re.exec(text))) { var h = parseInt(m[2], 10) || 0; if (h > best) best = h; }
  if (best >= 2100) return "4K";
  if (best >= 1400) return "1440p";
  if (best >= 1000) return "1080p";
  if (best >= 700) return "720p";
  if (best >= 460) return "480p";
  if (best > 0) return "360p";
  return "HD";
}
function cnAbs(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.charAt(0) === "/") return CNO_BASE + url;
  return CNO_BASE + "/" + url;
}
function cnHlsSource(src) {
  var masterUrl = cnAbs(src.url);
  return cnFetchText(masterUrl, CNO_BASE + "/").then(function (text) {
    if (!text || text.indexOf("#EXTM3U") === -1) return [];
    var q = cnQualityFromMaster(text);
    /* NO header block on purpose (device-proven 2026-10-23): the vault
       mirrors Cloudflare-challenge requests carrying a browser UA /
       Referer, which is exactly what the apps send when a stream
       carries headers - playback stalled on both phone and TV. The
       headerless master (PlayTest P4/S1) plays: the players' native
       requests pass. Direct variant URLs stall after the first frame,
       so the master (adaptive) is the only form shipped. */
    return [{
      name: "CNO",
      title: "CNO \u00B7 " + (src.label || "Server") + " \u00B7 " + q,
      url: masterUrl,
      quality: q,
      type: "direct"
    }];
  }).catch(function () { return []; });
}
/* Player 1 = CineSrc (cinesrc.st). Its player resolves streams from the
   Febbox-style API at fembox.aether.bar: /hls/{movie|tv}/... first, then
   the MP4 endpoint. (Backend was NXDOMAIN at build time; the resolver is
   written to the player's own contract so it lights up if it returns.) */
function cnFembox(idPart, kind) {
  return cnFetchJson(FEMBOX_BASE + "/" + kind + "/" + idPart + "?ui=cno", "https://cinesrc.st/").then(function (d) {
    if (!d || !d.sources || !d.sources.length) return [];
    var out = [];
    d.sources.forEach(function (s) {
      var u = (s && (s.url || s.file || s.src)) || "";
      if (!/^https?:\/\//i.test(u)) return;
      var q = (s.quality || s.label || s.resolution || "HD");
      out.push({
        name: "CNO",
        title: "CNO \u00B7 Player 1 (CineSrc) \u00B7 " + q,
        url: u,
        quality: String(q),
        type: "direct",
        headers: { "Referer": "https://cinesrc.st/", "User-Agent": CNO_UA }
      });
    });
    return out;
  }).catch(function () { return []; });
}
function cnCineSrc(type, tmdbId, seasonNum, episodeNum) {
  var idPart = type === "tv" ? (tmdbId + "-" + (seasonNum || 1) + "-" + (episodeNum || 1)) : String(tmdbId);
  var seg = type === "tv" ? "tv" : "movie";
  return cnFembox(idPart, "hls/" + seg).then(function (hls) {
    if (hls.length) return hls;
    return cnFembox(idPart, seg);
  });
}
/* Player 2 = VidFast (vidfast.vc): obfuscated player with no public
   endpoint; best-effort scrape of the embed page for a direct playlist. */
function cnEmbedScrape(embedUrl, label) {
  return cnFetchText(embedUrl, CNO_BASE + "/").then(function (html) {
    if (!html) return [];
    var out = [], seen = {};
    var re = /https?:\/\/[^\s"'\\<>]+\.m3u8[^\s"'\\<>]*/g, m;
    while ((m = re.exec(html))) {
      var u = m[0].replace(/&amp;/g, "&");
      if (seen[u]) continue;
      seen[u] = 1;
      out.push({ name: "CNO", title: "CNO \u00B7 " + label + " \u00B7 HD", url: u, quality: "HD", type: "direct" });
    }
    return out;
  }).catch(function () { return []; });
}
/* Own-server fallback (added 2026-10-24, cno3): the detail API stopped
   listing the site's own HLS servers for most titles (Matrix/PHM/BB now
   list only the two embeds, whose resolvers are both dark: CineSrc's
   backend answers empty, VidFast's scrape finds nothing) - yet the
   server endpoints still serve those exact titles. Each title lives on
   exactly one own server (s21 for Matrix/PHM/BB, s19 for Shinchan; a
   wrong server answers clean {"error":"Not on this server"}), so the
   fallback probes both known servers and ships the headerless master
   of whichever answers with a real playlist. Runs only when the listed
   sources yield nothing. */
function cnOwnServerOne(num, url) {
  return cnFetchText(url, CNO_BASE + "/").then(function (text) {
    if (!text || text.indexOf("#EXTM3U") === -1) return [];
    return [{
      name: "CNO",
      title: "CNO \u00B7 Server " + num + " \u00B7 " + cnQualityFromMaster(text),
      url: url,
      quality: cnQualityFromMaster(text),
      type: "direct"
    }];
  }).catch(function () { return []; });
}
function cnOwnServersFallback(type, tmdbId, s, e) {
  var mid = type === "tv"
    ? ("/tv/" + tmdbId + "/" + s + "/" + e)
    : ("/movie/" + tmdbId);
  return Promise.all([
    cnOwnServerOne(21, CNO_BASE + "/api/s/21" + mid + "?v=3"),
    cnOwnServerOne(19, CNO_BASE + "/api/s/19" + mid + "?v=3")
  ]).then(function (per) {
    var out = [];
    per.forEach(function (list) { list.forEach(function (st) { out.push(st); }); });
    return out;
  });
}
function cnResolveSource(src, type, tmdbId, seasonNum, episodeNum) {
  if (!src || !src.url) return Promise.resolve([]);
  if (src.kind === "hls") return cnHlsSource(src);
  if (src.kind === "embed") {
    if (src.url.indexOf("cinesrc") !== -1) return cnCineSrc(type, tmdbId, seasonNum, episodeNum);
    if (src.url.indexOf("vidfast") !== -1) return cnEmbedScrape(src.url, src.label || "Player 2");
    return cnEmbedScrape(src.url, src.label || "Player");
  }
  return Promise.resolve([]);
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var s = seasonNum || 1, e = episodeNum || 1;
  var detailUrl = type === "tv"
    ? (CNO_BASE + "/api/tv/" + tmdbId + "/episode/" + s + "/" + e)
    : (CNO_BASE + "/api/movie/" + tmdbId);
  var gateUrl = type === "tv" ? (CNO_BASE + "/api/tv/" + tmdbId) : detailUrl;
  return Promise.all([cnTmdbMeta(tmdbId, type), cnFetchJson(gateUrl), cnFetchJson(detailUrl)]).then(function (res) {
    var meta = res[0], gateDetail = res[1], detail = res[2];
    if (!cnGate(gateDetail, meta, tmdbId)) return [];
    var sources = (detail && detail.sources) || [];
    var jobs = sources.map(function (src) { return cnResolveSource(src, type, tmdbId, s, e); });
    return Promise.all(jobs).then(function (per) {
      var out = [], seen = {};
      per.forEach(function (list) {
        list.forEach(function (st) {
          if (seen[st.url]) return;
          seen[st.url] = 1;
          out.push(st);
        });
      });
      if (out.length) return out.slice(0, 25);
      return cnOwnServersFallback(type, tmdbId, s, e).then(function (fb) {
        fb.forEach(function (st) {
          if (seen[st.url]) return;
          seen[st.url] = 1;
          out.push(st);
        });
        return out.slice(0, 25);
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.CNOScraperModule = { getStreams: getStreams };
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
