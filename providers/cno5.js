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
   - kind "embed" Player 1 = CineSrc (cinesrc.st) REMOVED in cno4
     (2026-10-25): its resolver backend fembox.aether.bar went from
     NXDOMAIN to a blackhole IP whose fetches never settle in the
     fetch stack (Node fetch hangs >60s; curl fails fast), and one
     never-settling branch vetoes the whole Promise.all - the working
     own-server branch never ran, so CNO returned nothing and the
     harness/tvsim timed out. The branch never yielded a stream since
     build, so disconnecting it only unblocks live branches. Do NOT
     reconnect it until the backend answers with settling fetches.
   - kind "embed" Player 2 = VidFast (vidfast.vc), obfuscated player with
     no public endpoint - embed page scrape fallback only.
   Gate: detail id echo + exact TMDB title match (the API serves TMDB's
   own records by ID; no search, no fuzzy). No timers, no
   TextEncoder/WebCrypto - TV guest safe. */
var CNO_BASE = "https://cno.to";
var CNO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

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
function cnHlsSource(src, mediaTitle, seasonNum, episodeNum) {
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
    var lbl = formatStreamLabel({ source: "CNO", title: mediaTitle, quality: q, season: seasonNum, episode: episodeNum, server: src.label, url: masterUrl });
    return [{
      name: lbl,
      title: lbl,
      url: masterUrl,
      quality: q,
      type: "direct"
    }];
  }).catch(function () { return []; });
}
/* Player 2 = VidFast (vidfast.vc): obfuscated player with no public
   endpoint; best-effort scrape of the embed page for a direct playlist. */
function cnEmbedScrape(embedUrl, label, mediaTitle, seasonNum, episodeNum) {
  return cnFetchText(embedUrl, CNO_BASE + "/").then(function (html) {
    if (!html) return [];
    var out = [], seen = {};
    var re = /https?:\/\/[^\s"'\\<>]+\.m3u8[^\s"'\\<>]*/g, m;
    while ((m = re.exec(html))) {
      var u = m[0].replace(/&amp;/g, "&");
      if (seen[u]) continue;
      seen[u] = 1;
      var lbl = formatStreamLabel({ source: "CNO", title: mediaTitle, quality: "HD", season: seasonNum, episode: episodeNum, server: label, url: u });
      out.push({ name: lbl, title: lbl, url: u, quality: "HD", type: "direct" });
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
function cnOwnServerOne(num, url, mediaTitle, seasonNum, episodeNum) {
  return cnFetchText(url, CNO_BASE + "/").then(function (text) {
    if (!text || text.indexOf("#EXTM3U") === -1) return [];
    var lbl = formatStreamLabel({ source: "CNO", title: mediaTitle, quality: cnQualityFromMaster(text), season: seasonNum, episode: episodeNum, server: "Server " + num, url: url });
    return [{
      name: lbl,
      title: lbl,
      url: url,
      quality: cnQualityFromMaster(text),
      type: "direct"
    }];
  }).catch(function () { return []; });
}
function cnOwnServersFallback(type, tmdbId, s, e, mediaTitle) {
  var mid = type === "tv"
    ? ("/tv/" + tmdbId + "/" + s + "/" + e)
    : ("/movie/" + tmdbId);
  var seas = type === "tv" ? s : undefined, ep = type === "tv" ? e : undefined;
  return Promise.all([
    cnOwnServerOne(21, CNO_BASE + "/api/s/21" + mid + "?v=3", mediaTitle, seas, ep),
    cnOwnServerOne(19, CNO_BASE + "/api/s/19" + mid + "?v=3", mediaTitle, seas, ep)
  ]).then(function (per) {
    var out = [];
    per.forEach(function (list) { list.forEach(function (st) { out.push(st); }); });
    return out;
  });
}
function cnResolveSource(src, type, tmdbId, seasonNum, episodeNum, mediaTitle) {
  if (!src || !src.url) return Promise.resolve([]);
  if (src.kind === "hls") return cnHlsSource(src, mediaTitle, type === "tv" ? seasonNum : undefined, type === "tv" ? episodeNum : undefined);
  if (src.kind === "embed") {
    if (src.url.indexOf("cinesrc") !== -1) return Promise.resolve([]); /* CineSrc backend dead + hangs chain - see header (cno4) */
    if (src.url.indexOf("vidfast") !== -1) return cnEmbedScrape(src.url, src.label || "Player 2", mediaTitle, type === "tv" ? seasonNum : undefined, type === "tv" ? episodeNum : undefined);
    return cnEmbedScrape(src.url, src.label || "Player", mediaTitle, type === "tv" ? seasonNum : undefined, type === "tv" ? episodeNum : undefined);
  }
  return Promise.resolve([]);
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
    var jobs = sources.map(function (src) { return cnResolveSource(src, type, tmdbId, s, e, mediaTitle); });
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
