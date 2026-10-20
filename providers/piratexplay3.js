// PirateXPlay scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: PirateXPlay provider — TMDB-slug site with multi-mirror embeds.
// Resolves: AWSStream (as-cdn), generic players, AbyssPlayer, Byse/Filemoon,
// GDMirrorbot mirrors.
//
// NOTE: set TMDB_API_KEY below (free key from themoviedb.org) — used to turn
// the TMDB ID Nuvio passes in into a title for searching.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var BASE_URL = "https://piratexplay.cc";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};
var RESOLVE_TIMEOUT = 12000;

// ---------- helpers ----------

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  var opts = Object.assign({}, options, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function fetchHtml(url, referer, timeoutMs) {
  var headers = Object.assign({}, HEADERS, { Referer: referer || BASE_URL + "/" });
  return fetchWithTimeout(url, { headers: headers }, timeoutMs || 20000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function b64decode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  var bin = atob(s);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function absoluteUrl(href, base) {
  base = base || BASE_URL;
  if (!href) return "";
  if (href.indexOf("http") === 0) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  return base + (href.charAt(0) === "/" ? href : "/" + href);
}

function normTitle(t) {
  return String(t || "").toLowerCase().replace(/[:\-–—]/g, " ").replace(/[^\w\s]/g, "").replace(/\b(the|a|an)\b/g, "").replace(/\s+/g, " ").trim();
}

function titleScore(a, b) {
  var na = normTitle(a), nb = normTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  var wa = na.split(" "), wb = nb.split(" ");
  var hit = 0;
  wa.forEach(function (w) { if (wb.indexOf(w) !== -1) hit++; });
  return (2 * hit) / (wa.length + wb.length);
}

// Exact-title gate (zero-mismatch): every distinctive word of the TMDB title
// must appear as a whole word in the candidate, and the word sets must be
// near-identical (dice >= 0.8) once release/season noise words are dropped.
var TITLE_NOISE = { the: 1, a: 1, an: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, multi: 1, audio: 1, complete: 1,
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
  normTitle(foldAccents(String(t).toLowerCase())).split(" ").forEach(function (w) {
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
  var contained = true;
  for (var i = 0; i < q.length; i++) if (c.indexOf(q[i]) === -1) { contained = false; break; }
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

function buildSearchQueries(title) {
  var queries = [title];
  var words = title.split(/\s+/);
  if (words.length > 1) {
    queries.push(words.slice(1).join(" "));
    if (words.length > 2) queries.push(words.slice(0, 2).join(" "));
  }
  var ci = title.indexOf(":");
  if (ci > 2) queries.push(title.slice(0, ci).trim());
  var nh = title.replace(/-/g, "");
  if (nh !== title) queries.push(nh);
  var seen = {}, out = [];
  queries.forEach(function (q) { if (q.length > 1 && !seen[q]) { seen[q] = 1; out.push(q); } });
  return out;
}

// ---------- search (JSON API) ----------

function searchAnime(query) {
  var url = BASE_URL + "/api/search-ajax.php?keyword=" + encodeURIComponent(query);
  return fetchWithTimeout(url, { headers: HEADERS }, 15000).then(function (res) {
    if (!res.ok) return [];
    return res.json();
  }).then(function (data) {
    if (!data || data.status !== "success" || !Array.isArray(data.data)) return [];
    return data.data.map(function (item) {
      var tmdb = item.tmdb || {};
      var type = tmdb.type === "movies" ? "movies" : "series";
      var slug = tmdb.url || "";
      return {
        type: type, slug: slug, title: tmdb.title || "",
        detailUrl: BASE_URL + "/" + type + "/" + slug,
      };
    }).filter(function (c) { return c.slug && c.title; });
  }).catch(function () { return []; });
}

// ---------- embed resolvers ----------

function extractGenericPlayer(url, referer) {
  return fetchHtml(url, referer, 15000).then(function (html) {
    var patterns = [
      /file\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/,
      /source\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/,
      /"file"\s*:\s*"([^"]+\.m3u8[^"]*?)"/,
      /src\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/,
      /var\s+urlPlay\s*=\s*["']([^"']+\.m3u8[^"']*?)["']/,
      /<source[^>]+src=["']([^"']+\.m3u8[^"']*?)["']/,
      /"(https?:\/\/[^"]+\.m3u8(?:[?#][^"]*)?)"/,
      /file\s*:\s*["']([^"']+\.mp4[^"']*?)["']/,
      /"file"\s*:\s*"([^"]+\.mp4[^"]*?)"/,
      /"(https?:\/\/[^"]+\.mp4(?:[?#][^"]*)?)"/,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(html);
      if (m && m[1] && m[1].indexOf("undefined") === -1) return m[1];
    }
    return null;
  }).catch(function () { return null; });
}

function extractAWSStream(url, referer) {
  try {
    var base = new URL(url).origin;
    var hash = new URL(url).searchParams.get("data") || url.split("/").filter(Boolean).pop() || "";
    if (!hash) return Promise.resolve(null);
    var apiUrl = base + "/player/index.php?data=" + hash + "&do=getVideo";
    return fetchWithTimeout(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": HEADERS["User-Agent"],
        Referer: referer, Origin: base,
      },
      body: "hash=" + encodeURIComponent(hash) + "&r=" + encodeURIComponent(referer),
    }, 15000).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      return (data && data.videoSource) || null;
    }).catch(function () { return null; });
  } catch (e) { return Promise.resolve(null); }
}

function isAbyssPlayerUrl(url) {
  return /(?:^|\/\/)(?:www\.)?abyssplayer\.com\//i.test(url);
}

function extractAbyssPlayerSources(url) {
  var headers = {
    "User-Agent": HEADERS["User-Agent"],
    Origin: "https://playhydrax.com",
    Referer: "https://playhydrax.com/",
  };
  return fetchWithTimeout(url, { headers: headers }, 15000).then(function (res) {
    if (!res.ok) return [];
    return res.text();
  }).then(function (html) {
    var m = /const\s+datas\s*=\s*"([^"]*)"/.exec(html);
    if (!m || !m[1]) return [];
    return fetchWithTimeout("https://enc-dec.app/api/dec-abyss", {
      method: "POST",
      headers: Object.assign({}, headers, { "Content-Type": "application/json" }),
      body: JSON.stringify({ text: m[1] }),
    }, 15000).then(function (res) {
      if (!res.ok) return [];
      return res.json();
    }).then(function (decoded) {
      var sources = (decoded && decoded.result && decoded.result.sources) || [];
      return sources.filter(function (s) { return s.status !== false && s.url; })
        .map(function (s, i) {
          var label = (s.type || ("Stream " + (i + 1))).trim();
          if (s.codec) label += " · " + String(s.codec).toUpperCase();
          return { label: label, videoUrl: s.url };
        });
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}

function aesGcmDecrypt(parts, ivB64, payloadB64, version) {
  try {
    var n = parseInt(version, 10);
    var selected = [];
    if (n >= 1 && n <= 20) {
      [n, 31 - n].forEach(function (idx) {
        if (idx >= 1 && idx <= parts.length && parts[idx - 1]) selected.push(parts[idx - 1]);
      });
    } else {
      selected = parts.filter(Boolean);
    }
    if (!selected.length) return Promise.resolve(null);
    var keyBytes = selected.map(b64decode);
    var total = keyBytes.reduce(function (a, b) { return a + b.length; }, 0);
    var keyBuf = new Uint8Array(total), off = 0;
    keyBytes.forEach(function (b) { keyBuf.set(b, off); off += b.length; });
    var iv = b64decode(ivB64);
    var cipherWithTag = b64decode(payloadB64);
    return crypto.subtle.importKey("raw", keyBuf, "AES-GCM", false, ["decrypt"]).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, cipherWithTag);
    }).then(function (buf) {
      var obj = JSON.parse(new TextDecoder().decode(buf));
      return (obj.sources && obj.sources[0] && obj.sources[0].url) || null;
    }).catch(function () { return null; });
  } catch (e) { return Promise.resolve(null); }
}

function extractBysePlayer(url, referer) {
  var hm = /\/e\/([a-zA-Z0-9]+)\/?/.exec(url);
  if (!hm) return Promise.resolve(null);
  var base = "";
  try { base = new URL(url).origin; } catch (e) { return Promise.resolve(null); }
  var apiUrl = base + "/api/videos/" + encodeURIComponent(hm[1]) + "/";
  return fetchWithTimeout(apiUrl, {
    headers: { "User-Agent": HEADERS["User-Agent"], Referer: referer, Origin: base },
  }, 15000).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (data) {
    if (!data || !data.playback) return null;
    var pb = data.playback;
    return aesGcmDecrypt(pb.key_parts || [], pb.iv, pb.payload, pb.version);
  }).catch(function () { return null; });
}

function extractGDMirrorbot(url, referer) {
  var base = "", sid = "";
  try {
    base = new URL(url).origin;
    sid = url.split("/").filter(Boolean).pop().split("?")[0] || "";
  } catch (e) { return Promise.resolve(null); }
  if (!sid) return Promise.resolve(null);
  return fetchWithTimeout(base + "/embedhelper.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": HEADERS["User-Agent"],
      Referer: url, Origin: base,
    },
    body: "sid=" + encodeURIComponent(sid),
  }, 15000).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (data) {
    if (!data) return null;
    var siteUrls = data.siteUrls || {};
    var mresult = {};
    if (typeof data.mresult === "string") {
      try { mresult = JSON.parse(new TextDecoder().decode(b64decode(data.mresult))); } catch (e) {}
    } else if (data.mresult && typeof data.mresult === "object") {
      mresult = data.mresult;
    }
    var keys = Object.keys(siteUrls).filter(function (k) { return mresult[k]; });
    var chain = Promise.resolve(null);
    keys.forEach(function (key) {
      chain = chain.then(function (done) {
        if (done) return done;
        var b = (siteUrls[key] || "").replace(/\/$/, "");
        var p = (mresult[key] || "").replace(/^\//, "");
        if (!b || !p) return null;
        var mirrorUrl = b.charAt(b.length - 1) === "#" ? b + p : b + "/" + p;
        return resolveEmbedUrl(mirrorUrl, url).catch(function () { return null; });
      });
    });
    return chain;
  }).catch(function () { return null; });
}

