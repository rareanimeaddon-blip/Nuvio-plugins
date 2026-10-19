// HDHub4U scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Source: HDHub4U provider — Typesense search + multi-host resolver chain
// (HubCloud/HubDrive/PixelDrain/HUBCDN/HdStream4u/StreamTape/FileMoon/StreamWish).
//
// NOTE: set TMDB_API_KEY below (free key from themoviedb.org) — used to turn
// the TMDB ID Nuvio passes in into a title for searching.

var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var FALLBACK_DOMAIN = "https://hdhub4u.glass";
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
var HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  Cookie: "xla=s4t",
};

var domainCache = null;

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

function getText(url, timeoutMs, extraHeaders) {
  var headers = Object.assign({}, HEADERS, extraHeaders || {});
  return fetchWithTimeout(url, { headers: headers }, timeoutMs || 15000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function getJson(url, timeoutMs, extraHeaders) {
  var headers = Object.assign({}, HEADERS, extraHeaders || {});
  return fetchWithTimeout(url, { headers: headers }, timeoutMs || 15000).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

// robust base64 decode (handles missing padding)
function b64decode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  var bin = atob(s);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64ToStr(s) {
  return new TextDecoder().decode(b64decode(s));
}

function rot13(str) {
  return String(str).replace(/[a-zA-Z]/g, function (ch) {
    var base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function hexToBytes(hex) {
  hex = String(hex).replace(/\s/g, "");
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function aesCbcDecryptHex(hexStr, keyStr, ivStr) {
  var keyBytes = new TextEncoder().encode(keyStr);
  var ivBytes = new TextEncoder().encode(ivStr);
  var dataBytes = hexToBytes(hexStr);
  return crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["decrypt"]).then(function (key) {
    return crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, dataBytes);
  }).then(function (buf) {
    return new TextDecoder().decode(buf);
  });
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/\s+details\s*$/i, "")
    .replace(/\b(720p|1080p|2160p|480p|4k|ds4k|hd|fhd|uhd|webrip|web-dl|webdl|bluray|blu-ray|hdtc|hdcam|hevc|x265|x264|avc|10bit|hdr10?|sdr|dv|dolby|atmos|dts|truehd|opus|dd[0-9.]+|aac|mp3|flac|ac3|hindi|english|dual|multi|audio|tamil|telugu|punjabi|malayalam|kannada|bengali|marathi|season\s*\d+|s\d{2}|e\d{2}|full\s*(?:movie|series)|all\s*episodes?|remux|dubbed|extended|theatrical|unrated|remastered|restored|imax|cam|ts|dvdrip|dvdscr|bdrip|brrip|hdrip|hdts|predvd|digital|hq|esubs|org|v\d+|nf|amzn|netflix|hotstar|jio|zee5|sony|primevideo|voot|proper|retail|final|web\s*series|bonus\s*episodes?|series)\b/gi, "")
    .replace(/[([–-]\s*(?:19[5-9]\d|20[0-2]\d)\s*[\])]?/g, " ")
    .replace(/\b(?:19[5-9]\d|20[0-2]\d)\b/g, "")
    .replace(/[|&/\\[\]()]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractYear(text) {
  var m = /\b(19[5-9]\d|20[0-2]\d)\b/.exec(String(text || ""));
  return m ? m[1] : undefined;
}

function extractQuality(text) {
  text = String(text || "");
  if (/2160p|4k/i.test(text)) return "2160p";
  if (/1080p/i.test(text)) return "1080p";
  if (/720p/i.test(text)) return "720p";
  if (/480p/i.test(text)) return "480p";
  return "HD";
}

function titleScore(a, b) {
  var na = cleanTitle(a).toLowerCase(), nb = cleanTitle(b).toLowerCase();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  var wa = na.split(/\s+/), wb = nb.split(/\s+/);
  var hit = 0;
  wa.forEach(function (w) { if (wb.indexOf(w) !== -1) hit++; });
  return (2 * hit) / (wa.length + wb.length);
}

// ---------- TMDB ----------

function tmdbTitle(tmdbId, mediaType) {
  if (!TMDB_API_KEY || TMDB_API_KEY === "<redacted>") return Promise.resolve(null);
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY,
    {}, 12000
  ).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j ? (j.title || j.name || null) : null; })
    .catch(function () { return null; });
}

function tmdbImdb(tmdbId, mediaType) {
  if (!TMDB_API_KEY || TMDB_API_KEY === "<redacted>") return Promise.resolve(null);
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY,
    {}, 12000
  ).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j && j.imdb_id ? j.imdb_id : null; })
    .catch(function () { return null; });
}

