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

/* ZXCStream v1.0.4: Infinite Subtitles addon-only attach (osAttachSubtitles).
   Own resolve-API subtitles are kept; the addon overwrites on a release-fit hit.
   ZXCStream (zxcstream.com) - the site is TMDB-keyed and iframes
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
   WebCrypto - TV guest safe.
   Subtitles (v1.0.3): the resolve API carries them two ways and both
   are now attached as {id, url, lang, language, label} — the .srt
   file list in stream.subtitles (callisto; labels in native script,
   mapped to ISO codes, unrecognised names skipped) preferred, else
   the #EXT-X-MEDIA:TYPE=SUBTITLES renditions in source.master
   (orion/rousav; relative URIs resolved against the master URL).
   The same set goes on every emitted row: the subtitles belong to
   the title, not to one server. stream.vidbolt.xyz masters carry
   audio tracks only, no subtitles of their own. */
var VIDBOLT_BASE = "https://vidbolt.xyz";
var ZXC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var ZXC_FALLBACK_SERVERS = ["orion", "callisto", "fastva", "vega", "quantum", "quasar"];
var ZXC_TMDB_KEY = "";
try { ZXC_TMDB_KEY = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : ""; } catch (e) { ZXC_TMDB_KEY = ""; }
// TMDB details for the subtitle addon (addon is keyed by IMDb id; the
// per-row matcher needs the title). TV details carry NO imdb_id, so
// TV falls back to /external_ids. Fails open to empty on any error.
function zxcTmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  if (!ZXC_TMDB_KEY) return Promise.resolve({ title: "", imdbId: "" });
  return fetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + ZXC_TMDB_KEY, { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return { title: "", imdbId: "" };
      var meta = { title: j.title || j.name || "", imdbId: j.imdb_id || "" };
      if (meta.imdbId || kind !== "tv") return meta;
      return fetch("https://api.themoviedb.org/3/tv/" + tmdbId + "/external_ids?api_key=" + ZXC_TMDB_KEY, { headers: { Accept: "application/json" } })
        .then(function (r2) { return r2.ok ? r2.json() : null; })
        .then(function (j2) { meta.imdbId = (j2 && j2.imdb_id) || ""; return meta; })
        .catch(function () { return meta; });
    }).catch(function () { return { title: "", imdbId: "" }; });
}


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