function isByseHost(url) {
  return /bysezejataos\.com|bysetayico\.com|moonembd\.online|moonfeel\.online|moonfast\.online|filemoon\.(sx|to|in)/.test(url);
}
function isAWSHost(url) {
  return /awstream\.net|as-cdn\d+\.top|awstream/.test(url);
}
function isGDMirrorHost(url) {
  return /gdmirrorbot|techinmind|iqsmartgames\.com/.test(url);
}

function resolveEmbedUrl(embedUrl, referer) {
  if (embedUrl.indexOf("piratexplay.cc") !== -1) {
    try {
      var u = new URL(embedUrl);
      var inner = u.searchParams.get("url");
      if (inner) return resolveEmbedUrl(inner.indexOf("//") === 0 ? "https:" + inner : inner, embedUrl);
    } catch (e) {}
    return extractGenericPlayer(embedUrl, referer);
  }
  if (isAbyssPlayerUrl(embedUrl)) {
    return extractAbyssPlayerSources(embedUrl).then(function (ss) {
      return ss.length ? ss[0].videoUrl : null;
    });
  }
  if (isByseHost(embedUrl)) return extractBysePlayer(embedUrl, referer);
  if (isAWSHost(embedUrl)) return extractAWSStream(embedUrl, referer);
  if (isGDMirrorHost(embedUrl)) return extractGDMirrorbot(embedUrl, referer);
  return extractGenericPlayer(embedUrl, referer);
}

