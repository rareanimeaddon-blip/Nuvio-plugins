// AnimeDekho scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
//
// Remade from phisher98's CloudStream AnimeDekhoProvider (v72) — ported its
// host extractors and /aaa/ endpoint resolvers.
//
// IMPORTANT — ad gate behavior: animedekho.tv gates its /wp-json/dgt/v1/watch
// endpoint behind an ad-shortlink wall ("gated": true). This scraper returns []
// while the gate is active, exactly like the source Stremio addon does. It does
// NOT complete shortlinks, mint tokens, or capture cookies — clearing the gate
// requires a human completing it in a browser. There is intentionally no gate
// bypass logic anywhere in this file.
//
// Flow: TMDB title -> site search -> series/movie page -> episode URL ->
// POST /wp-json/dgt/v1/watch -> embed sources -> /aaa/ resolver ->
// host extractors -> direct streams.

var BASE_URL = "https://animedekho.tv";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}

function getText(url, timeoutMs, extraHeaders) {
  var headers = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
  for (var k in (extraHeaders || {})) headers[k] = extraHeaders[k];
  return fetchWithTimeout(url, { headers: headers }, timeoutMs || 15000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
    return r.text();
  });
}

function getJson(url, timeoutMs, extraHeaders) {
  var headers = { "User-Agent": UA, Accept: "application/json" };
  for (var k in (extraHeaders || {})) headers[k] = extraHeaders[k];
  return fetchWithTimeout(url, { headers: headers }, timeoutMs || 12000).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
    return r.json();
  });
}

function postJson(url, body, timeoutMs, extraHeaders) {
  var headers = {
    "User-Agent": UA, Accept: "application/json",
    "Content-Type": "application/json", Origin: BASE_URL, Referer: BASE_URL + "/",
  };
  for (var k in (extraHeaders || {})) headers[k] = extraHeaders[k];
  return fetchWithTimeout(url, { method: "POST", headers: headers, body: JSON.stringify(body) }, timeoutMs || 12000)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
      return r.json();
    });
}

// ---- TMDB helpers ----
function tmdbTitle(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout(
    "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY,
    { headers: { Accept: "application/json" } }, 10000
  ).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j ? (j.title || j.name || null) : null; })
    .catch(function () { return null; });
}

// ---- HTML helpers (regex only, no cheerio) ----
function inlineScripts(html) {
  var out = [];
  var re = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(html)) !== null) { if (m[1] && m[1].trim()) out.push(m[1]); }
  return out;
}

function attrFromTag(html, id, attr) {
  var elRe = new RegExp('<[^>]*\\bid=["\']' + id + '["\'][^>]*>', "i");
  var elM = elRe.exec(html);
  if (!elM) return null;
  var tag = elM[0];
  var aRe = new RegExp('\\b' + attr + '=["\']([^"\']*)["\']', "i");
  var aM = aRe.exec(tag);
  return aM ? aM[1] : null;
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/^Watch\s+Online\s+/i, "")
    .split(/\s*[–|]\s*/)[0]
    .replace(/\s+(?:Movie\s+)?(?:in\s+)?(?:Hindi|Tamil|Telugu|English|Dual)\s+(?:Dubbed?|Sub(?:bed)?|Audio)(?:\s+Free)?.*$/i, "")
    .replace(/\s*\|\s*AnimeDekho.*$/i, "")
    .trim() || String(raw || "").trim();
}

function isContentUrl(href) {
  if (!href) return false;
  var u = href.charAt(0) === "/" ? BASE_URL + href : href;
  return u.indexOf("animedekho.tv/") !== -1 || u.indexOf("animedekho.app/") !== -1;
}

