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

// PvrPlay provider — built 2026-11-09 (pvrplay1.js v1.0.0).
// Source: pvrplay.live / pvrplay.site (both redirect to rotating
// pvrplay.fun subdomains). The site is a TMDB-driven Next.js app;
// its Watch page embeds https://embed.reelsdownload.online/player/
// <tmdbId>?key=k_bf0ab0853bce46e3d90b256b&close=1 (key is static).
// That embed is a multi-source aggregator (vidrift / cinemaos /
// orion / moviebox / animesalt). Its direct stream API is:
//   GET https://embed.vidrift.in/api/boot/movie/<tmdbId>
//   GET https://embed.vidrift.in/api/boot/tv/<tmdbId>/<s>/<e>
// which returns { meta: { tmdbId, type, playbackToken, orionStreams } }.
// orionStreams are DIRECT video URLs (mp4 + HLS master playlists)
// on mb.vidrift.net, in several audio languages (Original, Hindi,
// Tamil, Telugu, French, Spanish, ...). The per-provider /api/source
// calls (vaplayer/vidlove/moviebox) 502, so boot/orionStreams is the
// only reliable path in v1.
// PLAYBACK GATE: the video hosts 403 without Referer
// "https://embed.vidrift.in/" (probe-verified: bare 403, vidlove.cc
// Referer 403, reelsdownload Referer 403, embed.vidrift.in 206/200).
// Every stream therefore carries that Referer (+ UA) in both
// `headers` and behaviorHints.proxyHeaders.request.
// Chain (TMDB-id-keyed, no title search to go wrong): TMDB meta
// (title/year/original language, for the label) + vidrift boot in
// parallel -> gate on meta.tmdbId === requested id and meta.type
// === mediaType -> orionStreams -> streams. Verified 2026-11-09
// (sandbox): The Matrix boot 7 streams (Original mp4 206 with the
// Referer; Hindi HLS master 200, rungs 1080/720/480); Breaking Bad
// S1E1 boot 4 streams (HLS); Project Hail Mary boot 8 streams.
// Device test decides playback (Referer forwarding via the app's
// playback proxy is the open question).

var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var VIDRIFT = "https://embed.vidrift.in";
var MB_HOST = "https://mb.vidrift.net";
var PLAYBACK_REFERER = "https://embed.vidrift.in/";

function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {};
  options.headers = options.headers || {};
  if (!options.headers["User-Agent"]) options.headers["User-Agent"] = UA;
  return fetch(url, options);
}
function getText(url, headers, timeoutMs) {
  return fetchWithTimeout(url, { headers: headers || {} }, timeoutMs || 12000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}
function getJson(url, headers, timeoutMs) {
  return getText(url, headers, timeoutMs || 10000).then(function (t) {
    try { return JSON.parse(t); } catch (e) { return null; }
  });
}

// ---------- TMDB (label + original language only) ----------
var LANG_NAME = { en: "English", hi: "Hindi", es: "Spanish", fr: "French", de: "German",
  it: "Italian", pt: "Portuguese", ru: "Russian", ar: "Arabic", bn: "Bengali", zh: "Chinese",
  ja: "Japanese", ko: "Korean", ta: "Tamil", te: "Telugu", ml: "Malayalam", mr: "Marathi",
  pa: "Punjabi", ur: "Urdu", id: "Indonesian", ms: "Malay", vi: "Vietnamese", th: "Thai",
  tl: "Filipino", nl: "Dutch", sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian",
  pl: "Polish", tr: "Turkish", uk: "Ukrainian", cs: "Czech", el: "Greek", he: "Hebrew",
  ro: "Romanian", hu: "Hungarian" };
function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return getJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY, {}, 10000)
    .then(function (j) {
      if (!j || !(j.title || j.name)) return null;
      var d = j.release_date || j.first_air_date || "";
      var ol = j.original_language ? (LANG_NAME[j.original_language] || j.original_language) : "";
      return { title: j.title || j.name, year: d ? parseInt(d.slice(0, 4), 10) : null, origLang: ol };
    })
    .catch(function () { return null; });
}

