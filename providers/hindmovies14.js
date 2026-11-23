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



// HindMovies provider (v1.hindmovie.im) — rebuilt 2026-10-20.
// 2026-10-28: site moved permanently (hindmovie.one 301s to hindmovie.tax),
// so BASE_URL points at the current domain instead of relying on the
// redirect hop on every API call.
// 2026-11-01: site moved again — hindmovie.tax 301s to the hindmovie.dad
// landing page (which forwards to v1.hindmovie.im via /current.php), so
// the wp-json search on the old domain returns landing-page HTML and
// yields 0 for every title. BASE_URL now points straight at
// v1.hindmovie.im, where the WordPress API answers normally. No gate,
// chain, or extraction change.
// Flow: TMDB -> wp-json search (exact-title gate + year) -> wp-json post ->
// per-quality download buttons (links/episode.joshapp.blog) -> file page
// (boldb.site / hshare.lol, server redirects to the landing page) ->
// GDShine button -> GDShine API -> direct worker file URL (verified 206/MKV).
// The old provider returned raw unsigned file-host URLs as "direct" streams
// and matched titles loosely (it served Love Lies Bleeding for Jawan);
// this rebuild resolves to verified direct files and gates titles exactly.

var BASE_URL = "https://v1.hindmovie.im";
var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var REQ_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

function fetchWithTimeout(url, options, timeoutMs) {
  return fetch(url, options || {});
}
function getHtml(url, timeoutMs) {
  return fetchWithTimeout(url, { headers: REQ_HEADERS }, timeoutMs || 12000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}
function getJson(url, timeoutMs) {
  return fetchWithTimeout(url, { headers: REQ_HEADERS }, timeoutMs || 10000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}
function stripTags(s) {
  return String(s == null ? "" : s)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- exact-title gate (v3, shared design) ----------
var TITLE_NOISE = { the: 1, a: 1, an: 1, with: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, subtitle: 1, subtitles: 1, subs: 1, multi: 1, audio: 1, complete: 1,
  hevc: 1, x264: 1, x265: 1, h264: 1, webdl: 1, hdtv: 1, bluray: 1, brrip: 1, hdrip: 1,
  "480p": 1, "720p": 1, "1080p": 1, "1440p": 1, "2160p": 1, "4k": 1, uhd: 1, hd: 1,
  watch: 1, download: 1, online: 1, sony: 1, yay: 1, uncensored: 1, uncut: 1, hungama: 1, tamil: 1, telugu: 1 };
var TAIL_JUNK = { mal: 1, ben: 1, jap: 1, kor: 1, chi: 1, eng: 1, hq: 1, dvdrip: 1, xvid: 1, aac: 1,
  proper: 1, repack: 1, extended: 1, unrated: 1, remastered: 1, dual: 1, web: 1, dl: 1 };
function isTailJunk(w) { return !!TAIL_JUNK[w] || /^\d{3,4}p$/.test(w) || /^\d+bit$/.test(w); }
var ACCENT_MAP = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
  "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
  "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
function foldAccents(s) {
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function (ch) { return ACCENT_MAP[ch] || ch; });
}
function exactWords(value) {
  var seen = {}, out = [];
  foldAccents(String(value).toLowerCase()).replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (w) {
    if (!w || TITLE_NOISE[w] || /^\d+$/.test(w) || /^s\d{1,2}(e\d{1,2})?$/.test(w) || /^e\d{1,2}$/.test(w)) return;
    if (!seen[w]) { seen[w] = 1; out.push(w); }
  });
  return out;
}
function isExactTitle(queryTitle, candTitle) {
  var q = exactWords(queryTitle), c = exactWords(candTitle);
  if (!q.length || !c.length) return false;
  if (q.join("") === c.join("")) return true; // one-word listings: "Shinchan" == "Shin Chan"
  var cset = {};
  c.forEach(function (w) { cset[w] = 1; });
  var contained = true;
  for (var i = 0; i < q.length; i++) if (!cset[q[i]]) { contained = false; break; }
  if (contained && (2 * q.length) / (q.length + c.length) >= 0.8) return true;
  // Release-junk tail: title words lead, only tech/release tokens follow.
  var stripped = [];
  for (var j = 0; j < c.length; j++) { if (!isTailJunk(c[j])) stripped.push(c[j]); }
  if (stripped.length && stripped.join("") === q.join("") && c.slice(0, stripped.length).join("") === q.join("")) return true;
  return false;
}
function titleScore(a, b) {
  var wa = exactWords(a), wb = exactWords(b);
  if (!wa.length || !wb.length) return 0;
  var hit = 0;
  wa.forEach(function (w) { if (wb.indexOf(w) !== -1) hit++; });
  return (2 * hit) / (wa.length + wb.length);
}
function yearOf(text) {
  var m = /\b(19|20)\d{2}\b/.exec(String(text || ""));
  return m ? parseInt(m[0], 10) : null;
}

// ---------- TMDB ----------
function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return getJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY, 10000)
    .then(function (j) {
      if (!j) return null;
      var title = j.title || j.name || null;
      if (!title) return null;
      var dateStr = j.release_date || j.first_air_date || "";
      return { title: title, year: yearOf(dateStr), imdbId: j.imdb_id || null };
    })
    .catch(function () { return null; });
}