// ---- unpack / URL extraction ----
var MEDIA_URL_PATTERN = /https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4|mkv|webm)(?:[?][^\s"'<>\\]*)?/gi;

function unpackEval(script) {
  if (script.indexOf("eval(function(p,a,c,k,e") === -1) return null;
  try {
    var match = /eval\(function\(p,a,c,k,e[^)]*\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/.exec(script);
    if (!match) return null;
    var p = match[1], aNum = parseInt(match[2], 10), cNum = parseInt(match[3], 10);
    var keys = match[4].split("|");
    var body = p;
    for (var i = cNum - 1; i >= 0; i--) {
      (function (idx) {
        var word = idx.toString(aNum);
        var re = new RegExp("\\b" + word + "\\b", "g");
        body = body.replace(re, function () {
          var n = 0, e = word;
          for (var j = 0; j < e.length; j++) {
            var ch = e[j];
            var val = (ch >= "0" && ch <= "9") ? ch.charCodeAt(0) - 48
              : (ch >= "a" && ch <= "z") ? ch.charCodeAt(0) - 87
              : (ch >= "A" && ch <= "Z") ? ch.charCodeAt(0) - 29 : 0;
            n = n * aNum + val;
          }
          var key = keys[n];
          return (key && key.length > 0) ? key : word;
        });
      })(i);
    }
    return body;
  } catch (e) { return null; }
}

function extractUrlsFromScript(script) {
  var urls = [], seen = {}, m;
  MEDIA_URL_PATTERN.lastIndex = 0;
  while ((m = MEDIA_URL_PATTERN.exec(script)) !== null) {
    var url = m[0].replace(/\\+/g, "");
    if (!seen[url]) { seen[url] = 1; urls.push(url); }
  }
  MEDIA_URL_PATTERN.lastIndex = 0;
  return urls;
}

// ---- search ----
function searchSite(query) {
  var url = BASE_URL + "/search/" + encodeURIComponent(query);
  var attempt = function () { return getText(url, 25000); };
  return attempt().catch(function () { return attempt(); }).then(function (html) {
    var results = [];
    var cardRe = /<a[^>]*class=["'][^"']*dgt-card[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = cardRe.exec(html)) !== null) {
      var tag = m[0], inner = m[1];
      var hrefM = /href=["']([^"']+)["']/i.exec(tag);
      var href = hrefM ? hrefM[1] : null;
      if (!href || !isContentUrl(href)) continue;
      var titleM = /class=["']dgt-card__title["'][^>]*>([\s\S]*?)</i.exec(inner) ||
        /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(inner);
      var rawTitle = titleM ? titleM[1].replace(/<[^>]+>/g, "").trim() : "Unknown";
      var abs = href.charAt(0) === "/" ? BASE_URL + href : href;
      var isMovie = /\/movies?\//i.test(abs) || /movie-hindi/i.test(abs);
      results.push({ title: cleanTitle(rawTitle), url: abs, type: isMovie ? "movie" : "series" });
    }
    return results;
  }).catch(function () { return []; });
}

function pickResult(results, mediaType) {
  var want = mediaType === "tv" ? "series" : "movie";
  for (var i = 0; i < results.length; i++) {
    if (results[i].type === want) return results[i];
  }
  return results.length ? results[0] : null;
}

// ---- episodes (series) ----
function getSeriesId(pageUrl, html) {
  var bodyM = /<body[^>]*class=["']([^"']*)["']/i.exec(html);
  var bodyClass = bodyM ? bodyM[1] : "";
  var m = /(?:term|postid)-(\d+)/.exec(bodyClass);
  if (m) return m[1];
  var slug = pageUrl.replace(/\/$/, "").split("/").pop() || "";
  if (!slug) return Promise.resolve(null);
  var tryType = function (wpType) {
    return fetchWithTimeout(
      BASE_URL + "/wp-json/wp/v2/" + wpType + "?slug=" + encodeURIComponent(slug) + "&_fields=id",
      { headers: { "User-Agent": UA, Accept: "application/json" } }, 8000
    ).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return (Array.isArray(d) && d[0] && d[0].id) ? String(d[0].id) : null; })
      .catch(function () { return null; });
  };
  return tryType("posts").then(function (id) { return id || tryType("pages"); });
}

function getEpisodes(seriesId, season) {
  var url = BASE_URL + "/wp-json/dgt/v1/episodes?series=" + encodeURIComponent(seriesId) +
    "&season=" + encodeURIComponent(String(season));
  return fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: BASE_URL + "/" } }, 12000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (payload) {
      var out = [];
      var list = (payload && payload.episodes) || [];
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var epUrl = item.url ? new URL(item.url, BASE_URL).toString() : "";
        var epNum = Number(item.episode);
        if (!epUrl || !isContentUrl(epUrl) || !isFinite(epNum)) continue;
        out.push({ url: epUrl, season: Number(item.season) || season, episode: epNum });
      }
      return out;
    }).catch(function () { return []; });
}

