// MovieLinkBD (cs3 remake) — v1.0.1
// Search + exact gate + LCG-decoded player-data blob ->
// fsldownload.com /p/ MKV streams (verified direct playback).
// House v5 fetch prelude + chain-retry postlude v2 spliced.

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

// MovieLinkBD — Nuvio scraper core, REMADE from the user-supplied
// CNCVerse MovieLinkBDProvider .cs3 (DEX-decompiled: search, load,
// loadLinks, getBase, mgToken flows).
//
// Ported cs3 mechanics:
//   getBase: resolve the CURRENT mirror from the hub
//     (https://movielinkbd.com/ homepage -> first subdomain mirror
//     link, currently fy8t8v.movielinkbd.at); fallbacks in order:
//     https://sefcng.movielinkbd.li (the cs3's hardcoded fallback,
//     verified alive) -> https://vcufgr.movielinkbd.at (user's
//     original host). The old v1 hardcoded vcufgr only, and mirrors
//     rotate — the hub lookup is the main fix.
//   search <base>/search?q=, page -> script#mlbdInlinePlayerData
//     blob -> same LCG decode as v1 (cs3's decodeManifest, verified
//     identical), episodes -> sources.
//   playback URLs are the /p/ URLs as-is: bare /p/ verified to play
//     FULLY from sandbox (1MB Range 206 + full GET 200, 1.47GB
//     length), so the cs3's ?mg= token is NOT appended — /g answers
//     403 without a browser-set cookie the TV guest cannot obtain,
//     and bare URLs play without it.
// NOT ported (guest cannot do them, and they are not needed for
// listing): WebView fetch fallback for Cloudflare Turnstile pages,
// and the mlbd_hp cookie jar (the site sets no cookies on plain
// fetches; nothing to replay).
// House rules kept: exact gate (title equality + year ±1; series
// cards must carry the requested season tag), TMDB alternative-
// titles fallback, no timers, pure-JS UTF-8 decode, atob polyfill.

var HUB = "https://movielinkbd.com";
var FALLBACKS = ["https://sefcng.movielinkbd.li", "https://vcufgr.movielinkbd.at"];
var BASE = "";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

// ---------- pure-JS UTF-8 decode shim (guest has no TextDecoder) ----------
if (typeof TextDecoder === "undefined") {
    globalThis.TextDecoder = function TextDecoder() {};
    globalThis.TextDecoder.prototype.decode = function (bytes) {
        if (!bytes) return "";
        var out = "", i = 0;
        while (i < bytes.length) {
            var b = bytes[i];
            if (b < 0x80) { out += String.fromCharCode(b); i++; }
            else if ((b & 0xe0) === 0xc0 && i + 1 < bytes.length) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2; }
            else if ((b & 0xf0) === 0xe0 && i + 2 < bytes.length) { out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 3; }
            else if ((b & 0xf8) === 0xf0 && i + 3 < bytes.length) {
                var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
                cp -= 0x10000;
                out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); i += 4;
            } else i++;
        }
        return out;
    };
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

async function httpText(url, referer) {
    try {
        var res = await fetch(url, {
            method: "GET",
            headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Referer": referer || BASE + "/" },
            signal: timeoutSignal(20000)
        });
        var text = await res.text();
        return { status: res.status, text: text };
    } catch (e) {
        return null;
    }
}

async function httpJson(url) {
    try {
        var res = await fetch(url, {
            method: "GET",
            headers: { "User-Agent": UA, "Accept": "application/json, text/plain, */*" },
            signal: timeoutSignal(12000)
        });
        var text = await res.text();
        try { return JSON.parse(text); } catch (e) { return null; }
    } catch (e) {
        return null;
    }
}

