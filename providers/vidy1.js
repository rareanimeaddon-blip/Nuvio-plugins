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

// Vidy scraper for Nuvio (vidy1.js v1.0.0).
// vidy.st is an embed-player site (TMDB-keyed: /movie/{tmdbId},
// /tv/{tmdbId}/{s}/{e}); its player is served through the SAME
// backend as the removed Movy provider: api.wecollege.net, with the
// same 18 named lanes (Miami, Boise, Nashville, Chicago, Vegas,
// Reno, Oakland, Seattle, Phoenix, Atlanta, Portland, Austin,
// Dallas, Munich, Berlin, Paris, Delhi, Cancun). The site DOES play
// real video (browser-verified 2026-11-12: The Matrix plays in full
// 1080p with subtitles, no sign-in) — but it does NOT host its own
// files; it aggregates upstream streams through its API. So this
// provider is a first-party-API aggregator, not a direct host.
// Flow (reverse-engineered from the site's own JS, 2026-11-12):
//   1. GET https://api.wecollege.net/seed?mediaId=<tmdbId>
//      -> {seed, ttlMs:30000}. Short-lived seed (30s).
//   2. GET https://api.wecollege.net/<lane>/sources
//      ?title=<enc>&mediaType=<movie|tv>&tmdbId=<id>&imdbId=<id>
//      [&episodeId&seasonId for TV]&enc=2&seed=<seed>
//      -> base64url string: "mvm1" magic + XOR-encrypted JSON
//      {sources:[{url,quality}], subtitles:[...], thumbnail}.
//      A 401 means a stale seed; the site re-fetches the seed once.
//   3. Decrypt with the site's own XOR keystream (ported verbatim
//      from its JS — identical to the Movy port, same backend):
//      key = f(seed, mediaId); keystream length = payload length;
//      XOR; check "mvm1"; UTF-8 decode.
// The seed is likely IP-bound (same class as vidsrc tokens) and the
// API sits behind Cloudflare, so sandbox validation is not proof;
// the device test is the decider. Lanes are tried in order and the
// first lanes that return streams win; a lane that 500s is skipped.
// Movies + TV series. Anime lane (anikoto) is not wired (movies and
// series only, matching the site's own client).
// NOTE: Vidy shares its backend/lanes with the removed Movy
// provider (same api.wecollege.net, same 18 lanes, same crypto).
// It is a different frontend/site, built here at the user's order.

