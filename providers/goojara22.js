// ---------- fetch style: INTERLEAVED FAST PATH (v2.1.4) ----------
// v2.1.4 (2026-11-24): Infinite Subtitles addon attach (addon-only, no
// direct SubDL/Wyzie/mirror) - rows carry _releaseTitle, final return
// wrapped with osAttachSubtitles; IMDb id fetched lazily via TMDB.
// v2.1.3 (2026-11-16): Luluvdo and Vidsrc embeds are skipped outright -
// both hosts accept the connection but never answer (Luluvdo 4/4 fetches
// hung past 15s in the sandbox; Vidsrc hung the same way on Young Sheldon
// S1E1 and is unresolvable from here anyway - IP-bound token), and this
// build has no per-fetch timeout, so one such link stalled the whole
// provider past the app budget and 0 streams came back even when Wootly
// had already resolved one. The skip happens in getGoPhpLinks (the Direct
// Links box labels each server) because the TV service follows the go.php
// redirect - filtering only in resolveEmbed would still hang inside
// followGoPhp. Wootly's frame POST also gets one fresh-frame retry: it
// 404s intermittently (404 in tvsim, 200 minutes later on a fresh token).
// 2026-10-30: live 2.0.13 answered Matrix and PHM in simulation (3
// streams each) yet returned NOTHING on the phone. Its per-search
// footprint is the suspect: 8 parallel embed branches PLUS two TMDB
// "clock" chains firing dozens of TMDB fetches per run, plus a full
// retry - far more than the phone bridge tolerates on repeat
// searches. v2.1.2 strips both clocks and the parallel collector:
// follow one server link, resolve it immediately, stop at 2 streams
// (max 5 tried). No retry once the embed stage was reached.
// Luluvdo UA headers and the emoji label formatter from
// 2.0.12/2.0.13 are kept.
// Goojara provider - Nuvio port of phisher98's CloudStream Goojara plugin
// (Goojara_0_tedm.cs3, decompiled and re-implemented 2026-10-20).
// Flow: session (server cookies + the _3chk pair the page prints in a
// script) -> POST /xmre.php search (z = #res data-ins token) -> watch
// page go.php server links -> follow redirect to the embed host ->
// per-host extraction (Luluvdo/Dood packed JS, Wootly grabm,
// Streamplay, Stre4mpay/VidHide). Title matching uses the exact gate.
var BASE = "https://ww1.goojara.to";
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
  // Wootly's /e/ frame POST intermittently 404s (2026-11-16: 404 in tvsim,
  // 200 minutes later with a fresh token) - on a non-OK POST, re-fetch the
  // embed page once for a fresh frame URL and retry the POST once only.
  function postFrame(frame, retried) {
    var h = { "Content-Type": "application/x-www-form-urlencoded", "Referer": embedUrl };
    if (cookieHeader()) h["Cookie"] = cookieHeader();
    h["User-Agent"] = UA;
    return fetchWithTimeout(frame, { method: "POST", headers: h, body: "qdfx=1" }, 9000)
      .then(function (r) {
        absorbCookies(r);
        if (r.ok) return r.text();
        if (retried) return "";
        return getText(embedUrl, { "Referer": BASE + "/" }, 9000, true).then(function (html2) {
          var im2 = /<iframe[^>]*src="([^"]+)"/i.exec(html2);
          if (!im2) return "";
          var frame2 = im2[1];
          if (frame2.indexOf("//") === 0) frame2 = "https:" + frame2;
          if (frame2 === frame) return "";
          return postFrame(frame2, true);
        }).catch(function () { return ""; });
      });
  }
  return getText(embedUrl, { "Referer": BASE + "/" }, 9000, true).then(function (html) {
    var im = /<iframe[^>]*src="([^"]+)"/i.exec(html);
    if (!im) return null;
    var frame = im[1];
    if (frame.indexOf("//") === 0) frame = "https:" + frame;
    return postFrame(frame, false)
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
  // Luluvdo hangs: its server accepts the connection but never answers
  // (2026-11-16: 4/4 fetches hung past 15s; curl gets a fast reset), and
  // this build has no per-fetch timeout, so one Luluvdo link stalls the
  // whole provider past the app budget. Vidsrc hangs the same way (Young
  // Sheldon S1E1) and is unresolvable from here anyway (IP-bound token).
  // Skip both outright; other hosts (Dood, Streamplay, Stre4mpay) keep
  // their existing path.
  if (/luluvdo|vidsrc/.test(host)) return Promise.resolve(null);
  if (/wootly/.test(host)) return resolveWootly(embedUrl);
  if (/dood|d000d/.test(host)) return resolveGenericEmbed(embedUrl, "Dood").then(function (r) {
    // Luluvdo fix (playback): tnmr.org answers 403 to player/mobile UAs
    // (ExoPlayer/Dalvik) on variant+segment fetches, so the player must send
    // the provider browser UA. Wootly and every other branch untouched.
    if (r) r.headers = { "User-Agent": UA };
    return r;
  });
  if (/streamplay/.test(host)) return resolveGenericEmbed(embedUrl, "Streamplay");
  if (/stre4mpay|vidhide|vhide/.test(host)) return resolveGenericEmbed(embedUrl, "Stre4mpay");
  return resolveGenericEmbed(embedUrl, host.replace(/^www\./, "") || "Server");
}
function getGoPhpLinks(pageUrl) {
  return getText(pageUrl, { "Referer": BASE + "/" }, 12000, true).then(function (html) {
    var links = [], m;
    // Direct Links carry the server name in the anchor text, e.g.
    // <a class="bcg" href="...go.php?url=...">Wootly <span>DVD</span></a>.
    // Luluvdo and Vidsrc links are dropped HERE, before following: the TV
    // service follows the go.php redirect, and both hosts accept the
    // connection but never answer (Luluvdo 4/4 hangs past 15s; Vidsrc
    // hung the same way on Young Sheldon S1E1), so following one hangs
    // the whole provider (this build has no per-fetch timeout). A link
    // with no readable label is kept (fail open for other servers/layouts).
    var re = /<a[^>]*href=(["'])(https?:\/\/[^"']*go\.php\?url=[^"']+)\1[^>]*>\s*([^<]*)/gi;
    while ((m = re.exec(html)) !== null) {
      var label = (m[3] || "").trim().toLowerCase();
      if (label === "luluvdo" || label === "vidsrc") continue;
      var link = m[2].replace(/^https?:\/\/[^/]+/, BASE);
      if (links.indexOf(link) === -1) links.push(link);
    }
    return links;
  }).catch(function () { return []; });
}
function streamsFromPage(pageUrl, mediaTitle, seasonNum, episodeNum) {
  return getGoPhpLinks(pageUrl).then(function (links) {
    if (!links.length) return [];
    var picks = links.slice(0, 6);
    var out = [], seen = {}, tried = 0;
    var chain = Promise.resolve();
    picks.forEach(function (goUrl) {
      chain = chain.then(function () {
        if (out.length >= 2 || tried >= 5) return null;
        return followGoPhp(goUrl, pageUrl).then(function (eu) {
          if (!eu) return null;
          tried++;
          return resolveEmbed(eu);
        }).then(function (r) {
          if (r && r.url && !seen[r.url]) {
            seen[r.url] = 1;
            var _gjSize = formatStreamSize({ source: "Goojara", title: mediaTitle, quality: "HD", season: seasonNum, episode: episodeNum, server: r.source, url: r.url });
            var st = {
              name: "Goojara",
              title: "Goojara",
              size: _gjSize,
              url: r.url,
              quality: "HD",
              _releaseTitle: mediaTitle + " HD",
              type: /\.m3u8(\?|$)/i.test(r.url) ? "hls" : "direct",
            };
            if (r.headers) st.headers = r.headers;
            out.push(st);
          }
        });
      });
    });
    return chain.then(function () { return out; });
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

// ---- Infinite Subtitles attach helpers ----
// osCfg: subtitle keys from SCRAPER_SETTINGS (the addon block's token-file
// fallback covers the rest). tmdbImdbId: the addon is keyed by IMDb id;
// TMDB detail carries imdb_id for movies, external_ids for TV. Called only
// when rows exist, so a title with no streams costs no extra fetch.
function osCfg() {
  var s = (typeof SCRAPER_SETTINGS !== "undefined" && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS : {};
  return {
    osSubtitles: s.osSubtitles,
    subdlApiKey: s.subdlApiKey,
    subdlApiKey2: s.subdlApiKey2,
    wyzieApiKey: s.wyzieApiKey,
    wyzieApiKey2: s.wyzieApiKey2
  };
}
function tmdbImdbId(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + (kind === "tv" ? "/external_ids" : "") + "?api_key=" + TMDB_KEY;
  return function (u) { return fetchWithTimeout(u, {}, 10000).then(function (r) { return r.json(); }); }(url).then(function (j) { return (j && j.imdb_id) || ""; }).catch(function () { return ""; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isTV = mediaType === "tv";
  return tmdbMeta(tmdbId, mediaType).then(function (meta) {
    if (!meta) return [];
    return attempt(meta, isTV, seasonNum, episodeNum, false);
  }).then(function (rows) {
    if (!rows || !rows.length) return rows;
    return tmdbImdbId(tmdbId, mediaType).then(function (imdb) { return osAttachSubtitles(rows, imdb, isTV, seasonNum, episodeNum, osCfg()); });
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
      if (!isTV) return streamsFromPage(pageUrl, meta.title, seasonNum, episodeNum).then(function (st) { return { streams: st, embedReached: true }; });
      if (seasonNum == null || episodeNum == null) return { streams: [] };
      return findEpisodePage(pageUrl, seasonNum, episodeNum).then(function (epUrl) {
        if (!epUrl) return { streams: [] };
        return streamsFromPage(epUrl, meta.title, seasonNum, episodeNum).then(function (st) { return { streams: st, embedReached: true }; });
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
    // Embed stage was reached but produced nothing: do NOT re-run it -
    // a re-run doubles the request burst on the phone bridge.
    if (res.embedReached) return [];
    if (Date.now() - aT0 >= 6000) return [];
    // Session worked but the chain came back empty (stale session /
    // throttling): ONE fresh-session retry, only while still fast.
    jar = {}; dataIns = "";
    return attempt(meta, isTV, seasonNum, episodeNum, true);
  }).catch(function () {
    if (isRetry) return [];
    if (Date.now() - aT0 >= 6000) return [];
    jar = {}; dataIns = "";
    return attempt(meta, isTV, seasonNum, episodeNum, true);
  });
}

global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}

/* No chain-retry postlude in this build - see the deadline note at the top. */
