// Dulo (dulo.mov) — ported from replitfree6-lang/Nuvio-streams
// (upstream providers/dulo.js, single-file scraper, no deps).
// TMDB-keyed first-party resolve endpoint, no site search, so no
// title matching to go wrong. Port changes vs upstream: guest
// TMDB_API_KEY (no embedded key), Pickle dropped (12s promo clip,
// not the feature — verified live), v5 fetch prelude + chain-
// retry postlude v2. Subtitles and the site's own proxy HLS
// URLs are kept verbatim; plugin stays standalone.

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

// ---------------------------------------------------------------------------
// Dulo — Nuvio plugin (scraper) for https://dulo.mov
// Movies, TV shows and anime, keyed directly by TMDB id (no site search).
//
// Flow (mirrors the site's own web client, minus its proxy transport —
// the first-party endpoint below answers plain requests directly):
//   GET https://dulo.mov/api/streams/resolve
//       ?tmdbId=<id>&type=movie|tv&progressive=true
//       [&seasonId=<s>&episodeId=<e>] [&title=&year=&runtime=]
//     -> { found: true, pending: false, sources: [
//          { label, url, type, captions: [
//              { id, url, language, display, format, hearingImpaired } ] } ] }
//
// Source kinds (observed live):
//   - "Pickle · 4K": DROPPED by this port (see the ordering block
//     below) — verified live as a 12s promo clip, not the feature.
//   - The other sources (Prime, Zenith, Chandra, Breeze, ...): HLS
//     playlists served through the site's stream proxy
//     (zstream-proxy.bluevelvet.space/?payload=...&headers=...). The
//     proxy URLs are plain GETs: the master playlist and its segments
//     are all proxy URLs, so any HLS player can follow them.
// Captions from the response are attached to every stream as subtitles.
//
// Platform notes (from earlier webOS work): no optional chaining /
// matchAll etc., every setTimeout use is guarded (that runtime has
// none), string season/episode arguments are coerced to numbers.
// ---------------------------------------------------------------------------

var API = "https://dulo.mov";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var RESOLVE_TIMEOUT_MS = 24000;
var TMDB_TIMEOUT_MS = 12000;

function isBlank(s) {
    return s == null || String(s).trim() === "";
}

function qualityFromLabel(label) {
    var m = String(label || "").match(/\b(2160|1440|1080|720|480|360)\s*p\b/i);
    if (m) return m[1] + "p";
    if (/\b4K\b/i.test(String(label || ""))) return "2160p";
    return "Auto";
}

function timeoutSignal(ms) {
    try {
        if (typeof AbortController === "undefined") return undefined;
        var ctl = new AbortController();
        if (typeof setTimeout === "function") {
            setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms);
        }
        return ctl.signal;
    } catch (e) {
        return undefined;
    }
}

function sleepGuarded(ms) {
    return new Promise(function (resolve) {
        try {
            if (typeof setTimeout === "function") { setTimeout(resolve, ms); return; }
        } catch (e) {}
        var end = Date.now() + ms;
        while (Date.now() < end) { /* spin-wait: webOS has no setTimeout */ }
        resolve();
    });
}

async function httpJson(url, timeoutMs, referer) {
    var headers = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": referer || API + "/",
    };
    var res = await fetch(url, {
        method: "GET",
        headers: headers,
        signal: timeoutSignal(timeoutMs),
    });
    var text = await res.text();
    var json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, text: text, json: json };
}

async function tmdbDetails(tmdbId, type) {
    try {
        var kind = type === "movie" ? "movie" : "tv";
        var key = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";
        if (!key) return null;
        var r = await httpJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + key, TMDB_TIMEOUT_MS, "");
        if (r.json) return r.json;
    } catch (e) {}
    return null;
}