function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripTags(html) {
    return String(html).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

// Card text -> { core (normalized title), year (or null), season (or null) }
function parseCard(text) {
    var t = String(text);
    var year = null;
    var ym = t.match(/\((19|20)\d{2}\)/);
    if (ym) year = parseInt(ym[0].replace(/[()]/g, ""), 10);
    var season = null;
    var sm = t.match(/\bS(\d{1,2})\b/i) || t.match(/Season\s*(\d{1,2})/i);
    if (sm) season = parseInt(sm[1], 10);
    var core = t.replace(/\[[^\]]*\]/g, " ").replace(/\(\d{4}\)/g, " ").replace(/\bS\d{1,2}\b/gi, " ").replace(/Season\s*\d{1,2}/gi, " ").replace(/\bCompleted\b/gi, " ");
    return { core: norm(core), year: year, season: season };
}

function parseSearch(html, type) {
    var out = [];
    var seen = {};
    var re = /<a[^>]*href="(\/(?:movie|series|anime|drama)\/[^"]+)"[^>]*>([\s\S]{0,800}?)<\/a>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        var href = m[1];
        if (seen[href]) continue;
        var isMovie = href.indexOf("/movie/") === 0;
        if (type === "movie" && !isMovie) continue;
        if (type === "tv" && isMovie) continue;
        var txt = stripTags(m[2]);
        if (!txt) continue;
        seen[href] = true;
        var card = parseCard(txt);
        card.href = href;
        out.push(card);
    }
    return out;
}

function yearOk(cardYear, tmdbYear) {
    if (cardYear == null || tmdbYear == null) return true;
    return Math.abs(cardYear - tmdbYear) <= 1;
}

function decodePlayerData(html) {
    try {
        var m = html.match(/<script([^>]*)id="mlbdInlinePlayerData"([^>]*)>([\s\S]*?)<\/script>/);
        if (!m) return null;
        var attrs = m[1] + m[2];
        var sM = attrs.match(/data-s="([0-9a-fA-F]+)"/);
        var rM = attrs.match(/data-r="(\d+)"/);
        if (!sM || !rM) return null;
        var r = parseInt(sM[1], 16) >>> 0;
        var rounds = parseInt(rM[1], 10) || 0;
        for (var i = 0; i < rounds; i++) r = (Math.imul(r, 1103515245) + 12345) >>> 0;
        var b64 = m[3].replace(/\s+/g, "");
        if (!b64) return null;
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) {
            r = (Math.imul(r, 1103515245) + 12345) >>> 0;
            bytes[j] = bin.charCodeAt(j) ^ ((r >>> 16) & 255);
        }
        var json = new TextDecoder("utf-8").decode(bytes);
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

function sourcesToStreams(sources, displayTitle) {
    var out = [];
    for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (!s || typeof s.url !== "string" || !s.url) continue;
        var q = s.quality ? (String(s.quality) + "p") : "Auto";
        var st = {
            name: "MovieLinkBD • " + q + (s.audio ? " • " + s.audio : ""),
            title: displayTitle,
            url: s.url,
            quality: q,
            headers: { "User-Agent": UA, "Referer": BASE + "/" },
            type: "mkv"
        };
        if (Array.isArray(s.external_subtitles) && s.external_subtitles.length) {
            var subs = [];
            for (var k = 0; k < s.external_subtitles.length; k++) {
                var c = s.external_subtitles[k];
                if (c && typeof c.url === "string" && c.url) {
                    subs.push({ url: c.url, language: c.label || c.language || "Unknown" });
                }
            }
            if (subs.length) st.subtitles = subs;
        }
        out.push(st);
    }
    return out;
}

// Resolve the current mirror from the hub (cs3 getBase), with the
// cs3's hardcoded fallback then the user's original host.
async function getBase() {
    try {
        var hub = await httpText(HUB + "/", HUB + "/");
        if (hub && hub.status === 200 && hub.text) {
            var re = /href="(?:https?:)?\/\/([a-z0-9-]+\.movielinkbd\.(?:at|li))\//gi;
            var m;
            while ((m = re.exec(hub.text)) !== null) {
                return "https://" + m[1];
            }
        }
    } catch (e) {}
    for (var i = 0; i < FALLBACKS.length; i++) {
        try {
            var probe = await httpText(FALLBACKS[i] + "/", FALLBACKS[i] + "/");
            if (probe && probe.status === 200) return FALLBACKS[i];
        } catch (e) {}
    }
    return FALLBACKS[FALLBACKS.length - 1];
}