// ---------- site search ----------
function findPost(meta) {
  var url = BASE_URL + "/wp-json/wp/v2/search?search=" + encodeURIComponent(meta.title) + "&per_page=20&_fields=id,title,url";
  return getJson(url, 10000).then(function (rows) {
    var cands = (Array.isArray(rows) ? rows : []).map(function (r) {
      return { postId: r.id, title: stripTags(r.title || ""), url: r.url || "" };
    });
    return pickPost(cands, meta);
  }).catch(function () { return null; }).then(function (found) {
    if (found) return found;
    // Fallback: HTML search results (<h2><a href>title</a>)
    return getHtml(BASE_URL + "/?s=" + encodeURIComponent(meta.title), 12000).then(function (html) {
      var cands = [], re = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, m;
      while ((m = re.exec(html)) !== null) {
        cands.push({ postId: null, title: stripTags(m[2]), url: m[1] });
      }
      return pickPost(cands, meta);
    }).catch(function () { return null; });
  });
}
function pickPost(cands, meta) {
  var best = null, bestRank = -1;
  cands.forEach(function (c) {
    if (!isExactTitle(meta.title, c.title)) return;
    var cy = yearOf(c.title);
    if (meta.year && cy && cy !== meta.year) return; // known-year mismatch = different release
    var rank = titleScore(c.title, meta.title) + (meta.year && cy === meta.year ? 0.5 : 0);
    if (rank > bestRank) { bestRank = rank; best = c; }
  });
  return best;
}
function getPostContent(post) {
  var url;
  if (post.postId) url = BASE_URL + "/wp-json/wp/v2/posts/" + post.postId + "?_fields=content,title";
  else {
    var slug = post.url.replace(/\/$/, "").split("/").pop();
    url = BASE_URL + "/wp-json/wp/v2/posts?slug=" + encodeURIComponent(slug) + "&_fields=content,title";
  }
  return getJson(url, 10000).then(function (data) {
    var p = Array.isArray(data) ? data[0] : data;
    if (!p || !p.content || !p.content.rendered) return null;
    return p.content.rendered;
  }).catch(function () { return null; });
}

// ---------- download buttons in a post ----------
function parseDownloads(html) {
  var h3s = [], hm;
  var h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  while ((hm = h3Re.exec(html)) !== null) h3s.push({ pos: hm.index, text: stripTags(hm[1]) });
  var out = [], bm;
  var btnRe = /<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"[^>]*>/gi;
  while ((bm = btnRe.exec(html)) !== null) {
    var label = "";
    for (var i = h3s.length - 1; i >= 0; i--) {
      if (h3s[i].pos < bm.index) { label = h3s[i].text; break; }
    }
    out.push({ label: label, url: bm[1] });
  }
  return out;
}

