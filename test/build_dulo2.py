#!/usr/bin/env python3
"""Build providers/dulo2.js from the upstream Dulo scraper.

Upstream: replitfree6-lang/Nuvio-streams providers/dulo.js (cloned to
~/workspace/work/nuvio-streams-src/). Port deviations (house rules):
  1. Embedded TMDB key dropped; the guest TMDB_API_KEY global is used
     instead (TMDB details are optional hints — a missing key only
     loses the display title, resolve still runs id-keyed).
  2. Pickle streams DROPPED, not just demoted: live-verified 2026-10-25
     that Pickle serves a 12-second promo clip (3 segments), not the
     feature — same no-fakes rule as the netmirror12 abuse-clip guard.
     Prime/Zenith/Aurora playlists are full-length features.
  3. `redirect: "follow"` dropped from fetch options (it is the
     default; the guest fetch bridge may ignore the option).
  4. House v5 fetch-retry prelude + chain-retry postlude v2 spliced
     (canonical text taken from providers/netmirror12.js).
Everything else is verbatim upstream, including subtitles and the
site's own proxy HLS URLs (the plugin stays standalone — no server
of ours is involved; the proxy is dulo.mov's own delivery).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path.home() / "workspace/work/nuvio-streams-src/providers/dulo.js"
DST = ROOT / "providers/dulo2.js"
NETMIRROR = ROOT / "providers/netmirror12.js"


def must_replace(text, old, new, what):
    if old not in text:
        sys.exit(f"build_dulo2: anchor not found: {what}")
    return text.replace(old, new, 1)


def main():
    src = SRC.read_text()
    nm = NETMIRROR.read_text()
    prelude_end = nm.index("})();") + len("})();")
    prelude = nm[:prelude_end]
    post_start = nm.index("/* __CHAIN_RETRY_POSTLUDE__")
    postlude = nm[post_start:]

    # 1. Embedded TMDB key -> guest global.
    src = must_replace(
        src,
        'var TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";\n',
        "",
        "embedded TMDB key line",
    )
    src = must_replace(
        src,
        '        var r = await httpJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY, TMDB_TIMEOUT_MS, "");',
        '        var key = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";\n        if (!key) return null;\n        var r = await httpJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + key, TMDB_TIMEOUT_MS, "");',
        "tmdbDetails key use",
    )

    # 2. Drop the redirect option.
    src = must_replace(
        src,
        '        redirect: "follow",\n',
        "",
        "redirect option",
    )

    # 3b. Fix the stale upstream header comment about Pickle.
    src = must_replace(
        src,
        """//   - "Pickle · 4K": the site's own CDN (.m3u8 on zcdn.bluevelvet.space).
