// HindMovies scraper for Nuvio
// Converted from the Stremio addon provider (hindmovies.ts).
// Flow: TMDB meta -> site search -> match page -> maxbutton links ->
// mvlink pages -> hshare ?id= links -> HMAC-SHA256 signed r.php URLs ->
// resolve to direct file links (incl. gdshine worker URLs).
// Standalone, sandbox-compatible: fetch + WebCrypto + regex HTML parsing only.

var BASE_URL = "https://hindmovie.fit";
var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
// HMAC secret (base64-decoded from the addon source)
var SECRET = "5e96085c56e0f54eda657790ac58d19b271479c504367fc9e6a6c33f1f824e6b";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var REQ_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5"
};

// ─── HTTP ────────────────────────────────────────────────────────────────────

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 15000);
  var opts = Object.assign({}, options || {}, { signal: controller.signal });
  return fetch(url, opts).then(
    function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

function getHtml(url, timeoutMs) {
  return fetchWithTimeout(url, { headers: REQ_HEADERS }, timeoutMs || 15000)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
}

// ─── Text helpers ────────────────────────────────────────────────────────────

function stripTags(s) {
  return String(s == null ? "" : s)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/\s+/g, " ")
    .trim();
}

function parseYear(text) {
  var m = /\b(19|20)\d{2}\b/.exec(String(text || ""));
  return m ? m[0] : null;
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/\s*season\s*\d+(?:\s*[-–]\s*\d+)?\s*/gi, " ")
    .replace(/\s*multi[- ]?audio\s*/gi, " ")
    .replace(/\s*(480p|720p|1080p|2160p|4K|UHD)\s*/gi, " ")
    .replace(/\s*Dual\s*Audio\s*/gi, " ")
    .replace(/\s*(?:Hindi|English|Tamil|Telugu|Bengali|Malayalam|Kannada)(?:\s*[-–]\s*(?:Hindi|English|Tamil|Telugu|Bengali|Malayalam|Kannada))*\s*/gi, " ")
    .replace(/\s*Hindi\s*/gi, " ")
    .replace(/\s*English\s*/gi, " ")
    .replace(/\s*Tamil\s*/gi, " ")
    .replace(/\s*Telugu\s*/gi, " ")
    .replace(/\s*Bengali\s*/gi, " ")
    .replace(/\s*Malayalam\s*/gi, " ")
    .replace(/\s*Kannada\s*/gi, " ")
    .replace(/\s*Dubbed\s*/gi, " ")
    .replace(/\s*Subtitle\s*/gi, " ")
    .replace(/\s*BluRay\s*/gi, " ")
    .replace(/\s*WEB-?DL\s*/gi, " ")
    .replace(/\s*\d{4}\s*/, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── HMAC-SHA256 signing (WebCrypto) ─────────────────────────────────────────

function base64Url(input) {
  var bytes = new TextEncoder().encode(String(input)), bin = "", i;
  for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function hmacSha256Hex16(key, data) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    .then(function (k) { return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)); })
    .then(function (ab) {
      var bytes = new Uint8Array(ab), hex = "", i, h;
      for (i = 0; i < bytes.length; i++) {
        h = bytes[i].toString(16);
        hex += (h.length === 1 ? "0" + h : h);
      }
      return hex.substring(0, 16);
    });
}

function signHShare(rawId, domain) {
  var t = Math.floor(Date.now() / 1000);
  var encoded = base64Url(rawId);
  return hmacSha256Hex16(SECRET, encoded + "|" + t).then(function (s) {
    return domain + "/r.php?d=" + encodeURIComponent(encoded) + "&t=" + t + "&s=" + s;
  });
}

function parseHShareLink(href) {
  try {
    var u = new URL(href);
    var rawId = u.searchParams.get("id");
    if (!rawId) return null;
    return { domain: u.origin, rawId: rawId };
  } catch (e) { return null; }
}

// ─── Title matching (compact port of the addon's findBestMatch) ──────────────

