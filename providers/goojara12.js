
// ---------- timer-free fetch deadlines (Goojara-specific, 2026-10-22) ----------
// WHY NO v5 RETRY PRELUDE / NO CHAIN POSTLUDE HERE: for Goojara the
// failure mode on the user's phone networks is the opposite of the TV's
// flaky drops - the goojara.to zone appears BLOCKED (Vi 5G: fast status-0
// resets; home Wi-Fi: fetches stall). Amplifying a blocked host with
// 4x fetch retries x 3 fallback bases x a whole-chain retry turned one
// dead session fetch into minutes of hanging, so the app killed the
// provider and showed only its "Error / about:error" row - even the
// diagnostic build returned nothing on Wi-Fi. This build uses ONE base,
// NO retry prelude, NO postlude, and bounds every network step with a
// real deadline so a blocked host fails in seconds and the provider
// still returns (empty / diag rows) inside the app budget.
// settleWithin(): races a promise against a wall-clock deadline with
// NO timers (the guests have none). The poll loop AWAITS a tiny fetch
// to TMDB (a host this provider already depends on) on every round -
// that real network wait keeps the event loop free, so the watched
// fetch can actually deliver (a Promise.resolve() microtask loop was
// tested and STARVES fetches: even a 1s fetch lost a 6s deadline).
// PirateXPlay's withDeadline microtask race is only safe there because
// its caller wants the fallback value anyway; here we need the body.
var GJ_TICK_URL = "https://api.themoviedb.org/3/movie/603?api_key=5f39fd16e987a9e3fce30d55cf09b438";
var GJ_TIMEOUT = "__GJ_TIMEOUT__";
function gjSpin(ms) { var t = Date.now(); while (Date.now() - t < ms) {} }
function gjTick() {
  return fetch(GJ_TICK_URL, {}).then(function (r) {
    return (r && typeof r.text === "function") ? r.text() : null;
  }).then(function () {}, function () {});
}
function settleWithin(promise, ms) {
  var box = { done: false, value: undefined, err: null };
  Promise.resolve(promise).then(function (v) { box.done = true; box.value = v; },
    function (e) { box.done = true; box.err = e; });
  var t0 = Date.now();
  function check() {
    if (box.done) { if (box.err) throw box.err; return box.value; }
    if (Date.now() - t0 >= ms) return GJ_TIMEOUT;
    gjSpin(15);
    return gjTick().then(check, check);
  }
  return Promise.resolve().then(check);
}
// Goojara provider — Nuvio port of phisher98's CloudStream Goojara plugin
// (Goojara_0_tedm.cs3, decompiled and re-implemented 2026-10-20).
// Flow: session (server cookies + the _3chk pair the page prints in a script)
// -> POST /xmre.php search (z = #res data-ins token) -> watch page go.php
// server links -> follow redirect to the embed host -> per-host extraction:
//   Luluvdo/Dood : packed JS -> direct tnmr.org m3u8 (verified playable)
//   Wootly       : iframe -> POST qdfx=1 -> var vd / tk -> web.wootly.ch/grabm
//   Streamplay   : generic page extraction (captcha-gated upstream)
//   Stre4mpay    : VidHide family — packed JS -> m3u8/mp4
// Fixes vs the removed v1.0.x build: #res data-ins is alphanumeric now (the
// old regex only accepted digits and grabbed the search box's token instead),
// cookies are absorbed from every response, embeds resolve in parallel, and
// title matching uses the exact-title gate.

var BASE = "https://ww1.goojara.to";
// Single base ONLY: www/apex just 301 to ww1 (same zone, same Cloudflare
// vhost, same block surface) - the 1.2.58 multi-base walk tripled the
// session hang on blocked networks for zero extra reachability.
var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

