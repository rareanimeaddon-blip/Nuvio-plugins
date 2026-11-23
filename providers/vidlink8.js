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



// Vidlink Scraper for Nuvio Local Scrapers
// v1.0.9: Infinite Subtitles addon-only attach (osAttachSubtitles, same
// block as moviesdrive13.js). Own captions are kept when the addon has
// no hit (osAttachSubtitles only overwrites on a hit). Playback headers
// (ExoPlayer UA in `headers` + behaviorHints.proxyHeaders) UNTOUCHED.
// React Native compatible version - Standalone (no external dependencies)
// Converted to Promise-based syntax for sandbox compatibility

// Constants
const TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
const ENC_DEC_API = "https://enc-dec.app/api";
const VIDLINK_API = "https://vidlink.pro/api/b";

// Required headers for Vidlink requests
const VIDLINK_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Connection": "keep-alive",
    "Referer": "https://vidlink.pro/",
    "Origin": "https://vidlink.pro"
};

// Helper function to make HTTP requests with default headers
function makeRequest(url, options = {}) {
    const defaultHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Accept': 'application/json,*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        ...options.headers
    };

    return fetch(url, {
        method: options.method || 'GET',
        headers: defaultHeaders,
        ...options
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    })
    .catch(error => {
        console.error(`[Vidlink] Request failed for ${url}: ${error.message}`);
        throw error;
    });
}

// M3U8 Parsing Functions

// Parse M3U8 content and extract quality streams
function parseM3U8(content, baseUrl) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    const streams = [];
    let currentStream = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            currentStream = { bandwidth: null, resolution: null, url: null };
            
            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
            if (bandwidthMatch) {
                currentStream.bandwidth = parseInt(bandwidthMatch[1]);
            }
            
            const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
            if (resolutionMatch) {
                currentStream.resolution = resolutionMatch[1];
            }
        } else if (currentStream && !line.startsWith('#')) {
            currentStream.url = resolveUrl(line, baseUrl);
            streams.push(currentStream);
            currentStream = null;
        }
    }
    return streams;
}

// Resolve relative URLs against base URL
function resolveUrl(url, baseUrl) {
    if (url.startsWith('http')) {
        return url;
    }
    try {
        return new URL(url, baseUrl).toString();
    } catch (error) {
        console.error(`[Vidlink] Could not resolve URL: ${url} against ${baseUrl}`);
        return url;
    }
}

// Determine quality from resolution
function getQualityFromResolution(resolution) {
    if (!resolution) return 'Auto';
    
    const [width, height] = resolution.split('x').map(Number);
    
    if (height >= 2160) return '4K';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    if (height >= 360) return '360p';
    return '240p';
}

// v4 stream-row formatter (same as the rest of the plugin): name/title =
// provider name only; size = multi-line body with title/year, season/
// episode, quality, server (URL hostname when no explicit server).
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


// v4 stream row for Vidlink.
// Map a caption language NAME to an ISO code. The API gives names, not
// codes, and the name is in the language's OWN script (اَلْعَرَبِيَّةُ,
// বাংলা, हिन्दी, Русский, 中文, ...), not English — so the table covers
// both the English name and the native-script name. The app's
// SubtitleDto REQUIRES `lang`, so an unrecognised name is skipped
// (a garbage code would mislabel the subtitle); the first-2-letters
// fallback only applies to plain ASCII names.
function vidlinkLangCode(name) {
  var n = String(name || "").trim().toLowerCase();
  var map = {
    english: "en", arabic: "ar", bengali: "bn", spanish: "es", french: "fr", german: "de", hindi: "hi",
    portuguese: "pt", indonesian: "id", turkish: "tr", russian: "ru", tamil: "ta", telugu: "te",
    malayalam: "ml", urdu: "ur", filipino: "tl", malay: "ms", chinese: "zh", punjabi: "pa",
    korean: "ko", japanese: "ja", italian: "it", dutch: "nl", swedish: "sv", polish: "pl",
    vietnamese: "vi", thai: "th", "español": "es", "français": "fr", "português": "pt",
    // Native-script names (as the API returns them).
    "اَلْعَرَبِيَّةُ": "ar", "العربية": "ar", "বাংলা": "bn", "हिन्दी": "hi", "हिंदी": "hi",
    "ਪੰਜਾਬੀ": "pa", "русский": "ru", "اُردُو": "ur", "اردو": "ur", "中文": "zh",
    "தமிழ்": "ta", "తెలుగు": "te", "മലയാളം": "ml", "한국어": "ko", "日本語": "ja",
    "italiano": "it", "nederlands": "nl", "svenska": "sv", "polski": "pl",
    "tiếng việt": "vi", "ภาษาไทย": "th", "türkçe": "tr"
  };
  if (map[n]) return map[n];
  if (/^[a-z]{2,3}$/.test(n)) return n;
  if (/^[a-z]+$/.test(n)) return n.slice(0, 2);
  return "";
}

