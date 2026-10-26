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
const BASE_URL = 'https://4khdhub.fans';
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
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
          year: data.first_air_date ? parseInt(data.first_air_date.split('-')[0]) : 0
        };
      } else {
        return {
          title: data.title,
          year: data.release_date ? parseInt(data.release_date.split('-')[0]) : 0
        };
      }
    })
    .catch(function (error) {
      console.log('[4KHDHub] TMDB request failed: ' + error.message);
      return null;
    });
}

function fetchPageUrl(name, year, isSeries) {
  var searchUrl = BASE_URL + '/?s=' + encodeURIComponent(name + ' ' + year);
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
          href = BASE_URL + (href.indexOf('/') === 0 ? '' : '/') + href;
        }
        return href;
      })
      .get();

    return matchingCards.length > 0 ? matchingCards[0] : null;
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
            referer: finalLinksUrl
          });
        }
        else if (text.indexOf('PixelServer') !== -1) {
          var pixelUrl = href.replace('/u/', '/api/file/');
          results.push({
            source: 'PixelServer',
            url: pixelUrl,
            meta: currentMeta,
            referer: finalLinksUrl
          });
        }
      });
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

function getStreams(tmdbId, type, season, episode) {
  return getTmdbDetails(tmdbId, type).then(function (tmdbDetails) {
    if (!tmdbDetails) return [];

    var title = tmdbDetails.title;
    var year = tmdbDetails.year;
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
                    var streamLabel = formatStreamLabel({
                      source: '4KHDHub', title: title,
                      quality: sourceResult.meta.height ? sourceResult.meta.height + 'p' : undefined,
                      season: isSeries ? season : undefined, episode: isSeries ? episode : undefined,
                      size: link.meta.bytes ? bytes.format(link.meta.bytes) : undefined,
                      server: link.source, url: link.url
                    });
                    var hdrs = {
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    };
                    // Worker file hosts gate on the generation page as Referer:
                    // without it every Worker URL answers 403 and nothing plays.
                    if (link.referer) hdrs.Referer = link.referer;
                    return {
                      name: streamLabel,
                      title: streamLabel,
                      url: link.url,
                      quality: sourceResult.meta.height ? sourceResult.meta.height + 'p' : undefined,
                      headers: hdrs,
                      behaviorHints: {
                        bingeGroup: '4khdhub-' + link.source
                      }
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
          return results.reduce(function (acc, val) { return acc.concat(val); }, []);
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
