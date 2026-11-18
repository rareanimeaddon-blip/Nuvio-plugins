// Prmovies — v1.0.0 chain (2026-11-18, movies only).
// Site: https://prmovies.coupons (WordPress). Chain, verified by
// browser inspection + the user's own phone screenshots:
//   search  GET /?s=<title>  -> poster cards, link
//     https://prmovies.coupons/<slug>-<year>-Watch-online-full-movie/
//   title page -> <IFRAME SRC="https://speedostream1.com/embed-<id>.html">
//     one per server, in order Server 1 = 1080p, Server 2 = 720p,
//     Server 3 = 480p (user's view-source: vad3ezk8kivh / 0sisa2d4hbrj /
//     08r3rzixx1jn on the Ramayana page; the player plays in Chrome).
//   embed page (Referer https://speedostream1.com/) -> file:"<url>"
//     (MediaVanced speedostream.py pattern) -> stream URL.
// Known facts / risks:
// - The download table on title pages points at the SAME speedostream
//   files, but the Ramayana 1080p + 720p download files are DEAD
//   ("File Not Found" on the phone); the player embeds use different
//   ids for 1080p, so the download table is NOT used here.
// - The embed page opened directly says "Embeds disabled2" (no
//   Referer); with the page Referer it plays in Chrome.
// - prmovies.coupons sits behind Cloudflare Turnstile: it blocks the
//   sandbox and the cloud browser outright, and the challenge never
//   clears there. Whether the app's fetch passes it on the device is
//   UNPROVEN (Nepu class) — the device verdict decides. If the app
//   gets the challenge page, this provider returns 0 cleanly.
// - speedostream1.com blocks datacenter IPs ("Your request was
//   blocked") but loads on the user's phone; the stream URL is
//   returned with Referer https://speedostream1.com/ attached.
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

var BASE = "https://prmovies.coupons";
var SPEEDO = "https://speedostream1.com";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var TMDB_KEY_FALLBACK = "5f39fd16e987a9e3fce30d55cf09b438";
var EMBED_QUALITIES = ["1080p", "720p", "480p"];

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

function fetchOnce(url, headers, withSignal) {
    var opts = { method: "GET", headers: headers };
    if (withSignal) opts.signal = timeoutSignal(20000);
    return fetch(url, opts).then(function (res) {
        return res.text().then(function (text) { return { status: res.status, text: text }; });
    });
}

function http(url, headers) {
    return fetchOnce(url, headers, true).catch(function () {
        return fetchOnce(url, headers, false).catch(function () { return null; });
    });
}

function providerHeaders(referer) {
    return { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Referer": referer || BASE + "/" };
}

function browserHeaders(referer) {
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": referer || BASE + "/",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
    };
}

function isChallengePage(html) {
    if (!html) return true;
    return html.indexOf("Just a moment") !== -1 ||
        html.indexOf("challenges.cloudflare.com") !== -1 ||
        html.indexOf("Verify you are human") !== -1 ||
        html.indexOf("Performing security verification") !== -1;
}

function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripTags(html) {
    return String(html).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function yearOk(cardYear, tmdbYear) {
    if (cardYear == null || tmdbYear == null) return true;
    return Math.abs(cardYear - tmdbYear) <= 1;
}

// Card text is e.g. "The Matrix (1999) 720p" / "The Matrix (1999)
// Hindi Dubbed" / "Ramayana: Rise of a Legend (2026) HD". Strip the
// year, quality tokens and dub tags so the core is the bare title.
function cardCore(text) {
    var t = String(text || "");
    var year = null;
    var ym = t.match(/\((19|20)\d{2}\)/);
    if (ym) year = parseInt(ym[0].replace(/[()]/g, ""), 10);
    var core = t.replace(/\(\d{4}\)/g, " ")
        .replace(/\b\d{3,4}p\b/gi, " ")
        .replace(/\b(Hindi Dubbed|Dual Audio|Hindi|English|Tamil|Telugu)\b/gi, " ")
        .replace(/\b(HDRip|WEBRip|BluRay|BRRip|DVDRip|HDTV|HDTS|CAM|PreDVD|HD|4K)\b/gi, " ")
        .replace(/\bWatch online full movie\b/gi, " ")
        .replace(/\[[^\]]*\]/g, " ");
    return { core: norm(core), year: year };
}

// Slug fallback: /the-matrix-1999-hindi-dubbed-Watch-online-full-movie/
// -> "the matrix" (cut at the year, hyphens to spaces, drop dub tags).
function slugCore(href) {
    try {
        var slug = String(href).split("/").filter(function (p) { return p; }).pop() || "";
        slug = slug.replace(/-Watch-online-full-movie\/?$/i, "");
        var m = slug.match(/^(.*?)-(19|20)\d{2}(-.*)?$/);
        var base = m ? m[1] : slug;
        base = base.replace(/-/g, " ").replace(/\b(hindi dubbed|dual audio|hindi|english)\b/gi, " ");
        return norm(base);
    } catch (e) { return ""; }
}

function parseSearch(html) {
    var out = [];
    var seen = {};
    var re = /<a[^>]*href="(https?:\/\/prmovies\.coupons\/[^"]+)"[^>]*>([\s\S]{0,1500}?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
        var href = m[1];
        if (seen[href]) continue;
        if (href.indexOf("-Watch-online-full-movie/") === -1) continue;
        var txt = stripTags(m[2]);
        if (!txt) continue;
        seen[href] = true;
        var c = cardCore(txt);
        c.href = href;
        c.slug = slugCore(href);
        out.push(c);
    }
    return out;
}

