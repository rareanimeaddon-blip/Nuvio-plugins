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

// Xon scraper for Nuvio (xon1.js v1.0.0).
// Ported from CNCVerse's XonProvider (CloudStream .cs3, v36) — the
// Xon app is the successor to the Vion app (CALLER "vion-official-app").
// The plugin's API (https://xon-avens.xyz/apis: nzgetshows.php /
// nzgetepisodes_v2.php, API key + CALLER headers) is DEAD as of
// 2026-11-13: the domain is parked (nginx 404 on /apis, HTTPS closes
// the connection, confirmed from sandbox AND browser) and the Firebase
// Remote Config keys that would supply a new base_url are revoked
// ("API key not valid" for both the plugin key and the APK v26 key).
// So this provider resolves titles directly against the library the
// Xon app itself draws from: archive.org. The app's own formatUrl()
// prepends "https://archive.org/download/" to relative video paths,
// and the official site (xonapp.store) serves its videos through the
// archive.org proxy https://xon-test.avensapps.workers.dev/download/.
// Verified 2026-11-13: Shinchan S1E1 (Hindi) is a real playable MP4
// (ftypisom/avc1/moov, HTTP 206, video/mp4, Range) at
//   https://xon-test.avensapps.workers.dev/download/
//   shinchan-s-01-e-01-rare-toons-india/
//   Shinchan%20S01E01%20%5BRareToonsIndia%5D.mp4
// Flow (TV): TMDB title -> gate-safe alias recall (TMDB alternative
// titles, Latin-script only, shortest first, cap 4, through the
// UNCHANGED exact gate) -> archive.org advancedsearch for the
// episode identifier -> item metadata -> the video file matching
// S<SS>E<EE> (mp4 first, then mkv) -> worker-proxy URL.
// Movies: archive.org title search with the exact gate; the item
// title must match the TMDB title/alias exactly and the file must be
// a video. A title with no exact match returns [] (honest empty).
// Gate v3: exact title matching, zero mismatch tolerance. An
// archive.org item only counts when its normalized title contains
// the normalized TMDB title/alias as a whole word AND the season /
// episode in its identifier or filename matches exactly.

var XON_TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var XON_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var XON_WORKER = "https://xon-test.avensapps.workers.dev/download/";
var XON_ARCHIVE = "https://archive.org";