var QUALITY_TAGS = /\b(4k|2160p|1080p|720p|480p|360p|hd|fhd|uhd|hdr|web[-\s]?dl|webrip|web|bluray|blu-ray|brrip|bdrip|dvdrip|hdrip|hdtv|hdcam|cam|dual audio|multi audio|dual[-\s]?audio|multi[-\s]?audio|x264|x265|hevc|h264|h265|10bit|esub|esubs|msubs|amzn|nf|hin|eng|hindi|english|dubbed|dub|subbed|sub|season\s*\d+|s\d{1,2}|complete|full)\b/gi;
var STOP_WORDS = { the: 1, a: 1, an: 1, of: 1, in: 1, at: 1, to: 1, with: 1, and: 1, or: 1, for: 1, on: 1 };

function baseNormalize(s) {
  return String(s || "").toLowerCase()
    .replace(/([a-z])\./g, "$1")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStripQuality(s) {
  return baseNormalize(String(s || "").replace(QUALITY_TAGS, " "));
}

function significantTokens(s) {
  return baseNormalize(s).split(" ").filter(function (w) { return w.length > 1 && !STOP_WORDS[w]; });
}

function bigrams(s) {
  var clean = baseNormalize(s).replace(/\s+/g, ""), out = [], i;
  for (i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
  return out;
}

function diceCoefficient(a, b) {
  var ba = bigrams(a), bb = bigrams(b), i, counts = {}, matches = 0, c;
  if (!ba.length || !bb.length) return ba.length === bb.length ? 1 : 0;
  for (i = 0; i < ba.length; i++) counts[ba[i]] = (counts[ba[i]] || 0) + 1;
  for (i = 0; i < bb.length; i++) {
    c = counts[bb[i]] || 0;
    if (c > 0) { matches++; counts[bb[i]] = c - 1; }
  }
  return (2 * matches) / (ba.length + bb.length);
}

function scoreTitleText(query, candidate) {
  if (!query || !candidate) return 0;
  var exact = query.trim().toLowerCase() === candidate.trim().toLowerCase() ? 1 : 0;
  var nq = normalizeStripQuality(query), nc = normalizeStripQuality(candidate);
  var normalized = (nq === nc) ? 1 : 0;
  if (!normalized && nq.replace(/\s+/g, "") === nc.replace(/\s+/g, "")) normalized = 0.92;

  var qa = significantTokens(nq), ca = significantTokens(nc), i, t;
  var qset = {}, cset = {}, inter = 0;
  for (i = 0; i < qa.length; i++) qset[qa[i]] = 1;
  for (i = 0; i < ca.length; i++) cset[ca[i]] = 1;
  for (t in qset) if (cset[t]) inter++;
  var union = qa.length + ca.length - inter;
  var jaccard = union > 0 ? inter / union : 0;
  var fuzzy = 0.5 * jaccard + 0.5 * diceCoefficient(nq, nc);

  var whole = 0;
  if (qa.length) {
    var hit = 0;
    for (i = 0; i < qa.length; i++) if (cset[qa[i]]) hit++;
    whole = hit / qa.length;
  }

  var startsWith = 0;
  if (nc.indexOf(nq) === 0 || nq.indexOf(nc) === 0) startsWith = 1;
  else {
    var qf = nq.split(" ")[0], cf = nc.split(" ")[0];
    if (qf && cf && qf === cf) startsWith = 0.5;
  }

  return Math.min(1, exact * 0.35 + normalized * 0.25 + fuzzy * 0.2 + whole * 0.1 + startsWith * 0.1);
}

// Mirrors the addon's scoring: text*0.6 + year*0.1 + type(neutral 0.5)*0.2 + seasonEpisode(n/a 1)*0.1
function scoreCandidate(qTitle, qYear, cTitle, cYear) {
  var text = scoreTitleText(qTitle, cTitle);
  var year = 0.5;
  if (qYear && cYear) {
    var d = Math.abs(qYear - cYear);
    year = d === 0 ? 1 : (d === 1 ? 0.6 : (d === 2 ? 0.3 : 0.05));
  }
  return Math.min(1, Math.max(0, text * 0.6 + year * 0.1 + 0.2));
}

// ─── TMDB meta ───────────────────────────────────────────────────────────────

function getTmdbMeta(tmdbId, type) {
  var kind = type === "series" ? "tv" : "movie";
  var base = "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_KEY;
  return fetchWithTimeout(base, {}, 10000).then(function (r) {
    if (!r.ok) throw new Error("tmdb " + r.status);
    return r.json();
  }).then(function (d) {
    var title = kind === "tv" ? (d.name || d.original_name) : (d.title || d.original_title);
    var date = kind === "tv" ? d.first_air_date : d.release_date;
    var year = date ? String(date).slice(0, 4) : "";
    return fetchWithTimeout(
      "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/external_ids?api_key=" + TMDB_KEY,
      {}, 10000
    ).then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; })
    .then(function (x) {
      return { title: title || "", year: year, imdbId: (x && x.imdb_id) || null };
    });
  }).catch(function () { return null; });
}