// ---------- page parsing (regex, no cheerio) ----------

function parseServerButtons(html) {
  var names = [];
  var re = /<button[^>]*class="[^"]*server-btn[^"]*"[^>]*data-server="(\d+)"[^>]*>([\s\S]*?)<\/button>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var idx = parseInt(m[1], 10);
    var label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || ("Server " + (idx + 1));
    names[isNaN(idx) ? names.length : idx] = label;
  }
  return names;
}

function parseIframes(html) {
  var urls = [];
  var re = /<div[^>]*id="options-(\d+)"[^>]*>[\s\S]*?<iframe[^>]*(?:src|data-src)="([^"]+)"[^>]*>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var idx = parseInt(m[1], 10), src = m[2];
    if (!src || src === "about:blank") continue;
    urls[isNaN(idx) ? urls.length : idx] = absoluteUrl(src);
  }
  if (!urls.length) {
    var re2 = /<iframe[^>]*(?:src|data-src)="([^"]+)"[^>]*>/gi;
    while ((m = re2.exec(html)) !== null) {
      if (m[1] && m[1] !== "about:blank") urls.push(absoluteUrl(m[1]));
    }
  }
  return urls.filter(Boolean);
}

function isPiratexplayOwnPlayer(url) {
  return url.indexOf("piratexplay.cc") !== -1 && url.indexOf("/player/") !== -1;
}

