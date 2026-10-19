/*
 * Goojara Nuvio Provider
 * Source: goojara.to (ww1.goojara.to)
 *
 * Flow:
 * 1. GET homepage -> extract dynamic _3chk('name','value') cookie
 * 2. POST /xmre.php (z={data-ins}&x=bcb23b0360&q={query}) -> search results
 * 3. Movie: /mXXXX page -> go.php?url= links
 *    TV: /tXXXX page -> /eXXXX episode -> go.php?url= links
 * 4. Follow go.php redirect -> embed URL (wootly/luluvdo)
 * 5. Luluvdo/Dood: fetch page -> unpack Dean Edwards packed JS -> extract m3u8
 */

var BASE = 'https://ww1.goojara.to';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var TMDB_KEY = '5f39fd16e987a9e3fce30d55cf09b438';

// Session state
var sessionCookie = null; // {name, value}

function fetchWithTimeout(url, opts, timeout) {
  opts = opts || {};
  // AbortController removed for Nuvio QuickJS compatibility
  opts.headers = opts.headers || {};
  if (!opts.headers['User-Agent']) opts.headers['User-Agent'] = UA;
  var fetchP = fetch(url, opts);
  var timeoutP = new Promise(function(_, rej) {
    setTimeout(function() { rej(new Error('Timeout')); }, timeout || 15000);
  });
  return Promise.race([fetchP, timeoutP]);
}

function getText(url, opts, timeout) {
  return fetchWithTimeout(url, opts, timeout).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  });
}

// ─── Session / Cookie Bypass ─────────────────────────────────────────────

function ensureSession() {
  if (sessionCookie) return Promise.resolve(sessionCookie);
  // Capture Set-Cookie headers from homepage + JS challenge cookie
  // AbortController removed for Nuvio QuickJS compatibility
  return fetch(BASE + '/', {
    headers: { 'Accept': 'text/html', 'User-Agent': UA }
  }).then(function (res) {
    // Collect server-set cookies
    var serverCookies = [];
    // getSetCookie is the standard way; fall back to parsing
    if (res.headers.getSetCookie) {
      res.headers.getSetCookie().forEach(function (sc) {
        var kv = sc.split(';')[0].trim();
        if (kv) serverCookies.push(kv);
      });
    } else {
      var sc = res.headers.get('set-cookie');
      if (sc) {
        // May contain multiple cookies; split carefully
        sc.split(/,(?=[^;,]+=)/).forEach(function (part) {
          var kv = part.split(';')[0].trim();
          if (kv && kv.indexOf('=') !== -1) serverCookies.push(kv);
        });
      }
    }
    return res.text().then(function (html) {
      var m = /_3chk\('([^']+)','([^']+)'\)/.exec(html);
      if (!m) throw new Error('Goojara: cookie challenge not found');
      var dins = /data-ins="(\d+)"/.exec(html);
      // Combine server cookies + JS challenge cookie
      serverCookies.push(m[1] + '=' + m[2]);
      sessionCookie = {
        name: m[1], value: m[2],
        dataIns: dins ? dins[1] : '',
        cookieStr: serverCookies.join('; ')
      };
      return sessionCookie;
    });
  }).catch(function (e) {
    clearTimeout(timer);
    throw e;
  });
}

function cookieHeader() {
  return sessionCookie.cookieStr || (sessionCookie.name + '=' + sessionCookie.value);
}

// ─── Search ──────────────────────────────────────────────────────────────

function searchGoojara(query) {
  return ensureSession().then(function (sess) {
    var body = 'z=' + encodeURIComponent(sess.dataIns) +
      '&x=bcb23b0360' +
      '&q=' + encodeURIComponent(query);
    // Note: Do NOT set Cookie header manually. Nuvio's fetch handles
    // server cookies (PHPSESSID) automatically. We append the _3chk
    // challenge cookie via a separate mechanism below.
    var headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': BASE + '/',
      'X-Requested-With': 'XMLHttpRequest'
    };
    // Only add _3chk manually if we have it; server cookies are automatic
    if (sess.name && sess.value) {
      headers['Cookie'] = sess.name + '=' + sess.value;
    }
    return fetchWithTimeout(BASE + '/xmre.php', {
      method: 'POST',
      headers: headers,
      body: body
    }, 10000);
  }).then(function (res) {
    if (!res.ok) throw new Error('Search HTTP ' + res.status);
    return res.text();
  }).then(function (html) {
    var results = [];
    // <li><a href="/mXXXX"><div class="im"><strong>Title</strong> (Year)
    // <li><a href="/tXXXX"><div class="it"><strong>Title</strong> (Year)
    var re = /<a href="(\/[mte][A-Za-z0-9]+)">\s*<div class="i[mt]">\s*<strong>([^<]+)<\/strong>\s*\((\d{4})\)/g;
    var m;
    while ((m = re.exec(html))) {
      results.push({
        href: m[1],
        title: m[2].trim(),
        year: m[3],
        type: m[1].charAt(1) === 'm' ? 'movie' : (m[1].charAt(1) === 't' ? 'tv' : 'episode')
      });
      if (results.length >= 10) break;
    }
    return results;
  });
}

