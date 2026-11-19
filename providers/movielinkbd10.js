// MovieLinkBD — v1.0.5 chain (2026-11-17): the site removed the
// data-host="mp4-entry" server row from file hub pages (verified on
// The Matrix + Project Hail Mary: 0 mp4-entry anchors, FSL row present
// on every hub). The FSL row is now the direct-file path:
//   hub page /file/<token> -> anchor data-host="fsl" ->
//   /file/<token2> -> <a href="https://fsl.movielink.tv/d/...">
// direct file (video/x-matroska, 206 Range, EBML magic verified).
// mp4-entry is still tried first in case the site restores it.
// Movie/series pages still carry the per-quality download buttons
//   <a href="#" data-dl="<b64>" data-ds="<seed>" data-dr="<rounds>">Download [720p • 1.4 GB]</a>
// decoded with the SAME LCG math as before -> "/file/<token>".
// Legacy script-decode is kept first as a fallback in case the site
// reverts. TV: buttons sit inside ep-card divs
// (data-season-number / data-episode-number); buttons before the
// first ep-card are whole-season packs and are skipped.
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

// MovieLinkBD — real provider (v1.0.0, device-proven chain).
// Same chain as movielinkbd2, plus the two fallbacks diag5 proved
// on-device (2026-10-26, The Matrix 720p Hindi played on the phone):
// (1) broad extraction — any script block whose tag carries data-s /
// data-r, tolerant of quote style, spacing, and id renames (the
// strict id="mlbdInlinePlayerData" regex misses the device page);
// (2) browser-header refetch — if strict + broad both fail on the
// provider-header page, re-fetch with full browser headers
// (Accept-Language + Sec-Fetch-* + Upgrade-Insecure-Requests) and
// try broad extraction there. No diag output: streams only.

var HUB = "https://movielinkbd.com";
var FALLBACKS = ["https://sefcng.movielinkbd.li", "https://vcufgr.movielinkbd.at"];
var BASE = "";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var DIAG = [];

// Summary outcome, filled as the chain progresses. Diag4 prepends
// two SUMMARY lines built from S, so the verdict is visible even
// when the Test view only shows the top rows (no scrolling needed).
var S = { hub: "?", tmdb: "?", cards: "?", match: "no", page: "?", decode: "?", ep: "?", src: 0, b64: 0, byt: 0, fa: "?", fb: "?" };

function diag(s) {
    // No-op in the real provider: diagnosis lives in the diag builds.
}

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

async function fetchOnce(url, referer, accept, withSignal) {
    var opts = {
        method: "GET",
        headers: { "User-Agent": UA, "Accept": accept, "Referer": referer || BASE + "/" }
    };
    if (withSignal) opts.signal = timeoutSignal(20000);
    var res = await fetch(url, opts);
    var text = await res.text();
    return { status: res.status, text: text };
}

// Tries with-signal first, plain on throw. Records which worked.
async function httpD(url, referer, accept, tag) {
    try {
        var r = await fetchOnce(url, referer, accept, true);
        diag(tag + " sig-ok status=" + r.status);
        return r;
    } catch (e) {
        try {
            var p = await fetchOnce(url, referer, accept, false);
            diag(tag + " sig-THROW plain-ok status=" + p.status);
            return p;
        } catch (e2) {
            diag(tag + " sig-THROW plain-THROW");
            return null;
        }
    }
}

function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripTags(html) {
    return String(html).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

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

// Shared payload decode: LCG deobfuscation over a base64 payload.
// Returns { data } or { error }.
function tryDecodePayload(payload, sHex, rStr) {
    try {
        var r = parseInt(sHex, 16) >>> 0;
        var rounds = parseInt(rStr, 10) || 0;
        for (var i = 0; i < rounds; i++) r = (Math.imul(r, 1103515245) + 12345) >>> 0;
        var b64 = String(payload).replace(/\s+/g, "");
        if (!b64) return { error: "EMPTY-B64" };
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) {
            r = (Math.imul(r, 1103515245) + 12345) >>> 0;
            bytes[j] = bin.charCodeAt(j) ^ ((r >>> 16) & 255);
        }
        var data = JSON.parse(new TextDecoder("utf-8").decode(bytes));
        if (!data || !Array.isArray(data.episodes)) return { error: "NO-EPS" };
        return { data: data, b64len: b64.length, bytlen: bytes.length };
    } catch (e) {
        return { error: "JSON" };
    }
}

