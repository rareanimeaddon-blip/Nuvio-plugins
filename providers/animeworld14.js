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



// AnimeWorld scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: AnimeWorld provider (watchanimeworld.top search -> episode page ->
// Zephyr iframe -> player API securedLink).
// NOTE: only the Zephyr player is used (Abyss/dub-player iframes are skipped,
// same as the source provider). The source provider proxied streams through
// its own server; here we resolve the Zephyr player API directly and return
// the securedLink as a direct URL.

var BASE = "https://watchanimeworld.top";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var TIMEOUT = 20000;
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function getHtml(url, extraHeaders) {
  var headers = Object.assign(
    { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    extraHeaders || {}
  );
  return fetchWithTimeout(url, { headers: headers }, TIMEOUT)
    .then(function (r) { return r.ok ? r.text() : null; })
    .catch(function () { return null; });
}

function tmdbTitle(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY,
    { headers: { Accept: "application/json" } },
    10000
  )
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j ? (j.title || j.name) : null; })
    .catch(function () { return null; });
}

// TMDB alternative titles (e.g. "Shin Chan" for "Crayon Shin-chan"):
// sites often list a show under an alias, so when the canonical name
// fails the exact gate, each Latin-script alias gets the same gated try.
function tmdbAltTitles(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/alternative_titles?api_key=" + TMDB_API_KEY,
    { headers: { Accept: "application/json" } },
    10000
  )
    .then(function (r) { return r.ok ? r.json() : null; })
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

