#!/usr/bin/env python3
"""Port the user-supplied Purstream plugin (Untitled-2__3__0_edjl.js) into
our provider set as providers/purstream2.js.

Changes vs the supplied file (playback mechanics ported, gates kept):
 1. TMDB key: the bundle's embedded key is dropped; the guest's
    TMDB_API_KEY global is used instead (same as every other provider).
 2. Exact gate hardened: the original fell back to the FIRST search
    result when no title matched exactly (`|| items[0]`). Removed: no
    exact match now throws, so getStreams returns []. The year check
    passes when either side lacks a year (title-exact remains the gate).
 3. Search attempts: FR title -> original title -> EN title (the
    original tried only the first two; EN is a third EXACT attempt).
 4. Streams now carry their parsed quality (the original shipped
    quality: "").
 5. Wrapped with the standard v5 fetch-retry prelude + v2 chain-retry
    postlude from zxcstream1. Everything else verbatim, including the
    UA+Referer stream headers the original ships.
NOTE: the upstream domains.json (wooodyhood/nuvio-repo) 404s as of
2026-10-24, so the plugin always uses the fallback api.purstream.club
(which is live); the detection code is kept so it picks up a live list
again if the repo returns.
"""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
src = (root.parent / "user" / "files" / "Untitled-2__3__0_edjl.js").read_text()
orig_len = len(src)

# --- 1. TMDB key: strip the embedded declaration, retarget references ---
src = re.sub(r'var TMDB_KEY\s*=\s*"[^"]*";', "", src, count=1)
assert "var TMDB_KEY" not in src, "embedded TMDB key declaration still present"
src = src.replace("TMDB_KEY", "PUR_TMDB_KEY")
reader = (
    'var PUR_TMDB_KEY = "";\n'
    "try { PUR_TMDB_KEY = (typeof TMDB_API_KEY !== \"undefined\") ? TMDB_API_KEY : \"\"; } catch (e) { PUR_TMDB_KEY = \"\"; }\n"
)
anchor = 'var PURSTREAM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";'
assert anchor in src
src = src.replace(anchor, anchor + "\n" + reader, 1)
assert src.count("PUR_TMDB_KEY") >= 4

# --- 2. Exact gate: drop the first-result fallback; year passes if unknown ---
old_find = re.search(
    r"var _0x2a29b2 = _0x21b847\.find\(function \(_0x1715a5\) \{\s*"
    r"var _0x1d013f = extractYear\(_0x1715a5\.release_date\);\s*"
    r"return cleanTitle\(_0x1715a5\.title\) === _0x998c7 && \(Math\.abs\(_0x4d2ef - _0x1d013f\) <= 1 \|\| !_0x4d2ef\);\s*"
    r"\}\) \|\| _0x21b847\[0\];\s*"
    r"return _0x2a29b2\.id;",
    src,
)
assert old_find, "search-match block not found"
src = src.replace(
    old_find.group(0),
    "var _0x2a29b2 = _0x21b847.find(function (_0x1715a5) {\n"
    "      var _0x1d013f = extractYear(_0x1715a5.release_date);\n"
    "      return cleanTitle(_0x1715a5.title) === _0x998c7 && (_0x1d013f == null || !_0x4d2ef || Math.abs(_0x4d2ef - _0x1d013f) <= 1);\n"
    "    });\n"
    "    if (!_0x2a29b2) throw new Error();\n"
    "    return _0x2a29b2.id;",
)

# --- 3. EN title as a third EXACT search attempt ---
old_chain = (
    "return findPurstreamIdByTitle(_0x400448.fr, _0x126066, _0x400448.year).catch(function () {\n"
    "      return findPurstreamIdByTitle(_0x400448.orig, _0x126066, _0x400448.year);\n"
    "    }).then(function (_0x2cac7b) {"
)
assert old_chain in src, "search chain not found"
src = src.replace(
    old_chain,
    "return findPurstreamIdByTitle(_0x400448.fr, _0x126066, _0x400448.year).catch(function () {\n"
    "      return findPurstreamIdByTitle(_0x400448.orig, _0x126066, _0x400448.year);\n"
    "    }).catch(function () {\n"
    "      return findPurstreamIdByTitle(_0x558699.enName, _0x126066, _0x400448.year);\n"
    "    }).then(function (_0x2cac7b) {",
    1,
)

