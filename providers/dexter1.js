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

/* Dexter (dexter.pw) — ported from the user's supplied file
   (sylphera_0_snrn.js) at their order, 2026-11-12. The site is a
   TMDB-keyed app with the same API shape as CNO:
   /api/s/{server}/{type}/{tmdbId}[/{s}/{e}]?v=3 returns a master
   playlist. Servers are tried in order [21, 1, 2, 3, 4, 5]; the first
   server that returns a real playlist wins. Only 1080p and 2160p
   variants are kept (the file drops 720p/480p), sorted best first.
   NOTE — two changes from the supplied file, both proven in sandbox:
   (1) User-Agent is MOBILE (Android Chrome) instead of the file's
   DESKTOP Chrome UA: the video hosts (v.lumenbox.top — Dexter serves
   the same backend/content as CNO) Cloudflare-403 a desktop UA on
   every video hop (variant AND segment) while a mobile UA answers
   200/206 with real fMP4. (2) Stream labels use the plugin v4 format
   (name = provider name, size = formatStreamSize body) instead of the
   file's sort-tag single line; array order still puts 2160p first.
   The API is TMDB-ID-keyed (no title search), so there is no title
   mismatch risk; the playlist itself is the gate (#EXTM3U check).
   No timers, no TextEncoder/WebCrypto - TV guest safe. */
var DEX_BASE = "https://dexter.pw";
var DEX_UA = "Mozilla/5.0 (Linux; Android 14; CPH2585) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
var DEX_HEADERS = { "Referer": DEX_BASE + "/", "Origin": DEX_BASE, "User-Agent": DEX_UA };

function dexToQuality(width, height) {
  if (width >= 3840 || height >= 2160) return { label: "2160p", rank: 5 };
  if (width >= 1920 || height >= 1080) return { label: "1080p", rank: 4 };
  return null;
}
function dexResolveUrl(path, baseUrl) {
  try {
    if (path.indexOf("http://") === 0 || path.indexOf("https://") === 0) return path;
    var base = baseUrl && baseUrl.indexOf("http") === 0 ? baseUrl : DEX_BASE;
    var origin = base.split("/").slice(0, 3).join("/");
    if (path.charAt(0) === "/") return origin + path;
    return origin + "/" + path;
  } catch (e) { return null; }
}
function dexParseMaster(text, baseUrl) {
  var lines = text.split("\n");
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = (lines[i] || "").trim();
    if (!line) continue;
    if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
    var next = (lines[i + 1] || "").trim();
    if (!next || next.charAt(0) === "#") continue;
    var m = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    if (!m) continue;
    var q = dexToQuality(parseInt(m[1], 10) || 0, parseInt(m[2], 10) || 0);
    if (!q) continue;
    var abs = dexResolveUrl(next, baseUrl);
    if (!abs) continue;
    out.push({ url: abs, quality: q.label, rank: q.rank });
  }
  return out;
}
function dexFetchServer(serverId, tmdbId, mediaType, season, episode) {
  var url = DEX_BASE + "/api/s/" + serverId + "/" + mediaType + "/" + tmdbId;
  if (mediaType === "tv") url += "/" + season + "/" + episode;
  url += "?v=3";
  return fetch(url, { headers: DEX_HEADERS }).then(function (res) {
    if (!res || !res.ok) return [];
    return res.text().then(function (text) {
      if (!text || text.indexOf("#EXTM3U") === -1) return [];
      var base = (res.url && res.url.indexOf("http") === 0) ? res.url : url;
      return dexParseMaster(text, base);
    });
  }).catch(function () { return []; });
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
  if (type !== "movie" && type !== "tv") return Promise.resolve([]);
  if (type === "tv" && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);
  var servers = [21, 1, 2, 3, 4, 5];
  var jobs = servers.map(function (id) { return dexFetchServer(id, tmdbId, type, s, e); });
  return Promise.all(jobs).then(function (per) {
    var found = [];
    for (var i = 0; i < per.length; i++) {
      if (per[i] && per[i].length > 0) { found = per[i]; break; }
    }
    if (!found.length) return [];
    var seen = {};
    var uniq = [];
    found.forEach(function (st) {
      if (seen[st.url]) return;
      seen[st.url] = 1;
      uniq.push(st);
    });
    uniq.sort(function (a, b) { return b.rank - a.rank; });
    var seas = type === "tv" ? s : undefined, ep = type === "tv" ? e : undefined;
    return uniq.map(function (st) {
      var sz = formatStreamSize({ source: "Dexter", quality: st.quality, season: seas, episode: ep, server: "Dexter", url: st.url });
      return {
        name: "Dexter",
        title: "Dexter",
        size: sz,
        url: st.url,
        quality: st.quality,
        type: "direct",
        headers: { "User-Agent": DEX_UA, "Referer": DEX_BASE + "/" },
        behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": DEX_UA, "Referer": DEX_BASE + "/" } } }
      };
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.DexterScraperModule = { getStreams: getStreams };
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