// ---------- session ----------
var jar = {};
var dataIns = "";
function absorbCookies(res) {
  try {
    var list = null;
    if (res.headers && typeof res.headers.getSetCookie === "function") list = res.headers.getSetCookie();
    else if (res.headers && typeof res.headers.get === "function") {
      var sc = res.headers.get("set-cookie");
      if (sc) list = sc.split(/,(?=[^;,]+=)/);
    }
    if (!list) return;
    list.forEach(function (c) {
      var pair = String(c).split(";")[0];
      var i = pair.indexOf("=");
      if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    });
  } catch (e) {}
}
function cookieHeader() {
  return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; ");
}
function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {};
  options.headers = options.headers || {};
  if (!options.headers["User-Agent"]) options.headers["User-Agent"] = UA;
  return fetch(url, options);
}
function getText(url, headers, timeoutMs) {
  var h = {};
  if (headers) Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
  if (cookieHeader()) h["Cookie"] = cookieHeader();
  var chain = fetchWithTimeout(url, { headers: h }, timeoutMs || 12000).then(function (r) {
    absorbCookies(r);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
  if (arguments[3]) return chain;
  return settleWithin(chain, timeoutMs || 9000).then(function (v) {
    if (v === GJ_TIMEOUT) throw new Error("timeout");
    return v;
  });
}
function ensureSession() {
  jar = {}; dataIns = "";
  return getText(BASE + "/", { "Accept": "text/html" }, 9000).then(function (html) {
    var m = /_3chk\(\s*'([^']+)'\s*,\s*'([^']+)'\)/.exec(html);
    if (m) jar[m[1]] = m[2];
    var d = /id="res"[^>]*data-ins="([^"]+)"/.exec(html) || /data-ins="([^"]+)"/.exec(html);
    if (d) dataIns = d[1];
    return !!dataIns;
  }).catch(function () { return false; });
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
  if (q.join("") === c.join("")) return true;
  var cset = {};
  c.forEach(function (w) { cset[w] = 1; });
  var contained = true;
  for (var i = 0; i < q.length; i++) if (!cset[q[i]]) { contained = false; break; }
  if (contained && (2 * q.length) / (q.length + c.length) >= 0.8) return true;
  var stripped = [];
  for (var j = 0; j < c.length; j++) { if (!isTailJunk(c[j])) stripped.push(c[j]); }
  if (stripped.length && stripped.join("") === q.join("") && c.slice(0, stripped.length).join("") === q.join("")) return true;
  return false;
}

// ---------- TMDB ----------
function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return settleWithin(fetchWithTimeout("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY, {}, 10000)
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !(j.title || j.name)) return null;
      var d = j.release_date || j.first_air_date || "";
      return { title: j.title || j.name, year: d ? parseInt(d.slice(0, 4), 10) : null };
    })
    .catch(function () { return null; }), 8000).then(function (v) { return v === GJ_TIMEOUT ? null : v; });
}

// ---------- site search ----------
function searchGoojara(query) {
  var body = "z=" + encodeURIComponent(dataIns) + "&x=bcb23b0360&q=" + encodeURIComponent(query);
  var h = { "Content-Type": "application/x-www-form-urlencoded", "Referer": BASE + "/", "X-Requested-With": "XMLHttpRequest" };
  if (cookieHeader()) h["Cookie"] = cookieHeader();
  return settleWithin(fetchWithTimeout(BASE + "/xmre.php", { method: "POST", headers: h, body: body }, 10000)
    .then(function (r) {
      absorbCookies(r);
      if (!r.ok) throw new Error("Search HTTP " + r.status);
      return r.text();
    })
    .then(function (html) {
      var results = [], m;
      var re = /<a href="(\/[mt][A-Za-z0-9]+)">\s*<div class="i[mt]">\s*<strong>([^<]+)<\/strong>\s*\((\d{4})\)/g;
      while ((m = re.exec(html)) !== null) {
        results.push({
          href: m[1],
          title: m[2].trim(),
          year: parseInt(m[3], 10),
          type: m[1].charAt(1) === "m" ? "movie" : "tv",
        });
        if (results.length >= 12) break;
      }
      return results;
    }), 9000).then(function (v) { if (v === GJ_TIMEOUT) throw new Error("timeout"); return v; });
}
function pickResult(results, meta, wantType) {
  var best = null;
  results.forEach(function (r) {
    if (r.type !== wantType) return;
    if (!isExactTitle(meta.title, r.title)) return;
    if (meta.year && r.year && Math.abs(r.year - meta.year) > 1) return;
    if (!best) best = r;
    else if (meta.year && r.year === meta.year && best.year !== meta.year) best = r;
  });
  return best;
}