# --- 4. Carry parsed quality into the stream objects ---
old_mq = 'quality: "",\n      language: "",\n      format: _0x168dce,'
assert old_mq in src
src = src.replace(old_mq, 'quality: _0x56fac8,\n      language: "",\n      format: _0x168dce,', 1)
old_eq = 'quality: "",\n      language: "",\n      format: _0x40dc85,'
assert old_eq in src
src = src.replace(old_eq, 'quality: _0xcb09c0,\n      language: "",\n      format: _0x40dc85,', 1)

# --- 5. Assemble with prelude + postlude ---
template = (root / "providers" / "zxcstream1.js").read_text()
prelude = template[: template.index("/* ZXCStream (zxcstream.com)")]
postlude = template[template.index("/* __CHAIN_RETRY_POSTLUDE__"):]
header = (
    "/* Purstream (api.purstream.club) - ported from the user-supplied\n"
    "   plugin (Untitled-2__3__0_edjl.js, wooodyhood/nuvio-repo style).\n"
    "   Chain: TMDB details -> API search (FR/orig/EN title, exact match\n"
    "   + year) -> media sheet (movies) / episode sources (TV).\n"
    "   First-result fallback removed; guest TMDB key; quality carried.\n"
    "   TV-guest safe: Promise chains only, no timers/crypto/cheerio. */\n"
)
out = prelude + header + src.rstrip() + "\n\n" + postlude
dest = root / "providers" / "purstream2.js"
# 6. Formatter v2 label: inject before getStreams, rewire push site(s).
_fmt = '// __STREAM_LABEL_FORMATTER__ v2: one-line emoji label for every stream.\n// Movie:  🎬 <Title> • 📺 <Quality> • 🔊 <Audio> • 💬 <Subs> • 🖥️ <Provider> • 🗄️ <Server>\n// Series: 🎬 <Title> • 📺 <Quality> • 📂 Season <N> • 🎞️ Episode <N> • 🔊 <Audio> • 💬 <Subs> • 🖥️ <Provider> • 🗄️ <Server>\n// Segments with no data are omitted, except Quality (always shown, "Unknown" fallback).\n// Server = explicit server label when the provider knows one, else the stream URL\'s hostname.\n// Pure string work, no timers, no TextEncoder, no fetch. Never throws.\nfunction formatStreamLabel(o) {\n  try {\n    o = o || {};\n    var parts = [];\n    function str(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }\n    function langName(v) {\n      var k = str(v).toLowerCase();\n      var map = { en: "English", eng: "English", english: "English", hi: "Hindi", hin: "Hindi", hindi: "Hindi",\n        es: "Spanish", spa: "Spanish", fr: "French", fre: "French", fra: "French", de: "German", ger: "German", deu: "German",\n        it: "Italian", ita: "Italian", pt: "Portuguese", por: "Portuguese", ru: "Russian", rus: "Russian",\n        ar: "Arabic", ara: "Arabic", bn: "Bengali", ben: "Bengali", zh: "Chinese", chi: "Chinese", zho: "Chinese",\n        ja: "Japanese", jpn: "Japanese", ko: "Korean", kor: "Korean", ta: "Tamil", tam: "Tamil", te: "Telugu", tel: "Telugu",\n        ml: "Malayalam", mal: "Malayalam", mr: "Marathi", mar: "Marathi", pa: "Punjabi", pan: "Punjabi",\n        ur: "Urdu", urd: "Urdu", id: "Indonesian", ind: "Indonesian", ms: "Malay", msa: "Malay", vi: "Vietnamese",\n        vie: "Vietnamese", th: "Thai", tha: "Thai", tl: "Filipino", fil: "Filipino", nl: "Dutch", nld: "Dutch",\n        sv: "Swedish", swe: "Swedish", da: "Danish", dan: "Danish", fi: "Finnish", fin: "Finnish",\n        no: "Norwegian", nor: "Norwegian", pl: "Polish", pol: "Polish", tr: "Turkish", tur: "Turkish",\n        uk: "Ukrainian", ukr: "Ukrainian", cs: "Czech", ces: "Czech", cze: "Czech", el: "Greek", ell: "Greek",\n        he: "Hebrew", heb: "Hebrew", ro: "Romanian", ron: "Romanian", rum: "Romanian", hu: "Hungarian", hun: "Hungarian" };\n      if (map[k]) return map[k];\n      return str(v);\n    }\n    var title = str(o.title);\n    if (title) parts.push("🎬 " + title);\n    var q = str(o.quality);\n    if (!q || q.toLowerCase() === "unknown") q = "Unknown";\n    parts.push("📺 " + q);\n    if (o.season !== undefined && o.season !== null && String(o.season) !== "") parts.push("📂 Season " + o.season);\n    if (o.episode !== undefined && o.episode !== null && String(o.episode) !== "") parts.push("🎞️ Episode " + o.episode);\n    var audio = o.audio;\n    if (Array.isArray(audio)) audio = audio.filter(function (a) { return str(a); }).join(" / ");\n    audio = str(audio);\n    if (audio && audio.toLowerCase() !== "unknown") parts.push("🔊 " + audio);\n    var subs = o.subtitles;\n    var langs = [];\n    if (Array.isArray(subs)) {\n      for (var i = 0; i < subs.length; i++) {\n        var lg = (subs[i] && typeof subs[i] === "object") ? (subs[i].language || subs[i].name) : subs[i];\n        lg = langName(lg);\n        if (lg && langs.indexOf(lg) === -1) langs.push(lg);\n      }\n    } else if (typeof subs === "string" && str(subs)) { langs = [langName(subs)]; }\n    if (langs.length) {\n      var shown = langs.slice(0, 3).join(", ");\n      if (langs.length > 3) shown += " +" + (langs.length - 3) + " more";\n      parts.push("💬 " + shown);\n    }\n    var size = str(o.size);\n    if (size) parts.push("📦 " + size);\n    var extra = str(o.extra);\n    if (extra) parts.push(extra);\n    var src = str(o.source) || str(o.provider);\n    if (src) parts.push("🖥️ " + src);\n    var server = str(o.server);\n    if (!server && str(o.url)) {\n      var h = str(o.url).split("/")[2] || "";\n      server = h.replace(/^www\\./, "");\n    }\n    if (server) parts.push("🗄️ " + server);\n    return parts.join(" • ");\n  } catch (e) {\n    try { return (o && (o.source || o.provider) ? String(o.source || o.provider) : "Stream") + " • " + (o && o.quality ? String(o.quality) : "Unknown"); } catch (e2) { return "Stream"; }\n  }\n}'
assert out.count('function getStreams(_0x4baaaa, _0x126066, _0x539bb1, _0x523727) {') == 1, 'label step: getStreams anchor'
out = out.replace('function getStreams(_0x4baaaa, _0x126066, _0x539bb1, _0x523727) {', _fmt + "\n\n" + 'function getStreams(_0x4baaaa, _0x126066, _0x539bb1, _0x523727) {', 1)
assert out.count('    return {\n      name: "Purstream | " + _0x56fac8.toLowerCase() + " | " + _0x53c8d3,\n      title: _0x217d9a,') == 1, 'label step: anchor missing: ' + '    return {\n      name: "Purstream | " + _0x56fac8.toLowerC'
out = out.replace('    return {\n      name: "Purstream | " + _0x56fac8.toLowerCase() + " | " + _0x53c8d3,\n      title: _0x217d9a,', '    var _0xlbl = formatStreamLabel({ source: "Purstream", title: _0x22ed47.enName, quality: _0x56fac8, audio: _0x53c8d3, url: _0x1e197e.url });\n    return {\n      name: _0xlbl,\n      title: _0xlbl,', 1)
assert out.count('    return {\n      name: "Purstream | " + _0xcb09c0.toLowerCase() + " | " + _0xa6c753,\n      title: _0x2f09cb,') == 1, 'label step: anchor missing: ' + '    return {\n      name: "Purstream | " + _0xcb09c0.toLowerC'
out = out.replace('    return {\n      name: "Purstream | " + _0xcb09c0.toLowerCase() + " | " + _0xa6c753,\n      title: _0x2f09cb,', '    var _0xlbl = formatStreamLabel({ source: "Purstream", title: _0x296e79.enName, quality: _0xcb09c0, season: _0x46ea42, episode: _0x42f2bb, audio: _0xa6c753, url: _0x533f4c.stream_url });\n    return {\n      name: _0xlbl,\n      title: _0xlbl,', 1)
dest.write_text(out)
print(f"port: {orig_len} -> {len(out)} bytes; wrote {dest}")
