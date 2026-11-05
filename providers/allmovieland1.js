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



// AllMovieLand provider — ported 2026-11-06 (allmovieland1.js v1.0.0)
// from phisher98's CSX CineStream invokeAllmovieland (com.megix).
// Chain (IMDb-keyed, no title search to go wrong):
//   TMDB -> IMDb id (external_ids)
//   -> stream host: player.js (allmovieland.link, canonical per source)
//      else a movie page on allmovieland.art (host is embedded in
//      every page), else the host seen on the site (luxki440das.com)
//   -> GET <host>/play/<imdbId> (Referer: site) -> the playlist
//      script -> JSON {file, key, href}
//   -> GET <file> with X-CSRF-TOKEN: <key> (strip the ",[]" artifact)
//      -> server list [{title, id, file, folder:[{episode, id,
//      folder:[{title, id, file}]}]}]
//   -> movie: every server's (file, title); TV: server id == season
//      -> folder episode == episode -> its (file, title)
//   -> POST <host>/playlist/<file>.txt (X-CSRF-TOKEN, Referer) -> the
//      M3U8 URL text -> stream (type hls, 1080p per source, Referer).
// STATUS 2026-11-06: the stream host luxki440das.com is OFFLINE
// ("We are offline now") and player.js is Cloudflare-blocked, so the
// provider returns [] for every title right now. It is shipped FULLY
// built so that when the host comes back online it starts giving
// streams with no change. Do not "fix" the 0s while the host is down.

var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// The site moved: allmovieland.one 301s to allmovieland.art.
var MAIN_URL = "https://allmovieland.art";

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
function postText(url, headers, timeoutMs) {
  return fetchWithTimeout(url, { method: "POST", headers: headers || {} }, timeoutMs || 12000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}
function getJson(url, headers, timeoutMs) {
  return getText(url, headers, timeoutMs || 10000).then(function (t) {
    try { return JSON.parse(t); } catch (e) { return null; }
  });
}
function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); });
}
function fixUrl(url, domain) {
  if (!url) return "";
  if (url.indexOf("http") === 0) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  var d = String(domain || "").replace(/\/+$/, "");
  if (url.charAt(0) === "/") return d + url;
  return d + "/" + url;
}

// ---------- TMDB ----------
function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return getJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY, {}, 10000)
    .then(function (j) {
      if (!j || !(j.title || j.name)) return null;
      var d = j.release_date || j.first_air_date || "";
      return { title: j.title || j.name, year: d ? parseInt(d.slice(0, 4), 10) : null };
    })
    .catch(function () { return null; });
}
function tmdbImdbId(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return getJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_KEY, {}, 10000)
    .then(function (j) { return (j && j.imdb_id) ? j.imdb_id : null; })
    .catch(function () { return null; });
}

// ---------- stream host ----------
// 1. player.js (canonical per source): const AwsIndStreamDomain = '<host>';
// 2. a movie page on the site (the host is embedded in every page).
// 3. the host seen on the site (2026-11-06) — offline now, but if it
//    comes back on the same domain this works even if page fetch fails.
function extractPostLinks(html) {
  var out = [], m, seen = {};
  var re = /href="(https?:\/\/[^"]+\/\d+-[^"]*\.html)"/gi;
  while ((m = re.exec(html)) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = 1; out.push(m[1]); }
  }
  return out;
}
function getStreamHost() {
  return getText("https://allmovieland.link/player.js?v=60%20128", { Referer: MAIN_URL + "/" }, 8000)
    .then(function (js) {
      var m = /const AwsIndStreamDomain.*'(.*)';/.exec(js || "");
      if (m && m[1]) return m[1];
      return null;
    }).catch(function () { return null; })
    .then(function (host) {
      if (host) return host;
      return getText(MAIN_URL + "/", { Referer: MAIN_URL + "/" }, 8000).then(function (home) {
        var links = extractPostLinks(home);
        if (!links.length) return null;
        return getText(links[0], { Referer: MAIN_URL + "/" }, 8000).then(function (page) {
          var m = /AwsIndStreamDomain\s*=\s*'([^']+)'/.exec(page || "");
          return (m && m[1]) ? m[1] : null;
        }).catch(function () { return null; });
      }).catch(function () { return null; });
    })
    .then(function (host) {
      if (host) return host.replace(/\/+$/, "") + "/";
      return "https://luxki440das.com/";
    });
}