// ---- watch sources (THE GATE LIVES HERE) ----
function getWatchSources(episodeUrl) {
  return getText(episodeUrl, 10000).then(function (html) {
    var postId = Number(attrFromTag(html, "dgt-watch", "data-title"));
    var episodeId = Number(attrFromTag(html, "dgt-watch", "data-term"));
    if (!(postId > 0) || !(episodeId > 0)) return [];
    return postJson(
      BASE_URL + "/wp-json/dgt/v1/watch",
      { post_id: postId, episode_id: episodeId },
      12000,
      { Referer: episodeUrl }
    ).then(function (payload) {
      // *** AD GATE: the site returns {gated: true} until a human completes
      // the ad shortlink in a browser. Return [] — never bypass. ***
      if (payload && payload.gated) return [];
      var sources = [];
      var list = (payload && payload.sources) || [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (s.kind !== "embed" || s.show_embed === false || !s.server || !s.embed) continue;
        var embed = new URL(s.embed, BASE_URL).toString();
        if (!isContentUrl(embed)) continue;
        sources.push({ server: s.server, embed: embed, quality: s.quality });
      }
      return sources;
    });
  }).catch(function () { return []; });
}

// ---- /aaa/ endpoint resolvers (from CloudStream plugin) ----
// The site's own /aaa/ endpoints resolve encrypted embed URLs to direct links.
function resolveAaaPlay(encUrl, referer) {
  // GET /aaa/get/play.php?url={enc}&fetch=1 -> {instant_dl, cloud_r2, direct_mgt}
  var apiUrl = BASE_URL + "/aaa/get/play.php?url=" + encodeURIComponent(encUrl) + "&fetch=1";
  return getJson(apiUrl, 12000, { Referer: referer || BASE_URL + "/" }).then(function (j) {
    var out = [];
    if (!j) return out;
    var push = function (u, label) {
      if (u && typeof u === "string" && /^https?:\/\//i.test(u)) {
        out.push(nuvioStream("AnimeDekho | " + label, u));
      }
    };
    push(j.instant_dl, "InstantDL");
    push(j.cloud_r2, "CloudR2");
    push(j.direct_mgt, "DirectMGT");
    // also check nested data
    if (j.data) {
      push(j.data.instant_dl, "InstantDL");
      push(j.data.cloud_r2, "CloudR2");
      push(j.data.direct_mgt, "DirectMGT");
      push(j.data.url, "AAA");
      push(j.data.link, "AAA");
    }
    return out;
  }).catch(function () { return []; });
}

