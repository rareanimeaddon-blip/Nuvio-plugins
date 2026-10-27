/*
 * Anime Dekho — Nuvio plugin (scraper)
 * Converted 1:1 from AnimeDekhoProvider.cs3 (CloudStream3 plugin v72 by phisher98).
 * Streams flow: TMDB id -> site search (DGT suggest API) -> post page (DGT snapshot)
 * -> DGT episodes API -> DGT watch API (with ad-gate bypass + nonce fallback)
 * -> per-server extractors (all 31 extractors registered by the original plugin).
 * Support the original author: https://buymeacoffee.com/phisher98
 */
"use strict";
/*
 * Shared extractor library — a faithful JavaScript port of the extractors that
 * AnimeDekhoProvider.cs3 (CloudStream3 plugin, version 72, by phisher98) registers
 * in AnimeDekhoPlugin.load(), in the same registration order:
 *
 *   StreamRuby, Vidmoly (Vidmolynet), GDMirrorbot, Techinmind (GDMirrorbot),
 *   StreamWish (Cdnwish), StreamWish (Multimovies), FileMoon, FileMoon (FileMoonNL/Filesim),
 *   Krakenfiles, Voe, StreamTape, FilemoonV2, Vidhide (Animezia), VidStack (Cloudy),
 *   VidStack (vidcloudupns), Animedekhoco, Blakiteapi, AWSStream (ascdn21), AWSStream (ascdn26),
 *   Ravok, NeoCDN, DekhoVidSrc, AnimeworldMirror, GDFlix, Gofile, DekhoHubCloud (HubCloud),
 *   Vidmoly (VidmolyBiz), AnimedekhoEmbed, Abyass, Abyass (Short), Abyass (AbyssPlayer)
 *
 * Extractors written by the plugin author (present in the .cs3 DEX) are ported
 * method-for-method from the decompiled bytecode. Extractors that CloudStream
 * ships as app built-ins (FileMoon, Krakenfiles, Voe, StreamTape, FilemoonV2) and
 * the CloudStream base classes (Vidmoly, StreamWish, Vidhide, VidStack, Filesim)
 * are not inside the .cs3 file; they are re-implemented here from their standard
 * public CloudStream behaviour so that loadExtractor() can route to them exactly
 * like CloudStream does.
 *
 * An extractor "link" in this file is an object:
 *   { source, name, url, type: "m3u8"|"video"|"infer", referer, headers, quality, subtitles }
 * quality is the numeric CloudStream quality (1080 means 1080p, 0 = Unknown).
 */

let cheerio = null;
try {
    cheerio = require("cheerio-without-node-native");
} catch (e) {
    cheerio = null;
}

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const Q_UNKNOWN = 0;

// ---------------------------------------------------------------------------
// Small utilities (Kotlin stdlib / CloudStream equivalents)
// ---------------------------------------------------------------------------

function isBlank(s) {
    return s == null || String(s).trim() === "";
}

function substringAfter(str, delim) {
    const s = String(str);
    const i = s.indexOf(delim);
    return i === -1 ? s : s.substring(i + delim.length);
}

function substringAfterLast(str, delim) {
    const s = String(str);
    const i = s.lastIndexOf(delim);
    return i === -1 ? s : s.substring(i + delim.length);
}

function substringBefore(str, delim) {
    const s = String(str);
    const i = s.indexOf(delim);
    return i === -1 ? s : s.substring(0, i);
}

function toIntOrNull(s) {
    if (s == null) return null;
    const t = String(s).trim();
    if (!/^[+-]?\d+$/.test(t)) return null;
    const n = parseInt(t, 10);
    return Number.isNaN(n) ? null : n;
}

// CloudStream ExtractorApiKt.getQualityFromName()
function getQualityFromName(name) {
    if (name == null) return Q_UNKNOWN;
    const s = String(name);
    if (s.includes("2160")) return 2160;
    if (s.includes("1440")) return 1440;
    if (s.includes("1080")) return 1080;
    if (s.includes("720")) return 720;
    if (s.includes("480")) return 480;
    if (s.includes("360")) return 360;
    if (s.includes("240")) return 240;
    return Q_UNKNOWN;
}

// scheme + "://" + host of a URL (Kotlin URI.getScheme/getHost, DekhoHubCloud.baseUrlOf /
// GDFlix.gdflixBaseUrl / GDMirrorbot.getBaseUrl); "" when the URL cannot be parsed.
function baseUrlOf(url) {
    try {
        const u = new URL(String(url));
        return u.protocol.replace(/:$/, "") + "://" + u.hostname;
    } catch (e) {
        return "";
    }
}

function originOf(url) {
    return baseUrlOf(url);
}

// Java URLEncoder.encode(str, "UTF-8")
function javaUrlEncode(str) {
    return encodeURIComponent(String(str))
        .replace(/%20/g, "+")
        .replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// Java URLDecoder.decode(str, "UTF-8")
function javaUrlDecode(str) {
    return decodeURIComponent(String(str).replace(/\+/g, " "));
}

// CloudStream MainAPIKt.base64Decode() — tolerant standard Base64 -> UTF-8 string.
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64DecodeBytes(str) {
    const clean = String(str == null ? "" : str).replace(/[^A-Za-z0-9+/=]/g, "");
    const bytes = [];
    let buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (ch === "=") break;
        const val = B64_ALPHABET.indexOf(ch);
        if (val === -1) continue;
        buffer = (buffer << 6) | val;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
    }
    return bytes;
}

function utf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
        const b = bytes[i];
        if (b < 0x80) {
            out += String.fromCharCode(b);
            i += 1;
        } else if (b >= 0xc0 && b < 0xe0 && i + 1 < bytes.length) {
            out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
            i += 2;
        } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
            out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
            i += 3;
        } else if (b >= 0xf0 && i + 3 < bytes.length) {
            const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
            const adj = cp - 0x10000;
            out += String.fromCharCode(0xd800 + (adj >> 10), 0xdc00 + (adj & 0x3ff));
            i += 4;
        } else {
            i += 1;
        }
    }
    return out;
}

function base64Decode(str) {
    return utf8Decode(base64DecodeBytes(str));
}

// Dean Edwards p.a.c.k.e.d unpacker (CloudStream JsUnpacker equivalent).
function unpackJs(packed) {
    if (!packed) return null;
    const m = /}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.split\('\|'\)/.exec(packed)
        || /}\s*\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*\.split\("\|"\)/.exec(packed);
    if (!m) return null;
    const payload = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const radix = parseInt(m[2], 10);
    let count = parseInt(m[3], 10);
    const words = m[4].split("|");
    function e(c) {
        return (c < radix ? "" : e(Math.floor(c / radix))) + ((c % radix) > 35 ? String.fromCharCode((c % radix) + 29) : (c % radix).toString(36));
    }
    const dict = {};
    while (count-- > 0) {
        dict[e(count)] = words[count] || e(count);
    }
    return payload.replace(/\b\w+\b/g, (w) => (Object.prototype.hasOwnProperty.call(dict, w) ? dict[w] : w));
}

function sleep(ms) {
    if (typeof setTimeout === "function") {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    // Platform difference: the LG webOS TV runtime has no setTimeout at all
    // (proven by the TV diagnostic on 2026-10-23), so resolving immediately
    // made every ad-gate wait collapse to zero and the bypass could never
    // pass on TV. Wait by watching the clock instead, in small slices.
    const end = Date.now() + ms;
    return (async () => {
        while (Date.now() < end) {
            const sliceEnd = Math.min(end, Date.now() + 40);
            while (Date.now() < sliceEnd) {}
            await Promise.resolve();
        }
    })();
}

// ---------------------------------------------------------------------------
// HTTP helpers (NiceHttp Requests equivalents)
// ---------------------------------------------------------------------------

// Requests carry a timeout, like a standard HTTP client (OkHttp/NiceHttp in
// the original app); without it a single dead host could hang getStreams.
// 12s (lowered from 30s during conversion): Nuvio kills scrapers that run
// too long, and several extractor hosts hang rather than refuse.
const HTTP_TIMEOUT_MS = 12000;

function timeoutSignal(ms) {
    try {
        if (typeof AbortController === "undefined") return undefined;
        const ctl = new AbortController();
        if (typeof setTimeout === "function") setTimeout(() => { try { ctl.abort(); } catch (e) {} }, ms);
        return ctl.signal;
    } catch (e) {
        return undefined;
    }
}

async function httpGetText(url, opts) {
    opts = opts || {};
    const res = await fetch(url, {
        method: "GET",
        headers: opts.headers || {},
        redirect: opts.redirect || "follow",
        signal: timeoutSignal(opts.timeoutMs || HTTP_TIMEOUT_MS),
    });
    return await res.text();
}

async function httpGetRes(url, opts) {
    opts = opts || {};
    return await fetch(url, {
        method: "GET",
        headers: opts.headers || {},
        redirect: opts.redirect || "follow",
        signal: timeoutSignal(opts.timeoutMs || HTTP_TIMEOUT_MS),
    });
}

async function httpPostText(url, body, opts) {
    opts = opts || {};
    const init = { method: "POST", headers: opts.headers || {}, redirect: opts.redirect || "follow", signal: timeoutSignal(opts.timeoutMs || HTTP_TIMEOUT_MS) };
    if (body != null) init.body = body;
    const res = await fetch(url, init);
    return await res.text();
}

// app.post(url, headers, data = form map) — form-urlencoded body.
async function httpPostForm(url, data, opts) {
    opts = opts || {};
    const parts = [];
    for (const k of Object.keys(data || {})) {
        parts.push(javaUrlEncode(k) + "=" + javaUrlEncode(data[k]));
    }
    const headers = Object.assign({}, opts.headers || {});
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
    return await httpPostText(url, parts.join("&"), { headers, redirect: opts.redirect });
}

function loadDoc(html) {
    if (!cheerio) return null;
    return cheerio.load(html == null ? "" : String(html));
}

async function httpGetDoc(url, opts) {
    const text = await httpGetText(url, opts);
    return loadDoc(text);
}

function scriptTexts($) {
    const out = [];
    if (!$) return out;
    $("script").each((i, el) => {
        const d = $(el).html();
        if (d) out.push(d);
    });
    return out;
}

// Find the first <script> whose data contains the given text (jsoup :containsData).
function scriptContaining($, needle) {
    const scripts = scriptTexts($);
    for (const t of scripts) {
        if (t.includes(needle)) return t;
    }
    return null;
}

function makeLink(source, name, url, type, opts) {
    opts = opts || {};
    return {
        source: source,
        name: name,
        url: url,
        type: type || "infer",
        referer: opts.referer || "",
        headers: opts.headers || {},
        quality: opts.quality != null ? opts.quality : Q_UNKNOWN,
        subtitles: opts.subtitles || [],
    };
}

function inferType(url) {
    const u = String(url || "").toLowerCase();
    if (u.includes(".m3u8")) return "m3u8";
    return "video";
}

// ---------------------------------------------------------------------------
// CloudStream base-class / built-in extractors (not part of the .cs3 file;
// re-implemented from their standard public CloudStream behaviour)
// ---------------------------------------------------------------------------

// Shared by Vidhide / StreamWish / FileMoon / Filesim: fetch the embed page,
// unpack the p.a.c.k.e.d script and take the "file:" source, plus any
// caption tracks declared next to it.
async function packedFileExtractor(inst, url, referer, emit, emitSub) {
    const $ = await httpGetDoc(url, { headers: { "Referer": referer || "", "User-Agent": DESKTOP_UA } });
    if (!$) return;
    let unpacked = "";
    for (const t of scriptTexts($)) {
        const u = unpackJs(t);
        if (u) unpacked += "\n" + u;
    }
    if (!unpacked) return;
    const m = /file\s*:\s*"([^"]+)"/.exec(unpacked) || /file\s*:\s*'([^']+)'/.exec(unpacked);
    if (m) {
        emit(makeLink(inst.name, inst.name, m[1], "m3u8", { referer: originOf(url) + "/" }));
    }
    // Caption tracks: {"file":"...","label":"...","kind":"captions", ...} in any key order.
    const trackRe = /\{[^{}]*"kind"\s*:\s*"captions"[^{}]*\}/g;
    let tm;
    while ((tm = trackRe.exec(unpacked)) !== null) {
        const fm = /"file"\s*:\s*"([^"]+)"/.exec(tm[0]);
        const lm = /"label"\s*:\s*"([^"]+)"/.exec(tm[0]);
        if (fm) emitSub({ language: lm ? lm[1] : "Unknown", url: fm[1] });
    }
}