// Page forensics: what is ACTUALLY in the fetched page, regardless
// of the strict script-id regex. Broad scan finds ANY script block
// whose opening tag carries data-s/data-r (tolerant of quote style,
// spacing, and id renames) and tries to decode its payload.
function forensicPage(html) {
    var out = {
        bytes: html.length,
        blobText: html.indexOf("mlbdInlinePlayerData") !== -1,
        hasDataS: html.indexOf("data-s") !== -1,
        hasDataR: html.indexOf("data-r") !== -1,
        scriptCount: 0,
        broad: null
    };
    var re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        out.scriptCount++;
        var sM = m[1].match(/data-s\s*=\s*["']([0-9a-fA-F]+)["']/);
        var rM = m[1].match(/data-r\s*=\s*["'](\d+)["']/);
        if (sM && rM) {
            var res = tryDecodePayload(m[2], sM[1], rM[1]);
            out.broad = res.data ? { ok: true, eps: res.data.episodes.length, data: res.data } : { ok: false, error: res.error };
            break;
        }
    }
    if (!out.broad) out.broad = { ok: false, error: "NO-DATA-SCRIPT" };
    return out;
}

async function fetchOnceB(url, referer, withSignal) {
    var opts = {
        method: "GET",
        headers: {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": referer || BASE + "/",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1"
        }
    };
    if (withSignal) opts.signal = timeoutSignal(20000);
    var res = await fetch(url, opts);
    var text = await res.text();
    return { status: res.status, text: text };
}

// Second page fetch with full browser headers (A/B vs provider headers).
async function fetchPageB(url, referer) {
    try {
        var r = await fetchOnceB(url, referer, true);
        diag("PAGEB sig-ok status=" + r.status);
        return r;
    } catch (e) {
        try {
            var p = await fetchOnceB(url, referer, false);
            diag("PAGEB sig-THROW plain-ok status=" + p.status);
            return p;
        } catch (e2) {
            diag("PAGEB sig-THROW plain-THROW");
            return null;
        }
    }
}

function decodePlayerDataD(html) {
    // Instrumented decode: same math as the real provider, but the
    // failure REASON is recorded in S.decode instead of a bare null.
    try {
        var m = html.match(/<script([^>]*)id="mlbdInlinePlayerData"([^>]*)>([\s\S]*?)<\/script>/);
        if (!m) { S.decode = "FAIL:NO-SCRIPT"; return null; }
        var attrs = m[1] + m[2];
        var sM = attrs.match(/data-s="([0-9a-fA-F]+)"/);
        var rM = attrs.match(/data-r="(\d+)"/);
        if (!sM) { S.decode = "FAIL:NO-S"; return null; }
        if (!rM) { S.decode = "FAIL:NO-R"; return null; }
        var r = parseInt(sM[1], 16) >>> 0;
        var rounds = parseInt(rM[1], 10) || 0;
        for (var i = 0; i < rounds; i++) r = (Math.imul(r, 1103515245) + 12345) >>> 0;
        var b64 = m[3].replace(/\s+/g, "");
        S.b64 = b64.length;
        if (!b64) { S.decode = "FAIL:EMPTY-B64"; return null; }
        var bin;
        try { bin = atob(b64); } catch (e) { S.decode = "FAIL:ATOB"; return null; }
        var bytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) {
            r = (Math.imul(r, 1103515245) + 12345) >>> 0;
            bytes[j] = bin.charCodeAt(j) ^ ((r >>> 16) & 255);
        }
        S.byt = bytes.length;
        var json = new TextDecoder("utf-8").decode(bytes);
        var data = JSON.parse(json);
        if (!data || !Array.isArray(data.episodes)) { S.decode = "FAIL:NO-EPS"; return null; }
        S.decode = "ok eps=" + data.episodes.length;
        return data;
    } catch (e) {
        S.decode = "FAIL:JSON";
        return null;
    }
}

function sourcesToStreams(sources, tmdbTitle, isTv, sNum, eNum) {
    var out = [];
    for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (!s || typeof s.url !== "string" || !s.url) continue;
        var q = s.quality ? (String(s.quality) + "p") : "Auto";
        var lblBody = formatStreamSize({ title: tmdbTitle, quality: q,
            season: isTv ? sNum : undefined, episode: isTv ? eNum : undefined,
            audio: s.audio, source: "MovieLinkBD", url: s.url });
        out.push({
            name: "MovieLinkBD",
            title: "MovieLinkBD",
            size: lblBody,
            url: s.url,
            quality: q,
            headers: { "User-Agent": UA, "Referer": BASE + "/" },
            type: "mkv"
        });
    }
    return out;
}

// NEW button chain (site change 2026-11-14/15): the inline player
// data script is gone; per-quality buttons carry the payload.
// Same LCG deobfuscation as tryDecodePayload, but the decoded value
// is a plain "/file/<token>" path, not JSON.
function decodeButtonD(payload, sHex, rStr) {
    try {
        var r = parseInt(sHex, 16) >>> 0;
        var rounds = parseInt(rStr, 10) || 0;
        for (var i = 0; i < rounds; i++) r = (Math.imul(r, 1103515245) + 12345) >>> 0;
        var b64 = String(payload).replace(/\s+/g, "");
        if (!b64) return null;
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) {
            r = (Math.imul(r, 1103515245) + 12345) >>> 0;
            bytes[j] = bin.charCodeAt(j) ^ ((r >>> 16) & 255);
        }
        var s = new TextDecoder("utf-8").decode(bytes);
        if (!s || s.indexOf("/file/") !== 0) return null;
        return s;
    } catch (e) { return null; }
}

