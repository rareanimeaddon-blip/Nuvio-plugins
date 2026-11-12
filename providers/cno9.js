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

/* CNO (cno.to) — REBUILT FROM SCRATCH (cno9, v1.0.8, 2026-11-12).
   The site is a TMDB-keyed app with a JSON detail API listing every
   playable source per title. Only one source is a direct stream:
   kind "hls" (own servers, e.g. "Server 21"): /api/s/{n}/movie/{tmdb}
   or /api/s/{n}/tv/{tmdb}/{s}/{e} returns a master playlist whose
   variants live on v.lumenbox.top (segments ALWAYS on lumenbox.top,
   even when the variant playlist is served from a mirror host).
   The two "embed" sources are not direct streams: CineSrc (cinesrc.st)
   is a JS-driven Next.js player with no direct video URL in its HTML,
   and VidFast (vidfast.vc) is an RSA-encrypted embed API the TV guest
   cannot use (no WebCrypto). Both are skipped.

   THE FIX (proven 2026-11-12): the video hosts gate on User-Agent.
   A DESKTOP Chrome UA is Cloudflare-403 on EVERY video hop (variant
   AND segment, e.g. init.gif) while an ANDROID Chrome UA answers
   200/206 with real fMP4. The old provider (cno8) forced a desktop
   UA, so every stream buffered on the phone. This rebuild uses a
   MOBILE (Android) UA everywhere — provider fetches, stream headers,
   and proxyHeaders — and returns the DIRECT 1080p variant URL (not
   the master) so the player starts on the playlist it actually plays.
   Gate: detail id echo + exact TMDB title match. No timers, no
   TextEncoder/WebCrypto - TV guest safe. */
var CNO_BASE = "https://cno.to";
var CNO_UA = "Mozilla/5.0 (Linux; Android 14; CPH2585) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function cnHeaders(referer) {
  return { "User-Agent": CNO_UA, "Referer": referer || (CNO_BASE + "/"), "Accept": "*/*" };
}
function cnStreamHeaders() {
  return { "User-Agent": CNO_UA, "Referer": CNO_BASE + "/" };
}
function cnProxyHeaders() {
  return { request: cnStreamHeaders() };
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
function cnGate(detail, meta, tmdbId) {
  if (!detail || String(detail.id) !== String(tmdbId)) return false;
  if (meta && meta.title) {
    if (cnNorm(detail.title) !== cnNorm(meta.title)) return false;
    var dy = parseInt(detail.year, 10) || 0;
    if (meta.year && dy && Math.abs(dy - meta.year) > 1) return false;
  }
  return true;
}
function cnQualityFromRes(w, h) {
  if (h >= 2100) return "4K";
  if (h >= 1400) return "1440p";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h >= 460) return "480p";
  if (h > 0) return "360p";
  return "HD";
}
/* Pick the 1080p variant from a master playlist; fall back to the
   highest-resolution variant listed. Returns {url, quality} or null. */
function cnPickVariant(text) {
  if (!text || text.indexOf("#EXTM3U") === -1) return null;
  var lines = text.split("\n");
  var best = null, bestH = 0, v1080 = null;
  for (var i = 0; i < lines.length; i++) {
    var m = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i] || "");
    if (!m) continue;
    var h = parseInt(m[2], 10) || 0;
    var u = (lines[i + 1] || "").trim();
    if (!u || u.indexOf("http") !== 0) continue;
    if (h === 1080 || (h >= 1000 && h < 1400)) { if (!v1080) v1080 = { url: u, quality: "1080p" }; }
    if (h > bestH) { bestH = h; best = { url: u, quality: cnQualityFromRes(parseInt(m[1], 10) || 0, h) }; }
  }
  return v1080 || best;
}
function cnAbs(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.charAt(0) === "/") return CNO_BASE + url;
  return CNO_BASE + "/" + url;
}
function cnStream(mediaTitle, seasonNum, episodeNum, server, url, quality) {
  var sz = formatStreamSize({ source: "CNO", title: mediaTitle, quality: quality, season: seasonNum, episode: episodeNum, server: server, url: url });
  return { name: "CNO", title: "CNO", size: sz, url: url, quality: quality, type: "direct", headers: cnStreamHeaders(), behaviorHints: { proxyHeaders: cnProxyHeaders() } };
}
/* Resolve one listed HLS source: fetch its master, pick the 1080p
   variant, return it as the stream. */
function cnHlsVariant(src, mediaTitle, seasonNum, episodeNum) {
  var masterUrl = cnAbs(src.url);
  return cnFetchText(masterUrl, CNO_BASE + "/").then(function (text) {
    var v = cnPickVariant(text);
    if (!v) return [];
    return [cnStream(mediaTitle, seasonNum, episodeNum, src.label || "Server", v.url, v.quality)];
  }).catch(function () { return []; });
}
/* Own-server fallback: the detail API sometimes lists no HLS source
   even though the server endpoint still serves the title. Each title
   lives on exactly one own server (s21 for Matrix/PHM/BB, s19 for
   Shinchan); a wrong server answers {"error":"Not on this server"}.
   Probes both and ships the 1080p variant of whichever answers. */