// bcdn.hakunaymatata.com (the file host) blocks browser/Chrome UAs
// (428/429) and Referer: vidlink.pro — but allows a non-browser UA
// (206). The app's player defaults to a Chrome UA when a row carries
// no headers, so the player's requests were 428/429'd and playback
// failed. Set an ExoPlayer UA on the row. Deliver through BOTH
// `headers` and `behaviorHints.proxyHeaders` (fourkdhub pattern —
// `headers` alone did not reach the player on device).
var VIDLINK_PLAY_UA = "ExoPlayerLib/2.19.1";
function makeVidlinkStream(mediaInfo, quality, url, subs) {
  var q = (quality && String(quality).toLowerCase() !== "auto" && String(quality).toLowerCase() !== "unknown") ? quality : undefined;
  var lbl = formatStreamSize({ source: "Vidlink", title: mediaInfo.title, year: mediaInfo.year, season: mediaInfo.season, episode: mediaInfo.episode, quality: q, subtitles: subs, url: url });
  var hdrs = { "User-Agent": VIDLINK_PLAY_UA };
  var row = { name: "Vidlink", title: "Vidlink", size: lbl, url: url, quality: quality, headers: hdrs, behaviorHints: { proxyHeaders: { request: hdrs } }, _releaseTitle: (mediaInfo.title || "") + " " + (quality || "") };
  if (subs && subs.length) row.subtitles = subs;
  return row;
}

// Fetch and parse M3U8 playlist to extract quality variants
function fetchAndParseM3U8(playlistUrl, mediaInfo, subs) {
    console.log(`[Vidlink] Fetching M3U8 playlist: ${playlistUrl.substring(0, 80)}...`);
    
    return makeRequest(playlistUrl, { headers: VIDLINK_HEADERS })
        .then(response => response.text())
        .then(m3u8Content => {
            console.log(`[Vidlink] Parsing M3U8 content`);
            const parsedStreams = parseM3U8(m3u8Content, playlistUrl);
            
            if (parsedStreams.length === 0) {
                console.log('[Vidlink] No quality variants found, returning master playlist');
                // Fallback: return the master playlist as Auto quality
                return [makeVidlinkStream(mediaInfo, 'Auto', playlistUrl, subs)];
            }
            
            console.log(`[Vidlink] Found ${parsedStreams.length} quality variants`);
            
            // Convert parsed streams to Nuvio format
            const streams = parsedStreams.map(stream => {
                const quality = getQualityFromResolution(stream.resolution);
                return makeVidlinkStream(mediaInfo, quality, stream.url, subs);
            });
            
            return streams;
        })
        .catch(error => {
            console.error(`[Vidlink] Error fetching/parsing M3U8: ${error.message}`);
            // Fallback: return the master playlist URL
            return [makeVidlinkStream(mediaInfo, 'Auto', playlistUrl, subs)];
        });
}