async function resolveStreams(tmdbId, type, season, episode, meta) {
    var qs = "tmdbId=" + encodeURIComponent(tmdbId) + "&type=" + type + "&progressive=true";
    if (type === "tv") {
        qs += "&seasonId=" + season + "&episodeId=" + episode;
    }
    if (meta) {
        if (meta.title) qs += "&title=" + encodeURIComponent(meta.title);
        if (meta.year) qs += "&year=" + encodeURIComponent(meta.year);
        if (meta.runtime) qs += "&runtime=" + encodeURIComponent(Math.round(meta.runtime));
    }
    var url = API + "/api/streams/resolve?" + qs;
    var referer = API + "/watch/" + type + "/" + tmdbId;
    // The endpoint long-polls while pending: like the site's client, keep
    // polling and merge sources by label until it stops pending (bounded
    // so the app's Test is never left hanging).
    var merged = [];
    var mergedLabels = {};
    var deadline = Date.now() + 15000;
    var pending = true;
    while (pending && Date.now() < deadline) {
        var r = null;
        try { r = await httpJson(url, RESOLVE_TIMEOUT_MS, referer); } catch (e) { r = null; }
        if (r && r.json && Array.isArray(r.json.sources)) {
            for (var i = 0; i < r.json.sources.length; i++) {
                var s = r.json.sources[i];
                if (s && s.label && !mergedLabels[s.label]) {
                    mergedLabels[s.label] = true;
                    merged.push(s);
                }
            }
        }
        pending = !!(r && r.json && r.json.pending);
        if (!pending) break;
        if (Date.now() + 2000 >= deadline) break;
        await sleepGuarded(2000);
    }
    return { found: merged.length > 0, sources: merged };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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

async function getStreams(tmdbId, mediaType, season, episode) {
    var out = [];
    try {
        var type = mediaType === "movie" ? "movie" : "tv";
        var sNum = season == null || season === "" ? 1 : parseInt(season, 10);
        var eNum = episode == null || episode === "" ? 1 : parseInt(episode, 10);
        if (isNaN(sNum)) sNum = 1;
        if (isNaN(eNum)) eNum = 1;

        var details = await tmdbDetails(tmdbId, type);
        var meta = null;
        var displayTitle = "TMDB " + tmdbId;
        var mediaTitle = "TMDB " + tmdbId;
        if (details) {
            var t = details.title || details.name || null;
            var y = null;
            var rd = details.release_date || details.first_air_date || "";
            if (rd && rd.length >= 4) y = rd.slice(0, 4);
            meta = { title: t, year: y, runtime: details.runtime || null };
            if (t) displayTitle = t + (type === "movie" ? "" : " S" + sNum + "E" + eNum);
            if (t) mediaTitle = t;
        }

        var data = await resolveStreams(tmdbId, type, sNum, eNum, meta);
        if (!data || !Array.isArray(data.sources)) return out;

        // Proxy sources only. Pickle is DROPPED, not demoted: live
        // verified 2026-10-25 that its playlist is a 12s promo clip
        // (3 segments), not the feature — serving it would be a fake
        // stream, same rule as the netmirror12 abuse-clip guard.
        var all = [];
        for (var i = 0; i < data.sources.length; i++) {
            var s = data.sources[i];
            if (!s || typeof s.url !== "string" || !s.url) continue;
            if (/^Pickle\b/i.test(s.label || "")) continue;
            all.push(s);
        }

        var seen = {};
        for (var j = 0; j < all.length; j++) {
            var src = all[j];
            if (seen[src.url]) continue;
            seen[src.url] = true;
            var subs = [];
            if (Array.isArray(src.captions) && src.captions.length) {
                for (var k = 0; k < src.captions.length; k++) {
                    var c = src.captions[k];
                    if (c && typeof c.url === "string" && c.url) {
                        subs.push({ url: c.url, language: c.display || c.language || "Unknown" });
                    }
                }
            }
            var lblParts = String(src.label || "").split("\u00b7");
            var pool = lblParts.length > 1 ? lblParts[0].trim() : "";
            if (/^(2160p|1440p|1080p|720p|480p|360p|4K)$/i.test(pool)) pool = "";
            var lbl = formatStreamLabel({ source: "Dulo", title: mediaTitle, quality: qualityFromLabel(src.label), season: type === "tv" ? sNum : undefined, episode: type === "tv" ? eNum : undefined, subtitles: subs, server: pool, url: src.url });
            var st = {
                name: lbl,
                title: lbl,
                url: src.url,
                quality: qualityFromLabel(src.label),
                headers: { "User-Agent": UA, "Referer": API + "/" },
            };
            var t2 = src.type;
            if (t2 === "mp4" || t2 === "mkv" || t2 === "webm") st.type = t2;
            else st.type = "m3u8";
            if (subs.length) st.subtitles = subs;
            out.push(st);
        }
    } catch (err) {
        // Return whatever was collected; a scraper must not throw.
    }
    return out;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.getStreams = getStreams;
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