// Vidmoly (CloudStream base class) — instances: Vidmolynet, VidmolyBiz.
async function vidmolyGetUrl(inst, url, referer, emit, emitSub) {
    const text = await httpGetText(url, {
        headers: {
            "User-Agent": DESKTOP_UA,
            "Referer": referer || inst.mainUrl,
            "Sec-Fetch-Dest": "iframe",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "cross-site",
        },
    });
    if (!text) return;
    const m = /file\s*:\s*"([^"]+\.m3u8[^"]*)"/.exec(text) || /file\s*:\s*'([^']+\.m3u8[^']*)'/.exec(text);
    if (!m) return;
    const origin = originOf(url);
    emit(makeLink(inst.name, inst.name, m[1], "m3u8", {
        referer: origin + "/",
        headers: { "Referer": origin + "/", "Origin": origin, "User-Agent": DESKTOP_UA },
    }));
}

// StreamWishExtractor (CloudStream base class) — instances: Cdnwish ("Streamwish"),
// Multimovies ("Multimovies Cloud").
async function streamWishGetUrl(inst, url, referer, emit, emitSub) {
    await packedFileExtractor(inst, url, referer, emit, emitSub);
}

// VidhideExtractor (CloudStream base class) — instance: Animezia.
// VidHidePro is the same flow under its own name/mainUrl (used by GDMirrorbot routing).
async function vidhideGetUrl(inst, url, referer, emit, emitSub) {
    await packedFileExtractor(inst, url, referer, emit, emitSub);
}

// VidStack (CloudStream base class) — instances: Cloudy, vidcloudupns, and the
// default instance GDMirrorbot routes UpnShare/RpmShare/StreamP2p links to.
// Mirrors the player/index.php "getVideo" flow that AWSStream (in the .cs3) also uses,
// with the POST base taken from the embed URL's own host, like CloudStream's VidStack.
async function vidStackGetUrl(inst, url, referer, emit, emitSub) {
    const hash = String(url).replace(/\/+$/, "").split("/").pop().split("?")[0].split("#")[0];
    const base = originOf(url);
    const doc = await httpGetDoc(url, {});
    const postUrl = base + "/player/index.php?data=" + hash + "&do=getVideo";
    const respText = await httpPostForm(postUrl, { hash: hash, r: referer || base }, {
        headers: { "x-requested-with": "XMLHttpRequest" },
    });
    let json = null;
    try { json = JSON.parse(respText); } catch (e) { json = null; }
    const m3u8 = json != null ? (json.videoSource != null ? json.videoSource : json.securedLink) : null;
    if (m3u8 != null) {
        emit(makeLink(inst.name, inst.name, m3u8, "m3u8", { referer: base + "/", quality: Q_UNKNOWN }));
    }
    if (doc) {
        const extractedPack = scriptContaining(doc, "function(p,a,c,k,e,d)") || "";
        if (!isBlank(extractedPack)) {
            const unpacked = unpackJs(extractedPack);
            if (unpacked != null) {
                const sm = /"kind":\s*"captions"\s*,\s*"file":\s*"(https.*?\.(?:srt|vtt))/.exec(unpacked);
                if (sm) emitSub({ language: "English", url: sm[1] });
            }
        }
    }
}

// FileMoon (CloudStream built-in).
async function fileMoonGetUrl(inst, url, referer, emit, emitSub) {
    await packedFileExtractor(inst, url, referer, emit, emitSub);
}

// Filesim (CloudStream base class) — instance: FileMoonNL ("FileMoon").
async function filesimGetUrl(inst, url, referer, emit, emitSub) {
    await packedFileExtractor(inst, url, referer, emit, emitSub);
}

// FilemoonV2 (CloudStream built-in): the /e/ page embeds the player in an iframe;
// the player page carries the packed script with the m3u8 source.
async function filemoonV2GetUrl(inst, url, referer, emit, emitSub) {
    let $ = await httpGetDoc(url, { headers: { "Referer": referer || "", "User-Agent": DESKTOP_UA } });
    if (!$) return;
    const iframe = $("iframe").first();
    const src = iframe && iframe.length ? iframe.attr("src") : null;
    if (!isBlank(src)) {
        const playerUrl = src.startsWith("http") ? src : originOf(url) + (src.startsWith("/") ? "" : "/") + src;
        const $2 = await httpGetDoc(playerUrl, { headers: { "Referer": url, "User-Agent": DESKTOP_UA } });
        if ($2) $ = $2;
    }
    let unpacked = "";
    for (const t of scriptTexts($)) {
        const u = unpackJs(t);
        if (u) unpacked += "\n" + u;
    }
    const m = /file\s*:\s*"([^"]+)"/.exec(unpacked);
    if (m) {
        emit(makeLink(inst.name, inst.name, m[1], "m3u8", { referer: originOf(url) + "/" }));
    }
}

// Krakenfiles (CloudStream built-in).
async function krakenfilesGetUrl(inst, url, referer, emit, emitSub) {
    const html = await httpGetText(url, { headers: { "Referer": referer || "", "User-Agent": DESKTOP_UA } });
    if (!html) return;
    let link = null;
    const $ = loadDoc(html);
    if ($) {
        link = $("video source").attr("src") || $("video").attr("src") || null;
    }
    if (isBlank(link)) {
        const m = /<source[^>]+src="(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/.exec(html);
        if (m) link = m[1];
    }
    if (isBlank(link) && $) {
        let unpacked = "";
        for (const t of scriptTexts($)) {
            const u = unpackJs(t);
            if (u) unpacked += "\n" + u;
        }
        const m = /file\s*:\s*"([^"]+)"/.exec(unpacked);
        if (m) link = m[1];
    }
    if (!isBlank(link)) {
        emit(makeLink(inst.name, inst.name, link, inferType(link), { referer: originOf(url) + "/" }));
    }
}

// StreamTape (CloudStream built-in): the real link is assembled by the page's
// own script into #robotlink (a static part plus a substring of a token string).
async function streamTapeGetUrl(inst, url, referer, emit, emitSub) {
    const html = await httpGetText(url, { headers: { "Referer": referer || "", "User-Agent": DESKTOP_UA } });
    if (!html) return;
    const $ = loadDoc(html);
    if (!$) return;
    let full = null;
    for (const t of scriptTexts($)) {
        if (!t.includes("robotlink")) continue;
        const m = /innerHTML\s*=\s*'([^']*)'\s*\+\s*\('([^']*)'\)\.substring\((\d+)\)(?:\.substring\((\d+)\))?/.exec(t)
            || /innerHTML\s*=\s*"([^"]*)"\s*\+\s*\('([^']*)'\)\.substring\((\d+)\)(?:\.substring\((\d+)\))?/.exec(t);
        if (m) {
            let tail = m[2].substring(parseInt(m[3], 10));
            if (m[4] != null) tail = tail.substring(parseInt(m[4], 10));
            full = m[1] + tail;
            break;
        }
    }
    let link = null;
    if (full) {
        link = full.startsWith("http") ? full : "https:" + (full.startsWith("//") ? full : "//" + full);
    } else {
        const robot = $("#robotlink").text().trim();
        if (robot.includes("get_video")) {
            link = robot.startsWith("http") ? robot : "https://" + robot.replace(/^\/+/, "");
        }
    }
    if (link) {
        emit(makeLink(inst.name, inst.name, link, "video", { referer: originOf(url) + "/" }));
    }
}

// Voe (CloudStream built-in): the embed page carries an obfuscated token that
// decodes (ROT13 -> junk-stripping -> Base64 -> char shift -3 -> reverse ->
// Base64) to a JSON object with the direct "source".
function rot13Str(s) {
    return s.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
}

async function voeGetUrl(inst, url, referer, emit, emitSub) {
    const html = await httpGetText(url, { headers: { "Referer": referer || "", "User-Agent": DESKTOP_UA } });
    if (!html) return;
    const m = /(?:var|const|let)\s+\w+\s*=\s*'([A-Za-z0-9+/=]{80,})'/.exec(html)
        || /'([A-Za-z0-9+/=]{120,})'/.exec(html);
    if (!m) return;
    try {
        let a = rot13Str(m[1]);
        for (const junk of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) {
            a = a.split(junk).join("");
        }
        a = base64Decode(a);
        a = a.split("").map((ch) => String.fromCharCode(ch.charCodeAt(0) - 3)).join("");
        a = a.split("").reverse().join("");
        a = base64Decode(a);
        const json = JSON.parse(a);
        const srcUrl = json.source || json.file;
        if (srcUrl) {
            emit(makeLink(inst.name, inst.name, srcUrl, inferType(srcUrl), { referer: originOf(url) + "/" }));
        }
    } catch (e) {
        // undecodable token — no link, exactly like a failed extraction in CloudStream
    }
}

// ---------------------------------------------------------------------------
// Extractors from the .cs3 DEX (ported method-for-method)
// ---------------------------------------------------------------------------

// StreamRuby (DEX) — mainUrl https://rubystm.com
async function streamRubyGetUrl(inst, url, referer, emit, emitSub) {
    const cleanedUrl = String(url).split("/e").join("");
    // Conversion fix: streamruby binds its playlist token to the exact
    // User-Agent that fetched the player page (verified live: same UA ->
    // 200, any other UA -> 403). In CloudStream the scraper and the player
    // share one HTTP stack UA, so the original never had to pin it; in
    // Nuvio they differ, so the page is fetched with DESKTOP_UA and the
    // same UA is sent to the player in the link headers below.
    const $ = await httpGetDoc(cleanedUrl, {
        headers: { "X-Requested-With": "XMLHttpRequest", "User-Agent": DESKTOP_UA },
    });
    if (!$) return;
    // jsoup: selectFirst("script:containsData(vplayer)")
    const data = scriptContaining($, "vplayer") || "";
    const headers = {
        "Accept": "*/*",
        "Connection": "keep-alive",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "Origin": cleanedUrl,
        "User-Agent": DESKTOP_UA,
    };
    let m = /file:"(.*)"/.exec(data);
    if (!m) {
        // Conversion addition (site drift): rubystm now serves its vplayer
        // script Dean Edwards packed, so the file:"..." pattern only exists
        // after unpacking the script.
        const unpacked = unpackJs(data);
        if (unpacked) m = /file:"([^"]*)"/.exec(unpacked);
    }
    if (!m || m[1] == null) return;
    emit(makeLink(inst.name, inst.name, m[1], "infer", {
        referer: inst.mainUrl,
        quality: 1080,
        headers: headers,
    }));
}