// Helper function to get TMDB info
function getTmdbInfo(tmdbId, mediaType) {
    const url = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    return makeRequest(url)
    .then(response => response.json())
    .then(data => {
        const title = mediaType === 'tv' ? data.name : data.title;
        const year = mediaType === 'tv' ? data.first_air_date?.substring(0, 4) : data.release_date?.substring(0, 4);
        
        if (!title) {
            throw new Error('Could not extract title from TMDB response');
        }
        
        console.log(`[Vidlink] TMDB Info: "${title}" (${year})`);
        return { title, year, data };
    });
}

// IMDb id for the subtitle addon: TMDB movie detail carries imdb_id,
// TV detail does not, so fall back to the external_ids endpoint.
function vidlinkToImdb(tmdbId, mediaType) {
    var kind = mediaType === 'tv' ? 'tv' : 'movie';
    return fetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return j && j.imdb_id ? j.imdb_id : null; })
        .catch(function () { return null; });
}

// Encrypt TMDB ID using enc-dec.app API
function encryptTmdbId(tmdbId) {
    console.log(`[Vidlink] Encrypting TMDB ID: ${tmdbId}`);
    
    return makeRequest(`${ENC_DEC_API}/enc-vidlink?text=${tmdbId}`)
    .then(response => response.json())
    .then(data => {
        if (data && data.result) {
            console.log(`[Vidlink] Successfully encrypted TMDB ID`);
            return data.result;
        } else {
            throw new Error('Invalid encryption response format');
        }
    })
    .catch(error => {
        console.error(`[Vidlink] Encryption failed: ${error.message}`);
        throw error;
    });
}

// Extract quality from stream data
function extractQuality(streamData) {
    if (!streamData) return 'Unknown';
    
    // Try to extract quality from various possible fields
    const qualityFields = ['quality', 'resolution', 'label', 'name'];
    
    for (const field of qualityFields) {
        if (streamData[field]) {
            const quality = streamData[field].toString().toLowerCase();
            
            // Map common quality indicators
            if (quality.includes('2160') || quality.includes('4k')) return '4K';
            if (quality.includes('1440') || quality.includes('2k')) return '1440p';
            if (quality.includes('1080') || quality.includes('fhd')) return '1080p';
            if (quality.includes('720') || quality.includes('hd')) return '720p';
            if (quality.includes('480') || quality.includes('sd')) return '480p';
            if (quality.includes('360')) return '360p';
            if (quality.includes('240')) return '240p';
            
            // Try to extract number from string
            const match = quality.match(/(\d{3,4})[pP]?/);
            if (match) {
                const resolution = parseInt(match[1]);
                if (resolution >= 2160) return '4K';
                if (resolution >= 1440) return '1440p';
                if (resolution >= 1080) return '1080p';
                if (resolution >= 720) return '720p';
                if (resolution >= 480) return '480p';
                if (resolution >= 360) return '360p';
                return '240p';
            }
        }
    }
    
    return 'Unknown';
}

