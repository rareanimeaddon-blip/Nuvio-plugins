// MovieLinkBD Diag2 — TEMPORARY diagnostic provider (v2 chain), remove after use.
// Reports each chain step as a labeled stream (name carries it).
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

function sourcesToStreams(sources, displayTitle) {
    var out = [];
    for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (!s || typeof s.url !== "string" || !s.url) continue;
        var q = s.quality ? (String(s.quality) + "p") : "Auto";
        out.push({
            name: "MovieLinkBD • " + q + (s.audio ? " • " + s.audio : ""),
            title: displayTitle,
            url: s.url,
            quality: q,
            headers: { "User-Agent": UA, "Referer": BASE + "/" },
            type: "mkv"
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
                    if (!data || !Array.isArray(data.episodes)) continue;
                }
            } else {
                diag("DECODE ok eps=" + data.episodes.length + " title=" + (data.title || "?"));
                S.fb = "skip";
            }
            var ep = null;
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
                real = sourcesToStreams(ep.sources, displayTitle);
                if (real.length) break;
            }
        }
        if (!real.length) diag("RESULT 0-streams");
        return real;
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