// ─── Search + parse (regex, no cheerio) ──────────────────────────────────────

function absoluteUrl(href, base) {
  try { return new URL(href, base).toString(); } catch (e) { return href; }
}

function parseMovieList(html) {
  var movies = [], artRe = /<article[\s\S]*?<\/article>/gi, am;
  while ((am = artRe.exec(html))) {
    var art = am[0];
    var lm = /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(art);
    if (!lm) continue;
    var rawUrl = lm[1], rawTitle = stripTags(lm[2]);
    if (!rawUrl || !rawTitle) continue;

    var imgM = /<img[^>]*?(?:data-src|src)="([^"]+)"/i.exec(art);
    var year = parseYear(rawTitle);
    var imdbM = /imdb\.com\/title\/(tt\d{7,8})/i.exec(art);

    var genres = [];
    var catM = /<[^>]*class="[^"]*cat-links[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(art);
    if (catM) {
      var ga = /<a[^>]*>([^<]*)<\/a>/gi, g;
      while ((g = ga.exec(catM[1]))) {
        var gt = g[1].trim();
        if (gt) genres.push(gt);
      }
    }

    movies.push({
      title: cleanTitle(rawTitle),
      url: absoluteUrl(rawUrl.replace(/#.*$/, ""), BASE_URL),
      poster: imgM ? imgM[1] : null,
      year: year,
      imdbId: imdbM ? imdbM[1] : null,
      genre: genres.length ? genres.join(", ") : null
    });
  }
  return movies;
}

function searchMovies(query, page) {
  var url = page === 1
    ? BASE_URL + "/?s=" + encodeURIComponent(query)
    : BASE_URL + "/page/" + page + "/?s=" + encodeURIComponent(query);
  return getHtml(url).then(parseMovieList).catch(function () { return []; });
}

function findMovieByTitle(title, year, imdbId) {
  function tryMatch(results) {
    if (!results.length) return null;
    var i;
    if (imdbId) {
      for (i = 0; i < results.length; i++) {
        if (results[i].imdbId && results[i].imdbId === imdbId) return results[i];
      }
    }
    var qy = year ? parseInt(year, 10) : undefined;
    var best = null, bestScore = 0.45;
    for (i = 0; i < results.length; i++) {
      var c = results[i];
      var s = scoreCandidate(title, qy, c.title, c.year ? parseInt(c.year, 10) : undefined);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }

  return searchMovies(title, 1).then(function (page1) {
    var hit = tryMatch(page1);
    if (hit) return hit;
    if (page1.length > 0) {
      return searchMovies(title, 2).then(tryMatch).catch(function () { return null; });
    }
    return null;
  }).catch(function () { return null; });
}

// ─── Signed links ────────────────────────────────────────────────────────────

function findHShareAnchor(html) {
  var re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, a;
  while ((a = re.exec(html))) {
    var tag = a[0], href = a[1], text = stripTags(a[2]);
    if (/get-link-btn/i.test(tag)) return href;
    if (/get links/i.test(text)) return href;
    if (href.indexOf("?id=") >= 0) return href;
  }
  var m = /href="([^"]*\?id=[^"]*)"/i.exec(html);
  return m ? m[1] : null;
}

function getMovieSignedLinks(movieUrl) {
  return getHtml(movieUrl).then(function (html) {
    var h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>/gi, hm, h3s = [];
    while ((hm = h3Re.exec(html))) h3s.push({ pos: hm.index, text: stripTags(hm[1]) });

    var tasks = [];
    var btnRe = /<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"[^>]*>/gi, bm;
    while ((bm = btnRe.exec(html))) {
      var label = "", i;
      for (i = h3s.length - 1; i >= 0; i--) {
        if (h3s[i].pos < bm.index) { label = h3s[i].text; break; }
      }
      tasks.push({ mvlinkUrl: bm[1], qualityLabel: label });
    }

    var jobs = tasks.map(function (t) {
      return getHtml(t.mvlinkUrl).then(function (mvHtml) {
        var rawHref = findHShareAnchor(mvHtml);
        if (!rawHref) return null;
        var hshare = parseHShareLink(rawHref);
        if (!hshare) return null;
        return signHShare(hshare.rawId, hshare.domain).then(function (signed) {
          return { signedUrl: signed, qualityLabel: t.qualityLabel };
        });
      }).catch(function () { return null; });
    });

    return Promise.all(jobs).then(function (arr) {
      return arr.filter(function (x) { return !!x; });
    });
  }).catch(function () { return []; });
}

function getSeriesEpisodeSignedLink(seriesUrl, season, episode) {
  return getHtml(seriesUrl).then(function (html) {
    var h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>/gi, hm, h3s = [];
    while ((hm = h3Re.exec(html))) {
      h3s.push({ pos: hm.index, end: hm.index + hm[0].length, text: stripTags(hm[1]) });
    }

    var episodeListUrl = null, i;
    for (i = 0; i < h3s.length; i++) {
      var sm = /Season\s*(\d+)/i.exec(h3s[i].text);
      if (sm && parseInt(sm[1], 10) === season) {
        var nextStart = (i + 1 < h3s.length) ? h3s[i + 1].pos : html.length;
        var seg = html.slice(h3s[i].end, nextStart);
        var am = /<a[^>]*href="([^"]+)"[^>]*>/i.exec(seg);
        if (am) { episodeListUrl = am[1]; break; }
      }
    }
    if (!episodeListUrl) {
      var fb = /<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"[^>]*>/i.exec(html);
      if (fb) episodeListUrl = fb[1];
    }
    if (!episodeListUrl) return null;

    return getHtml(episodeListUrl).then(function (epHtml) {
      var re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, a, epHref = null;
      while ((a = re.exec(epHtml))) {
        var em = /Episode\s*(\d+)/i.exec(stripTags(a[2]));
        if (em && parseInt(em[1], 10) === episode) { epHref = a[1]; break; }
      }
      if (!epHref) return null;
      var hshare = parseHShareLink(epHref);
      if (!hshare) return null;
      return signHShare(hshare.rawId, hshare.domain);
    });
  }).catch(function () { return null; });
}

