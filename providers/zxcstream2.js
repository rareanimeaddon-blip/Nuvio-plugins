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

/* ZXCStream (zxcstream.com) - the site is TMDB-keyed and iframes
   VidBolt (vidbolt.xyz) as one of its backup players. VidBolt exposes
   a keyless resolve API: GET /api/resolve?type=&id=&prefer=<server>
   returns ready HLS sources per server. Chain verified 2026-10-23:
   - proxy.vidbolt.xyz sources (Vega/Quantum) play fully bare
     (master/media/segment 200/206, TS sync byte checked).
   - Direct HLS hosts (e.g. img.animecurx.tech for TV) need
     Referer: https://vidbolt.xyz/ - verified master/variant/segment.
   - img.rousav.tech sources are LAST RESORT only: their variant
     playlists require the master's api_key query propagated, which
     a plain player cannot do (and the CDN edge is flaky even with
     it). Emitted only when no other family produced a source.
   - dash-hls-bridge URLs are structurally dead (bridge 502 /
     unsigned CloudFront) - always skipped.
   The site's main VidStuck backend is Cloudflare-walled (403) from
   datacenter IPs, so it is not used. No timers, no TextEncoder /
   WebCrypto - TV guest safe. */
var VIDBOLT_BASE = "https://vidbolt.xyz";
var ZXC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var ZXC_FALLBACK_SERVERS = ["orion", "callisto", "fastva", "vega", "quantum", "quasar"];

function zxcFetchText(url, referer) {
  return fetch(url, {
    headers: { "User-Agent": ZXC_UA, "Referer": referer || (VIDBOLT_BASE + "/") }
  }).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
}

function zxcEmbedUrl(mediaType, tmdbId, seasonNum, episodeNum) {
  return mediaType === "tv"
    ? VIDBOLT_BASE + "/tv/" + tmdbId + "/" + (seasonNum || 1) + "/" + (episodeNum || 1)
    : VIDBOLT_BASE + "/movie/" + tmdbId;
}

function zxcServers(mediaType, tmdbId, seasonNum, episodeNum) {
  return zxcFetchText(zxcEmbedUrl(mediaType, tmdbId, seasonNum, episodeNum), "https://zxcstream.com/").then(function (html) {
    var m = /window\.__VB__\s*=\s*(\{[\s\S]*?\});/.exec(html || "");
    if (m) {
      try {
        var cfg = JSON.parse(m[1]);
        if (cfg && cfg.servers && cfg.servers.length) {
          return cfg.servers.map(function (s) { return { id: s.id, name: s.name || s.id }; });
        }
      } catch (e) {}
    }
    return ZXC_FALLBACK_SERVERS.map(function (id) { return { id: id, name: id }; });
  });
}

function zxcResolve(server, mediaType, tmdbId, seasonNum, episodeNum) {
  var q = "type=" + mediaType + "&id=" + tmdbId;
  if (mediaType === "tv") q += "&season=" + (seasonNum || 1) + "&episode=" + (episodeNum || 1);
  q += "&prefer=" + encodeURIComponent(server.id);
  return zxcFetchText(VIDBOLT_BASE + "/api/resolve?" + q, zxcEmbedUrl(mediaType, tmdbId, seasonNum, episodeNum)).then(function (txt) {
    var out = [];
    var j = null;
    try { j = JSON.parse(txt || ""); } catch (e) {}
    var sources = (j && j.stream && j.stream.sources) || [];
    sources.forEach(function (src) {
      if (src && src.url) out.push({ url: src.url, quality: src.quality || "", server: server.name });
    });
    return out;
  }).catch(function () { return []; });
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
  return zxcServers(type, tmdbId, seasonNum, episodeNum).then(function (servers) {
    return Promise.all(servers.map(function (s) { return zxcResolve(s, type, tmdbId, seasonNum, episodeNum); })).then(function (perServer) {
      var seen = {};
      var proxied = [], referred = [], lastResort = [];
      perServer.forEach(function (list) {
        list.forEach(function (s) {
          if (seen[s.url]) return;
          seen[s.url] = 1;
          if (s.url.indexOf("dash-hls-bridge") !== -1) return;
          var q = /\b(2160p|1080p|720p|480p|360p)\b/i.exec(s.quality || "") ? s.quality : "HD";
          var lbl = formatStreamLabel({ source: "ZXCStream", quality: q, season: type === "tv" ? seasonNum : undefined, episode: type === "tv" ? episodeNum : undefined, server: s.server, url: s.url });
          var stream = {
            name: lbl,
            title: lbl,
            url: s.url,
            quality: q,
            type: "direct"
          };
          if (s.url.indexOf("proxy.vidbolt.xyz") !== -1) { proxied.push(stream); return; }
          if (s.url.indexOf("img.rousav.tech") !== -1) { lastResort.push(stream); return; }
          var hdrs = { "Referer": VIDBOLT_BASE + "/", "User-Agent": ZXC_UA };
          stream.headers = hdrs;
          stream.behaviorHints = { notWebReady: true, proxyHeaders: { request: hdrs } };
          referred.push(stream);
        });
      });
      var main = proxied.concat(referred);
      return main.length ? main : lastResort;
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.ZXCStreamScraperModule = { getStreams: getStreams };
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