// AWSStream (DEX) — base of ascdn21 / ascdn26 (both named "Zephyrflick").
async function awsStreamGetUrl(inst, url, referer, emit, emitSub) {
    const extractedHash = substringBefore(substringBefore(substringAfterLast(String(url).replace(/\/+$/, ""), "/"), "?"), "#");
    const doc = await httpGetDoc(url, {});
    const m3u8Url = inst.mainUrl + "/player/index.php?data=" + extractedHash + "&do=getVideo";
    const header = { "x-requested-with": "XMLHttpRequest" };
    const formdata = { hash: extractedHash, r: referer != null ? referer : inst.mainUrl };
    const respText = await httpPostForm(m3u8Url, formdata, { headers: header });
    let response = null;
    try { response = JSON.parse(respText); } catch (e) { response = null; }
    const m3u8 = response != null ? (response.videoSource != null ? response.videoSource : response.securedLink) : null;
    if (m3u8 != null) {
        emit(makeLink(inst.name, inst.name, m3u8, "m3u8", {
            referer: inst.mainUrl + "/",
            quality: Q_UNKNOWN,
        }));
    }
    if (doc) {
        const extractedPack = scriptContaining(doc, "function(p,a,c,k,e,d)") || "";
        if (!isBlank(extractedPack)) {
            const unpacked = unpackJs(extractedPack);
            if (unpacked != null) {
                const sm = /"kind":\s*"captions"\s*,\s*"file":\s*"(https.*?\.(?:srt|vtt))/.exec(unpacked);
                if (sm) emitSub({ language: "English", url: sm[1] });
            }
        }
    }
}

// Abyass (DEX) — instances: Abyass (https://abyssplayer.com), Short (https://short.icu),
// AbyssPlayer (https://player.abyssplayer.com, display name also "Abyass").
async function abyassGetUrl(inst, url, referer, emit, emitSub) {
    let handled = false;
    if (String(url).includes("data=")) {
        try {
            const decode = javaUrlDecode(substringBefore(substringAfter(String(url), "data="), "&"));
            const jSONArray = JSON.parse(base64Decode(decode));
            const optJSONObject = Array.isArray(jSONArray) && jSONArray.length > 0 ? jSONArray[0] : null;
            if (optJSONObject == null || !("language" in optJSONObject) || !("link" in optJSONObject)) {
                throw new Error("Failed requirement.");
            }
            const pairs = [];
            for (let idx = 0; idx < jSONArray.length; idx++) {
                const jSONObject = jSONArray[idx];
                const language = jSONObject.language != null ? String(jSONObject.language) : "Unknown";
                const link = String(jSONObject.link != null ? jSONObject.link : "").split("\\/").join("/");
                if (!isBlank(link)) pairs.push([language, link]);
            }
            await Promise.all(pairs.map((pair) => abyassHandledPair(inst, pair[0], pair[1], referer, emit, emitSub)));
            handled = true;
        } catch (e) {
            handled = false;
        }
    }
    if (!handled) {
        await abyassMain(inst, url, referer, emit, emitSub);
    }
}

async function abyassHandledPair(inst, language, link, referer, emit, emitSub) {
    const fixedLink = link.split("https://short.icu").join("https://abyssplayer.com");
    const collected = [];
    await abyassGetUrl(inst, fixedLink, referer, (l) => collected.push(l), emitSub);
    for (const extLink of collected) {
        emit(Object.assign({}, extLink, { name: extLink.name + " [" + language + "]" }));
    }
}

async function abyassMain(inst, url, referer, emit, emitSub) {
    const fixedUrl = String(url).split("https://short.icu").join("https://abyssplayer.com");
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Origin": "https://playhydrax.com",
        "Referer": "https://playhydrax.com/",
    };
    const document = await httpGetDoc(fixedUrl, { headers: headers });
    if (!document) return;
    const scriptsText = scriptTexts(document).join("\n");
    const m = /const\s+datas\s*=\s*"([^"]*)"/.exec(scriptsText);
    if (!m || m[1] == null) return;
    const datas = m[1];
    const body = "{\n    \"text\": \"" + datas + "\"\n}";
    const postHeaders = Object.assign({}, headers, { "Content-Type": "application/json" });
    const respText = await httpPostText("https://enc-dec.app/api/dec-abyss", body, { headers: postHeaders });
    let abyssResponse = null;
    try { abyssResponse = JSON.parse(respText); } catch (e) { abyssResponse = null; }
    if (abyssResponse == null || abyssResponse.result == null) return;
    const sources = (abyssResponse.result.sources || []).filter(
        (s) => s != null && s.status && !isBlank(s.url)
    );
    for (const s of sources) {
        // Site behaviour (found 2026-10-23): a dec-abyss source URL is not
        // the file itself — it answers 302 to a rotating mirror host, and
        // players that drop custom headers across a cross-host redirect
        // (or mishandle the redirect) fail to play these streams even
        // though the link is valid — Abyss streams failed in the app on
        // phone and TV while direct-link servers played. Resolve the
        // redirect here, on the same device/IP the player will use, and
        // hand over the final URL plus the Referer and the exact
        // User-Agent this extractor used, mirroring the StreamRuby fix.
        let finalUrl = s.url;
        try {
            const rr = await httpGetRes(s.url, { headers: headers, redirect: "manual" });
            const loc = rr && rr.status >= 300 && rr.status < 400 && typeof rr.headers.get === "function"
                ? rr.headers.get("location") : null;
            if (!isBlank(loc)) {
                if (loc.startsWith("http")) {
                    finalUrl = loc;
                } else if (loc.startsWith("/")) {
                    const origin = /^https?:\/\/[^/]+/.exec(s.url);
                    if (origin) finalUrl = origin[0] + loc;
                }
            }
        } catch (e) {
            // Keep the original URL — the player may still follow it.
        }
        emit(makeLink(inst.name, inst.name + " [" + String(s.codec).toUpperCase() + "]", finalUrl, "infer", {
            quality: getQualityFromName(s.type),
            referer: "https://playhydrax.com/",
            headers: { "Referer": "https://playhydrax.com/", "User-Agent": headers["User-Agent"] },
        }));
    }
}

// AnimedekhoEmbed (DEX) — mainUrl https://animedekho.tv/embed
async function animedekhoEmbedGetUrl(inst, url, referer, emit, emitSub) {
    const doc = await httpGetDoc(url, {
        headers: { "Referer": referer != null ? referer : "https://animedekho.tv/" },
    });
    if (!doc) return;
    const iframe = doc("iframe[src]").first();
    const iframeSrc = iframe && iframe.length ? iframe.attr("src") : null;
    if (isBlank(iframeSrc)) return;
    await loadExtractor(iframeSrc, url, emit, emitSub);
}

// Animedekhoco (DEX) — mainUrl https://animedekho.co
async function animedekhocoGetUrl(inst, url, referer, emit, emitSub) {
    if (!String(url).includes("url=")) return;
    const doc = await httpGetDoc(url, {});
    const text = await httpGetText(url, {});
    const links = [];
    if (doc) {
        doc("select#serverSelector option").each((i, option) => {
            const link = doc(option).attr("value");
            let name = doc(option).text();
            if (isBlank(name)) name = "Unknown";
            if (!isBlank(link)) links.push([name, link]);
        });
    }
    if (text != null) {
        const m = /file\s*:\s*"([^"]+)"/.exec(text);
        if (m && m[1] != null) links.push(["Player File", m[1]]);
    }
    for (const pair of links) {
        emit(makeLink(pair[0], pair[0], pair[1], "infer", {
            referer: inst.mainUrl,
            quality: Q_UNKNOWN,
        }));
    }
}

// AnimeworldMirror (DEX) — mainUrl https://animeworld.site/mirror, requiresReferer
async function animeworldMirrorGetUrl(inst, url, referer, emit, emitSub) {
    const doc = await httpGetDoc(url, {
        headers: { "Referer": referer != null ? referer : "https://animedekho.tv/" },
    });
    if (!doc) return;
    const options = doc("select#serverSelect option").toArray();
    for (const optionEl of options) {
        const option = doc(optionEl);
        const link = (option.attr("value") || "").trim();
        if (isBlank(link)) continue;
        let serverName = option.attr("data-server");
        if (isBlank(serverName)) serverName = option.text();
        const lower = String(serverName).toLowerCase();
        if (lower.includes("rpm") || lower.includes("p2p")) {
            continue;
        } else if (lower.includes("upn")) {
            continue;
        } else {
            if (!lower.includes("hg")) {
                try {
                    if (!lower.includes("earn")) {
                        await loadExtractor(link, url, emit, emitSub);
                    }
                } catch (e) {
                    // per-option failures are swallowed by the original
                }
            }
        }
    }
}

// Blakiteapi (DEX) — mainUrl https://blakiteapi.xyz
function blakiteQualityFromString(q) {
    const s = String(q == null ? "" : q).toLowerCase();
    if (s.includes("1080")) return 1080;
    if (s.includes("720")) return 720;
    if (s.includes("480")) return 480;
    if (s.includes("360")) return 360;
    return Q_UNKNOWN;
}

async function blakiteapiGetUrl(inst, url, referer, emit, emitSub) {
    const apiurl = inst.mainUrl + "/api/get.php?id=" + substringAfterLast(String(url), "/")
        + "&tmdbId=" + substringBefore(substringAfter(String(url), "embed/"), "/");
    const responseText = await httpGetText(apiurl, {});
    const json = JSON.parse(responseText);
    if (!json.success) return;
    const data = json.data;
    const quality = data.quality != null ? String(data.quality) : "480p";
    const format = data.format != null ? String(data.format) : "MP4";
    const dataId = data.dataId != null ? String(data.dataId) : "";
    const streamUrl = inst.mainUrl + "/stream/" + dataId + "." + format;
    emit(makeLink(inst.name, inst.name, streamUrl, "infer", {
        quality: blakiteQualityFromString(quality),
    }));
}

// DekhoVidSrc (DEX) — mainUrl https://animedekho.tv/aaa/get/play.php
async function dekhoVidSrcGetUrl(inst, url, referer, emit, emitSub) {
    const respText = await httpGetText(String(url) + "&fetch=1", {
        headers: { "Referer": referer != null ? referer : inst.mainUrl },
    });
    let json = null;
    try { json = JSON.parse(respText); } catch (e) { json = null; }
    if (json == null || json.results == null) return;
    const results = json.results;
    for (const key of ["instant_dl", "cloud_r2", "direct_mgt"]) {
        const source = results[key];
        if (source == null || source.url == null) continue;
        const link = source.url;
        if (!String(link).startsWith("http")) continue;
        emit(makeLink(inst.name, inst.name, link, "video", {
            quality: Q_UNKNOWN,
            referer: "https://animedekho.tv/",
        }));
    }
}