// Server buttons: "Server 1 ... HD 1080P" -> [{num:1, quality:"1080p"}].
function parseServers(html) {
    var out = [];
    var re = /Server\s*(\d)[\s\S]{0,400}?\b(1080|720|480)p\b/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
        out.push({ num: parseInt(m[1], 10), quality: m[2] + "p" });
    }
    return out;
}

function parseEmbeds(html) {
    var out = [];
    var seen = {};
    var re = /<iframe[^>]+src=["'](https?:\/\/speedostream1\.com\/embed-[^"']+\.html)["']/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
        var url = m[1];
        if (seen[url]) continue;
        seen[url] = true;
        out.push(url);
    }
    return out;
}

function extractFileUrl(embedHtml) {
    if (!embedHtml) return null;
    if (embedHtml.indexOf("Embeds disabled") !== -1) return null;
    if (embedHtml.indexOf("File Not Found") !== -1) return null;
    var m = embedHtml.match(/file\s*:\s*["']([^"']+)["']/);
    if (m && m[1] && m[1].indexOf("http") === 0) return m[1];
    return null;
}

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

async function getStreams(tmdbId, mediaType, season, episode) {
    var real = [];
    try {
        if (mediaType && mediaType !== "movie") return real;
        var key = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ? TMDB_API_KEY : TMDB_KEY_FALLBACK;
        var tj = await http("https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + key, { "User-Agent": UA, "Accept": "application/json, text/plain, */*" });
        var details = null;
        if (tj && tj.status === 200) { try { details = JSON.parse(tj.text); } catch (e) {} }
        if (!details) return real;
        var tmdbTitle = details.title || details.name || "";
        if (!tmdbTitle) return real;
        var rd = details.release_date || "";
        var tmdbYear = rd && rd.length >= 4 ? parseInt(rd.slice(0, 4), 10) : null;

        // Gate v3 pattern: canonical title, then TMDB alternative titles
        // (Latin-script only, shortest first, cap 4), each through the
        // UNCHANGED exact gate.
        var titles = [tmdbTitle];
        try {
            var aj = await http("https://api.themoviedb.org/3/movie/" + tmdbId + "/alternative_titles?api_key=" + key, { "User-Agent": UA, "Accept": "application/json, text/plain, */*" });
            if (aj && aj.status === 200) {
                var ad = JSON.parse(aj.text);
                var alts = [];
                if (ad && Array.isArray(ad.titles)) {
                    for (var ai = 0; ai < ad.titles.length; ai++) {
                        var at = ad.titles[ai] && ad.titles[ai].title;
                        if (!at || norm(at) === norm(tmdbTitle)) continue;
                        if (/[^\u0000-\u024F\s\.,:;'\-!&()]/.test(at)) continue;
                        alts.push(at);
                    }
                }
                alts.sort(function (a, b) { return a.length - b.length; });
                for (var a2 = 0; a2 < Math.min(alts.length, 4); a2++) titles.push(alts[a2]);
            }
        } catch (e) {}

        for (var ti = 0; ti < titles.length; ti++) {
            var q = titles[ti];
            var qNorm = norm(q);
            var sh = await http(BASE + "/?s=" + encodeURIComponent(q), browserHeaders(BASE + "/"));
            if (!sh || !sh.text) continue;
            // 403/503 = Cloudflare (or the host) blocking this client;
            // aliases would hit the same wall, so stop cleanly.
            if (sh.status === 403 || sh.status === 503 || isChallengePage(sh.text)) return real;
            if (sh.status !== 200) continue;
            var cards = parseSearch(sh.text);
            var match = null;
            for (var ci = 0; ci < cards.length; ci++) {
                var c = cards[ci];
                if (c.core !== qNorm && c.slug !== qNorm) continue;
                if (!yearOk(c.year, tmdbYear)) continue;
                match = c;
                break;
            }
            if (!match) continue;
            var pg = await http(match.href, browserHeaders(BASE + "/?s=" + encodeURIComponent(q)));
            if (!pg || pg.status !== 200 || !pg.text || isChallengePage(pg.text)) {
                var pg2 = await http(match.href, providerHeaders(match.href));
                if (!pg2 || pg2.status !== 200 || !pg2.text || isChallengePage(pg2.text)) continue;
                pg = pg2;
            }
            var servers = parseServers(pg.text);
            var embeds = parseEmbeds(pg.text);
            if (!embeds.length) continue;
            for (var ei = 0; ei < Math.min(embeds.length, 3); ei++) {
                var quality = "Unknown";
                if (servers[ei] && servers[ei].quality) quality = servers[ei].quality;
                else if (EMBED_QUALITIES[ei]) quality = EMBED_QUALITIES[ei];
                var eh = await http(embeds[ei], {
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Referer": SPEEDO + "/"
                });
                if (!eh || eh.status !== 200 || !eh.text) continue;
                var fileUrl = extractFileUrl(eh.text);
                if (!fileUrl) continue;
                var isHls = /\.m3u8(\?|$)/i.test(fileUrl);
                var lblBody = formatStreamSize({ title: tmdbTitle, year: tmdbYear, quality: quality, source: "Prmovies", server: "speedostream1.com", url: fileUrl });
                real.push({
                    name: "Prmovies",
                    title: "Prmovies",
                    size: lblBody,
                    url: fileUrl,
                    quality: quality,
                    headers: { "User-Agent": UA, "Referer": SPEEDO + "/" },
                    type: isHls ? "m3u8" : "mp4"
                });
            }
            if (real.length) break;
        }
        return real;
    } catch (err) {
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