var ALLOWED_MODAL = { fm: 1, gdmirr: 1, hyd: 1, abyss: 1, abyssplayer: 1 };

function extractModalSources(url, referer) {
  return fetchHtml(url, referer, 20000).then(function (html) {
    var candidates = [];
    // <div class="server-option ..." data-link="..." data-language="...">
    // (attributes may span multiple lines)
    var re = /class="server-option[^"]*"[\s\S]*?data-link="([^"]+)"[\s\S]*?data-language="([^"]+)"/gi, m;
    var re2 = /data-language="([^"]+)"[\s\S]{0,200}?data-link="([^"]+)"/gi;
    var seen = {};
    while ((m = re.exec(html)) !== null) {
      var link = m[1], label = m[2].trim().toLowerCase();
      if (link && label && ALLOWED_MODAL[label] && !seen[link]) { seen[link] = 1; candidates.push({ label: label, link: link }); }
    }
    while ((m = re2.exec(html)) !== null) {
      var label2 = m[1].trim().toLowerCase(), link2 = m[2];
      if (link2 && label2 && ALLOWED_MODAL[label2] && !seen[link2]) { seen[link2] = 1; candidates.push({ label: label2, link: link2 }); }
    }
    var jobs = candidates.map(function (c) {
      var embedUrl = absoluteUrl(c.link, BASE_URL);
      var displayLabel = (c.label === "hyd" || c.label === "abyss" || c.label === "abyssplayer") ? "AbyssPlayer" : c.label.toUpperCase();
      if (isAbyssPlayerUrl(embedUrl)) {
        return withTimeout(extractAbyssPlayerSources(embedUrl), RESOLVE_TIMEOUT).then(function (ss) {
          return ss.map(function (s) {
            return { label: displayLabel + " · " + s.label, videoUrl: s.videoUrl };
          });
        });
      }
      return withTimeout(resolveEmbedUrl(embedUrl, url), RESOLVE_TIMEOUT).then(function (vu) {
        return vu ? [{ label: displayLabel, videoUrl: vu }] : [];
      });
    });
    return Promise.all(jobs).then(function (results) {
      var out = [];
      results.forEach(function (r) { out.push.apply(out, r); });
      return out;
    });
  }).catch(function () { return []; });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function (resolve) { setTimeout(function () { resolve(null); }, ms); }),
  ]);
}

function qualityFromUrl(url) {
  var m = /(\d{3,4})p/i.exec(url);
  return m ? m[1] + "p" : "Unknown";
}

// ---------- main fetch ----------