// ─── Resolve ─────────────────────────────────────────────────────────────────

function qualityFromText(text) {
  if (/2160|4[kK]|uhd/i.test(text)) return "4K";
  if (/1080/i.test(text)) return "1080p";
  if (/720/i.test(text)) return "720p";
  if (/480/i.test(text)) return "480p";
  return "HD";
}

function extractSpecs(name) {
  var parts = [];
  var q = qualityFromText(name);
  if (q !== "HD") parts.push(q);
  if (/bluray|bdrip/i.test(name)) parts.push("BluRay");
  else if (/web[- ]?dl/i.test(name)) parts.push("WEB-DL");
  else if (/webrip/i.test(name)) parts.push("WEBRip");
  else if (/hdrip/i.test(name)) parts.push("HDRip");
  if (/x265|hevc/i.test(name)) parts.push("x265");
  else if (/x264/i.test(name)) parts.push("x264");
  if (/10[- ]?bit/i.test(name)) parts.push("10bit");
  if (/dual/i.test(name)) parts.push("Dual");
  else if (/hindi/i.test(name)) parts.push("HIN");
  return parts.join(" ") || q;
}

function resolveGdshine(url) {
  var parts = String(url).split("/"), id = parts[parts.length - 1] || "";
  if (!id) return Promise.resolve(null);
  return fetchWithTimeout("https://gdshine.org/api/files/s/" + id, { headers: REQ_HEADERS }, 10000)
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var fid = j && j.data && j.data.id;
      if (!fid) return null;
      return fetchWithTimeout(
        "https://gdshine.org/api/downloads/" + fid + "/via-worker",
        { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, REQ_HEADERS), body: "{}" },
        10000
      );
    })
    .then(function (r) { return r ? r.json() : null; })
    .then(function (j) { return (j && j.data && j.data.copyUrl) || null; })
    .catch(function () { return null; });
}