// NeoCDN (DEX) — mainUrl https://animedekho.tv/aaa/myth
async function neoCDNGetUrl(inst, url, referer, emit, emitSub) {
    if (!String(url).includes("/aaa/myth/play.php") && !String(url).includes("/aaa/myth/play2.php")) return;
    const pageText = await httpGetText(url, {
        headers: { "Referer": referer != null ? referer : "https://animedekho.tv/" },
    });
    if (!pageText) return;
    const fetchMatch = /fetch\s*\(\s*["']([^"']*fetch\.php[^"']*)["']/.exec(pageText);
    if (!fetchMatch || fetchMatch[1] == null) return;
    const fetchPath = fetchMatch[1];
    const workerMatch = /const\s+worker\s*=\s*["']([^"']*)["']/.exec(pageText);
    const worker = workerMatch && workerMatch[1] != null ? workerMatch[1] : "";
    const fetchUrl = fetchPath.startsWith("http")
        ? fetchPath
        : "https://animedekho.tv" + (fetchPath.startsWith("/") ? "" : "/") + fetchPath;
    const respText = await httpGetText(fetchUrl, { headers: { "Referer": url } });
    let json = null;
    try { json = JSON.parse(respText); } catch (e) { json = null; }
    if (json == null || json.sources == null) return;
    for (const s of json.sources) {
        const finalStream = isBlank(worker) ? s.url : worker + javaUrlEncode(s.url);
        emit(makeLink(inst.name, inst.name, finalStream, "video", {
            quality: getQualityFromName(s.type),
        }));
    }
}

// Ravok (DEX) — mainUrl https://ravok.buzz; same getVideo flow as AWSStream,
// plus a master-playlist quality probe.
async function ravokGetUrl(inst, url, referer, emit, emitSub) {
    const hash = substringBefore(substringBefore(substringAfterLast(String(url).replace(/\/+$/, ""), "/"), "?"), "#");
    let response = null;
    try {
        const postUrl = inst.mainUrl + "/player/index.php?data=" + hash + "&do=getVideo";
        const respText = await httpPostForm(postUrl, { hash: hash, r: referer != null ? referer : inst.mainUrl }, {
            headers: { "x-requested-with": "XMLHttpRequest" },
        });
        response = JSON.parse(respText);
    } catch (e) {
        response = null;
    }
    if (response == null) return;
    const master = response.videoSource != null ? response.videoSource : response.securedLink;
    if (master == null) return;
    let quality = Q_UNKNOWN;
    try {
        const masterText = await httpGetText(master, { headers: { "Referer": inst.mainUrl + "/" } });
        const nameRe = /NAME="(\d{3,4})p"/g;
        let mm;
        let max = null;
        while ((mm = nameRe.exec(masterText)) !== null) {
            const v = toIntOrNull(mm[1]);
            if (v != null && (max == null || v > max)) max = v;
        }
        quality = max != null ? max : Q_UNKNOWN;
    } catch (e) {
        quality = Q_UNKNOWN;
    }
    emit(makeLink(inst.name, inst.name, master, "m3u8", {
        referer: inst.mainUrl + "/",
        quality: quality,
    }));
}

// Gofile (DEX) — mainUrl https://gofile.io, API https://api.gofile.io
async function gofileGetUrl(inst, url, referer, emit, emitSub) {
    try {
        const m = /\/(?:\?c=|d\/)([\da-zA-Z-]+)/.exec(String(url));
        if (!m || m[1] == null) return;
        const id = m[1];
        const accountText = await httpPostText(inst.apiUrl + "/accounts", null, {});
        const token = JSON.parse(accountText).data.token;
        const globalJs = await httpGetText(inst.mainUrl + "/dist/js/global.js", {});
        const wtMatch = /appdata\.wt\s*=\s*["']([^"']+)["']/.exec(globalJs || "");
        if (!wtMatch || wtMatch[1] == null) return;
        const wt = wtMatch[1];
        const fileText = await httpGetText(inst.apiUrl + "/contents/" + id + "?wt=" + wt, {
            headers: { "Authorization": "Bearer " + token },
        });
        const fileDataJson = JSON.parse(fileText);
        const data = fileDataJson.data;
        const children = data.children;
        const firstFileId = Object.keys(children)[0];
        const fileObj = children[firstFileId];
        const link = fileObj.link;
        const fileName = fileObj.name;
        const fileSize = fileObj.size;
        // NOTE: the size branches below reproduce the original code exactly,
        // including its swapped threshold behaviour (>= 1 GiB formats as MB).
        const sizeFormatted = fileSize >= 1073741824
            ? ((fileSize / 1024.0) / 1024.0).toFixed(2) + " MB"
            : (((fileSize / 1024.0) / 1024.0) / 1024.0).toFixed(2) + " GB";
        const qm = /(\d{3,4})[pP]/.exec(fileName || "");
        emit(makeLink("Gofile", "Gofile [" + sizeFormatted + "]", link, "infer", {
            quality: qm ? parseInt(qm[1], 10) : Q_UNKNOWN,
            headers: { "Cookie": "accountToken=" + token },
        }));
    } catch (e) {
        console.error("Gofile: Error occurred: " + (e && e.message != null ? e.message : e));
    }
}

// DekhoHubCloud (DEX) — name "HubCloud", mainUrl https://hubcloud.*
async function hubCloudEmit(emit, labelExtras, quality, server, link) {
    emit(makeLink("HubCloud " + server, "HubCloud " + server + labelExtras, link, "video", {
        quality: quality,
    }));
}

async function hubCloudButton(btn, $, labelExtras, quality, emit, emitSub) {
    const link = btn.attr("href");
    const text = btn.text();
    const containsIc = (s, sub) => String(s).toLowerCase().includes(sub.toLowerCase());
    if (containsIc(text, "FSL Server")) {
        await hubCloudEmit(emit, labelExtras, quality, "[FSL Server]", link);
        return;
    }
    if (containsIc(text, "FSLv2")) {
        await hubCloudEmit(emit, labelExtras, quality, "[FSLv2]", link);
        return;
    }
    if (containsIc(text, "Download File")) {
        await hubCloudEmit(emit, labelExtras, quality, "[Download]", link);
        return;
    }
    if (!containsIc(text, "BuzzServer")) {
        if (containsIc(text, "pixeldra") || containsIc(text, "pixel")) {
            const base = baseUrlOf(link);
            const finalURL = containsIc(link, "download")
                ? link
                : base + "/api/file/" + substringAfterLast(link, "/") + "?download";
            await hubCloudEmit(emit, labelExtras, quality, "[Pixeldrain]", finalURL);
            return;
        }
        if (containsIc(text, "S3 Server")) {
            await hubCloudEmit(emit, labelExtras, quality, "[S3 Server]", link);
            return;
        }
        if (!containsIc(text, "Mega Server")) {
            await loadExtractor(link, "", emit, emitSub);
            return;
        }
        await hubCloudEmit(emit, labelExtras, quality, "[Mega Server]", link);
        return;
    }
    // BuzzServer: the direct link is handed back in the hx-redirect response header.
    let dlink = "";
    try {
        const buzzResp = await httpGetRes(link + "/download", { headers: { "Referer": link } });
        const hx = buzzResp.headers.get("hx-redirect");
        dlink = hx != null ? hx : "";
    } catch (e) {
        dlink = "";
    }
    if (!isBlank(dlink)) {
        await hubCloudEmit(emit, labelExtras, quality, "[BuzzServer]", dlink);
    }
}

async function dekhoHubCloudGetUrl(inst, url, referer, emit, emitSub) {
    let href = null;
    try {
        if (String(url).includes("hubcloud.php")) {
            href = url;
        } else {
            const firstDoc = await httpGetDoc(url, {});
            const rawHref = firstDoc ? (firstDoc("#download").attr("href") || "") : "";
            if (/^http/i.test(rawHref)) {
                href = rawHref;
            } else {
                href = baseUrlOf(url).replace(/\/$/, "") + "/" + rawHref.replace(/^\//, "");
            }
        }
    } catch (e) {
        href = null;
    }
    if (href == null || isBlank(href)) return;
    let document = null;
    try {
        document = await httpGetDoc(href, {});
    } catch (e) {
        document = null;
    }
    if (document == null) return;
    const sizeEl = document("i#size").first();
    const size = sizeEl && sizeEl.length ? sizeEl.text() : "";
    const headerEl = document("div.card-header").first();
    const header = headerEl && headerEl.length ? headerEl.text() : "";
    const headerDetails = header.replace(/\.[a-zA-Z0-9]{2,4}$/, "").trim();
    let labelExtras = "";
    if (headerDetails.length > 0) labelExtras += " [" + headerDetails + "]";
    if (size.length > 0) labelExtras += " [" + size + "]";
    const qm = /(\d{3,4})[pP]/.exec(header);
    const quality = qm ? parseInt(qm[1], 10) : 2160;
    const buttons = document("div.card-body h2 a.btn").toArray();
    await Promise.all(buttons.map((el) => hubCloudButton(document(el), document, labelExtras, quality, emit, emitSub)));
}

// GDFlix (DEX) — mainUrl https://*.gdflix.*
async function gdflixGetLatestBaseUrl(baseUrl) {
    try {
        const text = await httpGetText("https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json", {});
        let dynamicUrls = null;
        try { dynamicUrls = JSON.parse(text); } catch (e) { dynamicUrls = null; }
        if (dynamicUrls != null && dynamicUrls["gdflix"] != null && !isBlank(dynamicUrls["gdflix"])) {
            return dynamicUrls["gdflix"];
        }
        return baseUrl;
    } catch (e) {
        return baseUrl;
    }
}

function gdflixGetIndexQuality(str) {
    const m = /\b(2160|1440|1080|720|576|540|480)\s*[pP]\b/.exec(str == null ? "" : String(str));
    if (!m) return Q_UNKNOWN;
    const v = toIntOrNull(m[1]);
    return v != null ? v : Q_UNKNOWN;
}

function gdflixEmit(emit, name, labelExtras, quality, link, server) {
    const cleanLink = String(link == null ? "" : link).trim();
    if (isBlank(cleanLink)) return;
    const serverTag = String(server == null ? "" : server).trim();
    let displayName = name;
    if (serverTag.length > 0) displayName += " " + serverTag;
    displayName = (displayName + (labelExtras || "")).trim();
    let sourceName = name;
    if (serverTag.length > 0) sourceName = name + " " + serverTag;
    emit(makeLink(sourceName, displayName, cleanLink, "video", { quality: quality }));
}

async function gdflixButton(btn, $, ctx, emit, emitSub) {
    let text = btn.text();
    if (isBlank(text)) text = btn.find("a").text();
    const label = text.trim();
    const link = (btn.attr("href") || "").trim();
    if (isBlank(link)) return;
    const name = ctx.name;
    const containsIc = (s, sub) => String(s).toLowerCase().includes(sub.toLowerCase());

    if (containsIc(label, "FSL V2")) {
        gdflixEmit(emit, name, ctx.labelExtras, ctx.quality, link, "[FSL V2]");
        return;
    }
    if (containsIc(label, "DIRECT DL") || containsIc(label, "DIRECT SERVER")) {
        gdflixEmit(emit, name, ctx.labelExtras, ctx.quality, link, "[Direct]");
        return;
    }
    if (containsIc(label, "CLOUD DOWNLOAD")) {
        let resolved = link;
        if (link.includes("url=")) {
            try {
                resolved = javaUrlDecode(substringAfter(link, "url="));
            } catch (e) {
                resolved = link;
            }
        }
        gdflixEmit(emit, name, ctx.labelExtras, ctx.quality, resolved, "[Cloud]");
        return;
    }
    if (containsIc(label, "FAST CLOUD")) {
        try {
            const resolved = link.startsWith("http") ? link : ctx.baseUrl + link;
            const doc = await httpGetDoc(resolved, { headers: ctx.headers });
            let found = "";
            if (doc) {
                const el = doc("a:contains(Cloud Resume Download), div.card-body a, div.text-center a.btn-success, a.btn-success").first();
                found = el && el.length ? (el.attr("href") || "") : "";
            }
            if (isBlank(found)) return;
            gdflixEmit(emit, name, ctx.labelExtras, ctx.quality, found, "[FAST CLOUD]");
        } catch (e) {
            console.log("GDFlix FastCloud: " + e);
        }
        return;
    }
    if (!containsIc(label, "Instant DL")) {
        if (containsIc(link, "pixeldra") || containsIc(label, "pixeldra")) {
            const base = baseUrlOf(link);
            const finalURL = containsIc(link, "download")
                ? link
                : base + "/api/file/" + substringAfterLast(link, "/") + "?download";
            gdflixEmit(emit, name, ctx.labelExtras, ctx.quality, finalURL, "[Pixeldrain]");
            return;
        }
        if (containsIc(label, "GoFile")) {
            try {
                const doc = await httpGetDoc(link, { headers: ctx.headers });
                if (!doc) return;
                const anchors = doc("a[href*=\"gofile\"], .row .row a").toArray();
                for (const aEl of anchors) {
                    const href = doc(aEl).attr("href");
                    if (href != null && containsIc(href, "gofile")) {
                        await loadExtractor(href, link, emit, emitSub);
                    }
                }
            } catch (e) {
                console.log("Gofile: " + e);
            }
            return;
        }
        if (containsIc(label, "GD Index")) {
            const cfLink = link.startsWith("http") ? link : ctx.baseUrl + link;
            await Promise.all([1, 2].map(async (cfType) => {
                try {
                    const cfDoc = await httpGetDoc(cfLink + "?type=" + cfType, { headers: ctx.headers });
                    if (!cfDoc) return;
                    cfDoc("a.btn-success").each((i, b) => {
                        const source = cfDoc(b).attr("href");
                        if (!isBlank(source)) {
                            gdflixEmit(emit, name, ctx.labelExtras, ctx.quality, source, "[CF]");
                        }
                    });
                } catch (e) {
                    console.log("GDFlix CF: " + e);
                }
            }));
            return;
        }
        console.log("GDFlix: No server matched for: " + label);
        return;
    }
    // Instant DL: the direct link is the "url=" part of the redirect Location header.
    try {
        const res = await fetch(link, { method: "GET", headers: ctx.headers, redirect: "manual", signal: timeoutSignal(HTTP_TIMEOUT_MS) });
        const loc = res.headers.get("location") || res.headers.get("Location");
        const target = loc != null ? substringAfter(loc, "url=") : null;
        if (!isBlank(target)) {
            gdflixEmit(emit, name, ctx.labelExtras, ctx.quality, target, "[Instant Download]");
        }
    } catch (e) {
        console.log("Instant DL: " + e);
    }
}

async function gdflixGetUrl(inst, url, referer, emit, emitSub) {
    const baseRef = { value: baseUrlOf(url) };
    const latest = await gdflixGetLatestBaseUrl(baseRef.value);
    let finalUrl = url;
    if (!isBlank(baseRef.value) && !isBlank(latest) && baseRef.value !== latest) {
        finalUrl = String(url).split(baseRef.value).join(latest);
        baseRef.value = latest;
    }
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": baseRef.value + "/",
    };
    let document = null;
    try {
        document = await httpGetDoc(finalUrl, { headers: headers });
    } catch (e) {
        document = null;
    }
    if (document == null) return;
    const fileName = substringAfter(document("ul > li.list-group-item:contains(Name)").text(), "Name : ").trim();
    const size = substringBefore(substringAfter(document("ul > li.list-group-item:contains(Size)").text(), "Size : "), "|").trim();
    const quality = gdflixGetIndexQuality(fileName);
    let labelExtras = "";
    if (size.length > 0) labelExtras += " [" + size + "]";
    const ctx = { name: inst.name, labelExtras: labelExtras, quality: quality, headers: headers, baseUrl: baseRef.value };
    const buttons = document("div.text-center a").toArray();
    await Promise.all(buttons.map((el) => gdflixButton(document(el), document, ctx, emit, emitSub)));
}

// GDMirrorbot (DEX) — instances: GDMirrorbot (https://gdmirrorbot.nl) and
// Techinmind ("Techinmind Cloud AIO", https://stream.techinmind.space).
async function gdmirrorbotGetUrl(inst, url, referer, emit, emitSub) {
    let sid;
    let host;
    if (String(url).includes("key=")) {
        const pageText = await httpGetText(url, {});
        const finalIdM = /FinalID\s*=\s*"([^"]+)"/.exec(pageText || "");
        const finalId = finalIdM ? finalIdM[1] : null;
        const myKeyM = /myKey\s*=\s*"([^"]+)"/.exec(pageText || "");
        const myKey = myKeyM ? myKeyM[1] : null;
        const idTypeM = /idType\s*=\s*"([^"]+)"/.exec(pageText || "");
        const idType = idTypeM && idTypeM[1] != null ? idTypeM[1] : "imdbid";
        const baseUrlM = /let\s+baseUrl\s*=\s*"([^"]+)"/.exec(pageText || "");
        const baseUrl = baseUrlM && baseUrlM[1] != null ? baseUrlM[1] : url;
        host = baseUrlOf(baseUrl);
        if (finalId == null || myKey == null) return;
        let apiUrl;
        if (String(baseUrl).includes("/tv/")) {
            const seasonM = /\/tv\/\d+\/(\d+)\//.exec(baseUrl);
            const season = seasonM && seasonM[1] != null ? seasonM[1] : "1";
            const epM = /\/tv\/\d+\/\d+\/(\d+)/.exec(baseUrl);
            const epname = epM && epM[1] != null ? epM[1] : "1";
            apiUrl = inst.mainUrl + "/myseriesapi?tmdbid=" + finalId + "&season=" + season + "&epname=" + epname + "&key=" + myKey;
        } else {
            apiUrl = inst.mainUrl + "/mymovieapi?" + idType + "=" + finalId + "&key=" + myKey;
        }
        const apiText = await httpGetText(apiUrl, {});
        let fileslug = null;
        try {
            const rootObj = JSON.parse(apiText);
            const arr = rootObj ? rootObj.data : null;
            const first = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
            fileslug = first != null && first.fileslug != null ? String(first.fileslug) : null;
        } catch (e) {
            fileslug = null;
        }
        if (fileslug == null || isBlank(fileslug)) return;
        sid = fileslug;
    } else {
        sid = substringAfterLast(String(url), "embed/");
        const res = await httpGetRes(url, {});
        host = baseUrlOf(res.url || url);
    }
    const postData = { sid: sid };
    const responseText = await httpPostForm(host + "/embedhelper.php", postData, {});
    let root = null;
    try { root = JSON.parse(responseText); } catch (e) { root = null; }
    if (root == null) return;
    let siteUrls = {};
    let siteFriendlyNames = {};
    try { siteUrls = JSON.parse(root["siteUrls"] || "{}") || {}; } catch (e) { siteUrls = {}; }
    try { siteFriendlyNames = JSON.parse(root["siteFriendlyNames"] || "{}") || {}; } catch (e) { siteFriendlyNames = {}; }
    let decodedMresult = null;
    try {
        decodedMresult = JSON.parse(base64Decode(root["mresult"] != null ? root["mresult"] : ""));
    } catch (e) {
        console.error("Phisher: Failed to decode mresult: " + e);
        decodedMresult = null;
    }
    if (decodedMresult == null) return;
    const keys = Object.keys(siteUrls).filter((k) => Object.prototype.hasOwnProperty.call(decodedMresult, k));
    for (const key of keys) {
        const path = decodedMresult[key];
        const fullUrl = String(siteUrls[key]).replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
        const friendlyName = siteFriendlyNames[key];
        const base = referer != null ? referer : inst.mainUrl;
        console.log("Phisher: " + key + " " + friendlyName);
        try {
            if (key === "StreamHG" || key === "EarnVids") {
                await vidhideGetUrl(VIDHIDEPRO, fullUrl, base, emit, emitSub);
            } else if (key === "RpmShare" || key === "UpnShare" || key === "StreamP2p") {
                await vidStackGetUrl(VIDSTACK_DEFAULT, fullUrl, base, emit, emitSub);
            } else {
                await loadExtractor(fullUrl, base, emit, emitSub);
            }
        } catch (e) {
            console.error("Phisher: Failed to extract from " + friendlyName + " at " + fullUrl + ": " + e);
        }
    }
}