// ---------- domain ----------

function getActiveDomain() {
  if (domainCache) return Promise.resolve(domainCache);
  return getJson(DOMAINS_URL, 8000).then(function (d) {
    var domain = d && d.HDHUB4u ? String(d.HDHUB4u).trim() : "";
    domainCache = (domain && domain.indexOf("http") === 0) ? domain : FALLBACK_DOMAIN;
    return domainCache;
  }).catch(function () {
    domainCache = FALLBACK_DOMAIN;
    return domainCache;
  });
}

function rebaseUrl(url, activeDomain) {
  var base = activeDomain.replace(/\/+$/, "");
  if (url.indexOf("http") !== 0) return base + "/" + url.replace(/^\/+/, "");
  try {
    var u = new URL(url);
    if (/hdhub4u/i.test(u.hostname)) return base + u.pathname + u.search + u.hash;
  } catch (e) {}
  return url;
}

// ---------- search ----------
// Primary: Typesense JSON API. Fallback: HTML search page (regex-parsed).

function searchSiteHtml(query, activeDomain) {
  var url = activeDomain.replace(/\/+$/, "") + "/?s=" + encodeURIComponent(query);
  return getText(url, 15000).then(function (html) {
    if (!html) return [];
    var items = [], seen = {};
    // <li class="thumb ..."><figure><a href="/slug/" aria-label="Title"...>
    var re = /<li[^>]*class="[^"]*thumb[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*?(?:aria-label="([^"]+)"|title="([^"]+)")/gi, m;
    while ((m = re.exec(html)) !== null) {
      var href = m[1], rawTitle = (m[2] || m[3] || "").replace(/&#0?38;/g, "&");
      if (!href || href === "#" || seen[href]) continue;
      if (/^\/category\/|^\/page\//i.test(href)) continue;
      seen[href] = 1;
      var fullUrl = href.indexOf("http") === 0 ? href : activeDomain.replace(/\/+$/, "") + href;
      var slug = fullUrl.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
      if (!slug) continue;
      items.push({ slug: slug, title: cleanTitle(rawTitle), year: extractYear(rawTitle + " " + slug), url: fullUrl });
      if (items.length >= 20) break;
    }
    return items;
  }).catch(function () { return []; });
}

function searchSite(query) {
  return getActiveDomain().then(function (activeDomain) {
    var apiUrl =
      "https://search.pingora.fyi/collections/post/documents/search" +
      "?q=" + encodeURIComponent(query) +
      "&query_by=post_title,category&query_by_weights=4,2" +
      "&sort_by=sort_by_date:desc&limit=20&highlight_fields=none&use_cache=true&page=1";
    return getJson(apiUrl, 10000, { Referer: FALLBACK_DOMAIN }).then(function (data) {
      var items = [];
      var hits = (data && data.hits) || [];
      hits.forEach(function (hit) {
        var doc = hit.document || {};
        if (!doc.permalink || !doc.post_title) return;
        var fullUrl = rebaseUrl(doc.permalink, activeDomain);
        var slug = fullUrl.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
        items.push({
          slug: slug,
          title: cleanTitle(doc.post_title),
          year: extractYear(doc.post_title),
          url: fullUrl,
        });
      });
      if (items.length > 0) return items;
      return searchSiteHtml(query, activeDomain);
    }).catch(function () { return searchSiteHtml(query, activeDomain); });
  });
}

// ---------- redirect link decode (s('o','...') obfuscation) ----------

function decodeRedirectPayload(combined) {
  try {
    var step1 = b64ToStr(combined);
    var step2 = b64ToStr(step1);
    var step3 = rot13(step2);
    var jsonStr = b64ToStr(step3);
    var json = JSON.parse(jsonStr);
    if (json.o) {
      var u = b64ToStr(json.o).trim();
      if (u.indexOf("http") === 0) return u;
    }
    return null;
  } catch (e) { return null; }
}

function getRedirectLinks(pageHtml) {
  var regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
  var combined = "", m;
  while ((m = regex.exec(pageHtml)) !== null) { combined += (m[1] || m[2] || ""); }
  if (!combined) return Promise.resolve(null);
  return Promise.resolve(decodeRedirectPayload(combined));
}

// ---------- host resolvers ----------

function detectHost(url) {
  var u = String(url).toLowerCase();
  if (u.indexOf("pixeldrain.com") !== -1 || u.indexOf("pixeldrain.dev") !== -1) return "PixelDrain";
  if (u.indexOf("streamtape.") !== -1) return "StreamTape";
  if (u.indexOf("hubcloud.") !== -1) return "HubCloud";
  if (u.indexOf("hubdrive.") !== -1) return "HubDrive";
  if (u.indexOf("hblinks.") !== -1 || u.indexOf("hubstreamdad.") !== -1) return "Hblinks";
  if (u.indexOf("hdstream4u.") !== -1 || u.indexOf("hubstream.") !== -1) return "HdStream4u";
  if (u.indexOf("hubcdn.") !== -1) return "HUBCDN";
  if (u.indexOf("filemoon.") !== -1) return "FileMoon";
  if (u.indexOf("streamwish.") !== -1 || u.indexOf("wishfast.") !== -1) return "StreamWish";
  if (u.indexOf("doodstream") !== -1 || /dood\./.test(u)) return "DoodStream";
  return "Direct";
}

function isArchiveFile(url) {
  return /\.(zip|rar|7z)(?:["'?]|$)/i.test(String(url).split("?")[0]);
}

function resolvePixelDrain(url) {
  var m = /\/file\/([a-zA-Z0-9]+)/.exec(url);
  if (!m) return Promise.resolve(null);
  var fileId = m[1];
  return getJson("https://pixeldrain.com/api/file/" + fileId + "/info", 7000).then(function (info) {
    if (info && info.success === true) return "https://pixeldrain.com/api/file/" + fileId + "?download";
    return null;
  }).catch(function () { return null; });
}

// extract all <a class="btn" href> links from html (regex, no cheerio)
function extractBtnLinks(html) {
  var out = [];
  var re = /<a[^>]*class="[^"]*btn[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    out.push({ href: m[1], label: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase() });
  }
  return out;
}

function resolveHubCloud(url) {
  var base = "";
  try { var u = new URL(url); base = u.protocol + "//" + u.host; } catch (e) {}
  function fetchPage(pageUrl) {
    return getText(pageUrl, 15000).catch(function () { return null; });
  }
  return fetchPage(url).then(function (html) {
    if (!html) return null;
    // #download element with x-href (base64) or href
    var dl = /<[^>]*id="download"[^>]*>/i.exec(html);
    var pageUrl = url;
    if (dl) {
      var tag = dl[0];
      var href = /href="([^"]+)"/i.exec(tag);
      var xhref = /x-href="([^"]+)"/i.exec(tag);
      var raw = href ? href[1] : (xhref ? b64ToStr(xhref[1]) : "");
      if (raw) pageUrl = raw.indexOf("http") === 0 ? raw : base + "/" + raw.replace(/^\//, "");
    }
    if (pageUrl !== url) return fetchPage(pageUrl);
    return html;
  }).then(function (html) {
    if (!html) return null;
    var buttons = extractBtnLinks(html);
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.href.indexOf("http") !== 0 && b.href.indexOf("//") !== 0) continue;
      var full = b.href.indexOf("//") === 0 ? "https:" + b.href : b.href;
      if (/fsl server|fslv2|s3 server|mega server|download file/.test(b.label)) return full;
      if (/pixeldra|pixel server|pixelserver/.test(b.label)) {
        return resolvePixelDrain(full).then(function (pd) { return pd || full; });
      }
    }
    for (var j = 0; j < buttons.length; j++) {
      if (buttons[j].href.indexOf("http") === 0) return buttons[j].href;
    }
    return null;
  });
}