function normTitle(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findBest(results, title, year, wantType) {
  var nt = normTitle(title);
  var best = null, bestScore = 0;
  // TV requires stricter matching to avoid mismatches
  var threshold = wantType === 'tv' ? 70 : 40;
  results.forEach(function (r) {
    if (wantType && r.type !== wantType && r.type !== 'episode') return;
    var score = 0;
    var rn = normTitle(r.title);
    if (rn === nt) score = 100;
    else if (rn.indexOf(nt) === 0 || nt.indexOf(rn) === 0) score = 80;
    else {
      var words = nt.split(' ').filter(function (w) { return w.length >= 3; });
      var matched = words.filter(function (w) { return rn.indexOf(w) !== -1; }).length;
      if (words.length) score = Math.round((matched / words.length) * 70);
      // For TV: all significant words must match (no partial)
      if (wantType === 'tv' && matched < words.length) score = 0;
    }
    if (score > 0 && year && r.year) {
      if (Math.abs(parseInt(r.year) - parseInt(year)) <= 1) score += 10;
      else score = 0; // Year mismatch = reject for TV
    }
    if (score > bestScore) { bestScore = score; best = r; }
  });
  return bestScore >= threshold ? best : null;
}

// ─── Embed Extraction ────────────────────────────────────────────────────

function getGoPhpLinks(pageUrl) {
  return getText(pageUrl, {
    headers: { 'Referer': BASE + '/', 'Cookie': cookieHeader() }
  }, 10000).then(function (html) {
    var links = [];
    var re = /href="(https?:\/\/[^"]*go\.php\?url=[^"]+)"/g;
    var m;
    while ((m = re.exec(html))) {
      if (links.indexOf(m[1]) === -1) links.push(m[1]);
    }
    return { links: links, html: html };
  });
}

function followGoPhp(goUrl, referer) {
  // Don't auto-follow; we need the Location header
  // AbortController removed for Nuvio QuickJS compatibility
  return fetch(goUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'User-Agent': UA,
      'Referer': referer,
      'Cookie': cookieHeader()
    }
  }).then(function (res) {
    clearTimeout(timer);
    var loc = res.headers.get('location');
    if (loc) return loc;
    // If no redirect, try reading body for meta refresh or JS redirect
    return res.text().then(function (html) {
      var m = /<meta[^>]+http-equiv="refresh"[^>]+url=([^">]+)/i.exec(html) ||
              /window\.location\s*=\s*["']([^"']+)["']/.exec(html);
      return m ? m[1] : null;
    });
  }).catch(function (e) {
    clearTimeout(timer);
    throw e;
  });
}

// ─── Dean Edwards Unpacker (pure JS, no eval) ────────────────────────────

function unpackDeanEdwards(packed) {
  // Match: eval(function(p,a,c,k,e,d){...}( 'p', a, c, 'k'.split('|') ))
  // Or the standard: }('...',62,68,'...'.split('|'),0,{})
  var m = /\}\('(.*)',(\d+),(\d+),'(.*)'\.split\('\|'\)/.exec(packed.replace(/\n/g, ''));
  if (!m) return null;
  var p = m[1], a = parseInt(m[2], 10), c = parseInt(m[3], 10);
  var k = m[4].split('|');
  // Unescape
  p = p.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  function toBase(n) {
    var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (a <= 36) return n.toString(a);
    var s = '';
    do { s = chars[n % a] + s; n = Math.floor(n / a); } while (n > 0);
    return s;
  }
  while (c--) {
    if (k[c]) {
      var word = toBase(c);
      p = p.replace(new RegExp('\\b' + word + '\\b', 'g'), k[c]);
    }
  }
  return p;
}

function extractM3u8FromLuluvdo(embedUrl) {
  return getText(embedUrl, {
    headers: { 'Referer': BASE + '/' }
  }, 10000).then(function (html) {
    // Find packed script
    var scripts = [];
    var re = /<script[^>]*>([\s\S]*?)<\/script>/g;
    var m;
    while ((m = re.exec(html))) scripts.push(m[1]);

    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      if (s.indexOf('eval(function(p,a,c,k,e,d)') !== -1) {
        var unpacked = unpackDeanEdwards(s);
        if (unpacked) {
          var mu = /(https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*)/.exec(unpacked);
          if (mu) {
            // Unescape
            var url = mu[1].replace(/\\/g, '');
            return { url: url, source: 'Luluvdo' };
          }
        }
      }
    }
    // Fallback: look for m3u8 directly in HTML
    var dm = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/.exec(html);
    if (dm) return { url: dm[1], source: 'Luluvdo' };
    // Last resort: return embed URL itself (player might handle it)
    return { url: embedUrl, source: 'Luluvdo-embed' };
  }).catch(function () { return null; });
}

