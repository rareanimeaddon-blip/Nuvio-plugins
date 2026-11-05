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

// DesiSerials scraper for Nuvio (Indian TV serials / desi dramas)
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: desiserials.su (content domain; desiserials.to is a landing page).
//
// Chain (all plain HTTP, no timers, no JS execution):
//   TMDB title + episode air_date
//     -> /category/<channel>/<show-slug>/ (newest-first dated episode list)
//     -> episode page -> getlink.php tokens (v=part1, part2, part3)
//     -> freezod.com/hls/media_meta.php?v=<token>&type=player
//     -> source.file = signed play.php URL (1h expiry) -> 302 -> Yandex mp4
//
// The episode page's Watch Now buttons route through a freezod
// redirect chain (searchping getlink -> go.freezod.com -> an article
// landing page that shows an ad above the player). The provider does
// NOT load the article page, does NOT run its scripts, does NOT send
// its release-grant beacon and never invokes the ad schedule: the
// playback metadata endpoint answers with the episode's own token
// alone (verified 2026-11-05), so only playback mechanics are used.
// Serials are date-indexed: TMDB's episode air_date is matched
// against the episode post's date slug; season numbers are ignored
// (these shows run as one long daily run, and TMDB splits some of
// them into dozens of seasons).

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var BASE_URL = "https://www.desiserials.su";
var MEDIA_META = "https://freezod.com/hls/media_meta.php";
var PLAYER_BASE = "https://freezod.com/hls/";

var UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

// TMDB network name (normalised: lowercase, alphanumerics only) ->
// desiserials channel slug.
var CHANNEL_MAP = {
  starplus: "star-plus",
  colorstv: "colors-tv",
  colors: "colors-tv",
  zeetv: "zee-tv",
  sonyentertainmenttelevision: "sony-tv",
  sonytv: "sony-tv",
  sabtv: "sab-tv",
  sonysab: "sab-tv",
  andtv: "and-tv",
  starjalsha: "star-jalsha",
  jiohotstar: "jiohotstar",
  dangaltv: "dangal-tv",
  starbharat: "star-bharat"
};

// ---------- helpers ----------

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function fetchHtml(url, referer, timeoutMs) {
  return fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer || BASE_URL + "/",
    },
  }, timeoutMs || 20000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function fetchJson(url, referer, timeoutMs) {
  return fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer || BASE_URL + "/",
    },
  }, timeoutMs || 12000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function slugifyTitle(t) {
  return foldAccents(String(t || "").toLowerCase()).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
}

var MONTHS = ["january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"];

function ordinal(n) {
  if (n === 1 || n === 21 || n === 31) return n + "st";
  if (n === 2 || n === 22) return n + "nd";
  if (n === 3 || n === 23) return n + "rd";
  return n + "th";
}

function airDateParts(airDate) {
  var p = String(airDate || "").split("-");
  if (p.length !== 3) return null;
  var y = +p[0], m = +p[1], d = +p[2];
  if (!y || !m || m < 1 || m > 12 || !d || d < 1 || d > 31) return null;
  return { year: y, month: m, day: d, slug: ordinal(d) + "-" + MONTHS[m - 1] + "-" + y };
}

function episodeDateFromSlug(slug) {
  var m = /-(\d{1,2})(?:st|nd|rd|th)-([a-z]+)-(\d{4})-/.exec(slug || "");
  if (!m) return null;
  var mi = MONTHS.indexOf(m[2]);
  if (mi < 0) return null;
  return { year: +m[3], month: mi + 1, day: +m[1] };
}

function sameDate(a, b) {
  return !!(a && b && a.year === b.year && a.month === b.month && a.day === b.day);
}

// Show name as it appears in an episode slug, e.g.
// "anupama-4th-november-2026-full-episode-star-plus" -> "anupama".
function showPartFromSlug(slug) {
  var m = /^(.*?)-\d{1,2}(?:st|nd|rd|th)-[a-z]+-\d{4}-full-episode-/.exec(slug || "");
  if (m) return m[1].replace(/-/g, " ");
  return String(slug || "").replace(/-/g, " ");
}