function resolveHubDrive(url) {
  return getText(url, 15000).then(function (html) {
    if (!html) return null;
    // primary hubcloud button
    var m = /class="[^"]*btn-primary[^"]*btn-success1[^"]*"[^>]*href="([^"]+)"/i.exec(html) ||
            /href="([^"]+)"[^>]*class="[^"]*btn-primary[^"]*btn-success1/i.exec(html);
    var href = m ? m[1] : null;
    if (!href) {
      var re = /href="(https?:\/\/[^"]*hubcloud[^"]*)"/gi, mm;
      while ((mm = re.exec(html)) !== null) { href = mm[1]; break; }
    }
    if (href && href.indexOf("http") === 0) {
      if (/hubcloud/i.test(href)) return resolveHubCloud(href);
      return resolveLink(href, "HD").then(function (r) { return r ? r.url : null; });
    }
    return null;
  }).catch(function () { return null; });
}

function resolveHblinks(url) {
  return getText(url, 15000).then(function (html) {
    if (!html) return null;
    // collect hub* links: prefer <h3>/<h5> anchors, fall back to any anchor
    var links = [];
    var re = /<h[35][^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/gi, m;
    while ((m = re.exec(html)) !== null) links.push(m[1]);
    if (!links.length) {
      var re2 = /<a[^>]*href="(https?:\/\/(?:hubcloud|hubdrive|hubcdn)[^"]+)"[^>]*>/gi;
      while ((m = re2.exec(html)) !== null) links.push(m[1]);
    }
    var chain = Promise.resolve(null);
    links.forEach(function (href) {
      chain = chain.then(function (done) {
        if (done) return done;
        var low = href.toLowerCase();
        if (low.indexOf("hubdrive") !== -1) return resolveHubDrive(href);
        if (low.indexOf("hubcloud") !== -1) return resolveHubCloud(href);
        if (low.indexOf("hubcdn") !== -1) return resolveHUBCDN(href);
        return resolveLink(href, "HD").then(function (r) { return r ? r.url : null; });
      });
    });
    return chain;
  }).catch(function () { return null; });
}