// ---------- subtitle helpers ----------
// VidBolt's resolve API drops subtitle files in two places, and the
// provider used to ignore both:
//   1. `stream.subtitles[]` (callisto family): real .srt files on
//      cacdn.hakunaymatata.com, CloudFront-signed (~8h). `label`/`lang`
//      are language NAMES, often in native script (اَلْعَرَبِيَّةُ,
//      বাংলা, Español) — mapped to ISO codes with the table below;
//      an unrecognised non-ASCII name is SKIPPED, never guessed
//      (the VidLink lesson: a naive first-2-letters fallback made
//      garbage codes).
//   2. `source.master` (orion/rousav family): the embedded master
//      playlist carries #EXT-X-MEDIA:TYPE=SUBTITLES renditions
//      (English for movies, up to 32 languages for TV). The URI is
//      relative to the master URL and fetches 200 bare (no api_key
//      needed); it resolves to a .vtt segment playlist.
// The .srt list is preferred when present; the master renditions
// are the fallback. Either way the same set is attached to every
// emitted row (the subtitles belong to the title, not to one server).
var ZXC_LANG_NAMES = {
  "english": "en", "british english": "en", "english [cc]": "en",
  "arabic": "ar", "اَلْعَرَبِيَّةُ": "ar", "arabic (egyptian)": "ar",
  "bengali": "bn", "বাংলা": "bn",
  "spanish": "es", "español": "es", "european spanish": "es", "latin american spanish": "es",
  "french": "fr", "français": "fr",
  "german": "de", "deutsch": "de",
  "italian": "it", "italiano": "it",
  "portuguese": "pt", "português": "pt", "brazilian portuguese": "pt", "português (brasil)": "pt",
  "russian": "ru", "русский": "ru",
  "hindi": "hi", "हिन्दी": "hi", "हिंदी": "hi",
  "chinese": "zh", "chinese (simplified)": "zh", "chinese (traditional)": "zh", "中文": "zh",
  "japanese": "ja", "日本語": "ja",
  "korean": "ko", "한국어": "ko",
  "tamil": "ta", "தமிழ்": "ta",
  "telugu": "te", "తెలుగు": "te",
  "malayalam": "ml", "മലയാളം": "ml",
  "marathi": "mr", "मराठी": "mr",
  "punjabi": "pa", "ਪੰਜਾਬੀ": "pa",
  "urdu": "ur", "اُردُو": "ur",
  "indonesian": "id", "bahasa indonesia": "id",
  "malay": "ms", "bahasa melayu": "ms",
  "vietnamese": "vi", "tiếng việt": "vi",
  "thai": "th", "ไทย": "th",
  "filipino": "tl",
  "dutch": "nl", "nederlands": "nl",
  "swedish": "sv", "svenska": "sv",
  "danish": "da", "dansk": "da",
  "finnish": "fi", "suomi": "fi",
  "norwegian": "no", "norsk": "no", "norwegian bokmål": "no",
  "polish": "pl", "polski": "pl",
  "turkish": "tr", "türkçe": "tr",
  "ukrainian": "uk", "українська": "uk",
  "czech": "cs", "čeština": "cs",
  "greek": "el", "ελληνικά": "el",
  "hebrew": "he", "עברית": "he",
  "romanian": "ro", "română": "ro",
  "hungarian": "hu", "magyar": "hu",
  "icelandic": "is", "íslenska": "is",
  "croatian": "hr", "hrvatski": "hr",
  "serbian": "sr", "српски": "sr",
  "bulgarian": "bg", "български": "bg",
  "catalan": "ca", "català": "ca",
  "persian": "fa", "فارسی": "fa",
  "turkmen": "tk"
};
var ZXC_LANG_CODES3 = {
  eng: "en", ara: "ar", ben: "bn", spa: "es", fre: "fr", fra: "fr",
  ger: "de", deu: "de", ita: "it", por: "pt", rus: "ru", hin: "hi",
  chi: "zh", zho: "zh", jpn: "ja", kor: "ko", tam: "ta", tel: "te",
  mal: "ml", mar: "mr", pan: "pa", urd: "ur", ind: "id", msa: "ms",
  vie: "vi", tha: "th", fil: "tl", nld: "nl", swe: "sv", dan: "da",
  fin: "fi", nor: "no", nob: "no", pol: "pl", tur: "tr", ukr: "uk",
  ces: "cs", cze: "cs", ell: "el", heb: "he", ron: "ro", rum: "ro",
  hun: "hu", isl: "is", hrv: "sr", srp: "sr", bul: "bg", cat: "ca",
  fas: "fa", per: "fa", tuk: "tk"
};
var ZXC_LANG_CODES2 = {
  en: 1, ar: 1, bn: 1, es: 1, fr: 1, de: 1, it: 1, pt: 1, ru: 1, hi: 1,
  zh: 1, ja: 1, ko: 1, ta: 1, te: 1, ml: 1, mr: 1, pa: 1, ur: 1, id: 1,
  ms: 1, vi: 1, th: 1, tl: 1, nl: 1, sv: 1, da: 1, fi: 1, no: 1, nb: 1,
  pl: 1, tr: 1, uk: 1, cs: 1, el: 1, he: 1, ro: 1, hu: 1, is: 1, hr: 1,
  sr: 1, bg: 1, ca: 1, fa: 1, tk: 1, af: 1, sq: 1, am: 1, az: 1, be: 1,
  cy: 1, et: 1, eu: 1, ga: 1, gl: 1, gu: 1, ha: 1, hy: 1, ka: 1, kk: 1,
  km: 1, kn: 1, ku: 1, ky: 1, la: 1, lb: 1, lo: 1, lt: 1, lv: 1, mk: 1,
  mn: 1, ne: 1, ps: 1, sa: 1, si: 1, sk: 1, sl: 1, so: 1, st: 1, su: 1,
  sw: 1, tg: 1, ug: 1, uz: 1, yi: 1, yo: 1, zu: 1
};
// Language name or playlist LANGUAGE tag -> ISO 639-1 code, or "" to skip.
// Handles "English", "Español", native-script names, and tags like
// "en-GB.[CC]", "pt-BR", "zh-Hans" (primary subtag wins; nb -> no).
function zxcNormLang(raw) {
  var s = String(raw || "").toLowerCase().trim();
  if (!s) return "";
  s = s.replace(/\[cc\]/g, "").replace(/\s+/g, " ").trim();
  if (ZXC_LANG_NAMES[s]) return ZXC_LANG_NAMES[s];
  var noParen = s.replace(/\s*\([^)]*\)/g, "").trim();
  if (noParen !== s && ZXC_LANG_NAMES[noParen]) return ZXC_LANG_NAMES[noParen];
  var head = s.split(/[-. ]/)[0];
  if (ZXC_LANG_CODES2[head]) return head === "nb" ? "no" : head;
  if (ZXC_LANG_CODES3[head]) return ZXC_LANG_CODES3[head];
  return "";
}