// ---------- embed resolution ----------
function followGoPhp(goUrl, referer) {
  var h = { "Referer": referer };
  if (cookieHeader()) h["Cookie"] = cookieHeader();
  h["User-Agent"] = UA;
  return fetchWithTimeout(goUrl, { method: "GET", redirect: "manual", headers: h }, 8000)
    .then(function (res) {
      absorbCookies(res);
      var loc = res.headers.get("location");
      if (loc) return loc;
      if (res.url && res.url !== goUrl) return res.url;
      return res.text().then(function (html) {
        var m = /<meta[^>]+http-equiv="refresh"[^>]+url=([^">]+)/i.exec(html)
          || /window\.location\s*=\s*["']([^"']+)["']/.exec(html);
        return m ? m[1] : null;
      });
    })
    .catch(function () { return null; });
}
// Dean Edwards packer unpacker (pure JS, no eval)
function unpackPacked(packed) {
  var flat = String(packed).replace(/\n/g, " ");
  var m = /\}\('(.*)',(\d+),(\d+),'(.*)'\.split\('\|'\)/.exec(flat);
  if (!m) return null;
  var p = m[1], a = parseInt(m[2], 10), c = parseInt(m[3], 10), k = m[4].split("|");
  p = p.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  function toBase(n) {
    var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (a <= 36) return n.toString(a);
    var s = "";
    do { s = chars[n % a] + s; n = Math.floor(n / a); } while (n > 0);
    return s;
  }
  while (c--) {
    if (k[c]) p = p.replace(new RegExp("\\b" + toBase(c) + "\\b", "g"), k[c]);
  }
  return p;
}
function mediaFromHtml(html) {
  var m = /(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/.exec(html);
  if (m) return m[1];
  m = /(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/.exec(html);
  if (m) return m[1];
  var scripts = [], sm, re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  while ((sm = re.exec(html)) !== null) scripts.push(sm[1]);
  for (var i = 0; i < scripts.length; i++) {
    if (scripts[i].indexOf("eval(function(p,a,c,k,e,d)") === -1) continue;
    var u = unpackPacked(scripts[i]);
    if (!u) continue;
    m = /(https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*)/.exec(u) || /(https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*)/.exec(u);
    if (m) return m[1].replace(/\\/g, "");
  }
  return null;
}
function resolveWootly(embedUrl) {
  return getText(embedUrl, { "Referer": BASE + "/" }, 9000, true).then(function (html) {
    var im = /<iframe[^>]*src="([^"]+)"/i.exec(html);
    if (!im) return null;
    var frame = im[1];
    if (frame.indexOf("//") === 0) frame = "https:" + frame;
    var h = { "Content-Type": "application/x-www-form-urlencoded", "Referer": embedUrl };
    if (cookieHeader()) h["Cookie"] = cookieHeader();
    h["User-Agent"] = UA;
    return fetchWithTimeout(frame, { method: "POST", headers: h, body: "qdfx=1" }, 9000)
      .then(function (r) { absorbCookies(r); return r.ok ? r.text() : ""; })
      .then(function (t) {
        var vd = /var\s+vd\s*=\s*["']([^"']+)["']/.exec(t);
        var tk = /tk\s*=\s*["']([^"']+)["']/.exec(t);
        if (!vd || !tk) return null;
        return getText("https://web.wootly.ch/grabm?t=" + encodeURIComponent(tk[1]) + "&id=" + encodeURIComponent(vd[1]),
          { "Referer": frame }, 9000, true).then(function (g) {
          var url = mediaFromHtml(g);
          if (!url) {
            var bare = String(g).trim();
            if (/^https?:\/\/\S+$/.test(bare)) url = bare;
          }
          if (!url) return null;
          return { url: url, source: "Wootly", headers: { "Referer": "https://www.wootly.ch/" } };
        });
      });
  }).catch(function () { return null; });
}
function resolveGenericEmbed(embedUrl, sourceName) {
  return getText(embedUrl, { "Referer": BASE + "/" }, 9000, true).then(function (html) {
    var url = mediaFromHtml(html);
    return url ? { url: url, source: sourceName } : null;
  }).catch(function () { return null; });
}
function resolveEmbed(embedUrl) {
  if (!embedUrl) return Promise.resolve(null);
  var host = "";
  try { host = new URL(embedUrl).hostname; } catch (e) {}
  if (/wootly/.test(host)) return resolveWootly(embedUrl);
  if (/luluvdo|dood|d000d/.test(host)) return resolveGenericEmbed(embedUrl, "Luluvdo");
  if (/streamplay/.test(host)) return resolveGenericEmbed(embedUrl, "Streamplay");
  if (/stre4mpay|vidhide|vhide/.test(host)) return resolveGenericEmbed(embedUrl, "Stre4mpay");
  return resolveGenericEmbed(embedUrl, host.replace(/^www\./, "") || "Server");
}
function getGoPhpLinks(pageUrl) {
  return getText(pageUrl, { "Referer": BASE + "/" }, 12000, true).then(function (html) {
    var links = [], m;
    var re = /href="(https?:\/\/[^"]*go\.php\?url=[^"]+)"/g;
    while ((m = re.exec(html)) !== null) {
      var link = m[1].replace(/^https?:\/\/[^/]+/, BASE);
      if (links.indexOf(link) === -1) links.push(link);
    }
    return links;
  }).catch(function () { return []; });
}
function streamsFromPage(pageUrl) {
  return getGoPhpLinks(pageUrl).then(function (links) {
    if (!links.length) return [];
    var picks = links.slice(0, 8);
    // Collect in parallel but do NOT wait for every dead/slow server: finish
    // when all settle, when 3 streams are in hand, or at a 20s deadline —
    // waiting for the slowest branch is how live servers turned into a
    // device-side zero on titles with several dead embed slots.
    var partialOut = [];
    return settleWithin(new Promise(function (resolve) {
      var out = partialOut, seen = {}, settled = 0, done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve(out.slice(0, 6));
      }
      var t0 = Date.now();
      picks.forEach(function (goUrl) {
        followGoPhp(goUrl, pageUrl).then(function (embedUrl) {
          return resolveEmbed(embedUrl);
        }).then(function (r) {
          settled++;
          if (r && r.url && !seen[r.url]) {
            seen[r.url] = 1;
            var s = {
              name: "Goojara",
              title: r.source,
              url: r.url,
              quality: "HD",
              type: /\.m3u8(\?|$)/i.test(r.url) ? "hls" : "direct",
            };
            if (r.headers) s.headers = r.headers;
            out.push(s);
          }
          if (out.length >= 3 || settled >= picks.length) finish();
          // The deadline this collector always promised: once 15s have
          // passed and at least one stream is in hand, stop waiting on
          // slow/dead embed branches instead of riding them into the
          // app's provider timeout (which surfaces as an error row).
          else if (out.length >= 1 && Date.now() - t0 >= 15000) finish();
        }).catch(function () {
          settled++;
          if (settled >= picks.length) finish();
          else if (out.length >= 1 && Date.now() - t0 >= 15000) finish();
        });
      });
    }), 18000).then(function (v) { return v === GJ_TIMEOUT ? partialOut.slice(0, 6) : v; });
  });
}

// ---------- TV episodes ----------
function findEpisodePage(tvPageUrl, season, episode) {
  return getText(tvPageUrl, { "Referer": BASE + "/" }, 12000).then(function (html) {
    var idM = /id="seon"[^>]*data-id="(\d+)"/.exec(html);
    if (!idM) return null;
    var h = { "Content-Type": "application/x-www-form-urlencoded", "Referer": tvPageUrl, "X-Requested-With": "XMLHttpRequest" };
    if (cookieHeader()) h["Cookie"] = cookieHeader();
    h["User-Agent"] = UA;
    return settleWithin(fetchWithTimeout(BASE + "/xmre.php", {
      method: "POST", headers: h,
      body: "s=" + encodeURIComponent(season) + "&t=" + encodeURIComponent(idM[1]),
    }, 10000).then(function (r) {
      absorbCookies(r);
      return r.ok ? r.text() : "";
    }), 9000).then(function (v) { return v === GJ_TIMEOUT ? "" : v; });
  }).then(function (html) {
    if (!html) return null;
    var re = /<span class="sea">\s*(\d+)\s*<\/span>\s*<span>Season\s*(\d+)<\/span>[\s\S]*?<a href="(\/e[A-Za-z0-9]+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      if (parseInt(m[1], 10) === episode && parseInt(m[2], 10) === season) return BASE + m[3];
    }
    return null;
  }).catch(function () { return null; });
}