function resolveEmbed(embedUrl, referer) {
  if (/luluvdo\.com|dood|d000d/.test(embedUrl)) {
    return extractM3u8FromLuluvdo(embedUrl);
  }
  if (/wootly/.test(embedUrl)) {
    // Wootly embed: return the URL directly, Nuvio can try to play it
    // (the web player needs JS, but the embed URL itself may work)
    return Promise.resolve(embedUrl);
  }
  // Unknown embed: return as-is (might be direct)
  return Promise.resolve(null);
}

// ─── TV Episode ──────────────────────────────────────────────────────────

function findEpisode(tvPageUrl, season, episode) {
  return getText(tvPageUrl, {
    headers: { 'Referer': BASE + '/', 'Cookie': cookieHeader() }
  }, 10000).then(function (html) {
    // Get show ID for season AJAX: <div id="seon" data-id="157860">
    var idM = /id="seon"[^>]*data-id="(\d+)"/.exec(html);
    if (!idM) return null;
    var showId = idM[1];
    // POST /xmre.php s={season}&t={show_id} to get season episodes
    var body = "s=" + encodeURIComponent(season) + "&t=" + encodeURIComponent(showId);
    return fetchWithTimeout(BASE + "/xmre.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": tvPageUrl,
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookieHeader()
      },
      body: body
    }, 10000).then(function (res) {
      if (!res.ok) throw new Error("Season HTTP " + res.status);
      return res.text();
    });
  }).then(function (html) {
    if (!html) return null;
    // Exact structure in season response:
    // <div class="seho"><div class="seep"><span class="sea"> 1</span><span>Season 1</span></div>
    // <div class="snfo"><h1><a href="/eXXXX">Title</a></h1>
    var re = /<div class="seho">[\s\S]*?<span class="sea">\s*(\d+)\s*<\/span>\s*<span>Season\s*(\d+)<\/span>[\s\S]*?<a href="(\/e[A-Za-z0-9]+)"/g;
    var m;
    while ((m = re.exec(html))) {
      var epNum = parseInt(m[1], 10);
      var seaNum = parseInt(m[2], 10);
      if (seaNum === season && epNum === episode) {
        return BASE + m[3]; // EXACT match only
      }
    }
    return null; // No exact match -> return nothing (no mismatches)
  }).catch(function () { return null; });
}

// ─── TMDB ────────────────────────────────────────────────────────────────

function tmdb(path) {
  return fetchWithTimeout('https://api.themoviedb.org/3' + path +
    (path.indexOf('?') === -1 ? '?' : '&') + 'api_key=' + TMDB_KEY, {}, 10000)
    .then(function (r) { return r.json(); });
}

// ─── Main ────────────────────────────────────────────────────────────────

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var isTV = mediaType === 'tv' || mediaType === 'series';
  var meta, imdbId;

  return tmdb('/movie/' + tmdbId).catch(function () {
    return tmdb('/tv/' + tmdbId);
  }).then(function (d) {
    meta = d;
    return tmdb('/' + (d && d.title ? 'movie' : 'tv') + '/' + tmdbId + '/external_ids');
  }).then(function (ext) {
    imdbId = ext.imdb_id;
    var title = meta.title || meta.name;
    var year = (meta.release_date || meta.first_air_date || '').slice(0, 4);
    return searchGoojara(title);
  }).then(function (results) {
    var title = meta.title || meta.name;
    var year = (meta.release_date || meta.first_air_date || '').slice(0, 4);
    var wantType = isTV ? 'tv' : 'movie';
    var best = findBest(results, title, year, wantType);
    if (!best) return [];
    var pageUrl = BASE + best.href;

    if (!isTV) {
      return getGoPhpLinks(pageUrl).then(function (r) {
        return resolveAllEmbeds(r.links, pageUrl, title + ' (' + best.year + ')');
      });
    } else {
      return findEpisode(pageUrl, seasonNum, episodeNum).then(function (epUrl) {
        if (!epUrl) return [];
        return getGoPhpLinks(epUrl).then(function (r) {
          return resolveAllEmbeds(r.links, epUrl,
            title + ' S' + seasonNum + 'E' + episodeNum);
        });
      });
    }
  }).catch(function () { return []; });
}

function resolveAllEmbeds(goLinks, referer, label) {
  var chain = Promise.resolve([]);
  // Try first 3 embeds to avoid timeouts (was 1, increased for reliability)
  goLinks.slice(0, 3).forEach(function (goUrl) {
    chain = chain.then(function (streams) {
      return followGoPhp(goUrl, referer).then(function (embedUrl) {
        if (!embedUrl) return streams;
        return resolveEmbed(embedUrl, referer).then(function (resolved) {
          if (resolved && resolved.url) {
            streams.push({
              name: 'Goojara',
              title: resolved.source + ' ' + label,
              url: resolved.url,
              quality: 'Unknown',
              type: 'direct'
            });
          }
          return streams;
        });
      }).catch(function () { return streams; });
    });
  });
  return chain;
}

module.exports = { getStreams: getStreams };