var ZXC_LANG_DISPLAY = {
  en: "English", ar: "Arabic", bn: "Bengali", es: "Spanish", fr: "French",
  de: "German", it: "Italian", pt: "Portuguese", ru: "Russian", hi: "Hindi",
  zh: "Chinese", ja: "Japanese", ko: "Korean", ta: "Tamil", te: "Telugu",
  ml: "Malayalam", mr: "Marathi", pa: "Punjabi", ur: "Urdu",
  id: "Indonesian", ms: "Malay", vi: "Vietnamese", th: "Thai",
  tl: "Filipino", nl: "Dutch", sv: "Swedish", da: "Danish",
  fi: "Finnish", no: "Norwegian", pl: "Polish", tr: "Turkish",
  uk: "Ukrainian", cs: "Czech", el: "Greek", he: "Hebrew",
  ro: "Romanian", hu: "Hungarian", is: "Icelandic", hr: "Croatian",
  sr: "Serbian", bg: "Bulgarian", ca: "Catalan", fa: "Persian",
  tk: "Turkmen", af: "Afrikaans", sq: "Albanian", am: "Amharic",
  az: "Azerbaijani", be: "Belarusian", cy: "Welsh", et: "Estonian",
  eu: "Basque", ga: "Irish", gl: "Galician", gu: "Gujarati",
  ha: "Hausa", hy: "Armenian", ka: "Georgian", kk: "Kazakh",
  km: "Khmer", kn: "Kannada", ku: "Kurdish", ky: "Kyrgyz",
  la: "Latin", lb: "Luxembourgish", lo: "Lao", lt: "Lithuanian",
  lv: "Latvian", mk: "Macedonian", mn: "Mongolian", ne: "Nepali",
  ps: "Pashto", sa: "Sanskrit", si: "Sinhala", sk: "Slovak",
  sl: "Slovenian", so: "Somali", st: "Sesotho", su: "Sundanese",
  sw: "Swahili", tg: "Tajik", ug: "Uyghur", uz: "Uzbek",
  yi: "Yiddish", yo: "Yoruba", zu: "Zulu"
};

function zxcSubsFromApi(list) {
  var out = [], seen = {};
  (Array.isArray(list) ? list : []).forEach(function (entry, idx) {
    if (!entry || typeof entry !== "object") return;
    var url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url || !/^https?:\/\//i.test(url)) return;
    var display = String(entry.label || entry.lang || "").trim();
    var lang = zxcNormLang(entry.lang || entry.label || "");
    if (!lang || seen[lang]) return;
    seen[lang] = 1;
    // `language` is what formatStreamSize shows in the 💬 line, so it
    // carries the plain English name; `label` keeps the source's own
    // name (often native script) for fidelity.
    out.push({ id: "zxc-" + lang + "-" + idx, url: url, lang: lang, language: ZXC_LANG_DISPLAY[lang] || display || lang, label: display || lang });
  });
  return out;
}