async function searchAndResolve(title, type, sNum, eNum, tmdbYear, tmdbNorm, displayTitle) {
    var sh = await httpText(BASE + "/search?q=" + encodeURIComponent(title), BASE + "/");
    if (!sh || sh.status !== 200 || !sh.text) return [];
    var cards = parseSearch(sh.text, type);
    for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (c.core !== tmdbNorm) continue;
        if (!yearOk(c.year, tmdbYear)) continue;
        if (type === "tv" && c.season !== sNum) continue;
        var pg = await httpText(BASE + c.href, BASE + "/search?q=" + encodeURIComponent(title));
        if (!pg || pg.status !== 200 || !pg.text) continue;
        var data = decodePlayerData(pg.text);
        if (!data || !Array.isArray(data.episodes) || !data.episodes.length) continue;
        var ep = null;
        if (type === "movie") {
            for (var j = 0; j < data.episodes.length; j++) {
                if (data.episodes[j].kind === "movie") { ep = data.episodes[j]; break; }
            }
            if (!ep) ep = data.episodes[0];
        } else {
            for (var k = 0; k < data.episodes.length; k++) {
                var cand = data.episodes[k];
                if (cand.season === sNum && cand.number === eNum) { ep = cand; break; }
            }
            if (!ep && sNum === 1) {
                for (var l = 0; l < data.episodes.length; l++) {
                    if (data.episodes[l].number === eNum) { ep = data.episodes[l]; break; }
                }
            }
        }
        if (ep && Array.isArray(ep.sources) && ep.sources.length) {
            var streams = sourcesToStreams(ep.sources, displayTitle);
            if (streams.length) return streams;
        }
    }
    return [];
}

async function tmdbDetails(tmdbId, type) {
    var key = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";
    if (!key) return null;
    var kind = type === "movie" ? "movie" : "tv";
    return await httpJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + key);
}

async function tmdbAliases(tmdbId, type) {
    try {
        var key = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";
        if (!key) return [];
        var kind = type === "movie" ? "movie" : "tv";
        var j = await httpJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/alternative_titles?api_key=" + key);
        if (!j) return [];
        var arr = j.titles || j.results || [];
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var t = arr[i] && (arr[i].title || arr[i].name);
            if (!t) continue;
            if (/[^\x00-\x7F]/.test(t)) continue;
            out.push(t);
        }
        out.sort(function (a, b) { return a.length - b.length; });
        return out.slice(0, 4);
    } catch (e) {
        return [];
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

        BASE = await getBase();

        var details = await tmdbDetails(tmdbId, type);
        if (!details) return out;
        var tmdbTitle = details.title || details.name || "";
        if (!tmdbTitle) return out;
        var rd = details.release_date || details.first_air_date || "";
        var tmdbYear = rd && rd.length >= 4 ? parseInt(rd.slice(0, 4), 10) : null;
        var tmdbNorm = norm(tmdbTitle);
        var displayTitle = tmdbTitle + (type === "movie" ? "" : " S" + sNum + "E" + eNum);

        var streams = await searchAndResolve(tmdbTitle, type, sNum, eNum, tmdbYear, tmdbNorm, displayTitle);
        if (!streams.length) {
            var aliases = await tmdbAliases(tmdbId, type);
            for (var a = 0; a < aliases.length; a++) {
                if (norm(aliases[a]) === tmdbNorm) continue;
                streams = await searchAndResolve(aliases[a], type, sNum, eNum, tmdbYear, tmdbNorm, displayTitle);
                if (streams.length) break;
            }
        }
        return streams;
    } catch (err) {
        return out;
    }
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