// ---------------------------------------------------------------------------
// Extractor registry — AnimeDekhoPlugin.load() registration order
// ---------------------------------------------------------------------------

const VIDHIDEPRO = { name: "VidHidePro", mainUrl: "https://vidhidepro.com", requiresReferer: true, getUrl: null };
VIDHIDEPRO.getUrl = (url, referer, emit, emitSub) => vidhideGetUrl(VIDHIDEPRO, url, referer, emit, emitSub);
const VIDSTACK_DEFAULT = { name: "VidStack", mainUrl: "https://vidstack.io", requiresReferer: true, getUrl: null };
VIDSTACK_DEFAULT.getUrl = (url, referer, emit, emitSub) => vidStackGetUrl(VIDSTACK_DEFAULT, url, referer, emit, emitSub);

function makeInstance(name, mainUrl, requiresReferer, fn) {
    const inst = { name: name, mainUrl: mainUrl, requiresReferer: !!requiresReferer, getUrl: null };
    inst.getUrl = (url, referer, emit, emitSub) => fn(inst, url, referer, emit, emitSub);
    return inst;
}

const EXTRACTORS = [
    makeInstance("StreamRuby", "https://rubystm.com", false, streamRubyGetUrl),
    makeInstance("Vidmoly", "https://vidmoly.net", true, vidmolyGetUrl),
    makeInstance("GDMirrorbot", "https://gdmirrorbot.nl", true, gdmirrorbotGetUrl),
    makeInstance("Techinmind Cloud AIO", "https://stream.techinmind.space", true, gdmirrorbotGetUrl),
    makeInstance("Streamwish", "https://cdnwish.com", true, streamWishGetUrl), // StreamWish base: requiresReferer
    makeInstance("Multimovies Cloud", "https://multimovies.cloud", true, streamWishGetUrl),
    makeInstance("FileMoon", "https://filemoon.sx", true, fileMoonGetUrl),
    makeInstance("FileMoon", "https://filemoon.nl", false, filesimGetUrl),
    makeInstance("Krakenfiles", "https://krakenfiles.com", false, krakenfilesGetUrl),
    makeInstance("Voe", "https://voe.sx", false, voeGetUrl),
    makeInstance("StreamTape", "https://streamtape.com", false, streamTapeGetUrl),
    makeInstance("FilemoonV2", "https://filemoon.to", true, filemoonV2GetUrl),
    makeInstance("Animezia", "https://animezia.cloud", true, vidhideGetUrl),
    makeInstance("VidStack", "https://cloudy.upns.one", true, vidStackGetUrl),
    makeInstance("VidStack", "https://vidcloud.upns.ink", true, vidStackGetUrl),
    makeInstance("Animedekhoco", "https://animedekho.co", false, animedekhocoGetUrl),
    makeInstance("Blakiteapi", "https://blakiteapi.xyz", false, blakiteapiGetUrl),
    makeInstance("Zephyrflick", "https://as-cdn21.top", true, awsStreamGetUrl),
    makeInstance("Zephyrflick", "https://as-cdn26.top", true, awsStreamGetUrl),
    makeInstance("Ravok", "https://ravok.buzz", false, ravokGetUrl),
    makeInstance("NeoCDN", "https://animedekho.tv/aaa/myth", false, neoCDNGetUrl),
    makeInstance("DekhoVidSrc", "https://animedekho.tv/aaa/get/play.php", false, dekhoVidSrcGetUrl),
    makeInstance("AnimeworldMirror", "https://animeworld.site/mirror", true, animeworldMirrorGetUrl),
    makeInstance("GDFlix", "https://*.gdflix.*", false, gdflixGetUrl),
    makeInstance("Gofile", "https://gofile.io", false, gofileGetUrl),
    makeInstance("HubCloud", "https://hubcloud.*", false, dekhoHubCloudGetUrl),
    makeInstance("Vidmoly", "https://vidmoly.biz", true, vidmolyGetUrl),
    makeInstance("AnimedekhoEmbed", "https://animedekho.tv/embed", false, animedekhoEmbedGetUrl),
    makeInstance("Abyass", "https://abyssplayer.com", true, abyassGetUrl),
    makeInstance("Short", "https://short.icu", true, abyassGetUrl),
    makeInstance("Abyass", "https://player.abyssplayer.com", true, abyassGetUrl),
];
// Gofile's API base (DEX: mainApi = "https://api.gofile.io")
for (const e of EXTRACTORS) {
    if (e.name === "Gofile") e.apiUrl = "https://api.gofile.io";
}