function zxcSubsFromMaster(masterText, baseUrl) {
  var out = [], seen = {};
  if (!masterText || !baseUrl) return out;
  var re = /#EXT-X-MEDIA:TYPE=SUBTITLES[^\n]*/gi, m, idx = 0;
  var dir = "";
  try { var u = new URL(baseUrl); dir = u.origin + u.pathname.replace(/[^/]*$/, ""); } catch (e) { return out; }
  while ((m = re.exec(masterText)) !== null) {
    var line = m[0];
    var uri = /URI="([^"]+)"/i.exec(line);
    if (!uri || !uri[1]) continue;
    var url = uri[1];
    if (!/^https?:\/\//i.test(url)) {
      try { url = new URL(url, dir).href; } catch (e) { continue; }
    }
    var langRaw = /LANGUAGE="([^"]+)"/i.exec(line);
    var name = /NAME="([^"]+)"/i.exec(line);
    var display = name ? name[1] : "";
    var lang = zxcNormLang(langRaw ? langRaw[1] : display);
    if (!lang) continue;
    if (seen[lang]) {
      // Prefer a plain "English" rendition over a "[CC]" one when the
      // master lists both (it lists en-GB.[CC], en.[CC], then en).
      var prev = out[seen[lang]];
      if (prev && /\[cc\]/i.test(prev.label || "") && !/\[cc\]/i.test(display)) {
        out[seen[lang]] = { id: prev.id, url: url, lang: lang, language: ZXC_LANG_DISPLAY[lang] || display || lang, label: display || lang };
      }
      continue;
    }
    seen[lang] = out.length;
    out.push({ id: "zxc-" + lang + "-m" + (idx++), url: url, lang: lang, language: ZXC_LANG_DISPLAY[lang] || display || lang, label: display || lang });
  }
  return out;
}

// English first (stable) so the row label's first 💬 languages are the
// ones most viewers want; the rest keep the source's order.
function zxcSortSubs(subs) {
  var en = [], rest = [];
  subs.forEach(function (s) { if (s.lang === "en") en.push(s); else rest.push(s); });
  return en.concat(rest);
}