function resolveSignedUrl(signedUrl, qualityLabel) {
  return getHtml(signedUrl).then(function (html) {
    var nameM = /Name:\s*([^<\n\r]+)/i.exec(html);
    var sizeM = /Size:\s*([^<\n\r]+)/i.exec(html);
    var rawName = nameM ? nameM[1].trim() : "";
    var fileSize = sizeM ? sizeM[1].trim() : "";
    var specs = extractSpecs(rawName || qualityLabel);
    var sizeTag = fileSize ? " [" + fileSize + "]" : "";
    var quality = qualityFromText(rawName || qualityLabel);

    function mk(titleLabel, href) {
      return {
        title: (specs ? specs + " | " : "") + titleLabel + sizeTag,
        url: href,
        quality: quality
      };
    }

    var btnUrls = [], re = /<a[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*href="([^"]+)"[^>]*>/gi, m;
    while ((m = re.exec(html))) {
      var href = m[1];
      if (href && href.indexOf("javascript") !== 0) btnUrls.push(href);
    }

    var jobs = btnUrls.map(function (btnUrl) {
      if (btnUrl.toLowerCase().indexOf("gdshine") >= 0) {
        return resolveGdshine(btnUrl).then(function (directUrl) {
          return directUrl ? [mk("GDShine", directUrl)] : [];
        }).catch(function () { return []; });
      }
      return getHtml(btnUrl, 12000).then(function (btnHtml) {
        var out = [], a;
        var r1 = /<a[^>]*class="[^"]*\bbutton\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((a = r1.exec(btnHtml))) {
          var h1 = a[1];
          if (!h1 || h1 === "#" || h1.indexOf("javascript") === 0) continue;
          out.push(mk(stripTags(a[2]) || "Stream", h1));
        }
        var r2 = /<a[^>]*data-video[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((a = r2.exec(btnHtml))) {
          var h2 = a[1];
          if (!h2 || h2 === "#" || h2.indexOf("javascript") === 0) continue;
          out.push(mk(stripTags(a[2]) || "Stream", h2));
        }
        var r3 = /<a[^>]*href="([^"]+)"[^>]*>\s*<button[^>]*class="[^"]*\bbutton\b[^"]*"[^>]*>[\s\S]*?<\/button>\s*<\/a>/gi;
        while ((a = r3.exec(btnHtml))) {
          var h3 = a[1];
          if (!h3 || h3 === "#" || h3.indexOf("javascript") === 0) continue;
          out.push(mk("Stream", h3));
        }
        return out;
      }).catch(function () { return []; });
    });

    return Promise.all(jobs).then(function (arr) {
      var flat = [];
      arr.forEach(function (x) { flat = flat.concat(x); });
      return flat;
    });
  }).catch(function () { return []; });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function toNuvioStreams(items) {
  var seen = {}, out = [];
  items.forEach(function (s) {
    if (!s.url || seen[s.url]) return;
    seen[s.url] = 1;
    out.push({
      name: "HindMovies",
      title: s.title || "HindMovies",
      url: s.url,
      quality: s.quality || "HD",
      type: "direct"
    });
  });
  return out;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "series" : "movie";

  return getTmdbMeta(tmdbId, type).then(function (meta) {
    if (!meta || !meta.title) return [];

    return findMovieByTitle(meta.title, meta.year || undefined, meta.imdbId || undefined)
      .then(function (siteEntry) {
        if (!siteEntry) return [];

        // Post-match IMDB cross-check: reject if the list page embeds a
        // different IMDB ID than requested (definitive wrong-show signal).
        if (siteEntry.imdbId && meta.imdbId && siteEntry.imdbId !== meta.imdbId) return [];

        if (type === "movie") {
          return getMovieSignedLinks(siteEntry.url).then(function (signedLinks) {
            var jobs = signedLinks.map(function (sl) {
              return resolveSignedUrl(sl.signedUrl, sl.qualityLabel).catch(function () { return []; });
            });
            return Promise.all(jobs).then(function (arr) {
              var out = [];
              arr.forEach(function (x) { out = out.concat(x); });
              return toNuvioStreams(out);
            });
          });
        }

        // series
        if (seasonNum == null || episodeNum == null) return [];
        return getSeriesEpisodeSignedLink(siteEntry.url, seasonNum, episodeNum)
          .then(function (signedUrl) {
            if (!signedUrl) return [];
            return resolveSignedUrl(signedUrl, "S" + seasonNum + "E" + episodeNum);
          })
          .then(toNuvioStreams);
      });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