function fetchStreams(type, slug, season, episode) {
  var episodeUrl, seriesPageUrl;
  if (type === "movies" || season == null || episode == null) {
    episodeUrl = BASE_URL + "/" + type + "/" + slug;
    seriesPageUrl = episodeUrl;
  } else {
    episodeUrl = BASE_URL + "/episode/" + slug + "-" + season + "x" + episode + "/";
    seriesPageUrl = BASE_URL + "/series/" + slug + "/";
  }
  return fetchHtml(episodeUrl, seriesPageUrl, 20000).then(function (html) {
    var serverNames = parseServerButtons(html);
    var iframeUrls = parseIframes(html);
    if (!iframeUrls.length) return [];

    var embeds = [];
    for (var i = 0; i < iframeUrls.length; i++) {
      var eu = iframeUrls[i];
      if (!eu) continue;
      var sn = serverNames[i] || ("Server " + (i + 1));
      // animesalt multi-lang links: data= base64 JSON [{language, link}]
      if (/animesalt\.(link|ac|cx)/.test(eu)) {
        try {
          var u = new URL(eu);
          var data = u.searchParams.get("data");
          if (data) {
            var pairs = JSON.parse(new TextDecoder().decode(b64decode(data)));
            if (Array.isArray(pairs) && pairs.length) {
              pairs.forEach(function (p) {
                if (p.language && p.link) embeds.push({ serverName: sn + " [" + p.language + "]", embedUrl: p.link });
              });
              continue;
            }
          }
        } catch (e) {}
      }
      embeds.push({ serverName: sn, embedUrl: eu });
    }

    var allowed = /awstream\.net|as-cdn\d+\.top|awstream|piratexplay\.cc\/proxy\/|emturbovid\.com|bysezejataos\.com|bysetayico\.com|moonembd\.online|moonfeel\.online|moonfast\.online|iqsmartgames\.com|gdmirrorbot|techinmind|filemoon\.(sx|to|in)|abyssplayer\.com/i;
    var jobs = embeds.map(function (em) {
      if (isAbyssPlayerUrl(em.embedUrl)) {
        return withTimeout(extractAbyssPlayerSources(em.embedUrl), RESOLVE_TIMEOUT).then(function (ss) {
          return ss.map(function (s) {
            return { name: "PirateXPlay", title: em.serverName + " · AbyssPlayer · " + s.label, url: s.videoUrl, quality: qualityFromUrl(s.videoUrl), type: "direct" };
          });
        });
      }
      // piratexplay's own multi-mirror player: extract FM/Gdmirr/Abyss from modal
      if (isPiratexplayOwnPlayer(em.embedUrl)) {
        return withTimeout(extractModalSources(em.embedUrl, episodeUrl), RESOLVE_TIMEOUT).then(function (ss) {
          return ss.map(function (s) {
            return { name: "PirateXPlay", title: em.serverName + " · " + s.label, url: s.videoUrl, quality: qualityFromUrl(s.videoUrl), type: "direct" };
          });
        });
      }
      if (!allowed.test(em.embedUrl)) return Promise.resolve([]);
      return withTimeout(resolveEmbedUrl(em.embedUrl, episodeUrl), RESOLVE_TIMEOUT).then(function (videoUrl) {
        if (!videoUrl) return [];
        return [{ name: "PirateXPlay", title: em.serverName, url: videoUrl, quality: qualityFromUrl(videoUrl), type: "direct" }];
      });
    });
    return Promise.all(jobs).then(function (results) {
      var out = [];
      results.forEach(function (r) { out.push.apply(out, r); });
      return out;
    });
  }).catch(function () { return []; });
}

function fetchStreamsByTitle(title, stremioType, season, episode) {
  var pxpType = stremioType === "movie" ? "movies" : "series";
  var queries = buildSearchQueries(title);
  var chain = Promise.resolve(null);
  queries.forEach(function (q) {
    chain = chain.then(function (found) {
      if (found) return found;
      return searchAnime(q).then(function (cards) {
        if (!cards.length) return null;
        var typed = cards.filter(function (c) { return c.type === pxpType; });
        var pool = typed.length ? typed : cards;
        var best = null, bestScore = 0;
        pool.forEach(function (c) {
          if (!isExactTitle(title, c.title)) return; // zero-mismatch gate
          var s = titleScore(c.title, title);
          if (s > bestScore) { bestScore = s; best = c; }
        });
        return best;
      });
    });
  });
  return chain.then(function (best) {
    if (!best) return [];
    var targetSlug = best.slug;
    if (season != null) {
      var adjusted = best.slug.replace(/(-season-)\d+(-\d+)$/, "$1" + season + "$2");
      if (adjusted !== best.slug) targetSlug = adjusted;
    }
    return fetchStreams(best.type, targetSlug, season, episode);
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var stremioType = mediaType === "tv" ? "series" : "movie";
  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    return fetchStreamsByTitle(title, stremioType, seasonNum, episodeNum);
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.PirateXPlayScraperModule = { getStreams: getStreams };
}