// Exact-title gate (zero-mismatch): every distinctive word of the TMDB title
// must appear as a whole word in the candidate, and the word sets must be
// near-identical (dice >= 0.8) once release/season noise words are dropped.
// Kills false hits like "Breaking Bad" -> "The Bad Guys: Breaking In".
var TITLE_NOISE = { the: 1, a: 1, an: 1, with: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, subtitle: 1, subtitles: 1, subs: 1, multi: 1, audio: 1, complete: 1,
  hevc: 1, x264: 1, x265: 1, h264: 1, webdl: 1, hdtv: 1, bluray: 1, brrip: 1, hdrip: 1,
  "480p": 1, "720p": 1, "1080p": 1, "1440p": 1, "2160p": 1, "4k": 1, uhd: 1, hd: 1,
  watch: 1, download: 1, online: 1, sony: 1, yay: 1, uncensored: 1, uncut: 1, hungama: 1, tamil: 1, telugu: 1 };
var ACCENT_MAP = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
  "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
  "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
function foldAccents(s) {
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function (ch) { return ACCENT_MAP[ch] || ch; });
}
function exactWords(t) {
  var seen = {}, out = [];
  var cleaned = foldAccents(String(t).toLowerCase()).replace(/^download\s+/, "");
  cleaned.replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (w) {
    if (!w || TITLE_NOISE[w] || /^\d+$/.test(w) || /^s\d{1,2}(e\d{1,2})?$/.test(w) || /^e\d{1,2}$/.test(w)) return;
    if (!seen[w]) { seen[w] = 1; out.push(w); }
  });
  return out;
}
var TAIL_JUNK = { mal: 1, ben: 1, jap: 1, kor: 1, chi: 1, eng: 1, hq: 1, dvdrip: 1, xvid: 1, aac: 1,
  proper: 1, repack: 1, extended: 1, unrated: 1, remastered: 1, dual: 1, web: 1, dl: 1 };
function isTailJunk(w) { return !!TAIL_JUNK[w] || /^\d{3,4}p$/.test(w) || /^\d+bit$/.test(w); }
function isExactTitle(queryTitle, candTitle) {
  var q = exactWords(queryTitle), c = exactWords(candTitle);
  if (!q.length || !c.length) return false;
  if (q.join("") === c.join("")) return true; // one-word listings: "Shinchan" == "Shin Chan"
  var cset = {};
  c.forEach(function (w) { cset[w] = 1; });
  var contained = true;
  for (var i = 0; i < q.length; i++) if (!cset[q[i]]) { contained = false; break; }
    if (contained && (2 * q.length) / (q.length + c.length) >= 0.8) return true;
  // Release-junk tail: the title words lead and only tech/release tokens
  // follow (e.g. "Shinchan Season 1 ... 480p HQ DVDRip 10bit HEVC").
  var stripped = [];
  for (var j = 0; j < c.length; j++) { if (!isTailJunk(c[j])) stripped.push(c[j]); }
  if (stripped.length && stripped.join("") === q.join("") && c.slice(0, stripped.length).join("") === q.join("")) return true;
  return false;
}

function tmdbTitle(tmdbId, mediaType) {
  if (!TMDB_API_KEY || TMDB_API_KEY === "<redacted>") return Promise.resolve(null);
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, {}, 12000
  ).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j ? (j.title || j.name || null) : null; })
    .catch(function () { return null; });
}

// TMDB alternative titles (e.g. "Shin Chan" for "Crayon Shin-chan"):
// the site often lists a show under an alias, so when the canonical
// name fails the exact gate, each Latin-script alias gets the same try.
function tmdbAltTitles(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/alternative_titles?api_key=" + TMDB_API_KEY, {}, 12000
  ).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return [];
      var arr = j.results || j.titles || [];
      var out = [], seen = {};
      arr.forEach(function (it) {
        var t = (it && typeof it.title === "string") ? it.title.trim() : "";
        if (!t) return;
        if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0e00-\u0e7f\u0590-\u05ff\u0600-\u06ff]/.test(t)) return;
        var k = t.toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        out.push(t);
      });
      out.sort(function (a, b) { return a.length - b.length; });
      return out.slice(0, 4);
    })
    .catch(function () { return []; });
}

