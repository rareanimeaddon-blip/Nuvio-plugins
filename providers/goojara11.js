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
// Session fallback bases (2026-10-22): on one phone network the ww1 host
// was unreachable at transport level (every fetch status-0) while the
// site itself was up. www/apex redirect to ww1 at the HTTP layer but are
// different connection hostnames, so they are worth trying as alternate
// doors when the ww1 session cannot be established. The first base that
// yields a session becomes BASE for the whole run (search, pages,
// episode POSTs), and go.php links are rewritten onto it.
var BASES = ["https://ww1.goojara.to", "https://www.goojara.to", "https://goojara.to"];
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
  return fetchWithTimeout(url, { headers: h }, timeoutMs || 12000).then(function (r) {
    absorbCookies(r);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}
function tryBase(b) {
  jar = {}; dataIns = "";
  return getText(b + "/", { "Accept": "text/html" }, 12000).then(function (html) {
    var m = /_3chk\(\s*'([^']+)'\s*,\s*'([^']+)'\)/.exec(html);
    if (m) jar[m[1]] = m[2];
    var d = /id="res"[^>]*data-ins="([^"]+)"/.exec(html) || /data-ins="([^"]+)"/.exec(html);
    if (d) dataIns = d[1];
    if (dataIns) BASE = b;
    return !!dataIns;
  }).catch(function () { return false; });
}
function ensureSession() {
  var chain = Promise.resolve(false);
  BASES.forEach(function (b) {
    chain = chain.then(function (ok) { return ok ? true : tryBase(b); });
  });
  return chain;
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
  return fetchWithTimeout("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY, {}, 10000)
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !(j.title || j.name)) return null;
      var d = j.release_date || j.first_air_date || "";
      return { title: j.title || j.name, year: d ? parseInt(d.slice(0, 4), 10) : null };
    })
    .catch(function () { return null; });
}

// ---------- site search ----------
function searchGoojara(query) {
  var body = "z=" + encodeURIComponent(dataIns) + "&x=bcb23b0360&q=" + encodeURIComponent(query);
  var h = { "Content-Type": "application/x-www-form-urlencoded", "Referer": BASE + "/", "X-Requested-With": "XMLHttpRequest" };
  if (cookieHeader()) h["Cookie"] = cookieHeader();
  return fetchWithTimeout(BASE + "/xmre.php", { method: "POST", headers: h, body: body }, 10000)
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
    });
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
  return getText(embedUrl, { "Referer": BASE + "/" }, 9000).then(function (html) {
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
          { "Referer": frame }, 9000).then(function (g) {
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
  return getText(embedUrl, { "Referer": BASE + "/" }, 9000).then(function (html) {
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
  return getText(pageUrl, { "Referer": BASE + "/" }, 12000).then(function (html) {
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
    return new Promise(function (resolve) {
      var out = [], seen = {}, settled = 0, done = false;
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
    });
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
    return fetchWithTimeout(BASE + "/xmre.php", {
      method: "POST", headers: h,
      body: "s=" + encodeURIComponent(season) + "&t=" + encodeURIComponent(idM[1]),
    }, 10000).then(function (r) {
      absorbCookies(r);
      return r.ok ? r.text() : "";
    });
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
  return ensureSession().then(function (ok) {
    if (!ok) throw new Error("no session");
    return searchGoojara(meta.title);
  }).then(function (results) {
    var best = pickResult(results, meta, isTV ? "tv" : "movie");
    if (!best) throw new Error("no match");
    var pageUrl = BASE + best.href;
    if (!isTV) return streamsFromPage(pageUrl);
    if (seasonNum == null || episodeNum == null) return [];
    return findEpisodePage(pageUrl, seasonNum, episodeNum).then(function (epUrl) {
      if (!epUrl) return [];
      return streamsFromPage(epUrl);
    });
  }).then(function (streams) {
    if (streams && streams.length) return streams;
    if (isRetry) return [];
    // Empty result (site throttling / stale session): one fresh-session retry.
    jar = {}; dataIns = "";
    return attempt(meta, isTV, seasonNum, episodeNum, true);
  }).catch(function () {
    if (isRetry) return [];
    jar = {}; dataIns = "";
    return attempt(meta, isTV, seasonNum, episodeNum, true);
  });
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