// Collect download buttons from a movie/series page.
// Movie: every button on the page. TV: only buttons inside the
// ep-card div for the requested season/episode (buttons before the
// first ep-card are whole-season packs — skipped).
function parseDownloadButtons(html, type, sNum, eNum) {
    var out = [];
    try {
        var cards = [];
        if (type === "tv") {
            var cr = /data-season-number="(\d+)"[^>]*data-episode-number="(\d+)"/g;
            var cm;
            while ((cm = cr.exec(html)) !== null) {
                cards.push({ pos: cm.index, s: parseInt(cm[1], 10), e: parseInt(cm[2], 10) });
            }
        }
        var ar = /<a\b[^>]*>[\s\S]*?<\/a>/g;
        var am;
        while ((am = ar.exec(html)) !== null) {
            var tag = am[0];
            var dlM = tag.match(/data-dl="([^"]+)"/);
            if (!dlM) continue;
            var dsM = tag.match(/data-ds="([0-9a-fA-F]+)"/);
            var drM = tag.match(/data-dr="(\d+)"/);
            if (!dsM || !drM) continue;
            var txt = stripTags(tag);
            var lm = txt.match(/Download\s*\[\s*([0-9]+p)\s*•\s*([^\]]+)\]/);
            if (!lm) continue;
            if (type === "tv") {
                var card = null;
                for (var ci = 0; ci < cards.length; ci++) {
                    if (cards[ci].pos < am.index) card = cards[ci]; else break;
                }
                if (!card || card.s !== sNum || card.e !== eNum) continue;
            }
            out.push({ quality: lm[1], size: lm[2].trim(), dl: dlM[1], ds: dsM[1], dr: drM[1] });
        }
    } catch (e) {}
    return out;
}

// Hub page -> the server link (/file/<token>) for a given data-host row.
function findHostEntryHref(html, host) {
    try {
        var ar = /<a\b[^>]*>/g;
        var am;
        while ((am = ar.exec(html)) !== null) {
            if (am[0].indexOf('data-host="' + host + '"') === -1) continue;
            var hm = am[0].match(/href="([^"]+)"/);
            if (hm && hm[1].indexOf("/file/") === 0) return hm[1];
        }
    } catch (e) {}
    return null;
}

// Hub page -> the mp4-entry server link (/file/<token>).
function findMp4EntryHref(html) {
    return findHostEntryHref(html, "mp4-entry");
}

// FSL server page -> direct fsl.movielink.tv file URL (single link,
// inside the .fsl-action-area download button).
function findFslDirectUrl(html) {
    try {
        var m = html.match(/href="(https:\/\/fsl\.movielink\.tv\/d\/[^"]+)"/);
        if (m) return m[1];
    } catch (e) {}
    return null;
}

// Server page -> direct .mp4 URL (prefer stream.mp4). The page
// HTML-escapes & as &amp; — unescape before returning.
function findMp4Url(html) {
    try {
        var re = /https?:\/\/[^\s"'<>]+\.mp4(\?[^"'<>\s]*)?/g;
        var m, best = null;
        while ((m = re.exec(html)) !== null) {
            var u = m[0].replace(/&amp;/g, "&");
            if (u.indexOf("stream.mp4") !== -1) return u;
            if (!best) best = u;
        }
        return best;
    } catch (e) { return null; }
}

async function buttonsToStreamsD(pageHtml, pageUrl, tmdbTitle, tmdbYear, type, sNum, eNum) {
    var out = [];
    var btns = parseDownloadButtons(pageHtml, type, sNum, eNum);
    diag("BUTTONS " + btns.length);
    for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var filePath = decodeButtonD(b.dl, b.ds, b.dr);
        if (!filePath) { diag("BTN-DECODE FAIL"); continue; }
        var hub = await httpD(BASE + filePath, pageUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "HUBFILE");
        if (!hub || hub.status !== 200 || !hub.text) { diag("HUBFILE NO-HTML"); continue; }
        var url = null, streamType = "mp4";
        var entry = findMp4EntryHref(hub.text);
        if (entry) {
            var mp = await httpD(BASE + entry, BASE + filePath, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "MP4PAGE");
            if (mp && mp.status === 200 && mp.text) url = findMp4Url(mp.text);
            if (!url) diag("NO-MP4-URL");
        } else {
            diag("NO-MP4-ENTRY");
        }
        if (!url) {
            // FSL fallback (site removed the mp4-entry row 2026-11-17):
            // FSL row -> /file/<token> page -> direct fsl.movielink.tv
            // file link (video/x-matroska, Range OK, EBML magic).
            var fslEntry = findHostEntryHref(hub.text, "fsl");
            if (!fslEntry) { diag("NO-FSL-ENTRY"); continue; }
            var fslPage = await httpD(BASE + fslEntry, BASE + filePath, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "FSLPAGE");
            if (!fslPage || fslPage.status !== 200 || !fslPage.text) { diag("FSLPAGE NO-HTML"); continue; }
            url = findFslDirectUrl(fslPage.text);
            if (!url) { diag("NO-FSL-URL"); continue; }
            streamType = "mkv";
        }
        var lblBody = formatStreamSize({ title: tmdbTitle, year: tmdbYear, quality: b.quality,
            season: type === "tv" ? sNum : undefined, episode: type === "tv" ? eNum : undefined,
            size: b.size, source: "MovieLinkBD", url: url });
        out.push({
            name: "MovieLinkBD",
            title: "MovieLinkBD",
            size: lblBody,
            url: url,
            quality: b.quality,
            headers: { "User-Agent": UA, "Referer": BASE + "/" },
            type: streamType
        });
    }
    return out;
}