function resolveHUBCDN(url) {
  return getText(url, 15000).then(function (html) {
    if (!html) return null;
    var m = /reurl\s*=\s*"([^"]+)"/.exec(html);
    if (!m) return null;
    var encoded = m[1].split("?r=")[1];
    if (!encoded) return null;
    var decoded = b64ToStr(encoded);
    var link = decoded.indexOf("link=") !== -1 ? decoded.split("link=").pop().trim() : decoded.trim();
    return link.indexOf("http") === 0 ? link : null;
  }).catch(function () { return null; });
}

function resolveHdStream4u(url) {
  var base = "";
  try { var u = new URL(url); base = u.protocol + "//" + u.host; } catch (e) { return Promise.resolve(null); }
  var hash = url.split("#").pop().split("/").pop() || "";
  if (!hash) return Promise.resolve(null);
  return getText(base + "/api/v1/video?id=" + encodeURIComponent(hash), 10000, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  }).then(function (encoded) {
    encoded = (encoded || "").trim();
    if (!encoded) return null;
    var KEY = "kiemtienmua911ca";
    var IVS = ["1234567890oiuytr", "0123456789abcdef"];
    var chain = Promise.resolve(null);
    IVS.forEach(function (iv) {
      chain = chain.then(function (done) {
        if (done) return done;
        return aesCbcDecryptHex(encoded, KEY, iv).catch(function () { return null; });
      });
    });
    return chain;
  }).then(function (decrypted) {
    if (!decrypted) return null;
    var m = /"source"\s*:\s*"([^"]+)"/.exec(decrypted);
    if (m) return m[1].replace(/\\\//g, "/").replace(/^https/, "http");
    return null;
  }).catch(function () { return null; });
}

function resolveGenericPlayer(url) {
  return getText(url, 15000, { Referer: url }).then(function (html) {
    if (!html) return null;
    var patterns = [
      /file\s*:\s*['"]([^'"]+\.(?:mp4|mkv|m3u8)[^'"]*)['"]/i,
      /"sources"\s*:\s*\[.*?"file"\s*:\s*"([^"]+)"/s,
      /<source[^>]+src=['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(html);
      if (m && m[1] && m[1].indexOf("http") === 0) return m[1];
    }
    return null;
  }).catch(function () { return null; });
}

function resolveLink(url, qualityHint) {
  if (!url || url.indexOf("http") !== 0) return Promise.resolve(null);
  var host = detectHost(url);
  var p;
  switch (host) {
    case "PixelDrain": p = resolvePixelDrain(url); break;
    case "HubCloud": p = resolveHubCloud(url); break;
    case "HubDrive": p = resolveHubDrive(url); break;
    case "Hblinks": p = resolveHblinks(url); break;
    case "HdStream4u": p = resolveHdStream4u(url); break;
    case "HUBCDN": p = resolveHUBCDN(url); break;
    case "StreamTape":
    case "FileMoon":
    case "StreamWish":
    case "DoodStream": p = resolveGenericPlayer(url); break;
    case "Direct":
      p = Promise.resolve(/\.(mp4|mkv|avi|m3u8)/i.test(url) ? url : null);
      break;
    default: p = Promise.resolve(url);
  }
  return p.then(function (resolved) {
    if (!resolved) return null;
    return { url: resolved, quality: qualityHint || "HD", host: host };
  });
}

// ---------- extract streams from a content page ----------

var ALLOWED_DOMAINS_RE = /https?:\/\/(?:.*\.)?(hubcloud|hubdrive|hubstream|hdstream4u|hblinks|pixeldrain|pixeldrain\.dev|streamtape|filemoon|streamwish|wishfast|doodstream|dood\.|upstream|mixdrop|1fichier|mp4upload|gofile)\./i;

function extractAnchors(html, qualityFilter) {
  // returns [{url, text}] for <a href> anchors
  var out = [];
  var re = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (qualityFilter && !/480|720|1080|2160|4K/i.test(text)) continue;
    out.push({ url: m[1], text: text });
  }
  return out;
}