//     For the titles probed it currently serves a short promo clip
//     rather than the feature, so it is emitted LAST.""",
        """//   - "Pickle · 4K": DROPPED by this port (see the ordering block
//     below) — verified live as a 12s promo clip, not the feature.""",
        "Pickle header comment",
    )

    # 3. Drop Pickle entirely (12s promo, not the feature).
    src = must_replace(
        src,
        """        // Emit the proxy sources first (verified to carry the feature);
        // Pickle last — for the titles probed it serves a short promo.
        var ordered = [];
        var pickle = [];
        for (var i = 0; i < data.sources.length; i++) {
            var s = data.sources[i];
            if (!s || typeof s.url !== "string" || !s.url) continue;
            if (/^Pickle\\b/i.test(s.label || "")) pickle.push(s);
            else ordered.push(s);
        }
        var all = ordered.concat(pickle);""",
        """        // Proxy sources only. Pickle is DROPPED, not demoted: live
        // verified 2026-10-25 that its playlist is a 12s promo clip
        // (3 segments), not the feature — serving it would be a fake
        // stream, same rule as the netmirror12 abuse-clip guard.
        var all = [];
        for (var i = 0; i < data.sources.length; i++) {
            var s = data.sources[i];
            if (!s || typeof s.url !== "string" || !s.url) continue;
            if (/^Pickle\\b/i.test(s.label || "")) continue;
            all.push(s);
        }""",
        "Pickle ordering block",
    )

    header = (
        "// Dulo (dulo.mov) — ported from replitfree6-lang/Nuvio-streams\n"
        "// (upstream providers/dulo.js, single-file scraper, no deps).\n"
        "// TMDB-keyed first-party resolve endpoint, no site search, so no\n"
        "// title matching to go wrong. Port changes vs upstream: guest\n"
        "// TMDB_API_KEY (no embedded key), Pickle dropped (12s promo clip,\n"
        "// not the feature — verified live), v5 fetch prelude + chain-\n"
        "// retry postlude v2. Subtitles and the site's own proxy HLS\n"
        "// URLs are kept verbatim; plugin stays standalone.\n"
    )
    out = header + "\n" + prelude + "\n\n" + src + "\n" + postlude
    # 5. Formatter v2 label: inject before getStreams, rewire push site(s).
    _fmt = '// __STREAM_LABEL_FORMATTER__ v2: one-line emoji label for every stream.\n// Movie:  🎬 <Title> • 📺 <Quality> • 🔊 <Audio> • 💬 <Subs> • 🖥️ <Provider> • 🗄️ <Server>\n// Series: 🎬 <Title> • 📺 <Quality> • 📂 Season <N> • 🎞️ Episode <N> • 🔊 <Audio> • 💬 <Subs> • 🖥️ <Provider> • 🗄️ <Server>\n// Segments with no data are omitted, except Quality (always shown, "Unknown" fallback).\n// Server = explicit server label when the provider knows one, else the stream URL\'s hostname.\n// Pure string work, no timers, no TextEncoder, no fetch. Never throws.\nfunction formatStreamLabel(o) {\n  try {\n    o = o || {};\n    var parts = [];\n    function str(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }\n    function langName(v) {\n      var k = str(v).toLowerCase();\n      var map = { en: "English", eng: "English", english: "English", hi: "Hindi", hin: "Hindi", hindi: "Hindi",\n        es: "Spanish", spa: "Spanish", fr: "French", fre: "French", fra: "French", de: "German", ger: "German", deu: "German",\n        it: "Italian", ita: "Italian", pt: "Portuguese", por: "Portuguese", ru: "Russian", rus: "Russian",\n        ar: "Arabic", ara: "Arabic", bn: "Bengali", ben: "Bengali", zh: "Chinese", chi: "Chinese", zho: "Chinese",\n        ja: "Japanese", jpn: "Japanese", ko: "Korean", kor: "Korean", ta: "Tamil", tam: "Tamil", te: "Telugu", tel: "Telugu",\n        ml: "Malayalam", mal: "Malayalam", mr: "Marathi", mar: "Marathi", pa: "Punjabi", pan: "Punjabi",\n        ur: "Urdu", urd: "Urdu", id: "Indonesian", ind: "Indonesian", ms: "Malay", msa: "Malay", vi: "Vietnamese",\n        vie: "Vietnamese", th: "Thai", tha: "Thai", tl: "Filipino", fil: "Filipino", nl: "Dutch", nld: "Dutch",\n        sv: "Swedish", swe: "Swedish", da: "Danish", dan: "Danish", fi: "Finnish", fin: "Finnish",\n        no: "Norwegian", nor: "Norwegian", pl: "Polish", pol: "Polish", tr: "Turkish", tur: "Turkish",\n        uk: "Ukrainian", ukr: "Ukrainian", cs: "Czech", ces: "Czech", cze: "Czech", el: "Greek", ell: "Greek",\n        he: "Hebrew", heb: "Hebrew", ro: "Romanian", ron: "Romanian", rum: "Romanian", hu: "Hungarian", hun: "Hungarian" };\n      if (map[k]) return map[k];\n      return str(v);\n    }\n    var title = str(o.title);\n    if (title) parts.push("🎬 " + title);\n    var q = str(o.quality);\n    if (!q || q.toLowerCase() === "unknown") q = "Unknown";\n    parts.push("📺 " + q);\n    if (o.season !== undefined && o.season !== null && String(o.season) !== "") parts.push("📂 Season " + o.season);\n    if (o.episode !== undefined && o.episode !== null && String(o.episode) !== "") parts.push("🎞️ Episode " + o.episode);\n    var audio = o.audio;\n    if (Array.isArray(audio)) audio = audio.filter(function (a) { return str(a); }).join(" / ");\n    audio = str(audio);\n    if (audio && audio.toLowerCase() !== "unknown") parts.push("🔊 " + audio);\n    var subs = o.subtitles;\n    var langs = [];\n    if (Array.isArray(subs)) {\n      for (var i = 0; i < subs.length; i++) {\n        var lg = (subs[i] && typeof subs[i] === "object") ? (subs[i].language || subs[i].name) : subs[i];\n        lg = langName(lg);\n        if (lg && langs.indexOf(lg) === -1) langs.push(lg);\n      }\n    } else if (typeof subs === "string" && str(subs)) { langs = [langName(subs)]; }\n    if (langs.length) {\n      var shown = langs.slice(0, 3).join(", ");\n      if (langs.length > 3) shown += " +" + (langs.length - 3) + " more";\n      parts.push("💬 " + shown);\n    }\n    var size = str(o.size);\n    if (size) parts.push("📦 " + size);\n    var extra = str(o.extra);\n    if (extra) parts.push(extra);\n    var src = str(o.source) || str(o.provider);\n    if (src) parts.push("🖥️ " + src);\n    var server = str(o.server);\n    if (!server && str(o.url)) {\n      var h = str(o.url).split("/")[2] || "";\n      server = h.replace(/^www\\./, "");\n    }\n    if (server) parts.push("🗄️ " + server);\n    return parts.join(" • ");\n  } catch (e) {\n    try { return (o && (o.source || o.provider) ? String(o.source || o.provider) : "Stream") + " • " + (o && o.quality ? String(o.quality) : "Unknown"); } catch (e2) { return "Stream"; }\n  }\n}'
    assert out.count('async function getStreams(tmdbId, mediaType, season, episode) {') == 1, 'label step: getStreams anchor'
    out = out.replace('async function getStreams(tmdbId, mediaType, season, episode) {', _fmt + "\n\n" + 'async function getStreams(tmdbId, mediaType, season, episode) {', 1)
    assert out.count('        var displayTitle = "TMDB " + tmdbId;') == 1, 'label step: anchor missing: ' + '        var displayTitle = "TMDB " + tmdbId;'
    out = out.replace('        var displayTitle = "TMDB " + tmdbId;', '        var displayTitle = "TMDB " + tmdbId;\n        var mediaTitle = "TMDB " + tmdbId;', 1)
    assert out.count('            if (t) displayTitle = t + (type === "movie" ? "" : " S" + sNum + "E" + eNum);') == 1, 'label step: anchor missing: ' + '            if (t) displayTitle = t + (type === "movie" ? ""'
    out = out.replace('            if (t) displayTitle = t + (type === "movie" ? "" : " S" + sNum + "E" + eNum);', '            if (t) displayTitle = t + (type === "movie" ? "" : " S" + sNum + "E" + eNum);\n            if (t) mediaTitle = t;', 1)
    assert out.count('            var st = {\n                name: "Dulo • " + (src.label || "Stream"),\n                title: displayTitle,\n                url: src.url,\n                quality: qualityFromLabel(src.label),\n                headers: { "User-Agent": UA, "Referer": API + "/" },\n            };\n            var t2 = src.type;\n            if (t2 === "mp4" || t2 === "mkv" || t2 === "webm") st.type = t2;\n            else st.type = "m3u8";\n            if (Array.isArray(src.captions) && src.captions.length) {\n                var subs = [];\n                for (var k = 0; k < src.captions.length; k++) {\n                    var c = src.captions[k];\n                    if (c && typeof c.url === "string" && c.url) {\n                        subs.push({ url: c.url, language: c.display || c.language || "Unknown" });\n                    }\n                }\n                if (subs.length) st.subtitles = subs;\n            }\n            out.push(st);') == 1, 'label step: anchor missing: ' + '            var st = {\n                name: "Dulo • " + (sr'
    out = out.replace('            var st = {\n                name: "Dulo • " + (src.label || "Stream"),\n                title: displayTitle,\n                url: src.url,\n                quality: qualityFromLabel(src.label),\n                headers: { "User-Agent": UA, "Referer": API + "/" },\n            };\n            var t2 = src.type;\n            if (t2 === "mp4" || t2 === "mkv" || t2 === "webm") st.type = t2;\n            else st.type = "m3u8";\n            if (Array.isArray(src.captions) && src.captions.length) {\n                var subs = [];\n                for (var k = 0; k < src.captions.length; k++) {\n                    var c = src.captions[k];\n                    if (c && typeof c.url === "string" && c.url) {\n                        subs.push({ url: c.url, language: c.display || c.language || "Unknown" });\n                    }\n                }\n                if (subs.length) st.subtitles = subs;\n            }\n            out.push(st);', '            var subs = [];\n            if (Array.isArray(src.captions) && src.captions.length) {\n                for (var k = 0; k < src.captions.length; k++) {\n                    var c = src.captions[k];\n                    if (c && typeof c.url === "string" && c.url) {\n                        subs.push({ url: c.url, language: c.display || c.language || "Unknown" });\n                    }\n                }\n            }\n            var lblParts = String(src.label || "").split("\\u00b7");\n            var pool = lblParts.length > 1 ? lblParts[0].trim() : "";\n            if (/^(2160p|1440p|1080p|720p|480p|360p|4K)$/i.test(pool)) pool = "";\n            var lbl = formatStreamLabel({ source: "Dulo", title: mediaTitle, quality: qualityFromLabel(src.label), season: type === "tv" ? sNum : undefined, episode: type === "tv" ? eNum : undefined, subtitles: subs, server: pool, url: src.url });\n            var st = {\n                name: lbl,\n                title: lbl,\n                url: src.url,\n                quality: qualityFromLabel(src.label),\n                headers: { "User-Agent": UA, "Referer": API + "/" },\n            };\n            var t2 = src.type;\n            if (t2 === "mp4" || t2 === "mkv" || t2 === "webm") st.type = t2;\n            else st.type = "m3u8";\n            if (subs.length) st.subtitles = subs;\n            out.push(st);', 1)
    DST.write_text(out)
    print(f"wrote {DST} ({len(out)} bytes)")


if __name__ == "__main__":
    main()
