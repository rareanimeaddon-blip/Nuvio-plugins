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

/* VegaMovies - ported 2026-10-23 from the user-supplied CNCVerse
   CloudStream plugin (VegaMoviesProvider_0_ajmy.cs3, logic recovered
   from its DEX). Chain:
   1. Site base: urls.json (SaurabhKaperwan/Utils) key "vegamovies",
      then GET {base}/?re=vg&t=2 and adopt the redirect's origin.
   2. Search: GET {base}/search.php?q=<title>&page=1 (Typesense-style
      JSON). Match EXACTLY on the hit's imdb_id vs TMDB external ids;
      title+year gate only as fallback when no hit carries an imdb_id.
   3. Post page: movies take anchors wrapping a dwd-button (nexdrive
      intermediates) -> each nexdrive page lists V-Cloud links.
      Series take per-(season, quality) sections' "Episode Links"
      nexdrive anchors (Batch/Zip skipped) -> the nexdrive page lists
      one V-Cloud link per episode, in order.
   4. VCloud extractor: swap the link's origin for the current one
      from urls.json (key vcloud/hubcloud), GET the page, take the
      download URL from var url = atob(atob('..')) (double base64) or
      var url = '..', GET that page, and map its server buttons:
      FSL / FSLv2 / Mega / Download File -> href as-is; BuzzServer ->
      GET href + "/download", read hx-redirect; "10Gbps" -> follow
      the redirect (resolveFinalUrl); Pixeldrain -> var pxl in the
      page -> /api/file/<id>?download; "link=" hrefs -> the embedded
      target. Gofile buttons are skipped (needs its own API flow).
   Sandbox note: vcloud.* is Cloudflare-challenged from datacenter
   IPs, so the last hop cannot complete from the test sandbox; the
   chain is verified up to the V-Cloud link and runs as-is on-device.
   No timers, no TextEncoder/WebCrypto - TV guest safe. */
var VEGA_URLS_JSON = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";
var VEGA_FALLBACK_BASE = "https://new1.vegamovies.lease";
var VEGA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var _vegaBase = null;
var _vegaUrlMap = null;

function vegaHeaders(referer) {
  var h = { "User-Agent": VEGA_UA, "Accept": "text/html,application/json,*/*", "Accept-Language": "en-US,en;q=0.9" };
  if (referer) h.Referer = referer;
  return h;
}
function vegaText(url, referer) {
  return fetch(url, { headers: vegaHeaders(referer) }).then(function (r) { return r.text(); }).catch(function () { return ""; });
}
function vegaOrigin(url) {
  var m = /^(https?:\/\/[^\/]+)/i.exec(url || "");
  return m ? m[1] : "";
}
function vegaDecodeEntities(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
}
function vegaStripTags(s) {
  return vegaDecodeEntities(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function vegaAnchors(html) {
  var out = [];
  var re = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html || "")) !== null) {
    out.push({ href: vegaDecodeEntities(m[1]), inner: m[2], text: vegaStripTags(m[2]), index: m.index });
  }
  return out;
}
function vegaHeadings(html) {
  var out = [];
  var re = /<h[235]\b[^>]*>([\s\S]*?)<\/h[235]>/gi;
  var m;
  while ((m = re.exec(html || "")) !== null) {
    out.push({ text: vegaStripTags(m[1]), index: m.index, end: m.index + m[0].length });
  }
  return out;
}
function vegaQualityOf(text) {
  var m = /\b(2160p|1080p|720p|480p|360p)\b/i.exec(text || "");
  if (m) return m[1].toLowerCase();
  if (/4k/i.test(text || "")) return "2160p";
  return "HD";
}
function vegaIndexQuality(text) {
  var m = /(\d{3,4})[pP]/.exec(text || "");
  if (m) return m[1] + "p";
  var low = String(text || "").toLowerCase();
  if (low.indexOf("8k") !== -1) return "4320p";
  if (low.indexOf("4k") !== -1) return "2160p";
  if (low.indexOf("2k") !== -1) return "1440p";
  return null;
}

function vegaTmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&append_to_response=external_ids",
    { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return null;
      var title = j.title || j.name || null;
      var date = j.release_date || j.first_air_date || "";
      var year = /^\d{4}/.test(date) ? parseInt(date.substring(0, 4), 10) : null;
      var imdb = (j.external_ids && j.external_ids.imdb_id) || j.imdb_id || null;
      return title ? { title: title, year: year, imdb: imdb } : null;
    }).catch(function () { return null; });
}

function vegaUrlMap() {
  if (_vegaUrlMap) return Promise.resolve(_vegaUrlMap);
  return vegaText(VEGA_URLS_JSON).then(function (txt) {
    var map = {};
    try { map = JSON.parse(txt || "{}") || {}; } catch (e) {}
    _vegaUrlMap = map;
    return map;
  });
}

function vegaSiteBase() {
  if (_vegaBase) return Promise.resolve(_vegaBase);
  return vegaUrlMap().then(function (map) {
    var start = map.vegamovies || VEGA_FALLBACK_BASE;
    start = start.replace(/\/+$/, "");
    return fetch(start + "/?re=vg&t=2", { headers: vegaHeaders(), redirect: "manual" }).then(function (r) {
      var loc = "";
      try { loc = r.headers.get("location") || ""; } catch (e) {}
      var base = start;
      if (/^https?:\/\//i.test(loc)) base = vegaOrigin(loc);
      else if (r.url && vegaOrigin(r.url) && vegaOrigin(r.url) !== vegaOrigin(start)) base = vegaOrigin(r.url);
      _vegaBase = base;
      return base;
    }).catch(function () { _vegaBase = start; return start; });
  });
}

function vegaNormTitle(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function vegaSearch(base, meta) {
  var url = base + "/search.php?q=" + encodeURIComponent(meta.title) + "&page=1";
  return vegaText(url, base + "/").then(function (txt) {
    var hits = [];
    try {
      var j = JSON.parse(txt || "{}");
      hits = (j && j.hits) || [];
    } catch (e) {}
    var docs = hits.map(function (h) { return h && h.document; }).filter(function (d) { return d && d.permalink; });
    var matched = [];
    if (meta.imdb) {
      matched = docs.filter(function (d) { return d.imdb_id && d.imdb_id === meta.imdb; });
    }
    if (!matched.length && !docs.some(function (d) { return d.imdb_id; })) {
      var want = vegaNormTitle(meta.title);
      matched = docs.filter(function (d) {
        var t = String(d.post_title || "").replace(/^Download\s+/i, "").replace(/^\[18\+\]\s*/, "");
        var ym = /\((\d{4})\)/.exec(t);
        var candTitle = vegaNormTitle(t.replace(/\(\d{4}\)[\s\S]*$/, ""));
        if (candTitle !== want) return false;
        if (meta.year && ym && parseInt(ym[1], 10) !== meta.year) return false;
        return true;
      });
    }
    return matched.map(function (d) {
      return d.permalink.charAt(0) === "/" ? base + d.permalink : d.permalink;
    });
  }).catch(function () { return []; });
}

function vegaVcloudLinksOnPage(html) {
  return vegaAnchors(html).filter(function (a) { return /vcloud/i.test(a.href); })
    .map(function (a) { return a.href; });
}

/* Resolve one nexdrive intermediate page to its V-Cloud links. */
function vegaNexdrive(url, referer) {
  return vegaText(url, referer).then(function (html) { return vegaVcloudLinksOnPage(html); })
    .catch(function () { return []; });
}

/* VCloud extractor (see header comment). Returns [{url, label}]. */
function vegaResolveVCloud(link, referer) {
  return vegaUrlMap().then(function (map) {
    var key = /hubcloud/i.test(link) ? "hubcloud" : "vcloud";
    var latest = map[key];
    var url = link;
    if (latest && vegaOrigin(latest) && vegaOrigin(latest) !== vegaOrigin(link)) {
      url = vegaOrigin(latest) + link.substring(vegaOrigin(link).length);
    }
    return vegaText(url, referer).then(function (html) {
      if (!html) return [];
      var dl = null;
      if (url.indexOf("/video/") !== -1) {
        var vd = /<div class="vd">[\s\S]*?<a\b[^>]*\bhref="([^"]+)"/i.exec(html);
        if (vd) dl = vegaDecodeEntities(vd[1]);
      }
      if (!dl) {
        var atobM = /var\s+url\s*=\s*atob\s*\(\s*atob\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/.exec(html);
        if (atobM) {
          try { dl = atob(atob(atobM[1])); } catch (e) { dl = null; }
        }
      }
      if (!dl) {
        var plainM = /var url = '([^']*)'/.exec(html);
        if (plainM) dl = plainM[1];
      }
      if (!dl) return [];
      if (!/^https?:\/\//i.test(dl)) {
        dl = dl.charAt(0) === "/" ? vegaOrigin(url) + dl : vegaOrigin(url) + "/" + dl;
      }
      return vegaText(dl, url).then(function (page) {
        if (!page) return [];
        var headerM = /<div class="card-header"[^>]*>([\s\S]*?)<\/div>/i.exec(page);
        var quality = (headerM && vegaIndexQuality(vegaStripTags(headerM[1]))) || null;
        var sizeM = /<i id="size"[^>]*>([\s\S]*?)<\/i>/i.exec(page);
        var size = sizeM ? vegaStripTags(sizeM[1]) : "";
        var buttons = vegaAnchors(page).filter(function (a) {
          return a.href && /^https?:\/\//i.test(a.href) && a.text;
        });
        return Promise.all(buttons.map(function (b) {
          return vegaMapButton(b, page, dl).catch(function () { return null; });
        })).then(function (mapped) {
          return mapped.filter(Boolean).map(function (s) {
            s.quality = quality || s.quality || "HD";
            s.size = size;
            return s;
          });
        });
      });
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}

function vegaResolveFinalUrl(u) {
  if (!u) return Promise.resolve(null);
  if (u.indexOf("link=") !== -1) {
    var after = u.substring(u.indexOf("link=") + 5);
    try { after = decodeURIComponent(after); } catch (e) {}
    if (/^https?:\/\//i.test(after)) return Promise.resolve(after);
  }
  return fetch(u, { headers: vegaHeaders(), redirect: "manual" }).then(function (r) {
    var loc = "";
    try { loc = r.headers.get("location") || ""; } catch (e) {}
    if (loc && r.status >= 300 && r.status < 400) {
      try { return new URL(loc, u).toString(); } catch (e) { return loc; }
    }
    if (r.url && r.url !== u) return r.url;
    return u;
  }).catch(function () { return u; });
}

function vegaMapButton(b, page, referer) {
  var text = b.text || "";
  var href = b.href;
  function simple(label) { return Promise.resolve({ url: href, label: label }); }
  if (/FSL Server/i.test(text)) return simple("FSL Server");
  if (/FSLv2/i.test(text)) return simple("FSLv2 Server");
  if (/Mega Server/i.test(text)) return simple("Mega Server");
  if (/Download File/i.test(text)) return simple("Download");
  if (/BuzzServer/i.test(text)) {
    return fetch(href.replace(/\/+$/, "") + "/download", { headers: vegaHeaders(referer), redirect: "manual" })
      .then(function (r) {
        var hx = "";
        try { hx = r.headers.get("hx-redirect") || ""; } catch (e) {}
        if (!hx) return null;
        var fin = /^https?:\/\//i.test(hx) ? hx : vegaOrigin(href) + (hx.charAt(0) === "/" ? hx : "/" + hx);
        return { url: fin, label: "BuzzServer" };
      }).catch(function () { return null; });
  }
  if (/pixeldra/i.test(text) || /pixeldrain/i.test(href)) {
    var pxlM = /var\s+pxl\s*=\s*["']([^"']+)["']/.exec(page || "");
    if (!pxlM) return Promise.resolve(null);
    var pxl = pxlM[1];
    if (pxl.indexOf("download") === -1) return Promise.resolve(null);
    var fid = pxl.substring(pxl.lastIndexOf("/") + 1);
    if (!fid) return Promise.resolve(null);
    return Promise.resolve({ url: vegaOrigin(pxl) + "/api/file/" + fid + "?download", label: "Pixeldrain" });
  }
  if (/10Gbps/i.test(text)) {
    return vegaResolveFinalUrl(href).then(function (fin) { return fin ? { url: fin, label: "10Gbps" } : null; });
  }
  if (href.indexOf("link=") !== -1) {
    return vegaResolveFinalUrl(href).then(function (fin) { return fin ? { url: fin, label: "Download" } : null; });
  }
  if (/workers\.dev/i.test(href)) return simple("Server");
  return Promise.resolve(null);
}

function vegaStreamsFromVClouds(links, qualityHint, referer, mediaTitle, season, episode) {
  var seen = {};
  return Promise.all(links.map(function (l) {
    return vegaResolveVCloud(l, referer).catch(function () { return []; });
  })).then(function (perLink) {
    var out = [];
    perLink.forEach(function (list) {
      list.forEach(function (s) {
        if (seen[s.url]) return;
        seen[s.url] = 1;
        var q = s.quality && s.quality !== "HD" ? s.quality : (qualityHint || "HD");
        var streamLabel = formatStreamLabel({
          source: "VegaMovies", title: mediaTitle, quality: q,
          season: season, episode: episode,
          size: s.size, server: s.label, url: s.url
        });
        out.push({
          name: streamLabel,
          title: streamLabel,
          url: s.url,
          quality: q,
          type: "direct"
        });
      });
    });
    return out;
  });
}

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

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "tv" : "movie";
  return vegaTmdbMeta(tmdbId, type).then(function (meta) {
    if (!meta) return [];
    return vegaSiteBase().then(function (base) {
      return vegaSearch(base, meta).then(function (posts) {
        if (!posts.length) return [];
        var postUrl = posts[0];
        return vegaText(postUrl, base + "/").then(function (html) {
          if (!html) return [];
          if (type === "movie") {
            var headings = vegaHeadings(html);
            var dwd = vegaAnchors(html).filter(function (a) { return a.inner.indexOf("dwd-button") !== -1; }).slice(0, 5);
            if (!dwd.length) return [];
            return Promise.all(dwd.map(function (a) {
              var hint = "HD";
              for (var i = headings.length - 1; i >= 0; i--) {
                if (headings[i].index < a.index) { hint = vegaQualityOf(headings[i].text); break; }
              }
              return vegaNexdrive(a.href, postUrl).then(function (links) {
                return { links: links.slice(0, 2), hint: hint };
              });
            })).then(function (groups) {
              var jobs = [];
              groups.forEach(function (g) {
                g.links.forEach(function (l) { jobs.push({ link: l, hint: g.hint }); });
              });
              return vegaStreamsFromVClouds(jobs.map(function (j) { return j.link; }),
                jobs.length ? jobs[0].hint : "HD", postUrl, meta.title, undefined, undefined);
            });
          }
          /* TV: walk sections in document order; a section starts at a
             heading carrying a season number; its Episode Links anchor
             (not Batch/Zip) opens a nexdrive page with one V-Cloud
             link per episode. */
          var wantSeason = seasonNum || 1;
          var wantEpisode = episodeNum || 1;
          var heads = vegaHeadings(html);
          var anchors = vegaAnchors(html);
          var sections = [];
          heads.forEach(function (h, i) {
            var sm = /(?:Season |S)(\d+)/i.exec(h.text);
            if (!sm) return;
            var start = h.end;
            var stop = i + 1 < heads.length ? heads[i + 1].index : html.length;
            var ep = null;
            anchors.forEach(function (a) {
              if (a.index < start || a.index >= stop || ep) return;
              if (/nexdrive/i.test(a.href) && /episode/i.test(a.text) && !/zip|batch/i.test(a.text)) ep = a;
            });
            if (ep) sections.push({ season: parseInt(sm[1], 10), quality: vegaQualityOf(h.text), nex: ep.href });
          });
          var mine = sections.filter(function (s) { return s.season === wantSeason; }).slice(0, 3);
          if (!mine.length) return [];
          return Promise.all(mine.map(function (s) {
            return vegaNexdrive(s.nex, postUrl).then(function (links) {
              var link = links[wantEpisode - 1] || null;
              return link ? { link: link, hint: s.quality } : null;
            });
          })).then(function (picked) {
            var valid = picked.filter(Boolean);
            if (!valid.length) return [];
            return vegaStreamsFromVClouds(valid.map(function (v) { return v.link; }), valid[0].hint, postUrl, meta.title, wantSeason, wantEpisode);
          });
        });
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.VegaMoviesScraperModule = { getStreams: getStreams };
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