// ---------- TMDB ----------

function tmdbShow(tmdbId) {
  return fetchJson("https://api.themoviedb.org/3/tv/" + tmdbId + "?api_key=" + TMDB_API_KEY, null, 12000)
    .catch(function () { return null; });
}

function tmdbEpisode(tmdbId, season, episode) {
  return fetchJson("https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season +
    "/episode/" + episode + "?api_key=" + TMDB_API_KEY, null, 12000)
    .catch(function () { return null; });
}

// ---------- episode discovery ----------

function parseEpisodeLinks(html) {
  var out = [], seen = {};
  var re = /href="(\/[^"]*?full-episode[^"]*?)"/gi, m;
  while ((m = re.exec(html)) !== null) {
    var path = m[1].split("?")[0];
    var segs = path.replace(/^\/|\/$/g, "").split("/");
    var slug = segs[0] || "";
    if (!slug || seen[slug]) continue;
    seen[slug] = 1;
    out.push({ slug: slug, pageUrl: BASE_URL + path, date: episodeDateFromSlug(slug) });
  }
  return out;
}

function pickDatedEpisode(html, candTitle, airParts) {
  var eps = parseEpisodeLinks(html);
  for (var i = 0; i < eps.length; i++) {
    if (!eps[i].date || !sameDate(eps[i].date, airParts)) continue;
    if (!isExactTitle(candTitle, showPartFromSlug(eps[i].slug))) continue;
    return eps[i].pageUrl;
  }
  return null;
}

// One category base (page 1, then pages 2-3 only if page 1 exists).
// A 404 means the category does not exist -> null, one fetch spent.
function searchCategory(base, candTitle, airParts) {
  return fetchHtml(base, BASE_URL + "/", 20000).then(function (html) {
    var hit = pickDatedEpisode(html, candTitle, airParts);
    if (hit) return hit;
    var pchain = Promise.resolve(null);
    [base + "page/2/", base + "page/3/"].forEach(function (u) {
      pchain = pchain.then(function (g) {
        if (g) return g;
        return fetchHtml(u, BASE_URL + "/", 20000)
          .then(function (h2) { return pickDatedEpisode(h2, candTitle, airParts); })
          .catch(function () { return null; });
      });
    });
    return pchain;
  }).catch(function () { return null; });
}

function tryCandidate(candTitle, channel, airParts) {
  var slug = slugifyTitle(candTitle);
  if (!slug) return Promise.resolve(null);
  var bases = [];
  if (channel) bases.push(BASE_URL + "/category/" + channel + "/" + slug + "/");
  bases.push(BASE_URL + "/category/" + slug + "/");
  var chain = Promise.resolve(null);
  bases.forEach(function (base) {
    chain = chain.then(function (got) {
      if (got) return got;
      return searchCategory(base, candTitle, airParts);
    });
  });
  return chain;
}

// Last resort: the site's own search (?s=). Its index window is
// narrow (verified 2026-11-05: only a ~2-week slice per show), so
// this only ever rescues episodes the category walk missed.
function trySearch(candTitle, airParts) {
  return fetchHtml(BASE_URL + "/search.php?s=" + encodeURIComponent(candTitle), BASE_URL + "/", 20000)
    .then(function (html) { return pickDatedEpisode(html, candTitle, airParts); })
    .catch(function () { return null; });
}

// ---------- episode page -> part tokens -> streams ----------