// ---------- small helpers ----------
function _xonStr(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
function _xonNorm(s) {
  return _xonStr(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function _xonSlug(s) {
  return _xonNorm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function _xonPad(n, w) {
  var s = String(n);
  while (s.length < w) s = "0" + s;
  return s;
}
// Whole-word exact match on normalized text: the alias must appear
// as a complete word (or the whole string), never as a substring of
// another word. This is gate v3 — never weakened.
function _xonTitleMatches(haystack, alias) {
  var h = " " + _xonNorm(haystack) + " ";
  var a = _xonNorm(alias);
  if (!a) return false;
  if (h === " " + a + " ") return true;
  return h.indexOf(" " + a + " ") !== -1;
}
function _xonIsLatin(s) {
  return /^[\x00-\x7F]*$/.test(_xonStr(s));
}
function _xonFetchJson(url) {
  return fetch(url, { headers: { Accept: "application/json", "User-Agent": XON_UA } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

// ---------- TMDB ----------
function _xonTmdbDetails(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return _xonFetchJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + XON_TMDB_KEY)
    .then(function (j) {
      if (!j) return { title: "", year: "", runtime: 0 };
      var t = j.title || j.name || "";
      var d = j.release_date || j.first_air_date || "";
      var rt = 0;
      if (typeof j.runtime === "number" && j.runtime > 0) rt = j.runtime;
      else if (Array.isArray(j.episode_run_time) && j.episode_run_time.length && j.episode_run_time[0] > 0) rt = j.episode_run_time[0];
      return { title: t, year: d ? String(d).slice(0, 4) : "", runtime: rt };
    });
}
function _xonTmdbAliases(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return _xonFetchJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/alternative_titles?api_key=" + XON_TMDB_KEY)
    .then(function (j) {
      var out = [];
      var arr = (j && (j.titles || j.results)) || [];
      for (var i = 0; i < arr.length; i++) {
        var t = arr[i] && (arr[i].title || arr[i].name);
        if (t && _xonIsLatin(t)) out.push(t);
      }
      // Shortest first (most likely the short site name, e.g. "Shinchan"),
      // cap 4, de-duplicated. Gate is unchanged; only the candidate list.
      out.sort(function (a, b) { return a.length - b.length; });
      var seen = {}, res = [];
      for (var k = 0; k < out.length && res.length < 4; k++) {
        var key = _xonNorm(out[k]);
        if (key && !seen[key]) { seen[key] = true; res.push(out[k]); }
      }
      return res;
    });
}
function _xonEpRuntime(tmdbId, season, episode) {
  return _xonFetchJson("https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + XON_TMDB_KEY)
    .then(function (j) { return (j && typeof j.runtime === "number" && j.runtime > 0) ? j.runtime : 0; });
}

// ---------- archive.org ----------
// Search identifiers matching a glob-ish prefix. Returns identifiers.
function _xonArchiveSearchIdentifiers(query) {
  var url = XON_ARCHIVE + "/advancedsearch.php?q=" + encodeURIComponent(query) +
    "&fl%5B%5D=identifier&fl%5B%5D=title&rows=20&output=json";
  return _xonFetchJson(url).then(function (j) {
    var docs = (j && j.response && j.response.docs) || [];
    var out = [];
    for (var i = 0; i < docs.length; i++) {
      if (docs[i] && docs[i].identifier) out.push({ id: docs[i].identifier, title: docs[i].title || "" });
    }
    return out;
  });
}
function _xonArchiveMetadata(identifier) {
  return _xonFetchJson(XON_ARCHIVE + "/metadata/" + encodeURIComponent(identifier));
}
// Pick the video file for S<SS>E<EE> from an item's file list.
// Prefers .mp4 (h.264) over .mkv. The filename must contain the exact
// S<SS>E<EE> token (e.g. S01E01), so a wrong episode never matches.
function _xonPickEpisodeFile(files, season, episode) {
  if (!Array.isArray(files)) return null;
  var token = "S" + _xonPad(season, 2) + "E" + _xonPad(episode, 2);
  var tokenLo = token.toLowerCase();
  var mp4 = null, mkv = null;
  for (var i = 0; i < files.length; i++) {
    var f = files[i] || {};
    var name = _xonStr(f.name);
    if (!name) continue;
    var lower = name.toLowerCase();
    if (lower.indexOf(tokenLo) === -1) continue;
    if (lower.indexOf(".ia.mp4") !== -1) continue; // derived preview, skip
    if (/\.mp4$/i.test(name) && !mp4) mp4 = f;
    else if (/\.mkv$/i.test(name) && !mkv) mkv = f;
  }
  return mp4 || mkv || null;
}
function _xonWorkerUrl(identifier, fileName) {
  // The worker proxies archive.org downloads and serves Range +
  // video/mp4 reliably (verified 2026-11-13). encodeURIComponent
  // handles spaces and brackets in the filename.
  return XON_WORKER + encodeURIComponent(identifier) + "/" + encodeURIComponent(fileName);
}
function _xonFileSizeLabel(bytes) {
  var n = Number(bytes);
  if (!n || n <= 0) return "";
  if (n >= 1073741824) return (n / 1073741824).toFixed(2).replace(/\.00$/, "") + " GB";
  if (n >= 1048576) return Math.round(n / 1048576) + " MB";
  return Math.round(n / 1024) + " KB";
}

// ---------- v4 formatter ----------
// __STREAM_LABEL_FORMATTER__ v4 (size): user-spec body — heading is the
// provider name (in `name`), body is the essential info. Only lines
// with data are shown. Pure string work, no timers, no TextEncoder,
// no fetch. Never throws.
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

function _xonQualityFromName(fileName) {
  var n = _xonStr(fileName).toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(n)) return "2160p";
  if (/\b1080p\b/.test(n)) return "1080p";
  if (/\b720p\b/.test(n)) return "720p";
  if (/\b(480p|360p|360 p|sd)\b/.test(n)) return "SD";
  return "HD";
}
function _xonAudioFromId(identifier) {
  var id = _xonStr(identifier).toLowerCase();
  if (/(^|[-_])(hin|hindi|rare-toons-india)([-_]|$)/.test(id)) return "Hindi";
  if (/(^|[-_])(tam|tamil)([-_]|$)/.test(id)) return "Tamil";
  if (/(^|[-_])(tel|telugu)([-_]|$)/.test(id)) return "Telugu";
  if (/(^|[-_])(eng|english)([-_]|$)/.test(id)) return "English";
  if (/(^|[-_])(ben|bengali)([-_]|$)/.test(id)) return "Bengali";
  if (/(^|[-_])(mar|marathi)([-_]|$)/.test(id)) return "Marathi";
  if (/(^|[-_])(mal|malayalam)([-_]|$)/.test(id)) return "Malayalam";
  if (/(^|[-_])(kan|kannada)([-_]|$)/.test(id)) return "Kannada";
  return "";
}
function _xonMakeStream(url, meta, season, episode, fileName, fileSize, audio) {
  var quality = _xonQualityFromName(fileName);
  var size = formatStreamSize({
    title: meta.title, year: meta.year, runtime: meta.runtime,
    quality: quality, season: season, episode: episode,
    audio: audio || "Hindi", size: _xonFileSizeLabel(fileSize),
    source: "Xon", server: "archive.org", url: url
  });
  return {
    name: "Xon", title: "Xon", size: size,
    url: url, quality: quality, type: "direct",
    headers: { "User-Agent": XON_UA },
    behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": XON_UA } } }
  };
}

// Resolve one TV episode through archive.org.
// candidates: title strings (canonical first, then aliases, shortest
// first). For each, try the identifier search for the S/E pattern and
// keep only items whose title matches the candidate exactly (gate)
// and whose files contain the exact S<SS>E<EE> video.
function _xonResolveEpisode(candidates, season, episode, meta) {
  var out = [];
  var seen = {};
  var ci = 0;
  function nextCandidate() {
    // Stop once we have a usable set: trying further aliases after a
    // candidate already yielded streams only burns the TV budget.
    if (ci >= candidates.length || out.length >= 2) return Promise.resolve(out);
    var cand = candidates[ci++];
    var slug = _xonSlug(cand);
    if (!slug) return nextCandidate();
    var ss = _xonPad(season, 2), ee = _xonPad(episode, 2);
    // Identifier search: <slug>-s-<SS>-e-<EE>* catches the
    // Rare-Toons-style items (shinchan-s-01-e-01-rare-toons-india).
    var q = "identifier:(" + slug + "-s-" + ss + "-e-" + ee + "*)";
    return _xonArchiveSearchIdentifiers(q).then(function (items) {
      var ii = 0;
      function nextItem() {
        if (ii >= items.length || out.length >= 4) return nextCandidate();
        var item = items[ii++];
        // Gate: the item title must match this candidate exactly
        // (whole word), so a different show's S01E01 never passes.
        if (!_xonTitleMatches(item.title, cand) && !_xonTitleMatches(item.id, cand)) return nextItem();
        return _xonArchiveMetadata(item.id).then(function (md) {
          var files = (md && md.files) || [];
          var file = _xonPickEpisodeFile(files, season, episode);
          if (!file) return nextItem();
          var url = _xonWorkerUrl(item.id, file.name);
          if (seen[url]) return nextItem();
          seen[url] = true;
          out.push(_xonMakeStream(url, meta, season, episode, file.name, file.size, _xonAudioFromId(item.id)));
          return nextItem();
        }).catch(function () { return nextItem(); });
      }
      return nextItem();
    }).catch(function () { return nextCandidate(); });
  }
  return nextCandidate();
}

// Movies: search archive.org by exact title; keep only items whose
// title IS the TMDB title/alias (equals, or starts with it followed
// by a separator such as a year) and that carry a video file.
// A whole-word "contains" check is NOT enough here: it lets in
// "Decoding the Matrix" for The Matrix, a documentary, not the film.
// Returns [] when nothing matches exactly.
function _xonMovieTitleMatches(itemTitle, cand, year) {
  var h = _xonNorm(itemTitle);
  var a = _xonNorm(cand);
  if (!a) return false;
  if (h === a) return true;
  // Only a year may follow the title ("The Matrix (1999)", "The
  // Matrix 1999"). Anything else ("The Matrix in ZR", "The Matrix
  // Tried To Warn You") is a different video that merely starts
  // with the title — a starts-with check lets those through.
  if (year) {
    if (h === a + " " + year) return true;
    if (h === a + " (" + year + ")") return true;
    if (h === a + " " + year + " ") return true;
  }
  return false;
}
function _xonResolveMovie(candidates, meta) {
  var out = [];
  var seen = {};
  var ci = 0;
  function nextCandidate() {
    // Stop once we have a usable set: trying further aliases after a
    // candidate already yielded streams only burns the TV budget.
    if (ci >= candidates.length || out.length >= 2) return Promise.resolve(out);
    var cand = candidates[ci++];
    var q = "title:(\"" + cand.replace(/"/g, "") + "\") AND mediatype:(movies)";
    return _xonArchiveSearchIdentifiers(q).then(function (items) {
      var ii = 0;
      function nextItem() {
        if (ii >= items.length || out.length >= 4) return nextCandidate();
        var item = items[ii++];
        if (!_xonMovieTitleMatches(item.title, cand, meta.year)) return nextItem();
        return _xonArchiveMetadata(item.id).then(function (md) {
          var files = (md && md.files) || [];
          var best = null;
          for (var i = 0; i < files.length; i++) {
            var f = files[i] || {};
            var name = _xonStr(f.name);
            if (!name || name.indexOf(".ia.mp4") !== -1) continue;
            if (/\.mp4$/i.test(name) && !best) best = f;
            else if (/\.mkv$/i.test(name) && !best) best = f;
          }
          if (!best) return nextItem();
          var url = _xonWorkerUrl(item.id, best.name);
          if (seen[url]) return nextItem();
          seen[url] = true;
          out.push(_xonMakeStream(url, meta, undefined, undefined, best.name, best.size, _xonAudioFromId(item.id)));
          return nextItem();
        }).catch(function () { return nextItem(); });
      }
      return nextItem();
    }).catch(function () { return nextCandidate(); });
  }
  return nextCandidate();
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var season = seasonNum || 1, episode = episodeNum || 1;
  return Promise.all([
    _xonTmdbDetails(tmdbId, mediaType),
    _xonTmdbAliases(tmdbId, mediaType),
    kind === "tv" ? _xonEpRuntime(tmdbId, season, episode) : Promise.resolve(0)
  ]).then(function (res) {
    var meta = res[0] || { title: "", year: "", runtime: 0 };
    if (kind === "tv" && !meta.runtime && res[2] > 0) meta.runtime = res[2];
    if (!meta.title) return [];
    // Candidate titles: canonical first, then aliases (shortest
    // first, cap 4). The gate is unchanged for every candidate.
    // Each candidate also contributes its joined single-word form
    // (spaces/hyphens removed), because sites name shows that way:
    // TMDB's alias "Shin-chan" never matches the archive.org item
    // "shinchan-s-01-e-01-...", but the joined "Shinchan" does.
    // The joined form is still the full title/alias, so the gate
    // (exact whole-word title match + exact S/E) is not weakened.
    var candidates = [meta.title].concat(res[1] || []);
    var seen = {}, ordered = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var k = _xonNorm(c);
      if (k && !seen[k]) { seen[k] = true; ordered.push(c); }
      var joined = _xonNorm(c).replace(/\s+/g, "");
      if (joined && joined !== k && !seen[joined]) {
        seen[joined] = true;
        // Capitalise first letter for a natural title form.
        ordered.push(joined.charAt(0).toUpperCase() + joined.slice(1));
      }
    }
    if (kind === "tv") return _xonResolveEpisode(ordered, season, episode, meta);
    return _xonResolveMovie(ordered, meta);
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.XonScraperModule = { getStreams: getStreams };
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