function cnOwnServerVariant(num, url, mediaTitle, seasonNum, episodeNum) {
  return cnFetchText(url, CNO_BASE + "/").then(function (text) {
    var v = cnPickVariant(text);
    if (!v) return [];
    return [cnStream(mediaTitle, seasonNum, episodeNum, "Server " + num, v.url, v.quality)];
  }).catch(function () { return []; });
}
function cnOwnServersFallback(type, tmdbId, s, e, mediaTitle) {
  var mid = type === "tv" ? ("/tv/" + tmdbId + "/" + s + "/" + e) : ("/movie/" + tmdbId);
  var seas = type === "tv" ? s : undefined, ep = type === "tv" ? e : undefined;
  return Promise.all([
    cnOwnServerVariant(21, CNO_BASE + "/api/s/21" + mid + "?v=3", mediaTitle, seas, ep),
    cnOwnServerVariant(19, CNO_BASE + "/api/s/19" + mid + "?v=3", mediaTitle, seas, ep)
  ]).then(function (per) {
    var out = [];
    per.forEach(function (list) { list.forEach(function (st) { out.push(st); }); });
    return out;
  });
}

// __STREAM_LABEL_FORMATTER__ v4 (size): user-spec body — heading is the provider name (in `name`), body is the essential info.
// Body lines: 🎬 Title [(Year)] | 📂 Season N • 🎞️ Episode N (series only) | 💎 Quality | ⏱️ Runtime | 🔊 Audio | 💾 File size | 🗄️ Server | 💬 Subtitles.
// Only lines with data are shown. Pure string work, no timers, no TextEncoder, no fetch. Never throws.
function formatStreamSize(o) {
  try {
    o = o || {};
    function str(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
    function langName(v) {
      var k = str(v).toLowerCase();
      var map = { en: "English", eng: "English", english: "English", hi: "Hindi", hin: "Hindi", hindi: "Hindi",
        es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", ru: "Russian",
        ar: "Arabic", bn: "Bengali", zh: "Chinese", ja: "Japanese", ko: "Korean", ta: "Tamil", te: "Telugu",
        ml: "Malayalam", mr: "Marathi", pa: "Punjabi", ur: "Urdu", id: "Indonesian", ms: "Malay",
        vi: "Vietnamese", th: "Thai", tl: "Filipino", nl: "Dutch", sv: "Swedish", da: "Danish",
        fi: "Finnish", no: "Norwegian", pl: "Polish", tr: "Turkish", uk: "Ukrainian", cs: "Czech",
        el: "Greek", he: "Hebrew", ro: "Romanian", hu: "Hungarian" };
      if (map[k]) return map[k];
      return str(v);
    }
    var lines = [];
    var title = str(o.title);
    if (title) {
      var t = "🎬 " + title;
      var year = str(o.year);
      if (year) t += " (" + year + ")";
      lines.push(t);
    }
    if (o.season !== undefined && o.season !== null && String(o.season) !== "" &&
        o.episode !== undefined && o.episode !== null && String(o.episode) !== "")
      lines.push("📂 Season " + o.season + " • 🎞️ Episode " + o.episode);
    var q = str(o.quality);
    if (q && q.toLowerCase() !== "unknown") lines.push("💎 " + q);
    var rt = o.runtime;
    var rtMin = 0;
    if (typeof rt === "number" && rt > 0) rtMin = Math.round(rt);
    else if (typeof rt === "string" && /^\d+$/.test(rt.trim())) rtMin = parseInt(rt.trim(), 10);
    if (rtMin > 0) {
      var rh = Math.floor(rtMin / 60), rm = rtMin % 60;
      lines.push("⏱️ " + (rh > 0 ? rh + "h " + (rm < 10 ? "0" : "") + rm + "m" : rm + "m"));
    }
    var audio = o.audio;
    if (Array.isArray(audio)) audio = audio.filter(function (a) { return str(a); }).join(" / ");
    audio = str(audio);
    if (audio && audio.toLowerCase() !== "unknown") lines.push("🔊 " + audio);
    var size = str(o.size);
    if (size) lines.push("💾 " + size);
    var server = str(o.server);
    if (!server && str(o.url)) {
      var h = str(o.url).split("/")[2] || "";
      server = h.replace(/^www\./, "");
    }
    if (server) lines.push("🗄️ " + server);
    var subs = o.subtitles;
    var langs = [];
    if (Array.isArray(subs)) {
      for (var i = 0; i < subs.length; i++) {
        var lg = (subs[i] && typeof subs[i] === "object") ? (subs[i].language || subs[i].name) : subs[i];
        lg = langName(lg);
        if (lg && langs.indexOf(lg) === -1) langs.push(lg);
      }
    } else if (typeof subs === "string" && str(subs)) { langs = [langName(subs)]; }
    if (langs.length) {
      var shown = langs.slice(0, 3).join(", ");
      if (langs.length > 3) shown += " +" + (langs.length - 3) + " more";
      lines.push("💬 " + shown);
    }
    return lines.join("\n");
  } catch (e) { return ""; }
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
    var mediaTitle = (meta && meta.title) || "";
    if (!cnGate(gateDetail, meta, tmdbId)) return [];
    var sources = (detail && detail.sources) || [];
    var seas = type === "tv" ? s : undefined, ep = type === "tv" ? e : undefined;
    var jobs = [];
    sources.forEach(function (src) {
      if (src && src.kind === "hls" && src.url) jobs.push(cnHlsVariant(src, mediaTitle, seas, ep));
    });
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
      return cnOwnServersFallback(type, tmdbId, s, e, mediaTitle).then(function (fb) {
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