// ---------- vidrift boot ----------
function bootPath(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === "tv") return "/api/boot/tv/" + tmdbId + "/" + seasonNum + "/" + episodeNum;
  return "/api/boot/movie/" + tmdbId;
}
function bootStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return getJson(VIDRIFT + bootPath(tmdbId, mediaType, seasonNum, episodeNum),
    { Accept: "application/json", Referer: PLAYBACK_REFERER }, 15000)
    .then(function (j) {
      if (!j || !j.meta) return null;
      var m = j.meta;
      // Exact gate: the boot echoes the TMDB id + type it resolved.
      if (String(m.tmdbId) !== String(tmdbId)) return null;
      var mt = mediaType === "tv" ? "tv" : "movie";
      if (m.type && m.type !== mt) return null;
      var list = m.orionStreams;
      if (!Array.isArray(list) || !list.length) return null;
      return list;
    })
    .catch(function () { return null; });
}

function resolveStreamUrl(u) {
  if (!u) return "";
  if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) return u;
  if (u.charAt(0) === "/") return MB_HOST + u;
  return MB_HOST + "/" + u;
}
function qualityFromRungs(rungs) {
  var best = 0;
  if (Array.isArray(rungs)) {
    for (var i = 0; i < rungs.length; i++) {
      var h = rungs[i] && rungs[i].height ? parseInt(rungs[i].height, 10) : 0;
      if (h > best) best = h;
    }
  }
  if (best >= 2160) return "2160p";
  if (best >= 1440) return "1440p";
  if (best >= 1080) return "1080p";
  if (best >= 720) return "720p";
  if (best >= 480) return "480p";
  return "";
}
function langFromName(name, origLang) {
  // orionStream name is "Orion · <Language>" ("Original" = original audio).
  var s = String(name || "");
  var parts = s.split("·");
  var lang = parts.length > 1 ? parts[parts.length - 1].trim() : "";
  if (!lang) return "";
  if (/^original$/i.test(lang)) return origLang || "Original";
  return lang;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isSeries = mediaType === "tv";
  if (isSeries && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);
  return Promise.all([tmdbMeta(tmdbId, mediaType), bootStreams(tmdbId, mediaType, seasonNum, episodeNum)])
    .then(function (parts) {
      var meta = parts[0], list = parts[1];
      if (!meta || !list) return [];
      var ph = { "User-Agent": UA, Referer: PLAYBACK_REFERER };
      var out = [], seen = {};
      list.forEach(function (s) {
        if (!s || !s.url) return;
        var url = resolveStreamUrl(s.url);
        if (!url || seen[url]) return;
        seen[url] = 1;
        var isHls = s.type === "hls" || /\.m3u8(\?|$)/i.test(url);
        var q = qualityFromRungs(s.rungs) || (isHls ? "HD" : "HD");
        var audio = langFromName(s.name, meta.origLang);
        var label = formatStreamLabel({ source: "PvrPlay", title: meta.title, quality: q,
          season: isSeries ? seasonNum : undefined, episode: isSeries ? episodeNum : undefined,
          audio: audio || undefined, server: (s.provider || "Orion"), url: url });
        out.push({
          name: label,
          title: label,
          url: url,
          quality: q,
          type: isHls ? "hls" : "direct",
          headers: ph,
          behaviorHints: { notWebReady: false, proxyHeaders: { request: ph } },
        });
      });
      var qRank = { "2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "HD": 0 };
      out.sort(function (a, b) { return (qRank[b.quality] || 0) - (qRank[a.quality] || 0); });
      return out.slice(0, 8);
    })
    .catch(function () { return []; });
}

// __STREAM_LABEL_FORMATTER__ v2: one-line emoji label for every stream.
// Movie:  🎬 <Title> • 📺 <Quality> • 🔊 <Audio> • 💬 <Subs> • 🖥️ <Provider> • 🗄️ <Server>
// Series: 🎬 <Title> • 📺 <Quality> • 📂 Season <N> • 🎞️ Episode <N> • 🔊 <Audio> • 💬 <Subs> • 🖥️ <Provider> • 🗄️ <Server>
// Segments with no data are omitted, except Quality (always shown, "Unknown" fallback).
// Server = explicit server label when the provider knows one, else the stream URL's hostname.
// Pure string work, no timers, no TextEncoder, no fetch. Never throws.
function formatStreamLabel(o) {
  try {
    o = o || {};
    var parts = [];
    function str(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
    function langName(v) {
      var k = str(v).toLowerCase();
      var map = { en: "English", eng: "English", english: "English", hi: "Hindi", hin: "Hindi", hindi: "Hindi",
        es: "Spanish", spa: "Spanish", fr: "French", fre: "French", fra: "French", de: "German", ger: "German", deu: "German",
        it: "Italian", ita: "Italian", pt: "Portuguese", por: "Portuguese", ru: "Russian", rus: "Russian",
        ar: "Arabic", ara: "Arabic", bn: "Bengali", ben: "Bengali", zh: "Chinese", chi: "Chinese", zho: "Chinese",
        ja: "Japanese", jpn: "Japanese", ko: "Korean", kor: "Korean", ta: "Tamil", tam: "Tamil", te: "Telugu", tel: "Telugu",
        ml: "Malayalam", mal: "Malayalam", mr: "Marathi", mar: "Marathi", pa: "Punjabi", pan: "Punjabi",
        ur: "Urdu", urd: "Urdu", id: "Indonesian", ind: "Indonesian", ms: "Malay", msa: "Malay", vi: "Vietnamese",
        vie: "Vietnamese", th: "Thai", tha: "Thai", tl: "Filipino", fil: "Filipino", nl: "Dutch", nld: "Dutch",
        sv: "Swedish", swe: "Swedish", da: "Danish", dan: "Danish", fi: "Finnish", fin: "Finnish",
        no: "Norwegian", nor: "Norwegian", pl: "Polish", pol: "Polish", tr: "Turkish", tur: "Turkish",
        uk: "Ukrainian", ukr: "Ukrainian", cs: "Czech", ces: "Czech", cze: "Czech", el: "Greek", ell: "Greek",
        he: "Hebrew", heb: "Hebrew", ro: "Romanian", ron: "Romanian", rum: "Romanian", hu: "Hungarian", hun: "Hungarian", arabic: "Arabic", bengali: "Bengali", chinese: "Chinese", filipino: "Filipino", indonesian: "Indonesian", portuguese: "Portuguese", russian: "Russian", urdu: "Urdu", spanish: "Spanish", french: "French", german: "German", italian: "Italian", japanese: "Japanese", korean: "Korean", tamil: "Tamil", telugu: "Telugu", malayalam: "Malayalam", marathi: "Marathi", punjabi: "Punjabi", vietnamese: "Vietnamese", thai: "Thai", dutch: "Dutch", swedish: "Swedish", danish: "Danish", finnish: "Finnish", norwegian: "Norwegian", polish: "Polish", turkish: "Turkish", ukrainian: "Ukrainian", czech: "Czech", greek: "Greek", hebrew: "Hebrew", romanian: "Romanian", malay: "Malay" };
      if (map[k]) return map[k];
      return str(v);
    }
    var title = str(o.title);
    if (title) parts.push("🎬 " + title);
    var q = str(o.quality);
    if (!q || q.toLowerCase() === "unknown") q = "Unknown";
    parts.push("📺 " + q);
    if (o.season !== undefined && o.season !== null && String(o.season) !== "") parts.push("📂 Season " + o.season);
    if (o.episode !== undefined && o.episode !== null && String(o.episode) !== "") parts.push("🎞️ Episode " + o.episode);
    var audio = o.audio;
    if (Array.isArray(audio)) audio = audio.filter(function (a) { return str(a); }).join(" / ");
    audio = str(audio);
    if (audio && audio.toLowerCase() !== "unknown") parts.push("🔊 " + audio);
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
      parts.push("💬 " + shown);
    }
    var size = str(o.size);
    if (size) parts.push("📦 " + size);
    var extra = str(o.extra);
    if (extra) parts.push(extra);
    var src = str(o.source) || str(o.provider);
    if (src) parts.push("🖥️ " + src);
    var server = str(o.server);
    if (!server && str(o.url)) {
      var h = str(o.url).split("/")[2] || "";
      server = h.replace(/^www\./, "");
    }
    if (server) parts.push("🗄️ " + server);
    return parts.join(" • ");
  } catch (e) {
    try { return (o && (o.source || o.provider) ? String(o.source || o.provider) : "Stream") + " • " + (o && o.quality ? String(o.quality) : "Unknown"); } catch (e2) { return "Stream"; }
  }
}

global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
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