// ---------- UTF-8 shims (TV QuickJS guest has no TextEncoder/Decoder) ----------
if (typeof TextEncoder === "undefined") {
  globalThis.TextEncoder = function TextEncoder() {};
  globalThis.TextEncoder.prototype.encode = function (str) {
    str = String(str == null ? "" : str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var cp = str.codePointAt(i);
      if (cp > 0xffff) i++;
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return new Uint8Array(out);
  };
}
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
function _b64ToBytes(b64) {
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return bytes;
}
function _b64UrlToBytes(value) {
  var normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  return _b64ToBytes(normalized);
}
function _bytesToUtf8(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

var VIDY_API = "https://api.wecollege.net";
var VIDY_ORIGIN = "https://www.vidy.st";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var VIDY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var VIDY_HEADERS = {
  "User-Agent": VIDY_UA,
  "Accept": "*/*",
  "Origin": VIDY_ORIGIN,
  "Referer": VIDY_ORIGIN + "/"
};

// ---------- Movy stream-crypto (ported from the site's own JS) ----------
// SHA-256 round constants (first 16), "mvm1" magic, and the two
// mix helpers. r() is always true (e*(e+1) is always even) and the
// length-parity branch is always false, but both are kept verbatim
// so the port stays faithful to the source.
var _VD_D = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174];
var _VD_MAGIC = [109, 118, 109, 49]; // "mvm1"
function _vd_r(e) { return (e * (e + 1) & 1) == 0; }
function _vd_o(e) {
  e >>>= 0;
  e ^= e >>> 16;
  e = Math.imul(e, 0x85ebca6b) >>> 0;
  e ^= e >>> 13;
  e = Math.imul(e, 0xc2b2ae35) >>> 0;
  e ^= e >>> 16;
  return e >>> 0;
}
function _vd_u(e, a) {
  e >>>= 0;
  a &= 31;
  if (a === 0) return e >>> 0;
  return (e << a | e >>> (32 - a)) >>> 0;
}

// Seed cache: one seed per (origin|mediaId), 30s TTL, refreshed 5s early.
var _vdSeedCache = {};
function _vdOrigin(url) {
  try { return new URL(url).origin; } catch (e) { return url; }
}
function _vdFetchSeed(baseUrl, mediaId) {
  var key = _vdOrigin(baseUrl) + "|" + mediaId;
  var now = Date.now();
  var hit = _vdSeedCache[key];
  if (hit && hit.expiresAt - 5000 > now) return Promise.resolve(hit.seed);
  var url = _vdOrigin(baseUrl) + "/seed?mediaId=" + encodeURIComponent(mediaId);
  return fetch(url, { headers: VIDY_HEADERS }).then(function (r) {
    if (!r.ok) throw new Error("vidy: seed HTTP " + r.status);
    return r.json();
  }).then(function (j) {
    var ttl = (j && j.ttlMs) ? j.ttlMs : 30000;
    _vdSeedCache[key] = { seed: j.seed, expiresAt: now + ttl };
    return j.seed;
  });
}
function _vdDropSeed(baseUrl, mediaId) {
  delete _vdSeedCache[_vdOrigin(baseUrl) + "|" + mediaId];
}

// Keystream state builder: state = f(seed, mediaId).
function _vdBuildState(seed, mediaId) {
  var t;
  if (((t = seed.length) * (t + 1) & 1) == 1) {
    // Dead branch in the source (length*(length+1) is always even);
    // kept for fidelity, never taken.
    var a256 = [];
    for (var q = 0; q < 256; q++) a256[q] = q;
    var tt = 0;
    for (var s2 = 0; s2 < 256; s2++) {
      tt = (tt + a256[s2] + seed.charCodeAt(s2 % seed.length)) & 255;
      var tmp = a256[s2]; a256[s2] = a256[tt]; a256[tt] = tmp;
    }
    var acc0 = 0x67452301;
    for (var t2 = 0; t2 < seed.length; t2++) acc0 = _vd_u((acc0 ^ Math.imul(seed.charCodeAt(t2), _VD_D[15 & t2])) >>> 0, 5);
    return { S: a256, acc: _vd_o(acc0) };
  }
  var s = new Array(61);
  var n = _vd_o((function (e) {
    var a = 0x811c9dc5;
    for (var t3 = 0; t3 < e.length; t3++) a = Math.imul(a ^ e.charCodeAt(t3), 0x1000193) >>> 0;
    return _vd_o(a);
  })(seed) ^ _vd_o(mediaId >>> 0 ^ 0x9e3779b9)) >>> 0;
  for (var e = 0; e < 8; e++) {
    if (_vd_r(e)) {
      var a = n % 61;
      n = _vd_u((n + 0x9e3779b9) >>> 0, 7 + (7 & e));
      s[a] = (n ^ _vd_o(n)) >>> 0;
      n = _vd_o((n + a) >>> 0);
    } else {
      s[e] = _VD_D[15 & e];
    }
  }
  return { S: s, acc: _vd_o(0xa5a5a5a5 ^ n) >>> 0 };
}

// One 32-bit keystream word; advances the state (mutates state.S/acc).
function _vdNextWord(state, counter) {
  var t, s;
  var n = state.S, l = state.acc;
  var d = l % 61;
  var i = 0 - Number(d in n);
  var r = n[d] >>> 0;
  var c = Math.imul(0x9e3779b9, counter + 1) >>> 0;
  var b = (((t = l) ^ (s = (r ^ c) >>> 0)) >>> 0 | (t & s & i) >>> 0) >>> 0;
  l = _vd_o(((b = (_vd_u((b + l) >>> 0, 31 & d) ^ _vd_u(l, 31 & Math.imul(d, 7))) >>> 0)) + 0x9e3779b9 >>> 0);
  n[d] = l >>> 0;
  state.acc = l;
  return l >>> 0;
}

// Keystream of `len` bytes from (seed, mediaId).
function _vdKeystream(seed, mediaId, len) {
  var state = _vdBuildState(seed, mediaId);
  var out = new Uint8Array(len);
  var ctr = 0;
  for (var e = 0; e < len;) {
    var a = _vdNextWord(state, ctr++);
    out[e++] = 255 & a;
    if (e < len) out[e++] = (a >>> 8) & 255;
    if (e < len) out[e++] = (a >>> 16) & 255;
    if (e < len) out[e++] = (a >>> 24) & 255;
  }
  return out;
}

// Decrypt one encrypted sources payload (base64url string) -> JSON text.
function _vdDecryptPayload(payloadB64, seed, mediaId) {
  var enc = _b64UrlToBytes(payloadB64);
  var ks = _vdKeystream(seed, mediaId, enc.length);
  for (var e = 0; e < enc.length; e++) enc[e] ^= ks[e];
  for (var k = 0; k < _VD_MAGIC.length; k++) {
    if (enc[k] !== _VD_MAGIC[k]) throw new Error("vidy: decrypt failed (bad seed or tampered payload)");
  }
  var body = enc.subarray(_VD_MAGIC.length);
  return _bytesToUtf8(body);
}

// Fetch + decrypt one lane's /sources. Returns parsed {sources, subtitles}.
// A 401 clears the cached seed and retries once (the site does the same).
function _vdFetchLane(lane, params, mediaId) {
  var base = VIDY_API + "/" + lane + "/sources";
  var attempt = function () {
    return _vdFetchSeed(VIDY_API, mediaId).then(function (seed) {
      var q = [];
      var keys = Object.keys(params);
      for (var i = 0; i < keys.length; i++) q.push(encodeURIComponent(keys[i]) + "=" + encodeURIComponent(params[keys[i]]));
      q.push("enc=2");
      q.push("seed=" + encodeURIComponent(seed));
      var url = base + "?" + q.join("&");
      return fetch(url, { headers: VIDY_HEADERS }).then(function (r) {
        if (r.status === 401) {
          var err = new Error("vidy: seed invalid");
          err.status = 401;
          throw err;
        }
        if (!r.ok) throw new Error("vidy: lane " + lane + " HTTP " + r.status);
        return r.text();
      }).then(function (text) {
        var trimmed = String(text || "").trim();
        if (!trimmed) throw new Error("vidy: empty lane response");
        if (trimmed.charAt(0) === "{") {
          try {
            var errObj = JSON.parse(trimmed);
            if (errObj && typeof errObj.error === "string") throw new Error("vidy: " + errObj.error);
          } catch (e) {
            if (e && e.message && e.message.indexOf("vidy:") === 0) throw e;
          }
        }
        var jsonText = _vdDecryptPayload(trimmed, seed, mediaId);
        var data = JSON.parse(jsonText);
        return data;
      });
    });
  };
  return attempt().catch(function (e) {
    if (e && e.status === 401) {
      _vdDropSeed(VIDY_API, mediaId);
      return attempt();
    }
    throw e;
  });
}

// Lanes in the site's own order (first = Miami). We walk them in
// order and stop once we have streams; a lane that errors/500s is
// skipped. Cap the walk so a slow provider never overruns the budget.
// All 18 lanes the site lists (2026-11-10 probe): Miami, Boise,
// Nashville, Chicago, Vegas, Reno, Oakland, Seattle, Phoenix,
// Atlanta, Portland, Austin, Dallas, Munich, Berlin, Paris, Delhi,
// Cancun. Upstream per lane (The Matrix probe): goldenkite
// (Miami/Boise), vividstone (Nashville/Phoenix/Portland),
// workers.dev proxy (Chicago/Oakland/Munich), Hindi mirror
// (Austin/Delhi), majorplay (Dallas). Vegas/Reno/Seattle/Atlanta/
// Berlin/Paris/Cancun 500'd or seed-401'd on that probe — transient.
var VIDY_LANES = ["miami", "boise", "nashville", "chicago", "vegas", "reno", "oakland", "seattle", "phoenix", "atlanta", "portland", "austin", "dallas", "munich", "berlin", "paris", "delhi", "cancun"];

function _vdQualityOf(src) {
  if (!src) return "Unknown";
  var q = src.quality || src.label || "";
  var m = /(\d{3,4})\s*p/i.exec(String(q));
  if (m) return m[1] + "p";
  if (/2160|4k/i.test(String(q))) return "2160p";
  if (/1080/i.test(String(q))) return "1080p";
  if (/720/i.test(String(q))) return "720p";
  if (/480/i.test(String(q))) return "480p";
  if (/360/i.test(String(q))) return "360p";
  return "Unknown";
}

function _vdStreamsFromLane(data, lane, meta, season, episode) {
  var out = [];
  if (!data || !Array.isArray(data.sources)) return out;
  var subs = [];
  if (Array.isArray(data.subtitles)) {
    for (var i = 0; i < data.subtitles.length; i++) {
      var sb = data.subtitles[i];
      var lang = (sb && typeof sb === "object") ? (sb.language || sb.lang || sb.label || "") : String(sb || "");
      if (lang) subs.push(lang);
    }
  }
  data.sources.forEach(function (src) {
    var url = src && (src.url || src.file || src.src);
    if (!url || typeof url !== "string") return;
    if (!/^https?:\/\//i.test(url)) return;
    var quality = _vdQualityOf(src);
    var size = formatStreamSize({
      title: meta.title, year: meta.year, runtime: meta.runtime,
      quality: quality, season: season, episode: episode,
      source: "Vidy", server: lane, subtitles: subs, url: url
    });
    out.push({
      name: "Vidy", title: "Vidy", size: size,
      url: url, quality: quality, type: "direct",
      headers: { Referer: VIDY_ORIGIN + "/", "User-Agent": VIDY_UA },
      behaviorHints: { notWebReady: true, proxyHeaders: { request: { Referer: VIDY_ORIGIN + "/", "User-Agent": VIDY_UA } } }
    });
  });
  return out;
}

function _vdTmdbDetails(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return { title: "", year: "", runtime: 0, imdbId: "" };
      var t = j.title || j.name || "";
      var d = j.release_date || j.first_air_date || "";
      var rt = 0;
      if (typeof j.runtime === "number" && j.runtime > 0) rt = j.runtime;
      else if (Array.isArray(j.episode_run_time) && j.episode_run_time.length && j.episode_run_time[0] > 0) rt = j.episode_run_time[0];
      return { title: t, year: d ? String(d).slice(0, 4) : "", runtime: rt, imdbId: j.imdb_id || "" };
    }).catch(function () { return { title: "", year: "", runtime: 0, imdbId: "" }; });
}