function resolveAaaMyth(encUrl, referer) {
  // /aaa/myth/play.php and dl2.php?id= — myth endpoints
  var out = [];
  var p1 = getJson(BASE_URL + "/aaa/myth/play.php?url=" + encodeURIComponent(encUrl), 10000,
    { Referer: referer || BASE_URL + "/" }).then(function (j) {
      var res = [];
      if (j) {
        var push = function (u, label) {
          if (u && typeof u === "string" && /^https?:\/\//i.test(u)) res.push(nuvioStream("AnimeDekho | " + label, u));
        };
        push(j.url, "Myth");
        push(j.link, "Myth");
        push(j.file, "Myth");
        if (j.data) { push(j.data.url, "Myth"); push(j.data.link, "Myth"); }
      }
      return res;
    }).catch(function () { return []; });
  return p1;
}

// ---- host extractors ----
var FILEMOON_HOSTS = ["filemoon.sx","filemoon.nl","filemoon.in","filemoon.to","filemoon.wf","filemoon.lol","moonembed.app","filesim.com","smoothpre.com","listeamed.net","newer.stream","earnvids.com"];
var STREAMWISH_HOSTS = ["streamwish.com","streamwish.to","streamwish.site","cdnwish.com","multimovies.cloud","wishfast.top","awish.one","filelions.top","filelions.online","strwish.com","jodwish.com","sfastwish.com","hlswish.com","embedwish.com","streamhg.com","streamhg.to"];
var VIDHIDE_HOSTS = ["vidhide.com","vidhidepro.com","vidhidepro.net","vidhidepre.com","vidhidevip.com","luluvdo.com"];
var VOE_HOSTS = ["voe.sx","voe.bar","voe.cx","voe.gg","voe.pm","voe.al","voe.net"];
var STREAMRUBY_HOSTS = ["rubystm.com","streamruby.com","ruby.stream"];
var DOODSTREAM_HOSTS = ["dood.to","dood.la","dood.wf","dood.li","dood.pm","dood.so","dood.sh","dood.cx","doodstream.com","ds2play.com"];
// New from plugin:
var VIDSTACK_HOSTS = ["vidcloud.upns.ink","cloudy.upns.one","vidstack.net","vidstack.io"];
var STREAMTAPE_HOSTS = ["streamtape.com","streamtape.to","strtape.cloud","streamta.pe"];
var GOFILE_HOSTS = ["gofile.io"];
var VIDMOLY_HOSTS = ["vidmoly.biz","vidmoly.net","vidmoly.to"];
var RAVOK_HOSTS = ["ravok.buzz","ravok.tv"];
var AWSSTREAM_HOSTS = ["awstream.net","z.awstream.net"];
var BLAKITE_HOSTS = ["blakiteapi.xyz","blakite.com"];
var ASCDN_HOSTS = ["as-cdn21.top","as-cdn26.top","ascdn.top"];
var ANIMEZIA_HOSTS = ["animezia.cloud"];
var HUBCLOUD_HOSTS = ["hubcloud.ist","hubcloud.one","hubcloud.foo"];
var GDMIRRORBOT_HOSTS = ["gdmirrorbot.nl","gdmirrorbot.top"];
var TECHINMIND_HOSTS = ["techinmind.space","stream.techinmind.space"];
var NEOCDN_HOSTS = ["neocdn."];
var ANIMEDEKHO_EMBED_HOSTS = ["animedekho.tv/embed","animedekho.app/embed"];

function hostMatch(url, hosts) {
  for (var i = 0; i < hosts.length; i++) { if (url.indexOf(hosts[i]) !== -1) return true; }
  return false;
}

function nuvioStream(name, url) {
  var q = "Unknown";
  var qm = /(\d{3,4})p/i.exec(url);
  if (qm) q = qm[1] + "p";
  else if (/\.m3u8/i.test(url)) q = "HLS";
  return { name: name, title: name, url: url, quality: q, type: "direct" };
}

function extractFromScripts(html, label) {
  var streams = [], seen = {};
  var add = function (u) {
    if (!u || seen[u]) return;
    seen[u] = 1;
    streams.push(nuvioStream("AnimeDekho | " + label, u));
  };
  var scripts = inlineScripts(html);
  for (var i = 0; i < scripts.length; i++) {
    var candidates = [scripts[i]];
    var up = unpackEval(scripts[i]);
    if (up) candidates.push(up);
    for (var c = 0; c < candidates.length; c++) {
      var urls = extractUrlsFromScript(candidates[c]);
      for (var u = 0; u < urls.length; u++) add(urls[u]);
      var fm = candidates[c].match(/["']?file["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/g) || [];
      for (var f = 0; f < fm.length; f++) {
        var mm = /["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/.exec(fm[f]);
        if (mm) add(mm[1]);
      }
      // sources: [{file: "..."}] pattern (VidStack)
      var sm = candidates[c].match(/\{[^}]*["']file["']\s*:\s*["']([^"']+)["']/g) || [];
      for (var s2 = 0; s2 < sm.length; s2++) {
        var smm = /["']file["']\s*:\s*["']([^"']+)["']/.exec(sm[s2]);
        if (smm && /^https?:\/\//i.test(smm[1])) add(smm[1]);
      }
    }
  }
  if (!streams.length) {
    var raw = html.match(/["'](https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*?)["']/g) || [];
    for (var r = 0; r < raw.length; r++) {
      var rm = /["'](https?:\/\/[^"'\s]+)["']/.exec(raw[r]);
      if (rm) add(rm[1]);
    }
  }
  return streams;
}

// Generic extractors (fetch page, extract from scripts)
function extractFileMoon(url, referer) {
  var origin = "https://filemoon.sx";
  try { origin = new URL(url).origin; } catch (e) {}
  return getText(url, 15000, { Referer: referer || BASE_URL + "/", Origin: origin })
    .then(function (html) { return extractFromScripts(html, "FileMoon"); })
    .catch(function () { return []; });
}

function extractStreamWish(url, referer) {
  return getText(url, 15000, { Referer: referer || BASE_URL + "/" })
    .then(function (html) { return extractFromScripts(html, "StreamWish"); })
    .catch(function () { return []; });
}

function extractVidHide(url, referer) {
  return getText(url, 15000, { Referer: referer || BASE_URL + "/" }).then(function (html) {
    var scripts = inlineScripts(html).join("\n");
    var m = /file\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/.exec(scripts) ||
      /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*?)["']/.exec(scripts) ||
      /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*?)["']/.exec(html);
    return m ? [nuvioStream("AnimeDekho | VidHide", m[1])] : [];
  }).catch(function () { return []; });
}

function extractVoe(url, referer) {
  return getText(url, 8000, { Referer: referer || BASE_URL + "/" }).then(function (html) {
    var m = /'hls'\s*:\s*'([^']+\.m3u8[^']*)'/.exec(html) ||
      /"hls"\s*:\s*"([^"]+\.m3u8[^"]*)"/.exec(html) ||
      /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/.exec(html);
    return m ? [nuvioStream("AnimeDekho | Voe", m[1])] : [];
  }).catch(function () { return []; });
}

function extractStreamRuby(url, referer) {
  var cleaned = url.replace(/\/e\//, "/").replace(/\/e$/, "");
  return getText(cleaned, 10000, { Referer: referer || BASE_URL + "/" }).then(function (html) {
    var NOTFOUND = ["File Not Found", "file not found", "not-found", "Server Error (Link)", "This video has been removed", "Video Not Found"];
    for (var i = 0; i < NOTFOUND.length; i++) { if (html.indexOf(NOTFOUND[i]) !== -1) return []; }
    return extractFromScripts(html, "StreamRuby");
  }).catch(function () { return []; });
}

function extractDoodStream(url, referer) {
  var origin = "https://dood.to";
  try { origin = new URL(url).origin; } catch (e) {}
  var ref = referer || BASE_URL + "/";
  return getText(url, 10000, { Referer: ref }).then(function (html) {
    if (!html) return [];
    var pm = /\$\.get\(['"]([^'"]*pass_md5[^'"]*)['"]/i.exec(html) || /["'](\/pass_md5\/[^"'\s]+)["']/.exec(html);
    if (!pm) return [];
    var path = pm[1];
    var passUrl = path.indexOf("http") === 0 ? path : origin + path;
    return getText(passUrl, 8000, { Referer: url }).then(function (baseUrl) {
      if (!baseUrl || baseUrl.trim().indexOf("http") !== 0) return [];
      var tm = /[?&]token=([a-zA-Z0-9_-]+)/.exec(html);
      var token = tm ? tm[1] : Math.random().toString(36).slice(2, 12);
      var finalUrl = baseUrl.trim() + token + "?expiry=" + (Date.now() + 3600000);
      return [nuvioStream("AnimeDekho | DoodStream", finalUrl)];
    });
  }).catch(function () { return []; });
}

// New extractors from plugin
function extractVidStack(url, referer) {
  // VidStack variants (vidcloud.upns.ink, cloudy.upns.one): sources array in scripts
  return getText(url, 12000, { Referer: referer || BASE_URL + "/" }).then(function (html) {
    var scripts = inlineScripts(html).join("\n");
    // look for sources: [{file: "..."}] or file:"..."
    var m = /sources\s*:\s*\[\s*\{\s*["']?file["']?\s*:\s*["']([^"']+)["']/.exec(scripts) ||
      /["']?file["']?\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/.exec(scripts);
    if (m) return [nuvioStream("AnimeDekho | VidStack", m[1])];
    return extractFromScripts(html, "VidStack");
  }).catch(function () { return []; });
}

function extractStreamTape(url, referer) {
  // StreamTape: robotlink in page
  return getText(url, 12000, { Referer: referer || BASE_URL + "/" }).then(function (html) {
    var m = /robotlink['"]?\s*[:=]\s*['"]?([^'"\s]+\.mp4[^'"\s]*)['"]?/.exec(html) ||
      /\/v\/[a-zA-Z0-9]+\/[^"'\s]+\.mp4/.exec(html);
    if (m) {
      var u = m[1] || m[0];
      if (u.indexOf("http") !== 0) u = "https:" + u;
      return [nuvioStream("AnimeDekho | StreamTape", u)];
    }
    return extractFromScripts(html, "StreamTape");
  }).catch(function () { return []; });
}

function extractGofile(url, referer) {
  // Gofile: api.gofile.io — get direct link
  var idM = /gofile\.io\/(?:d|embed)\/([a-zA-Z0-9]+)/.exec(url);
  if (!idM) return Promise.resolve([]);
  var fileId = idM[1];
  return getJson("https://api.gofile.io/contents/" + fileId + "?wt=4fd6sg89d7s6", 10000,
    { Referer: referer || "https://gofile.io/" }).then(function (j) {
      var out = [];
      try {
        var contents = j && j.data && j.data.children;
        for (var k in contents) {
          var f = contents[k];
          if (f.link) out.push(nuvioStream("AnimeDekho | Gofile", f.link));
        }
      } catch (e) {}
      return out;
    }).catch(function () { return []; });
}

function extractVidmoly(url, referer) {
  return getText(url, 12000, { Referer: referer || BASE_URL + "/" })
    .then(function (html) { return extractFromScripts(html, "Vidmoly"); })
    .catch(function () { return []; });
}

function extractRavok(url, referer) {
  return getText(url, 12000, { Referer: referer || BASE_URL + "/" })
    .then(function (html) { return extractFromScripts(html, "Ravok"); })
    .catch(function () { return []; });
}

function extractAWSStream(url, referer) {
  // z.awstream.net — JSON API
  return getJson(url, 10000, { Referer: referer || BASE_URL + "/" }).then(function (j) {
    var out = [];
    if (j) {
      var push = function (u, label) {
        if (u && typeof u === "string" && /^https?:\/\//i.test(u)) out.push(nuvioStream("AnimeDekho | " + label, u));
      };
      push(j.url, "AWSStream");
      push(j.file, "AWSStream");
      push(j.source, "AWSStream");
      if (j.data) { push(j.data.url, "AWSStream"); push(j.data.file, "AWSStream"); }
    }
    return out;
  }).catch(function () {
    return getText(url, 10000, { Referer: referer || BASE_URL + "/" })
      .then(function (html) { return extractFromScripts(html, "AWSStream"); })
      .catch(function () { return []; });
  });
}

function extractBlakite(url, referer) {
  return getJson(url, 10000, { Referer: referer || BASE_URL + "/" }).then(function (j) {
    var out = [];
    if (j) {
      var push = function (u) {
        if (u && typeof u === "string" && /^https?:\/\//i.test(u)) out.push(nuvioStream("AnimeDekho | Blakite", u));
      };
      push(j.url); push(j.file); push(j.link);
      if (Array.isArray(j.sources)) { for (var i = 0; i < j.sources.length; i++) push(j.sources[i].file || j.sources[i].url); }
    }
    return out;
  }).catch(function () { return []; });
}

function extractAscdn(url, referer) {
  return getText(url, 12000, { Referer: referer || BASE_URL + "/" })
    .then(function (html) { return extractFromScripts(html, "ASCDN"); })
    .catch(function () { return []; });
}

function extractAnimezia(url, referer) {
  // animezia.cloud — VidHide variant with specific patterns
  return extractVidHide(url, referer).then(function (r) {
    if (r.length) return r;
    return getText(url, 12000, { Referer: referer || BASE_URL + "/" })
      .then(function (html) { return extractFromScripts(html, "Animezia"); });
  });
}

function extractHubCloud(url, referer) {
  // HubCloud: resolve through download page
  return getText(url, 15000, { Referer: referer || BASE_URL + "/" }).then(function (html) {
    // look for download links or direct file URLs
    var m = /href=["'](https?:\/\/[^"']+\.(?:mp4|mkv)[^"']*)["']/i.exec(html);
    if (m) return [nuvioStream("AnimeDekho | HubCloud", m[1])];
    return extractFromScripts(html, "HubCloud");
  }).catch(function () { return []; });
}

function extractGDMirrorbot(url, referer) {
  return getJson(url, 12000, { Referer: referer || BASE_URL + "/" }).then(function (j) {
    var out = [];
    if (j) {
      var push = function (u) {
        if (u && typeof u === "string" && /^https?:\/\//i.test(u)) out.push(nuvioStream("AnimeDekho | GDMirror", u));
      };
      push(j.url); push(j.download); push(j.link);
      if (Array.isArray(j.links)) { for (var i = 0; i < j.links.length; i++) push(j.links[i]); }
    }
    return out;
  }).catch(function () { return []; });
}

function extractTechinmind(url, referer) {
  return getText(url, 12000, { Referer: referer || BASE_URL + "/" })
    .then(function (html) { return extractFromScripts(html, "Techinmind"); })
    .catch(function () { return []; });
}

function extractNeoCDN(url, referer) {
  return getJson(url, 10000, { Referer: referer || BASE_URL + "/" }).then(function (j) {
    var out = [];
    if (j) {
      var list = j.sources || j.data || [];
      if (!Array.isArray(list)) list = [list];
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var u = s.file || s.url || s.src;
        if (u && /^https?:\/\//i.test(u)) out.push(nuvioStream("AnimeDekho | NeoCDN", u));
      }
    }
    return out;
  }).catch(function () {
    return getText(url, 10000, { Referer: referer || BASE_URL + "/" })
      .then(function (html) { return extractFromScripts(html, "NeoCDN"); })
      .catch(function () { return []; });
  });
}

function extractAbyss(url, referer) {
  // AbyssPlayer via enc-dec.app/api/dec-abyss (from plugin)
  var apiUrl = "https://enc-dec.app/api/dec-abyss?url=" + encodeURIComponent(url);
  return getJson(apiUrl, 15000, { Referer: referer || BASE_URL + "/" }).then(function (j) {
    var out = [];
    if (j) {
      var push = function (u, label) {
        if (u && typeof u === "string" && /^https?:\/\//i.test(u)) out.push(nuvioStream("AnimeDekho | " + (label || "Abyss"), u));
      };
      push(j.url); push(j.file); push(j.source);
      if (Array.isArray(j.sources)) {
        for (var i = 0; i < j.sources.length; i++) {
          var s = j.sources[i];
          push(s.url || s.file, s.label || s.quality || "Abyss");
        }
      }
      if (j.data) { push(j.data.url); push(j.data.file); }
    }
    return out;
  }).catch(function () { return []; });
}

function extractAnimedekhoEmbed(url, referer) {
  // animedekho.tv/embed URLs -> try /aaa/ endpoints first
  return resolveAaaPlay(url, referer).then(function (r) {
    if (r.length) return r;
    return resolveAaaMyth(url, referer);
  }).then(function (r) {
    if (r.length) return r;
    return getText(url, 10000, { Referer: referer || BASE_URL + "/" })
      .then(function (html) { return extractFromScripts(html, "ADembed"); });
  });
}

// ---- main resolver ----
function resolveEmbed(embedUrl, referer) {
  var ref = referer || BASE_URL + "/";
  var u = embedUrl;

  // Tier 0: AnimeDekho's own /aaa/ resolver (site's encrypted links)
  // Only for animedekho.tv URLs to avoid hammering third parties
  var aaaFirst = isContentUrl(u) || hostMatch(u, ANIMEDEKHO_EMBED_HOSTS);

  var hostExtract = function () {
    if (hostMatch(u, FILEMOON_HOSTS)) return extractFileMoon(u, ref);
    if (hostMatch(u, STREAMWISH_HOSTS)) return extractStreamWish(u, ref);
    if (hostMatch(u, ANIMEZIA_HOSTS)) return extractAnimezia(u, ref);
    if (hostMatch(u, VIDHIDE_HOSTS)) return extractVidHide(u, ref);
    if (hostMatch(u, VOE_HOSTS)) return extractVoe(u, ref);
    if (hostMatch(u, STREAMRUBY_HOSTS)) return extractStreamRuby(u, ref);
    if (hostMatch(u, DOODSTREAM_HOSTS)) return extractDoodStream(u, ref);
    if (hostMatch(u, VIDSTACK_HOSTS)) return extractVidStack(u, ref);
    if (hostMatch(u, STREAMTAPE_HOSTS)) return extractStreamTape(u, ref);
    if (hostMatch(u, GOFILE_HOSTS)) return extractGofile(u, ref);
    if (hostMatch(u, VIDMOLY_HOSTS)) return extractVidmoly(u, ref);
    if (hostMatch(u, RAVOK_HOSTS)) return extractRavok(u, ref);
    if (hostMatch(u, AWSSTREAM_HOSTS)) return extractAWSStream(u, ref);
    if (hostMatch(u, BLAKITE_HOSTS)) return extractBlakite(u, ref);
    if (hostMatch(u, ASCDN_HOSTS)) return extractAscdn(u, ref);
    if (hostMatch(u, HUBCLOUD_HOSTS)) return extractHubCloud(u, ref);
    if (hostMatch(u, GDMIRRORBOT_HOSTS)) return extractGDMirrorbot(u, ref);
    if (hostMatch(u, TECHINMIND_HOSTS)) return extractTechinmind(u, ref);
    if (hostMatch(u, NEOCDN_HOSTS)) return extractNeoCDN(u, ref);
    if (u.indexOf("abyssplayer.com") !== -1 || u.indexOf("abyss") !== -1) return extractAbyss(u, ref);
    // generic: try script URL extraction on the embed page itself
    return getText(u, 10000, { Referer: ref }).then(function (html) {
      return extractFromScripts(html, "Embed");
    }).catch(function () { return []; });
  };

  if (aaaFirst) {
    return resolveAaaPlay(u, ref).then(function (r) {
      if (r.length) return r;
      return resolveAaaMyth(u, ref);
    }).then(function (r) {
      if (r.length) return r;
      return hostExtract();
    });
  }
  return hostExtract();
}

// ---- main entry ----
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return tmdbTitle(tmdbId, mediaType).then(function (title) {
    if (!title) return [];
    return searchSite(title);
  }).then(function (results) {
    var picked = pickResult(results, mediaType);
    if (!picked) return [];
    if (mediaType !== "tv") return [picked.url];
    return getText(picked.url, 15000).then(function (html) {
      return Promise.resolve(getSeriesId(picked.url, html));
    }).then(function (seriesId) {
      if (!seriesId) return [];
      return getEpisodes(seriesId, seasonNum || 1);
    }).then(function (episodes) {
      for (var i = 0; i < episodes.length; i++) {
        if (episodes[i].episode === episodeNum) return [episodes[i].url];
      }
      return [];
    });
  }).then(function (watchUrls) {
    if (!watchUrls.length) return [];
    var chain = Promise.resolve([]);
    watchUrls.forEach(function (wurl) {
      chain = chain.then(function (acc) {
        return getWatchSources(wurl).then(function (sources) {
          // *** gate: getWatchSources returns [] when gated — no bypass ***
          var ex = sources.map(function (s) { return resolveEmbed(s.embed, wurl); });
          return Promise.all(ex).then(function (lists) {
            for (var i = 0; i < lists.length; i++) acc.push.apply(acc, lists[i]);
            return acc;
          });
        });
      });
    });
    return chain;
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.AnimeDekhoScraperModule = { getStreams: getStreams };
}