// ---------- file-host resolution ----------
function qualityFromText(text) {
  if (/2160|4k|uhd/i.test(text)) return "4K";
  if (/1080/.test(text)) return "1080p";
  if (/720/.test(text)) return "720p";
  if (/480/.test(text)) return "480p";
  if (/360/.test(text)) return "360p";
  return "HD";
}
function specsFromName(name) {
  var parts = [];
  var q = qualityFromText(name);
  if (q !== "HD") parts.push(q);
  if (/bluray|bdrip/i.test(name)) parts.push("BluRay");
  else if (/web[-.]?dl/i.test(name)) parts.push("Web-DL");
  else if (/webrip/i.test(name)) parts.push("WebRip");
  else if (/hdrip/i.test(name)) parts.push("HDRip");
  if (/x265|hevc/i.test(name)) parts.push("x265");
  else if (/x264|h264/i.test(name)) parts.push("x264");
  return parts.join(" ") || q;
}
function resolveGdshine(url) {
  var id = String(url).split("/").filter(Boolean).pop() || "";
  if (!id) return Promise.resolve(null);
  return getJson("https://gdshine.org/api/files/s/" + encodeURIComponent(id), 8000)
    .then(function (j) {
      var fid = j && j.data && j.data.id;
      if (!fid) return null;
      return fetchWithTimeout("https://gdshine.org/api/downloads/" + fid + "/via-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: "{}",
      }, 8000).then(function (r) { return r.ok ? r.json() : null; });
    })
    .then(function (j) { return (j && j.data && j.data.copyUrl) || null; })
    .catch(function () { return null; });
}
// fileUrl is a boldb.site / hshare.lol ?id=<file> link; fetching it lands on
// the download page (server-side redirect) whose buttons lead to the file.
function resolveFilePage(fileUrl, groupLabel, isRetry, mediaTitle, season, episode) {
  return getHtml(fileUrl, 15000).then(function (html) {
    var nameM = /Name:\s*([^<\n\r]+)/i.exec(html);
    var fileName = nameM ? nameM[1].trim() : "";
    var sizeM = /\[(\d+(?:\.\d+)?\s*(?:GB|MB))\]/i.exec(groupLabel || "");
    var btns = [], re = /<a\b[^>]*href="([^"]+)"[^>]*>/gi, m;
    while ((m = re.exec(html)) !== null) {
      if (!/\bclass="[^"]*\bbtn\b/i.test(m[0])) continue;
      var href = m[1];
      if (!href || href === "#" || href.indexOf("javascript") === 0) continue;
      btns.push(href);
    }
    var jobs = btns.map(function (href) {
      if (/gdshine\./i.test(href)) {
        return resolveGdshine(href).then(function (direct) {
          if (!direct) return null;
          var streamBody = formatStreamSize({
            source: "HindMovies", title: mediaTitle,
            quality: qualityFromText(fileName || groupLabel),
            season: season, episode: episode,
            size: sizeM ? sizeM[1] : undefined,
            server: "GDShine", url: direct
          });
          return {
            name: "HindMovies",
            title: "HindMovies",
            size: streamBody,
            url: direct,
            quality: qualityFromText(fileName || groupLabel),
            type: "direct",
            _releaseTitle: fileName || "",
          };
        });
      }
      return Promise.resolve(null); // photos/hcloud/dead worker mirrors are not playable
    });
    return Promise.all(jobs).then(function (arr) {
      return arr.filter(function (x) { return !!x; });
    });
  }).catch(function () { return []; });
}
// mvlink page (links.joshapp.blog) -> the file-host anchor (?id=<video file>)
function resolveMvlink(mvlinkUrl, groupLabel, mediaTitle, season, episode) {
  return getHtml(mvlinkUrl, 12000).then(function (html) {
    var m = /href="([^"]*[?&]id=[^"]*\.(?:mkv|mp4|avi)[^"]*)"/i.exec(html)
      || /href="([^"]*(?:boldb\.site|hshare\.lol)[^"]*)"/i.exec(html);
    if (!m) return [];
    return resolveFilePage(m[1].replace(/&amp;/g, "&"), groupLabel, undefined, mediaTitle, season, episode);
  }).catch(function () { return []; });
}

// ---------- main ----------
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
        if (hit) rows[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
      }
      return cleanup();
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";
  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta) return [];
    return findPost(meta).then(function (post) {
      if (!post) return [];
      return getPostContent(post).then(function (html) {
        if (!html) return [];
        var downloads = parseDownloads(html);
        if (!downloads.length) return [];
        if (type === "movie") {
          var picks = downloads.slice(0, 3);
          return Promise.all(picks.map(function (d) {
            return resolveMvlink(d.url, d.label, meta.title, undefined, undefined);
          })).then(function (lists) {
            var out = [];
            lists.forEach(function (l) { out.push.apply(out, l); });
            return osAttachSubtitles(dedupe(out).slice(0, 6), meta.imdbId, false, null, null, {
              osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
              subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
              subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
              year: meta.year || 0
            });
          });
        }
        // series: download buttons whose section header names the season
        if (seasonNum == null || episodeNum == null) return [];
        var seasonPicks = downloads.filter(function (d) {
          var sm = /season\s*(\d+)/i.exec(d.label || "");
          return sm && parseInt(sm[1], 10) === seasonNum;
        }).slice(0, 2);
        if (!seasonPicks.length) return [];
        return Promise.all(seasonPicks.map(function (d) {
          return getHtml(d.url, 12000).then(function (epHtml) {
            var re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, a, epUrl = null;
            while ((a = re.exec(epHtml)) !== null) {
              var em = /episode\s*0*(\d+)\b/i.exec(stripTags(a[2]));
              if (em && parseInt(em[1], 10) === episodeNum && /\.(mkv|mp4|avi)/i.test(a[1])) { epUrl = a[1]; break; }
            }
            if (!epUrl) return [];
            return resolveFilePage(epUrl.replace(/&amp;/g, "&"), d.label, undefined, meta.title, seasonNum, episodeNum);
          }).catch(function () { return []; });
        })).then(function (lists) {
          var out = [];
          lists.forEach(function (l) { out.push.apply(out, l); });
          return osAttachSubtitles(dedupe(out).slice(0, 4), meta.imdbId, true, seasonNum, episodeNum, {
            osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
            subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
            subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
            year: meta.year || 0
          });
        });
      });
    });
  }).catch(function () { return []; });
}
function dedupe(streams) {
  var seen = {}, out = [];
  streams.forEach(function (s) {
    if (s && s.url && !seen[s.url]) { seen[s.url] = 1; out.push(s); }
  });
  return out;
}

global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
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