function _vdTmdbImdb(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY, { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return (j && j.imdb_id) ? j.imdb_id : ""; })
    .catch(function () { return ""; });
}

function _vdEpRuntime(tmdbId, season, episode) {
  return fetch("https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + TMDB_API_KEY, { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return (j && typeof j.runtime === "number" && j.runtime > 0) ? j.runtime : 0; })
    .catch(function () { return 0; });
}

// __STREAM_LABEL_FORMATTER__ v2: one-line emoji label for every stream.
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
        he: "Hebrew", heb: "Hebrew", ro: "Romanian", ron: "Romanian", rum: "Romanian", hu: "Hungarian", hun: "Hungarian" };
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

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var season = seasonNum || 1, episode = episodeNum || 1;
  return Promise.all([
    _vdTmdbDetails(tmdbId, mediaType),
    _vdTmdbImdb(tmdbId, mediaType),
    kind === "tv" ? _vdEpRuntime(tmdbId, season, episode) : Promise.resolve(0)
  ]).then(function (res) {
    var meta = res[0] || { title: "", year: "", runtime: 0, imdbId: "" };
    var imdbId = res[1] || meta.imdbId || "";
    if (kind === "tv" && !meta.runtime && res[2] > 0) meta.runtime = res[2];
    if (!meta.title) return [];
    var params = {
      title: meta.title,
      mediaType: kind,
      tmdbId: String(tmdbId),
      imdbId: imdbId || ""
    };
    if (kind === "tv") {
      params.seasonId = String(season);
      params.episodeId = String(episode);
    }
    // Gate: the API is TMDB-keyed, so a response is by construction
    // for this exact title. We still require a non-empty title from
    // TMDB before calling it, so a bad id never yields streams.
    var lanes = VIDY_LANES.slice();
    var out = [];
    var seen = {};
    var idx = 0;
    var walk = function () {
      if (idx >= lanes.length) return out;
      // Stop once we have a healthy set; the site auto-picks one
      // server, we keep the first lanes that answer.
      if (out.length >= 8) return out;
      var lane = lanes[idx++];
      return _vdFetchLane(lane, params, tmdbId).then(function (data) {
        var streams = _vdStreamsFromLane(data, lane, meta, kind === "tv" ? season : undefined, kind === "tv" ? episode : undefined);
        streams.forEach(function (s) {
          if (!seen[s.url]) { seen[s.url] = true; out.push(s); }
        });
        if (out.length >= 8) return out;
        return walk();
      }).catch(function () {
        return walk();
      });
    };
    return walk();
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.VidyScraperModule = { getStreams: getStreams };
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
