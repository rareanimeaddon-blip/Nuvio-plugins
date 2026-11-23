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



const cheerio = require('cheerio-without-node-native');

// Constants
// __DYNAMIC_DOMAIN__ v1 (from the .cs3, phisher98 v41): the site's domain
// rotates. Resolve it from phisher98's live domains.json ("4khdhub" key,
// currently https://4khdhub.one), cached for the session. Fall back to the
// last known domain when the fetch fails. The .cs3 does the same lookup.
var DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/main/domains.json';
var FALLBACK_BASE_URL = 'https://4khdhub.fans';
var _baseUrl = null;
var _baseUrlPromise = null;
function getBaseUrl() {
  if (_baseUrl) return Promise.resolve(_baseUrl);
  if (_baseUrlPromise) return _baseUrlPromise;
  _baseUrlPromise = fetch(DOMAINS_URL).then(function (r) {
    if (!r.ok) return FALLBACK_BASE_URL;
    return r.json();
  }).then(function (j) {
    var u = (j && j['4khdhub']) || '';
    if (typeof u === 'string' && u.indexOf('http') === 0) _baseUrl = u.replace(/\/$/, '');
    else _baseUrl = FALLBACK_BASE_URL;
    return _baseUrl;
  }).catch(function () { _baseUrl = FALLBACK_BASE_URL; return _baseUrl; });
  return _baseUrlPromise;
}
const TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

// Polyfills & Helpers
// -----------------------------------------------------------------------------

// atob Polyfill
const atob = (input) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = String(input).replace(/=+$/, '');
  if (str.length % 4 === 1) throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
  let output = '';
  for (
    let bc = 0, bs, buffer, i = 0;
    (buffer = str.charAt(i++));
    ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
      ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
      : 0
  ) {
    buffer = chars.indexOf(buffer);
  }
  return output;
};

// Rot13 Cipher
const rot13Cipher = (str) => {
  return str.replace(/[a-zA-Z]/g, function (c) {
    return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
  });
};

// Levenshtein Distance
const levenshtein = {
  get: function (s, t) {
    if (s === t) {
      return 0;
    }
    var n = s.length, m = t.length;
    if (n === 0) {
      return m;
    }
    if (m === 0) {
      return n;
    }
    var d = [];
    for (var i = 0; i <= n; i++) {
      d[i] = [];
      d[i][0] = i;
    }
    for (var j = 0; j <= m; j++) {
      d[0][j] = j;
    }
    for (var i = 1; i <= n; i++) {
      for (var j = 1; j <= m; j++) {
        var cost = (s.charAt(i - 1) === t.charAt(j - 1)) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      }
    }
    return d[n][m];
  }
};