function extractStreams(pageUrl, season, episode, expectedImdbId) {
  return getText(pageUrl, 20000).then(function (html) {
    if (!html) return [];
    if (expectedImdbId) {
      var im = /imdb\.com\/title\/(tt\d{7,8})/i.exec(html);
      if (im && im[1] !== expectedImdbId) return [];
    }
    var isSeries = season != null && episode != null;
    var rawLinks = [];
    var seen = {};

    function push(url, ctx) {
      if (!url || url.indexOf("http") !== 0 || seen[url]) return;
      seen[url] = 1;
      rawLinks.push({ url: url, context: ctx || "" });
    }

    if (!isSeries) {
      // h3/h4 links with quality text
      var re = /<h[34][^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
      while ((m = re.exec(html)) !== null) {
        if (/480|720|1080|2160|4K/i.test(m[2])) push(m[1], m[2].replace(/<[^>]+>/g, " "));
      }
      if (rawLinks.length === 0) {
        extractAnchors(html, false).forEach(function (a) {
          if (ALLOWED_DOMAINS_RE.test(a.url)) push(a.url, a.text);
        });
      }
    } else {
      // series: find h3/h4 blocks mentioning Episode N
      var epMap = {};
      var hre = /<h[34][^>]*>([\s\S]*?)<\/h[34]>/gi, hm;
      var blocks = [];
      while ((hm = hre.exec(html)) !== null) blocks.push(hm[1]);
      blocks.forEach(function (block) {
        var epM = /EPiSODE\s*(\d+)/i.exec(block.replace(/<[^>]+>/g, " "));
        if (!epM) return;
        var epNum = parseInt(epM[1], 10);
        var are = /href="(https?:\/\/[^"]+)"/gi, am;
        while ((am = are.exec(block)) !== null) {
          (epMap[epNum] = epMap[epNum] || []).push(am[1]);
        }
      });
      var epLinks = epMap[episode] || [];
      if (epLinks.length === 0) {
        extractAnchors(html, false).forEach(function (a) {
          if (ALLOWED_DOMAINS_RE.test(a.url)) push(a.url, a.text);
        });
      } else {
        epLinks.forEach(function (u) { push(u, ""); });
      }
    }

    if (rawLinks.length === 0) return [];

    var jobs = rawLinks.slice(0, 10).map(function (link) {
      var finalUrl = link.url;
      var p = Promise.resolve(finalUrl);
      if (finalUrl.indexOf("?id=") !== -1) {
        p = getText(finalUrl, 15000).then(getRedirectLinks).then(function (d) { return d || finalUrl; }).catch(function () { return finalUrl; });
      }
      return p.then(function (fu) {
        var ctx = link.context + " " + pageUrl;
        var q = extractQuality(ctx);
        var sizeM = /[\[(]?(\d+\.?\d*\s*(?:GB|MB))[\])]?/i.exec(link.context);
        return resolveLink(fu, q).then(function (r) {
          if (!r || isArchiveFile(r.url)) return null;
          return {
            url: r.url,
            quality: r.quality,
            label: r.quality + " [" + r.host + "]",
            size: sizeM ? sizeM[1].replace(/\s+/, " ") : undefined,
          };
        });
      }).catch(function () { return null; });
    });
    return Promise.all(jobs).then(function (results) {
      return results.filter(function (r) { return !!r; });
    });
  }).catch(function () { return []; });
}

// ---------- main ----------

function pickBest(items, title, year) {
  var best = null, bestScore = -1;
  items.forEach(function (it) {
    var s = titleScore(it.title, title);
    if (year && it.year && year !== it.year) s -= 0.3;
    if (s > bestScore) { bestScore = s; best = it; }
  });
  return bestScore >= 0.4 ? best : null;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return Promise.all([tmdbTitle(tmdbId, mediaType), tmdbImdb(tmdbId, mediaType)]).then(function (vals) {
    var title = vals[0];
    if (!title) return [];
    var imdbId = vals[1];
    return searchSite(title).then(function (items) {
      if (!items.length) return [];
      var best = pickBest(items, title);
      if (!best) return [];
      return extractStreams(best.url, seasonNum, episodeNum, imdbId).then(function (streams) {
        return streams.map(function (s) {
          return {
            name: "HDHub4U",
            title: s.label + (s.size ? " " + s.size : "") + " | " + title,
            url: s.url,
            quality: /^\d+p$/.test(s.quality) ? s.quality : "Unknown",
            type: "direct",
          };
        });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.HDHub4UScraperModule = { getStreams: getStreams };
}