// Hub mirror resolution with reporting (mirrors movielinkbd2 getBase).
async function getBaseD() {
    try {
        var hub = await httpD(HUB + "/", HUB + "/", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "HUB");
        if (hub && hub.status === 200 && hub.text) {
            var re = /href="(?:https?:)?\/\/([a-z0-9-]+\.movielinkbd\.(?:at|li))\//gi;
            var m;
            while ((m = re.exec(hub.text)) !== null) {
                diag("HUB resolved " + m[1]);
                return "https://" + m[1];
            }
            diag("HUB NO-LINK");
        } else {
            diag("HUB NO-HTML");
        }
    } catch (e) {
        diag("HUB THROW");
    }
    for (var i = 0; i < FALLBACKS.length; i++) {
        try {
            var probe = await httpD(FALLBACKS[i] + "/", FALLBACKS[i] + "/", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "FB" + i);
            if (probe && probe.status === 200) {
                diag("FB use " + FALLBACKS[i]);
                return FALLBACKS[i];
            }
        } catch (e) {}
    }
    diag("FB ALL-FAIL use " + FALLBACKS[FALLBACKS.length - 1]);
    return FALLBACKS[FALLBACKS.length - 1];
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


var OS_MIRROR = 'https://opensubtitles-v3.strem.io';
var SD_API = 'https://api.subdl.com/api/v2/subtitles/search';
var SD_DL = 'https://dl.subdl.com';
var WZ_API = 'https://sub.wyzie.io/search';
// Secret gist holding the user's tokens (same file the showbox/gramcinema
// tokens live in). SCRAPER_SETTINGS always wins; the gist is only read when
// a key is missing from settings. The keys are never in the repo.
var TOKEN_FILE_URL = 'https://gist.githubusercontent.com/rareanimeaddon-blip/6fc363ac74cb8921d61c07a2c6bb59d6/raw/gistfile1.txt';
var _fileTokens = null;
var _fileTokensPromise = null;
function loadTokenFile() {
  if (_fileTokens) return Promise.resolve(_fileTokens);
  if (_fileTokensPromise) return _fileTokensPromise;
  if (!TOKEN_FILE_URL) { _fileTokens = {}; return Promise.resolve(_fileTokens); }
  try {
    _fileTokensPromise = fetch(TOKEN_FILE_URL).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (j) { _fileTokens = j || {}; return _fileTokens; }).catch(function () { _fileTokens = {}; return _fileTokens; });
  } catch (e) { _fileTokens = {}; return Promise.resolve(_fileTokens); }
  return _fileTokensPromise;
}
function _setting(cfg, key) {
  try {
    if (cfg && cfg[key]) return String(cfg[key]).trim();
  } catch (e) {}
  return '';
}
function getSubdlKeys(cfg) {
  var k1 = _setting(cfg, 'subdlApiKey');
  var k2 = _setting(cfg, 'subdlApiKey2');
  if (k1 && k2) return Promise.resolve([k1, k2]);
  return loadTokenFile().then(function (t) {
    if (!k1) { try { if (t && t.subdlApiKey) k1 = String(t.subdlApiKey).trim(); } catch (e) {} }
    if (!k2) { try { if (t && t.subdlApiKey2) k2 = String(t.subdlApiKey2).trim(); } catch (e) {} }
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  }).catch(function () {
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  });
}
function getWyzieKeys(cfg) {
  var k1 = _setting(cfg, 'wyzieApiKey');
  var k2 = _setting(cfg, 'wyzieApiKey2');
  if (k1 && k2) return Promise.resolve([k1, k2]);
  return loadTokenFile().then(function (t) {
    if (!k1) { try { if (t && t.wyzieApiKey) k1 = String(t.wyzieApiKey).trim(); } catch (e) {} }
    if (!k2) { try { if (t && t.wyzieApiKey2) k2 = String(t.wyzieApiKey2).trim(); } catch (e) {} }
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  }).catch(function () {
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  });
}
function osTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (t) { return t.length > 0; });
}
function osGroup(name) {
  var s = String(name || '');
  // Last parenthesised chunk that is NOT just a year (e.g. "(2026)") — the
  // year is not a release group, and treating it as one makes every
  // same-year release "match" (+4). Skip pure years / pure numbers.
  var groups = s.match(/\(([^)]+)\)/g) || [];
  for (var gi = groups.length - 1; gi >= 0; gi--) {
    var g = groups[gi].replace(/[()]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s*4khdhub\s*$/, '').trim();
    if (!g) continue;
    if (/^\d{4}$/.test(g) || /^\d+$/.test(g)) continue;
    return g;
  }
  var m = s.match(/[-.]([A-Za-z][A-Za-z0-9]{1,})\s*$/);
  if (m) return m[1].toLowerCase();
  return '';
}
function osReleaseFeatures(name) {
  var toks = osTokens(name);
  var set = {};
  for (var i = 0; i < toks.length; i++) set[toks[i]] = true;
  var squashed = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  var source = '';
  if (squashed.indexOf('bluray') !== -1) source = 'bluray';
  else if (squashed.indexOf('webdl') !== -1) source = 'webdl';
  else if (squashed.indexOf('webrip') !== -1) source = 'webrip';
  else if (squashed.indexOf('hdtv') !== -1) source = 'hdtv';
  else if (squashed.indexOf('dvdrip') !== -1) source = 'dvdrip';
  else if (set['ts'] || set['telesync']) source = 'ts';
  return {
    group: osGroup(name),
    source: source,
    res: set['2160p'] ? '2160p' : set['1080p'] ? '1080p' : set['720p'] ? '720p' : set['480p'] ? '480p' : '',
    codec: (set['x265'] || set['hevc'] || squashed.indexOf('h265') !== -1) ? 'hevc' : (set['x264'] || set['avc'] || squashed.indexOf('h264') !== -1) ? 'avc' : '',
    imax: !!set['imax'],
    remux: !!set['remux']
  };
}
function osScore(fileF, subF) {
  var s = 0;
  if (fileF.group && subF.group && fileF.group === subF.group) s += 4;
  else if (fileF.group && subF.group) {
    var fg = fileF.group.split(' '), sg = subF.group.split(' ');
    for (var i = 0; i < fg.length; i++) { if (sg.indexOf(fg[i]) !== -1) { s += 2; break; } }
  }
  if (fileF.source && fileF.source === subF.source) s += 2;
  if (fileF.res && fileF.res === subF.res) s += 1;
  if (fileF.codec && fileF.codec === subF.codec) s += 1;
  if (fileF.imax && subF.imax) s += 1;
  if (fileF.remux && subF.remux) s += 1;
  return s;
}
function osBestMatch(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0;
  for (var k = 0; k < subs.length; k++) {
    var sc = osScore(ff, osReleaseFeatures(subs[k].release));
    if (sc > bestScore) { bestScore = sc; best = subs[k]; }
  }
  return (best && bestScore >= 4) ? best : null;
}
function osMirrorSubs(imdbId, isSeries, season, episode) {
  var path = isSeries
    ? '/subtitles/series/' + imdbId + ':' + season + ':' + episode + '.json'
    : '/subtitles/movie/' + imdbId + '.json';
  return fetch(OS_MIRROR + path).then(function (r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function (j) {
    var list = (j && j.subtitles) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var lang = String(it.lang || '').toLowerCase();
      if (lang !== 'eng' && lang !== 'en') continue;
      var url = it.url || '';
      if (url.indexOf('https://') !== 0) continue;
      var host = '';
      try { host = new URL(url).hostname; } catch (e) {}
      if (host.indexOf('strem.io') === -1) continue;
      var rel = it.movieReleaseName || it.subtitleFileName || '';
      if (!rel) continue;
      out.push({ id: it.id, url: url, release: rel });
    }
    return out;
  }).catch(function () { return []; });
}
// Try each SubDL key in order; the first key that returns a usable list wins.
// A 401/429/non-ok response falls through to the next key. Returns [] if all fail.
// NOTE: the JSON parse is nested INSIDE the r.ok branch — a failed key's
// attempt() must return directly, not flow into the JSON-parsing .then()
// (that swallowed the good key's result: the array has no .subtitles).
function sdSearchSubs(imdbId, year, keys) {
  if (!keys || !keys.length) return Promise.resolve([]);
  var u = SD_API + '?imdb_id=' + encodeURIComponent(imdbId) + '&year=' + year + '&languages=en&type=movie';
  var idx = 0;
  var attempt = function () {
    if (idx >= keys.length) return Promise.resolve([]);
    var key = keys[idx++];
    return fetch(u, { headers: { 'Authorization': 'Bearer ' + key } }).then(function (r) {
      if (!r.ok) return attempt();
      return r.json().then(function (j) {
        var list = (j && j.subtitles) || [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var it = list[i] || {};
          if (String(it.language || '').toLowerCase() !== 'en') continue;
          var rel = it.release_name || '';
          var url = it.url || '';
          if (!rel || !url) continue;
          out.push({ id: it.id, url: SD_DL + url, release: rel });
        }
        if (!out.length) return attempt();
        return out;
      }).catch(function () { return attempt(); });
    }).catch(function () { return attempt(); });
  };
  return attempt();
}
// Wyzie search — ONE call per title (not per row); the result is reused
// across rows. The first still-needing row's release filename is passed via
// video= so Wyzie returns a match score (0-100) for that release. The key
// is a QUERY parameter, never a header. AI-translated rows are skipped.
// A 401/429/non-ok response falls through to the next key. Returns [] if all fail.
// The emitted url is a sub.wyzie.io/c/... link (tok param) — it does NOT
// reveal the API key, so it is safe to attach to a stream row.
function wzSearchSubs(imdbId, isSeries, season, episode, videoName, keys) {
  if (!keys || !keys.length) return Promise.resolve([]);
  var u = WZ_API + '?id=' + encodeURIComponent(imdbId) + '&language=en';
  if (isSeries) u += '&season=' + season + '&episode=' + episode;
  if (videoName) u += '&video=' + encodeURIComponent(videoName);
  var idx = 0;
  var attempt = function () {
    if (idx >= keys.length) return Promise.resolve([]);
    var key = keys[idx++];
    return fetch(u + '&key=' + encodeURIComponent(key)).then(function (r) {
      if (!r.ok) return attempt();
      return r.json().then(function (j) {
        var list = Array.isArray(j) ? j : [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var it = list[i] || {};
          if (it.ai) continue;
          var lang = String(it.language || '').toLowerCase();
          if (lang !== 'en' && lang !== 'eng') continue;
          var url = it.url || '';
          if (url.indexOf('https://sub.wyzie.io/') !== 0) continue;
          var rel = it.release || '';
          var rels = Array.isArray(it.releases) ? it.releases : [];
          if (!rel && !rels.length) continue;
          var ms = 0;
          try { if (it.match && typeof it.match.score === 'number') ms = it.match.score; } catch (e) {}
          out.push({ id: it.id, url: url, release: rel, releases: rels, hi: !!it.isHearingImpaired, format: String(it.format || '').toLowerCase(), matchScore: ms });
        }
        if (!out.length) return attempt();
        return out;
      }).catch(function () { return attempt(); });
    }).catch(function () { return attempt(); });
  };
  return attempt();
}
// Wyzie best match: score the release name AND every releases entry with the
// existing scorer, take the best. NOTE: Wyzie's own match.score is NOT used
// to force a match — it is too lenient for generic video filenames (a bare
// "Title Year 1080p h264" with no group/source scores 100 against many
// unrelated releases, which would attach the wrong subtitle). The
// release/releases token scorer is the matcher; video= only sorts results
// best-first. Prefer srt/vtt over other formats and non-HI over HI.
// Attach at >=4.
function wzBestMatch(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0, bestPref = -1;
  for (var k = 0; k < subs.length; k++) {
    var sub = subs[k];
    var sc = osScore(ff, osReleaseFeatures(sub.release || ''));
    var rels = sub.releases || [];
    for (var r = 0; r < rels.length; r++) {
      var s2 = osScore(ff, osReleaseFeatures(rels[r]));
      if (s2 > sc) sc = s2;
    }
    var pref = 0;
    if (sub.format === 'srt' || sub.format === 'vtt') pref += 2;
    if (!sub.hi) pref += 1;
    if (sc > bestScore || (sc === bestScore && sc >= 4 && pref > bestPref)) {
      bestScore = sc; best = sub; bestPref = pref;
    }
  }
  return (best && bestScore >= 4) ? best : null;
}
function osAttachSubtitles(rows, imdbId, isSeries, season, episode, cfg) {
  try {
    if (cfg && cfg.osSubtitles === false) return Promise.resolve(rows);
    if (!imdbId || !rows || !rows.length) return Promise.resolve(rows);
    var year = cfg && cfg.year ? cfg.year : 0;
    var cleanup = function () {
      for (var c = 0; c < rows.length; c++) { try { delete rows[c]._rel; delete rows[c]._releaseTitle; } catch (e) {} }
      return rows;
    };
    var prep = function () {
      for (var i = 0; i < rows.length; i++) {
        var rel = rows[i]._releaseTitle || '';
        if (!rel && rows[i].url) {
          try { rel = decodeURIComponent(String(rows[i].url).split('/').pop() || '').replace(/\.[^.]+$/, ''); } catch (e) {}
        }
        rows[i]._rel = rel;
      }
    };
    // 1. SubDL FIRST (primary). 2. Wyzie SECOND for rows SubDL missed.
    // 3. Mirror as BACKUP for rows SubDL and Wyzie missed.
    return getSubdlKeys(cfg).then(function (keys) {
      prep();
      var need = rows.slice();
      var useSubdl = function () {
        if (!keys.length) return Promise.resolve(need);
        return sdSearchSubs(imdbId, year, keys).then(function (sdSubs) {
          var still = [];
          for (var i = 0; i < need.length; i++) {
            var hit = osBestMatch(need[i]._rel, sdSubs);
            if (hit) need[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
            else still.push(need[i]);
          }
          return still;
        }).catch(function () { return need; });
      };
      var useWyzie = function (still) {
        if (!still.length) return Promise.resolve(still);
        return getWyzieKeys(cfg).then(function (wzKeys) {
          if (!wzKeys.length) return still;
          var videoName = '';
          for (var v = 0; v < still.length; v++) { if (still[v]._rel) { videoName = still[v]._rel; break; } }
          return wzSearchSubs(imdbId, isSeries, season, episode, videoName, wzKeys).then(function (wzSubs) {
            var rest = [];
            for (var i = 0; i < still.length; i++) {
              var hit = wzBestMatch(still[i]._rel, wzSubs);
              if (hit) still[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
              else rest.push(still[i]);
            }
            return rest;
          }).catch(function () { return still; });
        }).catch(function () { return still; });
      };
      return useSubdl().then(function (still) {
        return useWyzie(still);
      }).then(function (still) {
        if (!still.length) return cleanup();
        return osMirrorSubs(imdbId, isSeries, season, episode).then(function (mirrorSubs) {
          for (var j = 0; j < still.length; j++) {
            var hit2 = osBestMatch(still[j]._rel, mirrorSubs);
            if (hit2) still[j].subtitles = [{ id: String(hit2.id), url: hit2.url, lang: 'en' }];
          }
          return cleanup();
        }).catch(function () { return cleanup(); });
      });
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    var real = [];
    try {
        var type = mediaType === "movie" ? "movie" : "tv";
        var sNum = season == null || season === "" ? 1 : parseInt(season, 10);
        var eNum = episode == null || episode === "" ? 1 : parseInt(episode, 10);
        if (isNaN(sNum)) sNum = 1;
        if (isNaN(eNum)) eNum = 1;
        // Fresh run: clear any lines/outcome left by a previous run in
        // the same app session, so repeats never show stale results.
        DIAG.length = 0;
        S = { hub: "?", tmdb: "?", cards: "?", match: "no", page: "?", decode: "?", ep: "?", src: 0, b64: 0, byt: 0, fa: "?", fb: "?" };
        diag("movielinkbd3 v1.0.0 tmdb=" + tmdbId + " " + type);
        BASE = await getBaseD();
        S.hub = BASE;

        var key = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";
        if (!key) { diag("TMDB NO-KEY"); S.tmdb = "NO-KEY"; return real; }
        var kind = type === "movie" ? "movie" : "tv";
        var tj = await httpD("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + key, "", "application/json, text/plain, */*", "TMDB");
        var details = null;
        if (tj && tj.status === 200) { try { details = JSON.parse(tj.text); } catch (e) {} }
        if (!details) { diag("TMDB DETAILS-NULL"); S.tmdb = "FAIL"; return real; }
        var tmdbTitle = details.title || details.name || "";
        var rd = details.release_date || details.first_air_date || "";
        var tmdbYear = rd && rd.length >= 4 ? parseInt(rd.slice(0, 4), 10) : null;
        var tmdbNorm = norm(tmdbTitle);
        var displayTitle = tmdbTitle + (type === "movie" ? "" : " S" + sNum + "E" + eNum);
        diag("TMDB ok title=" + tmdbTitle + " year=" + tmdbYear);
        S.tmdb = tmdbTitle + "/" + tmdbYear;

        var sh = await httpD(BASE + "/search?q=" + encodeURIComponent(tmdbTitle), BASE + "/", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "SEARCH");
        if (!sh || sh.status !== 200 || !sh.text) { diag("SEARCH NO-HTML"); S.cards = "FAIL"; return real; }
        var cards = parseSearch(sh.text, type);
        diag("SEARCH cards=" + cards.length);
        S.cards = cards.length;
        var cores = [];
        for (var ci = 0; ci < Math.min(cards.length, 5); ci++) cores.push(cards[ci].core);
        diag("CORES " + cores.join(" | "));

        for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            if (c.core !== tmdbNorm) continue;
            if (!yearOk(c.year, tmdbYear)) { diag("MATCH year-reject " + c.href); continue; }
            if (type === "tv" && c.season !== sNum) continue;
            diag("MATCH " + c.href + " season=" + c.season + " year=" + c.year);
            S.match = c.href;
            var pg = await httpD(BASE + c.href, BASE + "/search?q=" + encodeURIComponent(tmdbTitle), "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "PAGE");
            if (!pg || pg.status !== 200 || !pg.text) { diag("PAGE NO-HTML"); S.page = "NO-HTML"; continue; }
            diag("PAGE bytes=" + pg.text.length);
            S.page = pg.text.length;
            var fa = forensicPage(pg.text);
            diag("FORENSIC-A blob=" + fa.blobText + " dS=" + fa.hasDataS + " dR=" + fa.hasDataR + " scr=" + fa.scriptCount);
            S.fa = "blob=" + fa.blobText + " dS=" + fa.hasDataS + " dR=" + fa.hasDataR + " scr=" + fa.scriptCount;
            var data = decodePlayerDataD(pg.text);
            if (!data || !Array.isArray(data.episodes)) {
                diag("DECODE FAIL " + S.decode);
                if (fa.broad && fa.broad.ok) {
                    diag("BROAD ok eps=" + fa.broad.eps);
                    data = fa.broad.data;
                    S.decode = "broad-ok";
                } else {
                    diag("BROAD FAIL " + (fa.broad ? fa.broad.error : "?"));
                    S.fa += " BROAD=" + (fa.broad ? fa.broad.error : "?");
                    var pgB = await fetchPageB(BASE + c.href, BASE + "/search?q=" + encodeURIComponent(tmdbTitle));
                    if (pgB && pgB.status === 200 && pgB.text) {
                        var fb = forensicPage(pgB.text);
                        diag("FORENSIC-B bytes=" + pgB.text.length + " blob=" + fb.blobText + " dS=" + fb.hasDataS + " dR=" + fb.hasDataR);
                        S.fb = "bytes=" + pgB.text.length + " blob=" + fb.blobText + " dS=" + fb.hasDataS + " dR=" + fb.hasDataR;
                        if (fb.broad && fb.broad.ok) {
                            diag("BROAD-B ok eps=" + fb.broad.eps);
                            data = fb.broad.data;
                            S.decode = "broadB-ok";
                        }
                    } else {
                        diag("PAGEB NO-HTML");
                        S.fb = "NO-HTML";
                    }
                    if (!data || !Array.isArray(data.episodes)) { diag("BUTTON-FALLBACK"); }
                }
            } else {
                diag("DECODE ok eps=" + data.episodes.length + " title=" + (data.title || "?"));
                S.fb = "skip";
            }
            var ep = null;
            if (data && Array.isArray(data.episodes)) {
            if (type === "movie") {
                for (var j = 0; j < data.episodes.length; j++) {
                    if (data.episodes[j].kind === "movie") { ep = data.episodes[j]; break; }
                }
                if (!ep) ep = data.episodes[0];
            } else {
                for (var k = 0; k < data.episodes.length; k++) {
                    if (data.episodes[k].season === sNum && data.episodes[k].number === eNum) { ep = data.episodes[k]; break; }
                }
                if (!ep && sNum === 1) {
                    for (var l = 0; l < data.episodes.length; l++) {
                        if (data.episodes[l].number === eNum) { ep = data.episodes[l]; break; }
                    }
                }
            }
            if (!ep) { diag("EP NOT-FOUND"); S.ep = "NOT-FOUND"; continue; }
            diag("EP " + (ep.label || ep.id) + " srcs=" + ((ep.sources || []).length));
            S.ep = (ep.label || ep.id);
            S.src = (ep.sources || []).length;
            if (ep.sources && ep.sources.length) {
                real = sourcesToStreams(ep.sources, tmdbTitle, type === "tv", sNum, eNum);
                if (real.length) break;
            }
            } else {
                // NEW button chain (site dropped the inline player script).
                var btnReal = await buttonsToStreamsD(pg.text, BASE + c.href, tmdbTitle, tmdbYear, type, sNum, eNum);
                if (btnReal.length) { real = btnReal; break; }
            }
        }
        if (!real.length) diag("RESULT 0-streams");
        var _imdbId = (details && details.imdb_id) ? String(details.imdb_id) : null;
        return osAttachSubtitles(real, _imdbId, type === "tv", sNum, eNum, {
          osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
          subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
          subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
          year: tmdbYear || 0
        });
    } catch (err) {
        diag("THROW " + String(err && err.message || err).slice(0, 80));
        return real;
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