// Bytes Parser/Formatter
const bytes = {
  parse: function (val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    var match = val.match(/^([0-9.]+)\s*([a-zA-Z]+)$/);
    if (!match) return 0;
    var num = parseFloat(match[1]);
    var unit = match[2].toLowerCase();
    var multiplier = 1;
    if (unit.indexOf('k') === 0) multiplier = 1024;
    else if (unit.indexOf('m') === 0) multiplier = 1024 * 1024;
    else if (unit.indexOf('g') === 0) multiplier = 1024 * 1024 * 1024;
    else if (unit.indexOf('t') === 0) multiplier = 1024 * 1024 * 1024 * 1024;
    return num * multiplier;
  },
  format: function (val) {
    if (val === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(val) / Math.log(k));
    if (i < 0) i = 0;
    return parseFloat((val / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
};

// Fetch Helper
function fetchText(url, options) {
  options = options || {};
  return fetch(url, {
    headers: Object.assign({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }, options.headers || {})
  })
    .then(function (res) {
      return res.text();
    })
    .catch(function (err) {
      console.log('[4KHDHub] Request failed for ' + url + ': ' + err.message);
      return null;
    });
}

// -----------------------------------------------------------------------------
// Core Logic
// -----------------------------------------------------------------------------

function getTmdbDetails(tmdbId, type) {
  var isSeries = type === 'series' || type === 'tv';
  var url = 'https://api.themoviedb.org/3/' + (isSeries ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
  console.log('[4KHDHub] Fetching TMDB details from: ' + url);
  return fetch(url)
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (isSeries) {
        return {
          title: data.name,
          year: data.first_air_date ? parseInt(data.first_air_date.split('-')[0]) : 0,
          imdb_id: data.imdb_id || null
        };
      } else {
        return {
          title: data.title,
          year: data.release_date ? parseInt(data.release_date.split('-')[0]) : 0,
          imdb_id: data.imdb_id || null
        };
      }
    })
    .catch(function (error) {
      console.log('[4KHDHub] TMDB request failed: ' + error.message);
      return null;
    });
}

function fetchPageUrl(name, year, isSeries) {
  return getBaseUrl().then(function (baseUrl) {
  var searchUrl = baseUrl + '/?s=' + encodeURIComponent(name + ' ' + year);
  return fetchText(searchUrl).then(function (html) {
    if (!html) return null;
    var $ = cheerio.load(html);
    var targetType = isSeries ? 'Series' : 'Movies';

    var matchingCards = $('.movie-card')
      .filter(function (_i, el) {
        var hasFormat = $(el).find('.movie-card-format:contains("' + targetType + '")').length > 0;
        return hasFormat;
      })
      .filter(function (_i, el) {
        var metaText = $(el).find('.movie-card-meta').text();
        var movieCardYear = parseInt(metaText);
        return !isNaN(movieCardYear) && Math.abs(movieCardYear - year) <= 1;
      })
      .filter(function (_i, el) {
        var movieCardTitle = $(el).find('.movie-card-title')
          .text()
          .replace(/\[.*?]/g, '')
          .trim();
        return levenshtein.get(movieCardTitle.toLowerCase(), name.toLowerCase()) < 5;
      })
      .map(function (_i, el) {
        var href = $(el).attr('href');
        if (href && href.indexOf('http') !== 0) {
          href = baseUrl + (href.indexOf('/') === 0 ? '' : '/') + href;
        }
        return href;
      })
      .get();

    return matchingCards.length > 0 ? matchingCards[0] : null;
  });
  });
}

function resolveRedirectUrl(redirectUrl) {
  return fetchText(redirectUrl).then(function (redirectHtml) {
    if (!redirectHtml) return null;

    try {
      var redirectDataMatch = redirectHtml.match(/'o','(.*?)'/);
      if (!redirectDataMatch) return null;

      var step1 = atob(redirectDataMatch[1]);
      var step2 = atob(step1);
      var step3 = rot13Cipher(step2);
      var step4 = atob(step3);
      var redirectData = JSON.parse(step4);

      if (redirectData && redirectData.o) {
        return atob(redirectData.o);
      }
    } catch (e) {
      console.log('[4KHDHub] Error resolving redirect: ' + e.message);
    }
    return null;
  });
}

function extractSourceResults($, el) {
  // This function returns a Promise resolving to { url, meta } or null
  var localHtml = $(el).html();
  var sizeMatch = localHtml.match(/([\d.]+ ?[GM]B)/);
  var heightMatch = localHtml.match(/\d{3,}p/);

  var title = $(el).find('.file-title, .episode-file-title').text().trim();

  if (!heightMatch) {
    heightMatch = title.match(/(\d{3,4})p/i);
  }

  var height = heightMatch ? parseInt(heightMatch[0]) : 0;
  if (height === 0 && (title.indexOf('4K') !== -1 || title.indexOf('4k') !== -1 || localHtml.indexOf('4K') !== -1 || localHtml.indexOf('4k') !== -1)) {
    height = 2160;
  }

  var meta = {
    bytes: sizeMatch ? bytes.parse(sizeMatch[1]) : 0,
    height: height,
    title: title
  };

  var hubCloudLink = $(el).find('a')
    .filter(function (_i, a) { return $(a).text().indexOf('HubCloud') !== -1; })
    .attr('href');

  if (hubCloudLink) {
    return resolveRedirectUrl(hubCloudLink).then(function (resolved) {
      return { url: resolved, meta: meta };
    });
  }

  var hubDriveLink = $(el).find('a')
    .filter(function (_i, a) { return $(a).text().indexOf('HubDrive') !== -1; })
    .attr('href');

  if (hubDriveLink) {
    return resolveRedirectUrl(hubDriveLink).then(function (resolvedDrive) {
      if (resolvedDrive) {
        return fetchText(resolvedDrive).then(function (hubDriveHtml) {
          if (hubDriveHtml) {
            var $2 = cheerio.load(hubDriveHtml);
            var innerCloudLink = $2('a:contains("HubCloud")').attr('href');
            if (innerCloudLink) {
              return { url: innerCloudLink, meta: meta };
            }
          }
          return null;
        });
      }
      return null;
    });
  }

  return Promise.resolve(null);
}

// NOTE on CloudStream's "10Gbps" button (NOT ported): CloudStream resolves
// it by following redirects (pixel.hubcloud.mov -> workers.dev ->
// cryptonewz.online/dl.php?link=<direct googleusercontent URL>) and taking
// the `link=` parameter. That is plain fetch+parse and it DOES work — the
// googleusercontent file is the same 3.89 GB REMUX, HEAD 200 video/mkv.
// But the redirect chain takes 20-144 s from this sandbox (HEAD chain ~20 s,
// GET ~144 s), which would push the provider past the TV's 60 s budget and
// delay every other row. The pixeldrain HTML scan below already yields the
// same file, so the 10Gbps path is omitted deliberately. If the redirect
// hosts ever get fast, re-add it via resolveFinalUrl (HEAD, 7 hops max).
function extractHubCloud(hubCloudUrl, baseMeta) {
  if (!hubCloudUrl) return Promise.resolve([]);

  // Referer: hubCloudUrl
  return fetchText(hubCloudUrl, { headers: { Referer: hubCloudUrl } }).then(function (redirectHtml) {
    if (!redirectHtml) return [];

    var redirectUrlMatch = redirectHtml.match(/var url ?= ?'(.*?)'/);
    if (!redirectUrlMatch) return [];

    var finalLinksUrl = redirectUrlMatch[1];
    return fetchText(finalLinksUrl, { headers: { Referer: hubCloudUrl } }).then(function (linksHtml) {
      if (!linksHtml) return [];

      var $ = cheerio.load(linksHtml);
      var results = [];
      var sizeText = $('#size').text();
      var titleText = $('title').text().trim();

      var currentMeta = Object.assign({}, baseMeta, {
        bytes: bytes.parse(sizeText) || baseMeta.bytes,
        title: titleText || baseMeta.title
      });

      $('a').each(function (_i, el) {
        var text = $(el).text();
        var href = $(el).attr('href');
        if (!href) return;

        if (text.indexOf('FSL') !== -1 || text.indexOf('Download File') !== -1) {
          results.push({
            source: 'FSL',
            url: href,
            meta: currentMeta,
            referer: hubCloudUrl
          });
        }
        else if (text.indexOf('PixelServer') !== -1) {
          var pixelUrl = href.replace('/u/', '/api/file/');
          results.push({
            source: 'PixelServer',
            url: pixelUrl,
            meta: currentMeta,
            referer: hubCloudUrl
          });
        }
      });
      // Pixeldrain HTML scan (CloudStream HubCloud pixeldrain branch):
      // the "Download [PixelServer: N]" button links ONE pixeldrain id,
      // which may be deleted, while the page HTML names other live ids
      // (e.g. C9sjCnPc for Young Sheldon S01E01). Scan the page for
      // pixeldrain /u/<id> ids and add each as a PixelServer row; the
      // liveness check below drops dead ones.
      var seenPixel = {};
      results.forEach(function (r) {
        if (r.source === 'PixelServer') {
          var pid0 = r.url.split('/api/file/')[1];
          if (pid0) seenPixel[pid0.split('/')[0].split('?')[0]] = 1;
        }
      });
      var pixRe = /https?:\/\/pixeldrain\.[a-z]+\/u\/([a-zA-Z0-9]+)/g, pm;
      while ((pm = pixRe.exec(linksHtml)) !== null) {
        var pid2 = pm[1];
        if (!pid2 || seenPixel[pid2]) continue;
        seenPixel[pid2] = 1;
        results.push({
          source: 'PixelServer',
          url: 'https://pixeldrain.dev/api/file/' + pid2,
          meta: currentMeta,
          referer: hubCloudUrl
        });
      }
      // PixelServer liveness: pixeldrain /api/file/<id>/info answers
      // success:false (404) for deleted files — those can never play, so drop
      // them. Any check error keeps the row (fail open).
      var checks = results.map(function (r) {
        if (r.source !== 'PixelServer') return Promise.resolve(r);
        var id = r.url.split('/api/file/')[1];
        id = id ? id.split('/')[0].split('?')[0] : '';
        if (!id) return Promise.resolve(r);
        return fetchText('https://pixeldrain.dev/api/file/' + id + '/info').then(function (txt) {
          try {
            var j = JSON.parse(txt || '{}');
            if (j && j.success === false) return null;
          } catch (e) {}
          return r;
        }).catch(function () { return r; });
      });
      return Promise.all(checks).then(function (checked) {
        return checked.filter(function (r) { return !!r; });
      });
    });
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
        if (hit) rows[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
      }
      return cleanup();
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

function getStreams(tmdbId, type, season, episode) {
  return getTmdbDetails(tmdbId, type).then(function (tmdbDetails) {
    if (!tmdbDetails) return [];

    var title = tmdbDetails.title;
    var year = tmdbDetails.year;
    var imdbId = tmdbDetails.imdb_id;
    console.log('[4KHDHub] Search: ' + title + ' (' + year + ')');

    var isSeries = type === 'series' || type === 'tv';
    return fetchPageUrl(title, year, isSeries).then(function (pageUrl) {
      if (!pageUrl) {
        console.log('[4KHDHub] Page not found');
        return [];
      }
      console.log('[4KHDHub] Found page: ' + pageUrl);

      return fetchText(pageUrl).then(function (html) {
        if (!html) return [];
        var $ = cheerio.load(html);

        var itemsToProcess = [];

        if (isSeries && season && episode) {
          // Find specific season and episode
          var seasonStr = 'S' + String(season).padStart(2, '0');
          var episodeStr = 'Episode-' + String(episode).padStart(2, '0');

          $('.episode-item').each(function (_i, el) {
            if ($('.episode-title', el).text().indexOf(seasonStr) !== -1) {
              var downloadItems = $('.episode-download-item', el)
                .filter(function (_j, item) { return $(item).text().indexOf(episodeStr) !== -1; });

              downloadItems.each(function (_k, item) {
                itemsToProcess.push(item);
              });
            }
          });
        } else {
          // Movies
          $('.download-item').each(function (_i, el) {
            itemsToProcess.push(el);
          });
        }

        console.log('[4KHDHub] Processing ' + itemsToProcess.length + ' items');

        var streamPromises = itemsToProcess.map(function (item) {
          return extractSourceResults($, item)
            .then(function (sourceResult) {
              if (sourceResult && sourceResult.url) {
                console.log('[4KHDHub] Extracting from HubCloud: ' + sourceResult.url);
                return extractHubCloud(sourceResult.url, sourceResult.meta).then(function (extractedLinks) {
                  return extractedLinks.map(function (link) {
                    var streamSize = formatStreamSize({
                      source: '4KHDHub', title: title, year: year,
                      quality: sourceResult.meta.height ? sourceResult.meta.height + 'p' : undefined,
                      season: isSeries ? season : undefined, episode: isSeries ? episode : undefined,
                      size: link.meta.bytes ? bytes.format(link.meta.bytes) : undefined,
                      server: link.source, url: link.url
                    });
                    var hdrs = {
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                    };
                    // Worker file hosts gate on UA + Referer together (header-gate
                    // test 2026-11-18, PHM DarQ row): bare -> 403, UA-only ->
                    // 403, Referer-only -> 403, UA+Referer -> 206. The
                    // Referer must be the HubCloud DRIVE url (hubcloud.mov/
                    // drive/<id>) — the resolved gamerxyt.com page url 403s
                    // then 206s (flaky) and the bare site domains 403. Plain
                    // `headers` alone did NOT reach the player (device 403 on
                    // phone + Fire TV), so deliver the same pair through
                    // behaviorHints.proxyHeaders too (MovieBox pattern).
                    if (link.referer) hdrs.Referer = link.referer;
                    return {
                      name: '4KHDHub',
                      title: '4KHDHub',
                      size: streamSize,
                      url: link.url,
                      quality: sourceResult.meta.height ? sourceResult.meta.height + 'p' : undefined,
                      headers: hdrs,
                      behaviorHints: {
                        bingeGroup: '4khdhub-' + link.source,
                        proxyHeaders: { request: hdrs }
                      },
                      // Temp only: the file's release title, for subtitle
                      // matching. Removed before the rows are returned.
                      _releaseTitle: (link.meta && link.meta.title) || (sourceResult.meta && sourceResult.meta.title) || ''
                    };
                  });
                });
              }
              return [];
            })
            .catch(function (err) {
              console.log('[4KHDHub] Item processing error: ' + err.message);
              return [];
            });
        });

        return Promise.all(streamPromises).then(function (results) {
          // Flatten results
          var rows = results.reduce(function (acc, val) { return acc.concat(val); }, []);
          // Attach a release-matched English subtitle per row from the
          // Infinite Subtitles addon (best effort — never fails the list).
          // imdbId is in scope from TMDB.
          return osAttachSubtitles(rows, imdbId, isSeries, season, episode, {
            osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
            subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
            subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
            year: year
          });
        });
      });
    });
  });
}

// Export for React Native compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
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