// Process Vidlink API response
// v1.0.6 (2026-11-18): the API returns a bare JSON `null` (HTTP 200) for
// titles it has no streams for (The Matrix, Project Hail Mary, Jawan,
// Game of Thrones S1E1 — verified live; Inception and Breaking Bad S1E1
// return real streams through this same code path). A null `data` used
// to throw on `data.stream` and burn all 3 chain-retries for nothing.
// Now it returns [] cleanly — 0 streams is the honest answer there.
function processVidlinkResponse(data, mediaInfo) {
    const streams = [];
    if (!data) return streams;

    // The API returns data.stream.captions[] with real subtitle files
    // ({id, url, language, type}) — read them and attach in the app's
    // SubtitleDto shape {id, url, lang}. `language` is kept so
    // formatStreamSize still shows the language in the row label.
    // (The findUrls fallback below still SKIPS caption/subtitle objects
    // — that is intentional, to avoid treating caption URLs as streams.)
    const subs = [];
    if (data.stream && Array.isArray(data.stream.captions)) {
        for (let i = 0; i < data.stream.captions.length; i++) {
            const cap = data.stream.captions[i];
            if (!cap || typeof cap.url !== "string" || !cap.url) continue;
            const cname = String(cap.language || "English");
            const code = vidlinkLangCode(cname);
            if (!code) continue;
            subs.push({ id: "vidlink-" + code + "-" + i, url: cap.url, lang: code, label: cname, language: cname });
        }
    }

    try {
        console.log(`[Vidlink] Processing response data:`, JSON.stringify(data, null, 2));
        
        // Handle Vidlink's specific response format with stream.qualities
        if (data.stream && data.stream.qualities) {
            console.log(`[Vidlink] Processing qualities from stream object`);
            
            // Process each quality level
            Object.entries(data.stream.qualities).forEach(([qualityKey, qualityData]) => {
                if (qualityData.url) {
                    const quality = extractQuality({ quality: qualityKey });
                    streams.push(makeVidlinkStream(mediaInfo, quality, qualityData.url, subs));
                }
            });
            
            // Handle playlist URL (HLS streams) - will be processed later
            if (data.stream.playlist) {
                // Mark for M3U8 processing
                streams.push({
                    _isPlaylist: true,
                    url: data.stream.playlist,
                    mediaInfo: mediaInfo,
                    subtitles: subs
                });
            }
        }
        // Handle playlist-only responses (HLS streams without qualities)
        else if (data.stream && data.stream.playlist && !data.stream.qualities) {
            console.log(`[Vidlink] Processing playlist-only response`);
            
            // Mark for M3U8 processing
            streams.push({
                _isPlaylist: true,
                url: data.stream.playlist,
                mediaInfo: mediaInfo,
                subtitles: subs
            });
        }
        // Handle single stream URL
        else if (data.url) {
            const quality = extractQuality(data);
            streams.push(makeVidlinkStream(mediaInfo, quality, data.url, subs));
        }
        // Handle multiple streams array
        else if (data.streams && Array.isArray(data.streams)) {
            data.streams.forEach((stream, index) => {
                if (stream.url) {
                    const quality = extractQuality(stream);
                    streams.push(makeVidlinkStream(mediaInfo, quality, stream.url, subs));
                }
            });
        }
        // Handle links array format
        else if (data.links && Array.isArray(data.links)) {
            data.links.forEach((link, index) => {
                if (link.url) {
                    const quality = extractQuality(link);
                    streams.push(makeVidlinkStream(mediaInfo, quality, link.url, subs));
                }
            });
        }
        // Fallback: Try to find any URL property in the object (excluding subtitles)
        else if (typeof data === 'object') {
            const findUrls = (obj, path = '') => {
                for (const [key, value] of Object.entries(obj)) {
                    if (typeof value === 'string' && (value.startsWith('http') || value.includes('.m3u8'))) {
                        // Skip subtitle files (.srt, .vtt, subtitle-related URLs)
                        if (value.includes('.srt') || value.includes('.vtt') || 
                            value.includes('subtitle') || value.includes('captions') ||
                            key.toLowerCase().includes('subtitle') || key.toLowerCase().includes('caption')) {
                            continue;
                        }
                        
                        const quality = extractQuality({ [key]: value });
                        streams.push(makeVidlinkStream(mediaInfo, quality, value));
                    } else if (typeof value === 'object' && value !== null) {
                        // Skip captions/subtitles objects
                        if (key.toLowerCase().includes('caption') || key.toLowerCase().includes('subtitle')) {
                            continue;
                        }
                        findUrls(value, path ? `${path}.${key}` : key);
                    }
                }
            };
            
            findUrls(data);
        }
        
        console.log(`[Vidlink] Extracted ${streams.length} streams from response`);
        
    } catch (error) {
        console.error(`[Vidlink] Error processing response: ${error.message}`);
    }
    
    return streams;
}