function getPartTokens(pageUrl) {
  return fetchHtml(pageUrl, BASE_URL + "/", 20000).then(function (html) {
    var re = /https?:\/\/freezod\.searchping\.com\/desiserials\/getlink\.php\?[^"'\s<>]+/gi, m;
    var link = null;
    while ((m = re.exec(html)) !== null) { link = m[0].replace(/&amp;/g, "&"); break; }
    if (!link) return null;
    var q = link.split("?")[1] || "";
    var params = {};
    q.split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) params[kv.slice(0, i)] = kv.slice(i + 1);
    });
    var parts = [];
    if (params.v) parts.push(params.v);
    if (params.part2) parts.push(params.part2);
    if (params.part3) parts.push(params.part3);
    return parts.length ? parts : null;
  }).catch(function () { return null; });
}

function resolvePart(token) {
  // media_meta.php rejects a foreign Referer (403), and the Yandex file
  // behind play.php rejects ANY Referer, so this call sends none at all.
  var url = MEDIA_META + "?v=" + encodeURIComponent(token) + "&type=player";
  return fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,*/*;q=0.8",
    },
  }, 12000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function (j) {
    if (!j || !j.source || !j.source.file) return null;
    var f = String(j.source.file);
    var abs = /^https?:\/\//i.test(f) ? f : PLAYER_BASE + f.replace(/^\//, "");
    return { url: abs, mime: j.source.mimeType || "video/mp4", title: j.source.title || "" };
  }).catch(function () { return null; });
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

// ---------- main ----------

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== "tv") return Promise.resolve([]); // serials only, no movies
  var season = seasonNum || 1;
  var episode = episodeNum || 1;
  return Promise.all([tmdbShow(tmdbId), tmdbEpisode(tmdbId, season, episode)]).then(function (pair) {
    var show = pair[0], ep = pair[1];
    if (!show || !show.name) return [];
    var title = show.name;
    var airParts = ep && ep.air_date ? airDateParts(ep.air_date) : null;
    if (!airParts) return []; // no air date -> cannot find the dated post
    var channel = null;
    try {
      var nets = show.networks || [];
      if (nets.length) channel = CHANNEL_MAP[normKey(nets[0].name)] || null;
    } catch (e) {}
    return tmdbAltTitles(tmdbId, "tv").then(function (alts) {
      var seen = {}, cands = [];
      [title].concat(alts || []).forEach(function (c) {
        var k = String(c || "").toLowerCase();
        if (c && !seen[k]) { seen[k] = 1; cands.push(c); }
      });
      var chain = Promise.resolve(null);
      cands.forEach(function (cand) {
        chain = chain.then(function (got) {
          if (got) return got;
          return tryCandidate(cand, channel, airParts);
        });
      });
      return chain.then(function (epUrl) {
        if (epUrl) return epUrl;
        var schain = Promise.resolve(null);
        cands.forEach(function (cand) {
          schain = schain.then(function (got) {
            if (got) return got;
            return trySearch(cand, airParts);
          });
        });
        return schain;
      });
    }).then(function (epUrl) {
      if (!epUrl) return [];
      return getPartTokens(epUrl).then(function (tokens) {
        if (!tokens) return [];
        return Promise.all(tokens.map(function (t) { return resolvePart(t); }))
          .then(function (metas) {
            var streams = [];
            metas.forEach(function (mt, idx) {
              if (!mt) return;
              var pm = /Part\s+(\d+)/i.exec(mt.title || "");
              var partNo = pm ? pm[1] : String(idx + 1);
              var lbl = formatStreamLabel({
                source: "DesiSerials", title: title, quality: "720p",
                season: season, episode: episode, audio: "Hindi",
                url: mt.url, extra: "Part " + partNo
              });
              // No Referer: the Yandex file behind play.php 403s on ANY
              // Referer (verified 2026-11-05); UA + Accept alone play.
              var ph = { "User-Agent": UA, Accept: "*/*" };
              streams.push({
                name: lbl,
                title: lbl,
                url: mt.url,
                quality: "720p",
                type: "direct",
                headers: ph,
                behaviorHints: { notWebReady: false, proxyHeaders: { request: ph } },
              });
            });
            return streams;
          });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.DesiSerialsScraperModule = { getStreams: getStreams };
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