// ---------- main ----------
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isTV = mediaType === "tv";
  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta) return [];
    return attempt(meta, isTV, seasonNum, episodeNum, false);
  }).catch(function () { return []; });
}
function attempt(meta, isTV, seasonNum, episodeNum, isRetry) {
  var aT0 = Date.now();
  return ensureSession().then(function (ok) {
    if (!ok) return { sessionFailed: true, streams: [] };
    return searchGoojara(meta.title).then(function (results) {
      var best = pickResult(results, meta, isTV ? "tv" : "movie");
      if (!best) return { streams: [] };
      var pageUrl = BASE + best.href;
      if (!isTV) return streamsFromPage(pageUrl).then(function (st) { return { streams: st }; });
      if (seasonNum == null || episodeNum == null) return { streams: [] };
      return findEpisodePage(pageUrl, seasonNum, episodeNum).then(function (epUrl) {
        if (!epUrl) return { streams: [] };
        return streamsFromPage(epUrl).then(function (st) { return { streams: st }; });
      });
    });
  }).then(function (res) {
    // A failed SESSION means the host is unreachable/blocked - retrying
    // the same host only multiplies the hang (that was the about:error
    // storm). Return empty at once; the app shows "no streams", not an
    // error row, and other providers are unaffected.
    if (res.sessionFailed) return [];
    var streams = res.streams;
    if (streams && streams.length) return streams;
    if (isRetry) return [];
    if (Date.now() - aT0 >= 12000) return [];
    // Session worked but the chain came back empty (stale session /
    // throttling): ONE fresh-session retry, only while still fast.
    jar = {}; dataIns = "";
    return attempt(meta, isTV, seasonNum, episodeNum, true);
  }).catch(function () {
    if (isRetry) return [];
    if (Date.now() - aT0 >= 12000) return [];
    jar = {}; dataIns = "";
    return attempt(meta, isTV, seasonNum, episodeNum, true);
  });
}

global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}

/* No chain-retry postlude in this build - see the deadline note at the top. */