// Main function to get streams - adapted for Nuvio provider format
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidlink] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S:${seasonNum}E:${episodeNum}` : ''}`);
    
    return getTmdbInfo(tmdbId, mediaType)
    .then(tmdbInfo => {
        const { title, year } = tmdbInfo;
        var subCfg = {
          osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
          subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
          subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
          wyzieApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.wyzieApiKey : undefined,
          wyzieApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.wyzieApiKey2 : undefined,
          year: year || 0
        };
        var imdbP = (tmdbInfo.data && tmdbInfo.data.imdb_id)
          ? Promise.resolve(tmdbInfo.data.imdb_id)
          : vidlinkToImdb(tmdbId, mediaType);
        // Encrypt TMDB ID
        return imdbP.then(function (imdbId) {
        return encryptTmdbId(tmdbId)
        .then(encryptedId => {
            // Build Vidlink API URL
            let vidlinkUrl;
            if (mediaType === 'tv' && seasonNum && episodeNum) {
                vidlinkUrl = `${VIDLINK_API}/tv/${encryptedId}/${seasonNum}/${episodeNum}`;
            } else {
                vidlinkUrl = `${VIDLINK_API}/movie/${encryptedId}`;
            }
            
            console.log(`[Vidlink] Requesting: ${vidlinkUrl}`);
            
            // Fetch stream data from Vidlink
            return makeRequest(vidlinkUrl, {
                headers: VIDLINK_HEADERS
            })
            .then(response => response.json())
            .then(data => {
                console.log(`[Vidlink] Received response from Vidlink API`);
                
                // Process the response
                const mediaInfo = {
                    title: title,
                    year: year,
                    mediaType: mediaType,
                    season: seasonNum,
                    episode: episodeNum
                };
                
                const streams = processVidlinkResponse(data, mediaInfo);
                
                if (streams.length === 0) {
                    console.log('[Vidlink] No streams found in response');
                    return [];
                }
                
                // Check if we have any playlist streams to process
                const playlistStreams = streams.filter(s => s._isPlaylist);
                const directStreams = streams.filter(s => !s._isPlaylist);
                
                if (playlistStreams.length > 0) {
                    console.log(`[Vidlink] Processing ${playlistStreams.length} M3U8 playlists`);
                    
                    // Fetch and parse each M3U8 playlist
                    const playlistPromises = playlistStreams.map(ps =>
                        fetchAndParseM3U8(ps.url, ps.mediaInfo, ps.subtitles)
                    );
                    
                    return Promise.all(playlistPromises)
                        .then(parsedStreamArrays => {
                            // Flatten the arrays and combine with direct streams
                            const allStreams = directStreams.concat(...parsedStreamArrays);
                            
                            // Sort streams by quality (highest first)
                            const qualityOrder = { '4K': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1, '360p': 0, '240p': -1, 'Auto': -2, 'Unknown': -3 };
                            allStreams.sort((a, b) => (qualityOrder[b.quality] || -3) - (qualityOrder[a.quality] || -3));
                            
                            console.log(`[Vidlink] Successfully processed ${allStreams.length} total streams`);
                            return osAttachSubtitles(allStreams, imdbId, mediaType === 'tv', seasonNum, episodeNum, subCfg);
                        });
                } else {
                    // No playlists, just sort and return direct streams
                    const qualityOrder = { '4K': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1, '360p': 0, '240p': -1, 'Auto': -2, 'Unknown': -3 };
                    directStreams.sort((a, b) => (qualityOrder[b.quality] || -3) - (qualityOrder[a.quality] || -3));
                    
                    console.log(`[Vidlink] Successfully processed ${directStreams.length} streams`);
                    return osAttachSubtitles(directStreams, imdbId, mediaType === 'tv', seasonNum, episodeNum, subCfg);
                }
            });
        });
        });
    })
    .catch(error => {
        console.error(`[Vidlink] Error in getStreams: ${error.message}`);
        return [];
    });
}

// Export for React Native
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.VidlinkScraperModule = { getStreams };
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