// CloudStream matches an extractor when the URL contains its mainUrl pattern
// ("*" acts as a wildcard, e.g. "https://*.gdflix.*", "https://hubcloud.*").
function extractorMatches(url, mainUrl) {
    const pattern = String(mainUrl).replace(/^https?:\/\//, "");
    const target = String(url).replace(/^https?:\/\//, "");
    if (pattern.includes("*")) {
        const re = new RegExp(pattern.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
        return re.test(target);
    }
    return target.includes(pattern);
}

// CloudStream ExtractorApiKt.loadExtractor(): runs the first registered
// extractor whose mainUrl matches the URL. Returns whether one matched.
async function loadExtractor(url, referer, emit, emitSub) {
    if (!url) return false;
    for (const ext of EXTRACTORS) {
        if (extractorMatches(url, ext.mainUrl)) {
            await ext.getUrl(url, referer != null ? referer : null, emit, emitSub);
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Shared site-resolution helpers (ports of AnimeDekhoProvider.search / load /
// toSearchResult and the trdekho helper used by HindiSubAnime and OnePace)
// ---------------------------------------------------------------------------

const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

// Nuvio hands providers a TMDB id; the CloudStream flow starts from a title
// search on the site, so the title is resolved through the TMDB API first.
async function tmdbDetails(tmdbId, mediaType) {
    const kind = mediaType === "movie" ? "movie" : "tv";
    try {
        const res = await fetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, { signal: timeoutSignal(HTTP_TIMEOUT_MS) });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

function tmdbTitle(details, mediaType) {
    if (!details) return null;
    if (mediaType === "movie") return details.title || details.original_title || null;
    return details.name || details.original_name || null;
}

// All the names TMDB knows the title by: primary, original, and the
// alternative-titles list. TMDB's primary name is not stable (TMDB id
// 30623 answered both "Shin Chan" and "Crayon Shin-chan" on the same day),
// and the site indexes posts under its own variants, so resolution
// searches with several of these.
async function tmdbTitles(tmdbId, mediaType, details) {
    const titles = [];
    const add = (t) => {
        if (!isBlank(t) && !titles.includes(t)) titles.push(t);
    };
    if (details) {
        if (mediaType === "movie") {
            add(details.title);
            add(details.original_title);
        } else {
            add(details.name);
            add(details.original_name);
        }
    }
    try {
        const kind = mediaType === "movie" ? "movie" : "tv";
        const res = await fetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/alternative_titles?api_key=" + TMDB_API_KEY, { signal: timeoutSignal(HTTP_TIMEOUT_MS) });
        if (res.ok) {
            const j = await res.json();
            const arr = (j && (j.titles || j.results)) || [];
            const alt = [];
            for (const t of arr) {
                const v = t && (t.title || t.name);
                if (!isBlank(v) && !alt.includes(v)) alt.push(v);
            }
            // The site indexes English/Latin titles; non-Latin alternatives
            // (Cyrillic, CJK, ...) cannot match anything there, so Latin
            // alternatives go first.
            const isLatin = (s) => !/[^\u0000-\u024F]/.test(s);
            for (const v of alt.filter(isLatin)) add(v);
            for (const v of alt.filter((s) => !isLatin(s))) add(v);
        }
    } catch (e) {
        // alternatives are best-effort; primary/original still apply
    }
    return titles.slice(0, 10);
}

// AnimeDekhoProvider.toSearchResult(a.dgt-card)
function cardToSearchResult($, card) {
    const href = $(card).attr("href");
    if (isBlank(href)) return null;
    const title = $(card).find("div.dgt-card__title").first().text();
    if (isBlank(title)) return null;
    const img = $(card).find("div.dgt-card__poster img").first();
    let poster = null;
    if (img && img.length) {
        const dataSrc = img.attr("data-src");
        poster = !isBlank(dataSrc) ? dataSrc : img.attr("src");
        if (poster != null && String(poster).includes("data:image")) poster = null;
    }
    return { url: href, poster: poster != null ? poster : null, title: title };
}

// AnimeDekhoProvider.search(): DGT suggest API first; empty or failed
// suggestions fall back to the HTML search page mapped through a.dgt-card.
async function searchSite(mainUrl, query) {
    const encoded = javaUrlEncode(query);
    let suggestions = null;
    try {
        const text = await httpGetText(mainUrl + "/wp-json/dgt/v1/suggest?q=" + encoded, {});
        const json = JSON.parse(text);
        const items = (json && json.items) || [];
        suggestions = [];
        for (const item of items) {
            if (item == null || isBlank(item.url) || isBlank(item.title)) continue;
            suggestions.push({ url: item.url, poster: item.poster != null ? item.poster : null, title: item.title, type: item.type != null ? item.type : null });
        }
    } catch (e) {
        console.error("AnimeDekho: Suggest search failed: " + e);
        suggestions = null;
    }
    if (suggestions == null) suggestions = [];
    if (suggestions.length === 0) {
        const $ = await httpGetDoc(mainUrl + "/?s=" + encoded, {});
        const out = [];
        if ($) {
            $("a.dgt-card").each((i, el) => {
                const r = cardToSearchResult($, el);
                if (r) out.push(r);
            });
        }
        return out;
    }
    return suggestions;
}

// AnimeDekhoProvider.load(): fetch the post page and read the DGT snapshot,
// external ids, season tabs — everything loadLinks later relies on.
async function loadPost(mainUrl, media) {
    const $ = await httpGetDoc(media.url, {});
    if (!$) return null;
    let snapshot = null;
    const snapEl = $("[data-snapshot]").first();
    if (snapEl && snapEl.length) {
        const raw = snapEl.attr("data-snapshot");
        if (raw) {
            try { snapshot = JSON.parse(raw); } catch (e) { snapshot = null; }
        }
    }
    const pickText = (sel) => {
        const el = $(sel).first();
        return el && el.length ? el.text().trim() : null;
    };
    let title = snapshot && !isBlank(snapshot.title) ? snapshot.title : null;
    if (title == null) title = pickText("span.dgt-titletext");
    if (title == null) title = pickText("div.dgt-muted");
    if (title == null) {
        const og = $("meta[property=og:title]").attr("content");
        title = !isBlank(og) ? og : "No Title";
    }
    const poster = snapshot && snapshot.poster != null ? snapshot.poster : media.poster;
    const backdrop = snapshot ? snapshot.backdrop : null;
    let plot = null;
    const overviewEl = $("p.dgt-overview").first();
    if (overviewEl && overviewEl.length && !isBlank(overviewEl.text().trim())) {
        plot = overviewEl.text().trim();
    }
    if (plot == null) {
        const ogd = $("meta[property=og:description]").last().attr("content");
        plot = ogd != null ? ogd : null;
    }
    const year = snapshot ? snapshot.year : null;
    const genres = snapshot ? snapshot.genres : null;
    const extId = (btnSel, re) => {
        const href = $("a." + btnSel).first().attr("href");
        if (!href) return null;
        const m = re.exec(href);
        return m ? toIntOrNull(m[1]) : null;
    };
    const tmdbId = extId("dgt-ext__btn--tmdb", /themoviedb\.org\/(?:tv|movie)\/(\d+)/);
    const malId = extId("dgt-ext__btn--mal", /myanimelist\.net\/anime\/(\d+)/);
    const anilistId = extId("dgt-ext__btn--anilist", /anilist\.co\/anime\/(\d+)/);
    let postId = snapshot && snapshot.id != null ? snapshot.id : null;
    if (postId == null) {
        const seriesEl = $("[data-series]").first();
        if (seriesEl && seriesEl.length) postId = toIntOrNull(seriesEl.attr("data-series"));
    }
    const seasons = [];
    const tabsEl = $("#dgt-season-tabs").first();
    if (tabsEl && tabsEl.length) {
        const rawTabs = tabsEl.attr("data-tabs");
        if (rawTabs) {
            try {
                const arr = JSON.parse(rawTabs);
                if (Array.isArray(arr)) {
                    for (const o of arr) {
                        if (o && typeof o.season === "number" && o.season > 0 && !seasons.includes(o.season)) {
                            seasons.push(o.season);
                        }
                    }
                    seasons.sort((a, b) => a - b);
                }
            } catch (e) {
                // malformed data-tabs — no seasons, like the original's runCatching
            }
        }
    }
    return {
        title: title,
        type: snapshot && snapshot.type != null ? snapshot.type : null,
        poster: poster != null ? poster : null,
        backdrop: backdrop != null ? backdrop : null,
        plot: plot,
        year: year != null ? year : null,
        genres: genres != null ? genres : null,
        tmdbId: tmdbId,
        malId: malId,
        anilistId: anilistId,
        postId: postId,
        seasons: seasons,
    };
}

// ---------------------------------------------------------------------------
// loadPostFast: the same fields load() extracts, read with plain string
// scans instead of a full DOM parse. The resolution path uses this: TV-class
// hardware (e.g. webOS) is slow at building DOMs over ~300 KB pages, and the
// fields needed (snapshot JSON, season tabs, external-id buttons) are all
// single attributes or anchors. It also keeps resolution working on hosts
// where the cheerio module is unavailable.
// ---------------------------------------------------------------------------

function htmlUnescape(s) {
    return String(s)
        .split("&quot;").join("\"")
        .split("&#039;").join("'")
        .split("&#39;").join("'")
        .split("&apos;").join("'")
        .split("&lt;").join("<")
        .split("&gt;").join(">")
        .split("&amp;").join("&");
}

function rawAttr(html, attr) {
    const m = new RegExp(attr + "=\"([^\"]*)\"").exec(html);
    return m ? htmlUnescape(m[1]) : null;
}

function metaContent(html, prop) {
    const tags = html.match(/<meta[^>]*>/g) || [];
    for (const tag of tags) {
        if (tag.includes("property=\"" + prop + "\"") || tag.includes("property='" + prop + "'")) {
            const m = /content="([^"]*)"/.exec(tag) || /content='([^']*)'/.exec(tag);
            if (m) return htmlUnescape(m[1]);
        }
    }
    return null;
}

function extIdFromHtml(html, btnClass, re) {
    const tagRe = /<a[^>]*>/g;
    let t;
    while ((t = tagRe.exec(html)) != null) {
        if (!t[0].includes(btnClass)) continue;
        const hm = /href="([^"]*)"/.exec(t[0]) || /href='([^']*)'/.exec(t[0]);
        if (!hm) return null;
        const m = re.exec(htmlUnescape(hm[1]));
        return m ? toIntOrNull(m[1]) : null;
    }
    return null;
}

async function loadPostFast(mainUrl, media) {
    let html = null;
    try {
        html = await httpGetText(media.url, {});
    } catch (e) {
        return null;
    }
    if (!html) return null;
    let snapshot = null;
    const snapRaw = rawAttr(html, "data-snapshot");
    if (snapRaw) {
        try { snapshot = JSON.parse(snapRaw); } catch (e) { snapshot = null; }
    }
    let title = snapshot && !isBlank(snapshot.title) ? snapshot.title : null;
    if (title == null) {
        const m = /<span[^>]*class="[^"]*dgt-titletext[^"]*"[^>]*>([^<]*)</.exec(html);
        if (m && !isBlank(m[1].trim())) title = m[1].trim();
    }
    if (title == null) {
        const m = /<div[^>]*class="[^"]*dgt-muted[^"]*"[^>]*>([^<]*)</.exec(html);
        if (m && !isBlank(m[1].trim())) title = m[1].trim();
    }
    if (title == null) {
        const og = metaContent(html, "og:title");
        title = !isBlank(og) ? og : "No Title";
    }
    const poster = snapshot && snapshot.poster != null ? snapshot.poster : media.poster;
    const backdrop = snapshot ? snapshot.backdrop : null;
    let plot = null;
    const pm = /<p[^>]*class="[^"]*dgt-overview[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    if (pm) {
        const txt = pm[1].split(/<[^>]*>/).join("").trim();
        if (!isBlank(txt)) plot = txt;
    }
    if (plot == null) plot = metaContent(html, "og:description");
    const year = snapshot ? snapshot.year : null;
    const genres = snapshot ? snapshot.genres : null;
    const tmdbId = extIdFromHtml(html, "dgt-ext__btn--tmdb", /themoviedb\.org\/(?:tv|movie)\/(\d+)/);
    const malId = extIdFromHtml(html, "dgt-ext__btn--mal", /myanimelist\.net\/anime\/(\d+)/);
    const anilistId = extIdFromHtml(html, "dgt-ext__btn--anilist", /anilist\.co\/anime\/(\d+)/);
    let postId = snapshot && snapshot.id != null ? snapshot.id : null;
    if (postId == null) {
        const ds = /\bdata-series="(\d+)"/.exec(html);
        if (ds) postId = toIntOrNull(ds[1]);
    }
    const seasons = [];
    const tabsIdx = html.indexOf("id=\"dgt-season-tabs\"");
    if (tabsIdx !== -1) {
        const dtIdx = html.indexOf("data-tabs=\"", tabsIdx);
        const dtEnd = dtIdx !== -1 ? html.indexOf("\"", dtIdx + 11) : -1;
        if (dtIdx !== -1 && dtEnd !== -1) {
            try {
                const arr = JSON.parse(htmlUnescape(html.slice(dtIdx + 11, dtEnd)));
                if (Array.isArray(arr)) {
                    for (const o of arr) {
                        if (o && typeof o.season === "number" && o.season > 0 && !seasons.includes(o.season)) {
                            seasons.push(o.season);
                        }
                    }
                    seasons.sort((a, b) => a - b);
                }
            } catch (e) {
                // malformed data-tabs — no seasons, like the original's runCatching
            }
        }
    }
    return {
        title: title,
        type: snapshot && snapshot.type != null ? snapshot.type : null,
        poster: poster != null ? poster : null,
        backdrop: backdrop != null ? backdrop : null,
        plot: plot,
        year: year != null ? year : null,
        genres: genres != null ? genres : null,
        tmdbId: tmdbId,
        malId: malId,
        anilistId: anilistId,
        postId: postId,
        seasons: seasons,
    };
}

// AnimeDekhoProvider.load() episode fetch for one season:
// GET /wp-json/dgt/v1/episodes?series=<id>&season=<season>
async function fetchEpisodes(mainUrl, seriesId, season) {
    try {
        const text = await httpGetText(mainUrl + "/wp-json/dgt/v1/episodes?series=" + seriesId + "&season=" + season, {});
        const json = JSON.parse(text);
        const episodes = (json && json.episodes) || [];
        // Episodes without a usable url are dropped by the original (mapNotNull).
        return episodes.filter((ep) => ep != null && !isBlank(ep.url));
    } catch (e) {
        console.error("AnimeDekho: Error fetching episodes for series " + seriesId + " season " + season + ": " + e);
        return [];
    }
}

// DgtEpisode -> the Media payload load() builds for an episode:
// Media(url = ep.url, mediaType = 2, postId = seriesId, epId = ep.id)
function episodeMedia(ep, seriesId) {
    return { url: ep.url, poster: null, mediaType: 2, postId: seriesId, epId: ep.id != null ? ep.id : null };
}

// The term/trid extraction shared by HindiSubAnime.loadLinks and
// OnepaceProvider.loadLinks: body class "(?:term|postid)-(\d+)", else
// "trid=(\d+)" anywhere in the page HTML, else ErrorLoadingException.
function extractTerm($) {
    const body = $("body").first();
    const bodyClass = body && body.length ? body.attr("class") : null;
    if (bodyClass == null) return { bodyMissing: true, term: null };
    const m1 = /(?:term|postid)-(\d+)/.exec(bodyClass);
    if (m1) return { bodyMissing: false, term: m1[1] };
    const m2 = /trid=(\d+)/.exec($.html());
    if (m2) return { bodyMissing: false, term: m2[1] };
    return { bodyMissing: false, term: null };
}

// One server slot of the trdekho fan-out used by HindiSubAnime
// (loadLinks$3) and OnePace (loadLinks$2):
// GET <mainUrl>/?trdekho=<i>&trid=<term>&trtype=<mediaType>, take the first
// iframe's src and run it through loadExtractor with the media url as referer.
async function trdekhoOnce(mainUrl, i, term, media, emit, emitSub, logLink) {
    try {
        const $ = await httpGetDoc(mainUrl + "/?trdekho=" + i + "&trid=" + term + "&trtype=" + media.mediaType, {});
        if (!$) return;
        const iframe = $("iframe").first();
        const link = iframe && iframe.length ? iframe.attr("src") : null;
        if (link == null) return;
        if (logLink) console.log("Phisher: " + link);
        try {
            await loadExtractor(link, media.url, emit, emitSub);
        } catch (e) {
            // the original wraps this call in runCatching as well
        }
    } catch (e) {
        // per-slot failures are swallowed by the original's runCatching
    }
}

// Collect the links + subtitles of a single loadExtractor() run so subtitles
// can be attached to that run's links (CloudStream delivers subtitles through
// a separate callback; Nuvio attaches them to stream objects).
function makeBatch() {
    const links = [];
    const subs = [];
    return {
        emit: (l) => links.push(l),
        emitSub: (s) => subs.push(s),
        flush: (push) => {
            for (const l of links) {
                if (subs.length) l.subtitles = (l.subtitles || []).concat(subs);
                push(l);
            }
        },
    };
}

async function runExtractor(url, referer) {
    const batch = makeBatch();
    await loadExtractor(url, referer, batch.emit, batch.emitSub);
    const out = [];
    batch.flush((l) => out.push(l));
    return out;
}

// Internal extractor link -> Nuvio stream object.
function toStream(link, title) {
    const headers = Object.assign({}, link.headers || {});
    if (link.referer) headers["Referer"] = link.referer;
    const stream = {
        name: link.name,
        title: title || link.name,
        url: link.url,
        quality: link.quality ? link.quality + "p" : "Auto",
        headers: headers,
    };
    const t = link.type === "infer" || link.type == null ? inferType(link.url) : link.type;
    if (t === "m3u8") stream.type = "m3u8";
    if (link.subtitles && link.subtitles.length) {
        stream.subtitles = link.subtitles.map((s) => ({ url: s.url, language: s.language || "Unknown" }));
    }
    return stream;
}

// ---------------------------------------------------------------------------
// AnimeDekhoProvider (DEX) — https://animedekho.tv, language "hi"
// Ported from AnimeDekhoProvider.kt: getNonce / verifyGate / bypassGate /
// fetchWatch / loadLinks (+ its embed and download handlers) / extractLabeled.
// The catalog side (getMainPage / search / load) has no direct equivalent in
// Nuvio's stream-only plugin API; its logic is reused above to resolve the
// TMDB id Nuvio passes in into the site's post + episode ids.
// ---------------------------------------------------------------------------

const MAIN_URL = "https://animedekho.tv";
const PROVIDER_NAME = "Anime Dekho";

// AnimeDekhoProvider.getNonce()
async function getNonce() {
    try {
        const text = await httpGetText(MAIN_URL + "/browse/", {});
        const m = /DGT=\{[^}]*?"nonce":"([a-f0-9]{8,20})"/.exec(text || "");
        return m ? m[1] : null;
    } catch (e) {
        return null;
    }
}

// AnimeDekhoProvider.verifyGate() — a direct, no-redirects GET whose
// Set-Cookie headers are scanned for the dgt_verified cookie.
async function verifyGate(verifyUrl) {
    const res = await fetch(verifyUrl, {
        method: "GET",
        headers: { "User-Agent": DESKTOP_UA, "Referer": MAIN_URL },
        redirect: "manual",
        signal: timeoutSignal(HTTP_TIMEOUT_MS),
    });
    let cookie = null;
    const setCookies = [];
    if (typeof res.headers.getSetCookie === "function") {
        for (const h of res.headers.getSetCookie()) setCookies.push(h);
    }
    const single = res.headers.get("set-cookie");
    if (single) setCookies.push(single);
    for (const h of setCookies) {
        const m = /dgt_verified=([^;]+)/.exec(h);
        if (m) {
            cookie = m[1];
            break;
        }
    }
    if (cookie == null && typeof res.headers.forEach === "function") {
        // Some TV fetch bridges hide set-cookie from get()/getSetCookie()
        // (proven by the TV diagnostic on webOS) but still expose it when
        // every header is iterated — scan them all as a last resort.
        res.headers.forEach((v) => {
            if (cookie == null) {
                const m = /dgt_verified=([^;]+)/.exec(String(v));
                if (m) cookie = m[1];
            }
        });
    }
    console.log("AnimeDekho: Gate verify code=" + res.status + " cookie=" + (cookie != null ? "ok" : "missing"));
    return cookie;
}

// AnimeDekhoProvider.bypassGate(gateUrl)
async function bypassGate(gateUrl) {
    try {
        const res = await httpGetRes(gateUrl, { headers: { "Referer": MAIN_URL } });
        const text = await res.text();
        const doc = loadDoc(text);
        let shortlink = null;
        if (doc) {
            const el = doc("input[name=shortlink]").first();
            const v = el && el.length ? el.attr("value") : null;
            if (!isBlank(v)) shortlink = v;
        }
        if (shortlink == null) {
            const m = /https?:\/\/[^"'\s<>]*\?dgt_verify=1[^"'\s<>]*/.exec(text || "");
            if (m) shortlink = m[0].split("&#038;").join("&");
        }
        if (shortlink == null) {
            console.error("AnimeDekho: Gate page code=" + res.status + ": no dgt_verify link found");
            return null;
        }
        let postlink = "";
        if (doc) {
            const el = doc("input[name=postlink]").first();
            const v = el && el.length ? el.attr("value") : null;
            postlink = v != null ? v : "";
        }
        await httpPostForm(MAIN_URL + "/skip/vshort.php",
            { postlink: postlink, shortlink: shortlink },
            { headers: { "Referer": gateUrl } });
        const iMatch = /[?&]i=(\d+)/.exec(shortlink);
        const iVal = iMatch ? toIntOrNull(iMatch[1]) : null;
        const eMatch = /[?&]e=(\d+)/.exec(shortlink);
        const eVal = eMatch ? toIntOrNull(eMatch[1]) : null;
        const waits = iVal != null ? [4, 12, 30, 75] : [10, 45];
        let result = null;
        for (const w of waits) {
            if (eVal != null && Math.floor(Date.now() / 1000) > eVal - 5) break;
            const waitSecs = (iVal != null ? iVal : 0) + w - Math.floor(Date.now() / 1000);
            if (waitSecs > 0) await sleep(waitSecs * 1000);
            result = await verifyGate(shortlink);
            if (result != null) break;
        }
        return result;
    } catch (e) {
        console.error("AnimeDekho: Gate bypass failed: " + e);
        return null;
    }
}

// AnimeDekhoProvider.fetchWatch(postId, epId, cookie, nonce)
async function fetchWatch(postId, epId, cookie, nonce) {
    const headers = { "Content-Type": "application/json" };
    if (!isBlank(cookie)) headers["Cookie"] = "dgt_verified=" + cookie;
    if (!isBlank(nonce)) headers["x-wp-nonce"] = nonce;
    try {
        const text = await httpPostText(
            MAIN_URL + "/wp-json/dgt/v1/watch",
            "{\"post_id\":" + postId + ",\"episode_id\":" + epId + "}",
            { headers: headers }
        );
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    } catch (e) {
        console.error("AnimeDekho: Watch API failed: " + e);
        return null;
    }
}

// AnimeDekhoProvider.extractLabeled(url, src, referer, subtitleCallback, callback)
async function extractLabeled(url, src, referer, pushLink) {
    try {
        const collected = await runExtractor(url, referer);
        for (const link of collected) {
            const server = src.server;
            if (isBlank(server)) {
                pushLink(link);
                continue;
            }
            let q = null;
            const qm = /(\d{3,4})p/.exec(server);
            if (qm) q = toIntOrNull(qm[1]);
            if (q == null && !isBlank(src.language)) {
                const lq = getQualityFromName(src.language);
                if (lq !== Q_UNKNOWN) q = lq;
            }
            const quality = q != null ? q : link.quality;
            const serverName = String(server).replace(/[ -]\d{3,4}p$/, "").trim();
            let suffix;
            if (!isBlank(src.quality)) {
                suffix = " • " + src.quality;
            } else if (serverName.toLowerCase() === "vidstream") {
                suffix = " • Multi-Lang";
            } else {
                suffix = "";
            }
            const detail = link.name.includes(" ") ? link.name.substring(link.name.indexOf(" ") + 1) : "";
            const tags = (detail.match(/\[[^\]]+\]/g) || []).join(" ");
            const detailSuffix = !isBlank(tags) ? " " + tags : "";
            pushLink(Object.assign({}, link, {
                name: serverName + suffix + detailSuffix,
                quality: quality,
            }));
        }
    } catch (e) {
        console.error("AnimeDekho: Failed to extract " + url + ": " + e);
    }
}

// loadLinks embed handler (AnimeDekhoProvider$loadLinks$6)
async function loadLinksEmbed(src, media, pushLink) {
    const embed = src.embed;
    let serverUrl = embed;
    if (String(embed).includes("/player.php?url=")) {
        serverUrl = null;
        try {
            const doc = await httpGetDoc(embed, { headers: { "Referer": MAIN_URL } });
            const iframe = doc ? doc("iframe[src]").first() : null;
            const v = iframe && iframe.length ? iframe.attr("src") : null;
            if (!isBlank(v)) serverUrl = v;
        } catch (e) {
            serverUrl = null;
        }
        if (serverUrl == null) return;
    }
    await extractLabeled(serverUrl, src, media.url, pushLink);
}

// loadLinks download handler (AnimeDekhoProvider$loadLinks$8)
async function loadLinksDownload(src, media, pushLink) {
    const download = src.download;
    let resolved = null;
    if (String(download).includes("/aaa/myth/dl2.php?id=")) {
        try {
            resolved = base64Decode(substringBefore(substringAfter(String(download), "id="), "&").trim());
        } catch (e) {
            resolved = null;
        }
    } else if (String(download).includes("download") && String(download).includes("url=")) {
        try {
            const doc = await httpGetDoc(download, { headers: { "Referer": media.url } });
            const a = doc ? doc("a[href^=http]").first() : null;
            const href = a && a.length ? a.attr("href") : null;
            resolved = href != null && href.includes("animedekho.tv") ? null : href;
        } catch (e) {
            resolved = null;
        }
    }
    if (resolved == null || isBlank(resolved)) return;
    await extractLabeled(resolved, src, media.url, pushLink);
}

// AnimeDekhoProvider.loadLinks(data, isCasting, subtitleCallback, callback)
async function loadLinks(media, pushLink) {
    let postId = media.postId != null ? media.postId : null;
    let epId = media.epId != null ? media.epId : 0;
    if (postId == null) {
        const pageUrl = (String(media.url).includes("/epi/") || String(media.url).includes("?"))
            ? media.url
            : String(media.url).replace(/\/+$/, "") + "?watch=1";
        try {
            const doc = await httpGetDoc(pageUrl, {});
            const root = doc ? doc("#dgt-watch").first() : null;
            if (root && root.length) {
                const dt = root.attr("data-title");
                postId = dt != null ? toIntOrNull(dt) : null;
                const dterm = root.attr("data-term");
                epId = dterm != null ? (toIntOrNull(dterm) != null ? toIntOrNull(dterm) : 0) : 0;
            }
        } catch (e) {
            // runCatching in the original — postId simply stays null
        }
        if (postId == null) {
            console.error("AnimeDekho: No post id found for " + media.url);
            return false;
        }
    }
    let cookie = null;
    let res = await fetchWatch(postId, epId, null, null);
    if (res != null && res.gated === true) {
        console.log("AnimeDekho: Watch API gated, bypassing ad gate");
        const gate = res.gate;
        if (gate != null) {
            cookie = await bypassGate(gate);
        }
        res = await fetchWatch(postId, epId, cookie, null);
    }
    if (res == null || res.gated === true) {
        console.log("AnimeDekho: Retrying watch with nonce fallback (cookie present: " + (!isBlank(cookie)) + ")");
        const nonce = await getNonce();
        if (nonce != null) {
            res = await fetchWatch(postId, epId, cookie, nonce);
        }
    }
    const sources = res != null ? res.sources : null;
    if (sources == null || sources.length === 0) {
        console.error("AnimeDekho: No sources returned for post " + postId + " ep " + epId);
        return false;
    }
    const embeds = sources.filter(
        (s) => s != null && s.kind === "embed" && s.show_embed !== false && !isBlank(s.embed)
    );
    await Promise.all(embeds.map((src) => loadLinksEmbed(src, media, pushLink)));
    const downloads = sources.filter(
        (s) => s != null && !isBlank(s.download) && s.show_download !== false
    );
    await Promise.all(downloads.map((src) => loadLinksDownload(src, media, pushLink)));
    return true;
}

// Resolve the TMDB id to the site's Media payload, exactly the way the
// CloudStream UI flow does (search -> load -> episode data).
async function resolveMedia(tmdbId, mediaType, season, episode) {
    const details = await tmdbDetails(tmdbId, mediaType);
    const title = tmdbTitle(details, mediaType);
    if (title == null) return null;
    // Gather candidates from the suggest search. The site indexes some
    // series under a squashed title ("Shinchan") while TMDB uses spaced
    // or franchised ones ("Shin Chan", "Crayon Shin-chan"-style variants
    // — TMDB's own primary name for the same id is not stable), and for
    // some queries suggest returns ONLY same-franchise movies — so every
    // known title variant is searched, each also in squashed form, and
    // the results merged.
    const titles = await tmdbTitles(tmdbId, mediaType, details);
    const queries = [];
    for (const t of titles) {
        if (queries.length >= 8) break;
        if (!queries.includes(t)) queries.push(t);
        const squashed = String(t).replace(/[^a-zA-Z0-9]+/g, "");
        if (squashed && squashed !== t && !queries.includes(squashed) && queries.length < 8) queries.push(squashed);
    }
    if (!queries.length) queries.push(title);
    const seenUrls = {};
    let results = [];
    for (const q of queries) {
        const rs = await searchSite(MAIN_URL, q);
        for (const r of rs) {
            if (r && r.url && !seenUrls[r.url]) {
                seenUrls[r.url] = true;
                results.push(r);
            }
        }
    }
    if (!results.length) return null;
    const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const wantSeries = mediaType !== "movie";
    const titleNorms = titles.map((t) => norm(t));
    const byTmdb = (arr) => arr.find((p) => p.l.tmdbId != null && String(p.l.tmdbId) === String(tmdbId));
    const byTitle = (arr) => arr.find((p) => titleNorms.includes(norm(p.l.title)));
    // Load candidates in small batches, most-likely first (the suggest API
    // already reports each item's type), and stop as soon as the pick is
    // certain. TV-class hardware is far slower than a phone at fetching
    // and scanning dozens of post pages, and Nuvio kills slow scrapers —
    // most titles resolve from the first batch alone. Pages are read with
    // loadPostFast (string scans, no DOM parse) for the same reason.
    const loadBatched = async (list) => {
        const rank = (r) => {
            if (r.type == null) return 1;
            return (r.type === "series") === wantSeries ? 0 : 2;
        };
        const ordered = list.slice(0, 24).map((r, i) => ({ r: r, i: i }))
            .sort((a, b) => (rank(a.r) - rank(b.r)) || (a.i - b.i))
            .map((x) => x.r);
        const totalByRank = [0, 0, 0];
        for (const r of ordered) totalByRank[rank(r)]++;
        const loadedByRank = [0, 0, 0];
        const loaded = [];
        // One retry per page: a transient fetch failure on the right post
        // must not let a same-franchise spin-off win the fallback pick.
        const loadWithRetry = async (r) => {
            const first = await loadPostFast(MAIN_URL, { url: r.url, poster: r.poster });
            return first != null ? first : loadPostFast(MAIN_URL, { url: r.url, poster: r.poster });
        };
        for (let start = 0; start < ordered.length; start += 3) {
            const batch = ordered.slice(start, start + 3);
            const batchLoaded = await Promise.all(batch.map(loadWithRetry));
            for (let j = 0; j < batch.length; j++) {
                loadedByRank[rank(batch[j])]++;
                const l = batchLoaded[j];
                if (!l) continue;
                const isSeries = l.type === "series" || (l.seasons != null && l.seasons.length > 0);
                loaded.push({ r: batch[j], l: l, isSeries: isSeries });
            }
            const poolNow = loaded.filter((p) => p.isSeries === wantSeries);
            if (byTmdb(poolNow) || byTitle(poolNow)) break;
            if (poolNow.length && loadedByRank[0] >= totalByRank[0] && loadedByRank[1] >= totalByRank[1]) break;
        }
        return loaded;
    };
    let all = await loadBatched(results);
    let pool = all.filter((p) => p.isSeries === wantSeries);
    if (!pool.length) {
        // Last resort: the original search's HTML fallback page, which is
        // not limited to the suggest index.
        const extra = [];
        for (const q of queries) {
            const $ = await httpGetDoc(MAIN_URL + "/?s=" + javaUrlEncode(q), {});
            if (!$) continue;
            $("a.dgt-card").each((i, el) => {
                const r = cardToSearchResult($, el);
                if (r && r.url && !seenUrls[r.url]) {
                    seenUrls[r.url] = true;
                    extra.push(r);
                }
            });
        }
        if (extra.length) {
            const extraLoaded = await loadBatched(extra);
            all = all.concat(extraLoaded);
            pool = all.filter((p) => p.isSeries === wantSeries);
        }
    }
    if (!all.length) return null;
    // A tv request must never resolve to a movie post (and vice versa):
    // an earlier version of this selection silently fell back to the
    // first loaded post — a same-franchise movie — so series requests
    // played a movie. Selection is type-scoped first: TMDB-id match,
    // then exact normalised-title match, then the first candidate of the
    // requested type; cross-type posts are only used on an exact TMDB or
    // title match.
    const pick = byTmdb(pool) || byTitle(pool) || byTmdb(all) || pool[0] || byTitle(all) || null;
    if (pick == null) return null;
    const chosen = pick.r;
    const loaded = pick.l;
    if (mediaType === "movie" || loaded.postId == null || loaded.seasons.length === 0) {
        return {
            media: { url: chosen.url, poster: null, mediaType: 1, postId: loaded.postId, epId: 0 },
            title: loaded.title,
        };
    }
    // Nuvio may hand season/episode as strings; the season list and the
    // episode numbers are numeric, so coerce before comparing.
    const s = season != null && !isNaN(parseInt(season, 10)) ? parseInt(season, 10) : 1;
    const e = episode != null && !isNaN(parseInt(episode, 10)) ? parseInt(episode, 10) : 1;
    if (!loaded.seasons.includes(s)) return null;
    const eps = await fetchEpisodes(MAIN_URL, loaded.postId, s);
    let ep = null;
    for (const candidate of eps) {
        if (Number(candidate.episode) === e) {
            ep = candidate;
            break;
        }
    }
    if (ep == null && e >= 1 && e <= eps.length) ep = eps[e - 1];
    if (ep == null) return null;
    return {
        media: episodeMedia(ep, loaded.postId),
        title: loaded.title + " S" + s + " E" + e,
    };
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const out = [];
    try {
        const resolved = await resolveMedia(tmdbId, mediaType, season, episode);
        if (!resolved) return out;
        const title = resolved.title;
        await loadLinks(resolved.media, (link) => out.push(toStream(link, title)));
    } catch (e) {
        console.error("AnimeDekho: getStreams failed: " + e);
    }
    return out;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