// ---------- playlist ----------
// The /play/<imdb> page carries a <script> containing "playlist".
// Source: data after the first "{" , before ";" , before ")" , prepend
// "{" -> JSON {file, key, href}. A balanced-brace fallback covers a
// script where the playlist object is not the first "{".
function extractPlaylist(html) {
  var re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi, m;
  var script = null;
  while ((m = re.exec(html)) !== null) {
    if (m[1].indexOf("playlist") !== -1) { script = m[1]; break; }
  }
  if (!script) return null;
  function parseFrom(s) {
    try {
      var bi = s.indexOf("{");
      if (bi === -1) return null;
      var after = s.slice(bi + 1);
      var semi = after.indexOf(";");
      if (semi !== -1) after = after.slice(0, semi);
      var paren = after.indexOf(")");
      if (paren !== -1) after = after.slice(0, paren);
      return JSON.parse("{" + after);
    } catch (e) { return null; }
  }
  var j = parseFrom(script);
  if (j && (j.file || j.key)) return j;
  var pi = script.indexOf("playlist");
  if (pi !== -1) {
    var bi2 = script.indexOf("{", pi);
    if (bi2 !== -1) {
      var depth = 0, end = -1;
      for (var i = bi2; i < script.length; i++) {
        var ch = script[i];
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        try { var j2 = JSON.parse(script.slice(bi2, end + 1)); if (j2 && (j2.file || j2.key)) return j2; } catch (e) {}
      }
    }
  }
  return null;
}

// ---------- servers ----------
// Movie: every server's (file, title). TV: server id == season ->
// folder episode == episode -> its (file, title).
function pickServers(servers, isSeries, season, episode) {
  var out = [];
  if (!Array.isArray(servers)) return out;
  if (!isSeries) {
    servers.forEach(function (s) { if (s && s.file) out.push({ file: s.file, lang: s.title || "" }); });
    return out;
  }
  var sv = null;
  for (var i = 0; i < servers.length; i++) {
    if (servers[i] && String(servers[i].id) === String(season)) { sv = servers[i]; break; }
  }
  if (!sv || !Array.isArray(sv.folder)) return out;
  var sf = null;
  for (var j = 0; j < sv.folder.length; j++) {
    if (sv.folder[j] && String(sv.folder[j].episode) === String(episode)) { sf = sv.folder[j]; break; }
  }
  if (!sf || !Array.isArray(sf.folder)) return out;
  sf.folder.forEach(function (e) { if (e && e.file) out.push({ file: e.file, lang: e.title || "" }); });
  return out;
}
function getM3u8(serverFile, host, key) {
  var url = host.replace(/\/+$/, "") + "/playlist/" + serverFile + ".txt";
  return postText(url, { "X-CSRF-TOKEN": key || "", Referer: MAIN_URL + "/" }, 12000)
    .then(function (t) {
      var u = String(t || "").trim();
      if (u.indexOf("http") === 0) return u;
      return null;
    }).catch(function () { return null; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isSeries = mediaType === "tv";
  if (isSeries && (seasonNum == null || episodeNum == null)) return Promise.resolve([]);
  return Promise.all([tmdbMeta(tmdbId, mediaType), tmdbImdbId(tmdbId, mediaType)])
    .then(function (parts) {
      var meta = parts[0], imdbId = parts[1];
      if (!meta || !imdbId) return [];
      return getStreamHost().then(function (host) {
        return getText(host + "play/" + imdbId, { Referer: MAIN_URL + "/" }, 12000)
          .then(function (page) {
            var pl = extractPlaylist(page);
            if (!pl || !pl.file) return [];
            var headers = { "X-CSRF-TOKEN": pl.key || "", Referer: MAIN_URL + "/" };
            var fileUrl = fixUrl(pl.file, host);
            return getText(fileUrl, headers, 12000).then(function (srvText) {
              var servers = null;
              try { servers = JSON.parse(String(srvText || "").replace(/,\s*\[\]/g, "")); } catch (e) { servers = null; }
              var picks = pickServers(servers, isSeries, seasonNum, episodeNum);
              var chain = Promise.resolve([]);
              picks.slice(0, 4).forEach(function (p) {
                chain = chain.then(function (acc) {
                  return getM3u8(p.file, host, pl.key).then(function (u) {
                    if (!u) return acc;
                    // Playback headers mirror the source: the site
                    // Referer (+ UA). The M3U8 host checks it.
                    var ph = { "User-Agent": UA, Referer: MAIN_URL + "/" };
                    var label = formatStreamLabel({ source: "AllMovieLand", title: meta.title, quality: "1080p",
                      season: isSeries ? seasonNum : undefined, episode: isSeries ? episodeNum : undefined,
                      audio: p.lang || undefined, server: "IndStream", url: u });
                    acc.push({
                      name: label,
                      title: label,
                      url: u,
                      quality: "1080p",
                      type: "hls",
                      headers: ph,
                      behaviorHints: { notWebReady: false, proxyHeaders: { request: ph } },
                    });
                    return acc;
                  });
                });
              });
              return chain;
            }).catch(function () { return []; });
          }).catch(function () { return []; });
      });
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