function zxcResolve(server, mediaType, tmdbId, seasonNum, episodeNum) {
  var q = "type=" + mediaType + "&id=" + tmdbId;
  if (mediaType === "tv") q += "&season=" + (seasonNum || 1) + "&episode=" + (episodeNum || 1);
  q += "&prefer=" + encodeURIComponent(server.id);
  return zxcFetchText(VIDBOLT_BASE + "/api/resolve?" + q, zxcEmbedUrl(mediaType, tmdbId, seasonNum, episodeNum)).then(function (txt) {
    var out = { sources: [], subtitles: [], masterSubs: [] };
    var j = null;
    try { j = JSON.parse(txt || ""); } catch (e) {}
    var sources = (j && j.stream && j.stream.sources) || [];
    sources.forEach(function (src) {
      if (src && src.url) {
        out.sources.push({ url: src.url, quality: src.quality || "", server: server.name });
        // Fallback subtitles live in the source's own embedded master
        // playlist (orion/rousav family); parse them per source.
        if (typeof src.master === "string" && src.master) {
          out.masterSubs = out.masterSubs.concat(zxcSubsFromMaster(src.master, src.url));
        }
      }
    });
    // Primary subtitles: the resolve response's own .srt file list
    // (callisto family). Collected even when this server's sources
    // are all dead (dash-hls-bridge) — they belong to the title.
    out.subtitles = zxcSubsFromApi(j && j.stream && j.stream.subtitles);
    return out;
  }).catch(function () { return { sources: [], subtitles: [], masterSubs: [] }; });
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
// ---- Subtitle addon (Infinite Streams Subtitles, Cloudflare Worker) ----
// The provider asks the addon for this title's subtitles instead of
// calling SubDL/Wyzie/mirror directly. The addon returns its ranked list
// (Sunsync pre-synced first, then SubDL, Wyzie, mirror); the provider
// picks the best match per row with the existing token scorer, so each
// stream carries the subtitle that fits its own release. The addon needs
// the user's keys in the URL config to return SubDL/Wyzie results —
// without them it returns Sunsync + mirror only. Pure-JS base64url
// (no Buffer/btoa in the TV guest); keys are ASCII so one char = one byte.
var ADDON_BASE = 'https://infinite-subtitles.teghvirsingh-work.workers.dev';
function b64urlEncodeAscii(str) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  for (var i = 0; i < str.length; i += 3) {
    var c1 = str.charCodeAt(i) & 255;
    var c2 = (i + 1 < str.length) ? str.charCodeAt(i + 1) & 255 : NaN;
    var c3 = (i + 2 < str.length) ? str.charCodeAt(i + 2) & 255 : NaN;
    var n = (c1 << 16) | ((isNaN(c2) ? 0 : c2) << 8) | (isNaN(c3) ? 0 : c3);
    out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63] + (isNaN(c2) ? '=' : chars[(n >>> 6) & 63]) + (isNaN(c3) ? '=' : chars[n & 63]);
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function addonConfigStr(sdKeys, wzKeys) {
  var o = {};
  if (sdKeys && sdKeys[0]) o.s = sdKeys[0];
  if (sdKeys && sdKeys[1] && sdKeys[1] !== sdKeys[0]) o.s2 = sdKeys[1];
  if (wzKeys && wzKeys[0]) o.w = wzKeys[0];
  if (wzKeys && wzKeys[1] && wzKeys[1] !== wzKeys[0]) o.w2 = wzKeys[1];
  var has = o.s || o.s2 || o.w || o.w2;
  if (!has) return '';
  return b64urlEncodeAscii(JSON.stringify(o));
}
// One addon call per title; returns the addon's ranked English subtitles
// as {id, url, release} for the per-row matcher. [] on any failure.
function addonSubs(imdbId, isSeries, season, episode, cfg) {
  return Promise.all([getSubdlKeys(cfg), getWyzieKeys(cfg)]).then(function (ks) {
    var cfgStr = addonConfigStr(ks[0], ks[1]);
    var path = isSeries
      ? '/subtitles/series/' + imdbId + ':' + season + ':' + episode + '.json'
      : '/subtitles/movie/' + imdbId + '.json';
    var url = ADDON_BASE + (cfgStr ? '/' + cfgStr : '') + path;
    return fetch(url).then(function (r) {
      if (!r.ok) return [];
      return r.json();
    }).then(function (j) {
      var list = (j && j.subtitles) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        var lang = String(it.lang || '').toLowerCase();
        if (lang !== 'en' && lang !== 'eng') continue;
        var u2 = it.url || '';
        if (u2.indexOf('https://') !== 0) continue;
        var rel = it.movieReleaseName || it.subtitleFileName || '';
        if (!rel) continue;
        out.push({ id: it.id, url: u2, release: rel });
      }
      return out;
    }).catch(function () { return []; });
  }).catch(function () { return []; });
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
// Best subtitle by release fit, with no threshold — returns {sub, score}.
// Used as the fallback when osBestMatch finds nothing: the highest-scoring
// subtitle for this row's release (same resolution class at least) is
// far better than the addon's top-ranked one, which is ranked by source
// quality, not by how well it fits this row. A BluRay-synced subtitle on
// a CAM row scores 0 here and is never picked.
function osBestAny(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0;
  for (var k = 0; k < subs.length; k++) {
    var sf = osReleaseFeatures(subs[k].release);
    var sc = osScore(ff, sf);
    if (sc > bestScore) { bestScore = sc; best = subs[k]; }
  }
  if (!best) return null;
  return { sub: best, score: bestScore };
}
function osAttachSubtitles(rows, imdbId, isSeries, season, episode, cfg) {
  // Subtitles come ONLY from the Infinite Subtitles addon. One addon call
  // per title; the best subtitle for each row’s own release is attached
  // automatically. No direct SubDL/Wyzie/mirror calls from this provider.
  try {
    if (cfg && cfg.osSubtitles === false) return Promise.resolve(rows);
    if (!imdbId || !rows || !rows.length) return Promise.resolve(rows);
    var cleanup = function () {
      for (var c = 0; c < rows.length; c++) { try { delete rows[c]._rel; delete rows[c]._releaseTitle; } catch (e) {} }
      return rows;
    };
    var prep = function () {
      for (var i = 0; i < rows.length; i++) {
        var rel = rows[i]._releaseTitle || '';
        if (!rel && rows[i].url) {
          try { rel = decodeURIComponent(String(rows[i].url).split('/').pop() || '').replace(/.[^.]+$/, ''); } catch (e) {}
        }
        rows[i]._rel = rel;
      }
    };
    prep();
    return addonSubs(imdbId, isSeries, season, episode, cfg).then(function (adSubs) {
      for (var i = 0; i < rows.length; i++) {
        var hit = osBestMatch(rows[i]._rel, adSubs);
        if (!hit) {
          var any = osBestAny(rows[i]._rel, adSubs);
          if (any && any.score >= 1) hit = any.sub;
        }
        if (!hit && adSubs.length) {
          // No release fit at all (e.g. a 480p row when the addon only has
          // 1080p subtitles). The addon only returns subtitles for THIS
          // title, so the top-ranked non-Sunsync one is the right movie —
          // attach it, unless the row is a CAM/TS, where no proper-release
          // subtitle can match the recording's timing.
          var rl = (rows[i]._rel || '').toLowerCase();
          if (rl.indexOf('cam') === -1 && rl.indexOf('ts') === -1) {
            for (var k = 0; k < adSubs.length; k++) {
              var cand = adSubs[k];
              var cid = String(cand.id || '').toLowerCase();
              var crel = String(cand.release || '').toLowerCase();
              if (cid.indexOf('sunsync') === -1 && crel.indexOf('sunsync') === -1) { hit = cand; break; }
            }
          }
        }
        if (hit) rows[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
      }
      return cleanup();
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

function zxcOsCfg() {
  return {
    osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
    subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
    subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
    year: 0
  };
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "tv" : "movie";
  return zxcTmdbMeta(tmdbId, type).then(function (meta) {
    return zxcServers(type, tmdbId, seasonNum, episodeNum).then(function (servers) {
    return Promise.all(servers.map(function (s) { return zxcResolve(s, type, tmdbId, seasonNum, episodeNum); })).then(function (perServer) {
      var seen = {};
      var proxied = [], referred = [], lastResort = [];
      // Subtitles belong to the title, not to one server: prefer the
      // resolve API's .srt file list (any server), else the master
      // playlist renditions parsed from the sources themselves.
      var apiSubs = [], masterSubs = [], seenLang = {};
      perServer.forEach(function (res) {
        (res.subtitles || []).forEach(function (s) { if (!seenLang["a" + s.lang]) { seenLang["a" + s.lang] = 1; apiSubs.push(s); } });
      });
      if (!apiSubs.length) {
        var seenM = {};
        perServer.forEach(function (res) {
          (res.masterSubs || []).forEach(function (s) { if (!seenM["m" + s.lang]) { seenM["m" + s.lang] = 1; masterSubs.push(s); } });
        });
      }
      var subs = zxcSortSubs(apiSubs.length ? apiSubs : masterSubs);
      perServer.forEach(function (res) {
        var list = res.sources || [];
        list.forEach(function (s) {
          if (seen[s.url]) return;
          seen[s.url] = 1;
          if (s.url.indexOf("dash-hls-bridge") !== -1) return;
          var q = /\b(2160p|1080p|720p|480p|360p)\b/i.exec(s.quality || "") ? s.quality : "HD";
          var body = formatStreamSize({ source: "ZXCStream", quality: q, season: type === "tv" ? seasonNum : undefined, episode: type === "tv" ? episodeNum : undefined, server: s.server, url: s.url, subtitles: subs });
          var stream = {
            name: "ZXCStream",
            title: "ZXCStream",
            url: s.url,
            quality: q,
            size: body,
            type: "direct",
            _releaseTitle: (meta.title ? meta.title + " " : "") + q
          };
          if (subs.length) stream.subtitles = subs;
          if (s.url.indexOf("proxy.vidbolt.xyz") !== -1) { proxied.push(stream); return; }
          if (s.url.indexOf("img.rousav.tech") !== -1) { lastResort.push(stream); return; }
          var hdrs = { "Referer": VIDBOLT_BASE + "/", "User-Agent": ZXC_UA };
          stream.headers = hdrs;
          stream.behaviorHints = { notWebReady: true, proxyHeaders: { request: hdrs } };
          referred.push(stream);
        });
      });
      var main = proxied.concat(referred);
      var rows = main.length ? main : lastResort;
      return osAttachSubtitles(rows, meta.imdbId || "", type === "tv", seasonNum || 1, episodeNum || 1, zxcOsCfg());
    });
    }).catch(function () { return []; });
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