function norm(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}
function compact(s) { return norm(s).replace(/\s+/g, ""); }
function score(a, b) {
  if (compact(a) === compact(b) && compact(a)) return 1;
  var x = norm(a).split(" ").filter(Boolean);
  var y = norm(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return 0;
  var yset = {};
  y.forEach(function (v) { yset[v] = 1; });
  var hit = 0;
  x.forEach(function (v) { if (yset[v]) hit++; });
  return (2 * hit) / (x.length + y.length);
}

// Exact-title gate (zero-mismatch): every distinctive word of the TMDB title
// must appear as a whole word in the candidate, and the word sets must be
// near-identical (dice >= 0.8) once release/season noise words are dropped.
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
function exactWords(s) {
  var seen = {}, out = [];
  norm(foldAccents(String(s).toLowerCase())).split(" ").forEach(function (w) {
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

function searchVariants(title) {
  var beforeColon = title.split(":")[0].trim();
  var hyphenToSpace = title.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  var collapsed = title.replace(/[-\s]+/g, "").trim();
  var seen = {};
  return [title, beforeColon, hyphenToSpace, collapsed].filter(function (v) {
    v = (v || "").trim();
    if (v.length <= 2 || seen[v]) return false;
    seen[v] = 1;
    return true;
  });
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseSearchResults(html) {
  var out = [];
  var seen = {};
  var blockRe = /<(li|article)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  var m, block;
  while ((m = blockRe.exec(html)) !== null) {
    block = m[2];
    var aM = /<a\b[^>]*\bclass="[^"]*\blnk-blk\b[^"]*"[^>]*\bhref="([^"]+)"/i.exec(block) ||
             /<a\b[^>]*\bhref="([^"]+)"[^>]*\bclass="[^"]*\blnk-blk\b[^"]*"/i.exec(block);
    var hM = /<h[12]\b[^>]*\bclass="[^"]*\bentry-title\b[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/i.exec(block);
    if (!aM || !hM) continue;
    var href = aM[1];
    var name = stripTags(hM[1]);
    if (!href || !name) continue;
    var absolute;
    try { absolute = new URL(href, BASE).toString(); } catch (e) { continue; }
    var path;
    try { path = new URL(absolute).pathname; } catch (e) { continue; }
    var slug = path.replace(/\/+$/, "").split("/").pop() || "";
    if (!slug || seen[slug]) continue;
    seen[slug] = 1;
    out.push({
      slug: slug,
      title: name,
      type: path.indexOf("/movies/") !== -1 ? "movie" : "series",
    });
  }
  return out;
}

function findAnimeWorldSlug(title, type) {
  var queries = searchVariants(title);
  var all = {};
  var chain = Promise.resolve();
  queries.forEach(function (q) {
    chain = chain.then(function () {
      return getHtml(BASE + "/?s=" + encodeURIComponent(q)).then(function (html) {
        if (!html) return;
        parseSearchResults(html).forEach(function (item) {
          all[item.type + ":" + item.slug] = item;
        });
      }).catch(function () {});
    });
  });
  return chain.then(function () {
    var pool = Object.keys(all).map(function (k) { return all[k]; });
    var typed = pool.filter(function (c) { return c.type === type; });
    var list = typed.length ? typed : pool;
    list = list.filter(function (c) { return isExactTitle(title, c.title); });
    list.sort(function (a, b) { return score(b.title, title) - score(a.title, title); });
    var best = list[0];
    if (best) return { slug: best.slug, title: best.title };
    return null;
  });
}

function tagAttr(tag, name) {
  var m = new RegExp(name + '\\s*=\\s*"([^"]*)"', "i").exec(tag) ||
          new RegExp(name + "\\s*=\\s*'([^']*)'", "i").exec(tag);
  return m ? m[1] : "";
}

function extractIframes(html) {
  var out = [];
  var re = /<iframe\b[^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var tag = m[0];
    var src = tagAttr(tag, "src").trim();
    var lazy = tagAttr(tag, "data-src").trim();
    var raw = (src && !/^(about:blank|javascript:)/i.test(src)) ? src : lazy;
    if (raw) out.push(raw.replace(/&amp;/g, "&"));
  }
  return out;
}

// Resolve a Zephyr player page to its direct video URL via the player API.
function harvestCookies(res, jar) {
  try {
    var raw = null;
    if (res.headers && typeof res.headers.getSetCookie === "function") raw = res.headers.getSetCookie();
    else if (res.headers && res.headers.get) { var sc = res.headers.get("set-cookie"); if (sc) raw = [sc]; }
    if (!raw) return;
    (Array.isArray(raw) ? raw : [raw]).forEach(function (line) {
      String(line).split(/,\s*(?=[A-Za-z0-9_.\-]+)/).forEach(function (part) {
        var m = /^\s*([A-Za-z0-9_.\-]+)=([^;]*)/.exec(part);
        if (m && m[2] && part.indexOf("=") < part.indexOf(";")) jar[m[1]] = m[2];
      });
    });
  } catch (e) {}
}
function jarString(jar) {
  var ks = Object.keys(jar);
  return ks.length ? ks.map(function (k) { return k + "=" + jar[k]; }).join("; ") : "";
}

// The Zephyr CDN refuses requests that do not look like its own
// player session: the web player arrives with the player page as
// Referer and the cookies the player page + API set. Replicate that
// session during resolution and hand it to the app with the stream -
// streams previously carried none of it and failed at playback.
function resolveZephyr(playerUrl, pageReferer) {
  var idM = /\/video\/([A-Za-z0-9_-]+)/i.exec(playerUrl);
  if (!idM) return Promise.resolve(null);
  var id = idM[1];
  var origin;
  try { origin = new URL(playerUrl).origin; } catch (e) { return Promise.resolve(null); }
  var apiUrl = origin + "/player/index.php?data=" + encodeURIComponent(id) + "&do=getVideo";
  var body = "hash=" + encodeURIComponent(id) + "&r=" + encodeURIComponent(playerUrl);
  var jar = {};
  return fetchWithTimeout(playerUrl, {
    headers: { "User-Agent": UA, "Referer": pageReferer || playerUrl },
  }, 15000)
    .then(function (r) { harvestCookies(r, jar); return null; })
    .catch(function () { return null; })
    .then(function () {
      var headers = {
        "User-Agent": UA,
        "Referer": playerUrl,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
      };
      var ck = jarString(jar);
      if (ck) headers.Cookie = ck;
      return fetchWithTimeout(apiUrl, { method: "POST", headers: headers, body: body }, 15000);
    })
    .then(function (r) { harvestCookies(r, jar); return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return null;
      var raw = j.securedLink || j.videoSource;
      if (!raw) return null;
      return { url: String(raw), referer: playerUrl, cookie: jarString(jar) };
    })
    .catch(function () { return null; });
}

function qualityFromUrl(url) {
  var m = /(\d{3,4})p/i.exec(url || "");
  return m ? m[1] + "p" : "Unknown";
}

// The site renumbered some seasons (e.g. Naruto Shippuden S10 is now
// 10x197..10x221 instead of 10x1..), so a guessed {slug}-{s}x{e} episode
// URL can 404 even though the season exists. Fall back to the season's own
// episode list (the same admin-ajax endpoint the site's Season tabs use)
// and pick the entry positionally. Matches the site's ascending order.
function resolveEpisodePage(match, seasonNum, episodeNum) {
  var guessed = BASE + "/episode/" + match.slug + "-" + (seasonNum || 1) + "x" + (episodeNum || 1) + "/";
  return getHtml(guessed).then(function (html) {
    if (html) return { url: guessed, html: html };
    return getHtml(BASE + "/anime/" + match.slug).then(function (seriesHtml) {
      if (!seriesHtml) return null;
      var pm = /data-post\s*=\s*"(\d+)"/i.exec(seriesHtml);
      if (!pm) return null;
      var ajaxUrl = BASE + "/wp-admin/admin-ajax.php?action=action_select_season" +
        "&season=" + encodeURIComponent(seasonNum || 1) +
        "&post=" + encodeURIComponent(pm[1]);
      return getHtml(ajaxUrl).then(function (listHtml) {
        if (!listHtml) return null;
        var seen = {}, list = [], re = /\/episode\/[A-Za-z0-9_-]+\//gi, m;
        while ((m = re.exec(listHtml)) !== null) {
          if (!seen[m[0]]) { seen[m[0]] = 1; list.push(m[0]); }
        }
        var idx = (episodeNum || 1) - 1;
        if (idx < 0 || idx >= list.length) return null;
        var url;
        try { url = new URL(list[idx], BASE).toString(); } catch (e) { return null; }
        return getHtml(url).then(function (epHtml) {
          return epHtml ? { url: url, html: epHtml } : null;
        });
      });
    });
  });
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

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return null;
    return findAnimeWorldSlug(title, type).then(function (match) {
      if (match) return match;
      return tmdbAltTitles(tmdbId, mediaType).then(function (alts) {
        var chain = Promise.resolve(null);
        alts.forEach(function (alt) {
          chain = chain.then(function (got) { return got || findAnimeWorldSlug(alt, type); });
        });
        return chain;
      });
    });
  }).then(function (match) {
    if (!match) return [];
    var moviePage = type === "movie" ? BASE + "/movies/" + match.slug : null;
    var pagePromise = moviePage
      ? getHtml(moviePage).then(function (html) { return html ? { url: moviePage, html: html } : null; })
      : resolveEpisodePage(match, seasonNum, episodeNum);
    return pagePromise.then(function (res) {
      if (!res) return [];
      var page = res.url, html = res.html;
      var seen = {};
      var zephyrs = [];
      extractIframes(html).forEach(function (raw) {
        var u;
        try { u = new URL(raw, page).toString(); } catch (e) { return; }
        var path;
        try { path = new URL(u).pathname; } catch (e) { return; }
        if (/\/dub-player\/t\/\d+\/?$/.test(path)) return; // nested dub page: abyss only
        if (!/zephyr/i.test(u)) return; // keep Zephyr only, like the source
        if (seen[u]) return;
        seen[u] = 1;
        zephyrs.push(u);
      });
      // Resolve with limited parallelism.
      var results = [];
      var i = 0;
      function next() {
        if (i >= zephyrs.length) return Promise.resolve();
        var batch = zephyrs.slice(i, i + 3);
        i += 3;
        return Promise.all(batch.map(function (u) {
          return resolveZephyr(u, page).then(function (direct) {
            if (direct) results.push(direct);
          });
        })).then(next);
      }
      return next().then(function () {
        var seenUrl = {};
        return results.filter(function (o) {
          if (seenUrl[o.url]) return false;
          seenUrl[o.url] = 1;
          return true;
        }).map(function (o) {
          var h = { Referer: o.referer, "User-Agent": UA };
          if (o.cookie) h.Cookie = o.cookie;
          return {
            name: formatStreamLabel({ title: match.title, quality: qualityFromUrl(o.url), season: type === "series" ? seasonNum : undefined, episode: type === "series" ? episodeNum : undefined, source: "AnimeWorld", server: "ZephyrFlick", url: o.url }),
            title: formatStreamLabel({ title: match.title, quality: qualityFromUrl(o.url), season: type === "series" ? seasonNum : undefined, episode: type === "series" ? episodeNum : undefined, source: "AnimeWorld", server: "ZephyrFlick", url: o.url }),
            url: o.url,
            quality: qualityFromUrl(o.url),
            type: "direct",
            headers: h,
            behaviorHints: { notWebReady: true, proxyHeaders: { request: h } },
          };
        });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.AnimeWorldScraperModule = { getStreams: getStreams };
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
