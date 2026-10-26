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

// NetMirror - REPLACED per user direction (2026-10-21) with the
// community build the user supplied and device-verified for playback
// (net52.cc mobile chain: verified-cookie session, playlist HLS with
// WebView playback headers). Adaptations for this plugin only:
// timer-free delay, regex host parsing (no new URL), guarded
// String.normalize, v5 fetch prelude + chain-retry postlude.
/**
 * netmirror - Built from src/netmirror/
 * Generated: 2026-09-26T18:41:31.637Z
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/netmirror/constants.js
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var PLATFORM_MAP = {
  netflix: {
    ott: "nf",
    search: "/mobile/search.php",
    post: "/mobile/post.php",
    episodes: "/mobile/episodes.php",
    playlist: "/mobile/playlist.php",
    img: "poster/v",
    epImg: "epimg/150"
  },
  primevideo: {
    ott: "pv",
    search: "/mobile/pv/search.php",
    post: "/mobile/pv/post.php",
    episodes: "/mobile/pv/episodes.php",
    playlist: "/mobile/pv/playlist.php",
    img: "pv/v",
    epImg: "pvepimg"
  },
  hotstar: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php",
    img: "hs/v",
    epImg: "hsepimg"
  },
  disney: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php",
    img: "hs/v",
    epImg: "hsepimg"
  }
};
var BASE_HEADERS = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
  "Cache-Control": "max-age=0",
  "Connection": "keep-alive",
  "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Android WebView";v="144"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Android"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36 /OS.Gatu v3.0",
  "X-Requested-With": "XMLHttpRequest"
};

// src/netmirror/utils.js
var COOKIE_TTL = 54e6;
var VERIFY_ATTEMPTS = 3;
var VERIFY_DELAY = 1e4;
var VERIFY_FAIL_TTL = 300000;
var verifyFailedAt = 0;
var APP_USER_AGENT = "Mozilla/5.0 (Linux; Android 12; RMX2117 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/147.0.7727.55 Mobile Safari/537.36 /OS.Gatu v3.0";
var cookieValue = "";
var cookieTimestamp = 0;
var cookieJar = [];
var delayModeLogged = false;
function hostOf(u) {
  var m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(String(u || ""));
  return m ? m[1].toLowerCase() : "";
}
function setCookieValues(headers) {
  var _a, _b;
  if (!headers)
    return [];
  if (typeof headers.getSetCookie === "function") {
    try {
      return headers.getSetCookie();
    } catch (e) {
    }
  }
  const raw = ((_a = headers.get) == null ? void 0 : _a.call(headers, "set-cookie")) || ((_b = headers.get) == null ? void 0 : _b.call(headers, "Set-Cookie")) || "";
  return raw.split(/,(?=\s*[^;,\s]+=)/g).map((value) => value.trim()).filter(Boolean);
}
function rememberResponseCookies(headers, responseUrl) {
  const host = hostOf(responseUrl);
  for (const raw of setCookieValues(headers)) {
    const pair = raw.split(";", 1)[0];
    const equals = pair.indexOf("=");
    if (equals <= 0)
      continue;
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    const domainMatch = raw.match(/(?:^|;)\s*domain=([^;]+)/i);
    const domain = (domainMatch ? domainMatch[1] : host).trim().replace(/^\./, "").toLowerCase();
    const index = cookieJar.findIndex((cookie2) => cookie2.name === name && cookie2.domain === domain);
    if (/max-age\s*=\s*0/i.test(raw) || !value) {
      if (index >= 0)
        cookieJar.splice(index, 1);
      continue;
    }
    const cookie = { name, value, domain };
    if (index >= 0)
      cookieJar[index] = cookie;
    else
      cookieJar.push(cookie);
  }
}
function cookieHeaderFor(url) {
  const host = hostOf(url);
  return cookieJar.filter((cookie) => host === cookie.domain || host.endsWith(`.${cookie.domain}`)).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
function request(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const headers = __spreadValues({}, options.headers || {});
    const cookieHeader = cookieHeaderFor(url);
    if (cookieHeader)
      headers.Cookie = cookieHeader;
    const response = yield fetch(url, __spreadProps(__spreadValues({}, options), { headers }));
    rememberResponseCookies(response.headers, response.url || url);
    return response;
  });
}
function getCookie(name) {
  var _a;
  return ((_a = cookieJar.find((cookie) => cookie.name === name)) == null ? void 0 : _a.value) || "";
}
function logDelayMode(mode) {
  if (delayModeLogged)
    return;
  delayModeLogged = true;
  console.log(`[NetMirror] Delay implementation: ${mode}`);
}
function delay(ms) {
  // Timer-free spin (the TV QuickJS guest has no setTimeout/Atomics);
  // the verification polling below needs real elapsed time to pass.
  var deadline = Date.now() + ms;
  while (Date.now() < deadline) {
  }
  return Promise.resolve();
}
function bypass(mainUrl) {
  return __async(this, null, function* () {
    var _a;
    if (cookieValue && Date.now() - cookieTimestamp < COOKIE_TTL)
      return cookieValue;
    /* 2026-10-24 (netmirror10): when verification cannot complete, do not
       pay the poll cost on every platform - one failed cycle covers the
       whole search for 5 minutes. Unverified search + playlist still
       serve movies (see the post fallback below), so a failed cycle must
       be cheap, not 70s x 4 platforms. */
    if (verifyFailedAt && Date.now() - verifyFailedAt < VERIFY_FAIL_TTL)
      return "";
    const base = String(mainUrl || "https://net52.cc").replace(/\/$/, "");
    const homeUrl = `${base}/mobile/home?app=1`;
    const appHeaders = {
      "User-Agent": APP_USER_AGENT,
      "X-Requested-With": "app.netmirror.netmirrornew"
    };
    try {
      console.log("[NetMirror] Starting mobile cookie verification...");
      cookieJar = [];
      const homeResponse = yield request(homeUrl, { headers: appHeaders });
      const homeHtml = yield homeResponse.text();
      if (!homeResponse.ok)
        throw new Error(`Mobile home returned HTTP ${homeResponse.status}`);
      const addhash = (_a = homeHtml.match(/data-addhash\s*=\s*["']([^"']+)["']/i)) == null ? void 0 : _a[1];
      if (!addhash)
        throw new Error("NetMirror mobile home did not provide data-addhash");
      const userverUrl = `https://userver.net52.cc/?hee5=${encodeURIComponent(addhash)}&a=y&t=${Math.random()}`;
      /* The click-registration host is currently dead (connection reset,
         no HTTP response) - without it verify2 can never say "All Done",
         so polling is futile. Fail fast instead of burning the poll
         loop: a thrown or non-2xx userver answer ends verification for
         this search. A 2xx answer still proceeds to the poll loop, so a
         recovered userver resumes normal verification. */
      let userverResponse = null;
      try {
        userverResponse = yield request(userverUrl, { headers: appHeaders });
      } catch (e) {
        userverResponse = null;
      }
      if (!userverResponse || !userverResponse.ok) {
        verifyFailedAt = Date.now();
        console.log("[NetMirror] Click-registration host unreachable; skipping cookie verification.");
        return "";
      }
      yield userverResponse.text();
      const verifyUrl = `${base}/mobile/verify2.php`;
      const verifyHeaders = {
        "User-Agent": APP_USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded"
      };
      for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
        yield delay(VERIFY_DELAY);
        const response = yield request(verifyUrl, {
          method: "POST",
          headers: verifyHeaders,
          body: `verify=${encodeURIComponent(addhash)}`
        });
        const text = yield response.text();
        let allDone = text.includes('"statusup":"All Done"');
        if (!allDone) {
          try {
            allDone = JSON.parse(text).statusup === "All Done";
          } catch (e) {
          }
        }
        if (!allDone) {
          console.log(`[NetMirror] Cookie verification pending (attempt ${attempt}/${VERIFY_ATTEMPTS}).`);
          continue;
        }
        const verifiedCookie = getCookie("t_hash_t");
        if (!verifiedCookie)
          throw new Error("Verification completed without a t_hash_t cookie");
        cookieValue = verifiedCookie;
        cookieTimestamp = Date.now();
        console.log("[NetMirror] Mobile cookie verified.");
        return cookieValue;
      }
      throw new Error("Mobile verification did not complete; NetMirror may be waiting for an ad click");
    } catch (error) {
      cookieValue = "";
      cookieTimestamp = 0;
      verifyFailedAt = Date.now();
      console.error("[NetMirror] Mobile cookie verification failed:", error.message);
      return "";
    }
  });
}

// src/netmirror/index.js
/* __NETMIRROR11__ (2026-10-24): full remake from the user's Stremio addon
   (Infinite Streams NetMirror provider). Three branches, in order:
   1. net27.cc embed API (TMDB-keyed, no session, no search): direct MP4 +
      resolution variants. This is the addon's primary path.
   2. NewTV API (discovered via mobidetect* /checknewtv.php token_hash):
      title search -> post -> episodes -> one-time player link. The addon
      takes the FIRST search result; this port applies the house exact
      gate instead (normalized title equality, zero mismatch tolerance).
   3. net52.cc mobile chain (the netmirror10 fallback, kept verbatim):
      verified-cookie session + search/post/playlist. This is the proven
      Matrix path - dropping it would regress Matrix, which the embed API
      does not carry (noSource) and NewTV currently does not serve
      (discovered host answers 403 "Page Not Found" on /newtv/*).
   Playback headers are preserved exactly as the addon ships them
   (embed: Referer videodownloader.site/ + UA; NewTV: player referer + UA;
   net52: the WebView header set). NOTE: the embed file host answers 426
   to datacenter IPs, so sandbox byte-fetching cannot prove playback -
   the device press-play verdict is the playback proof, as always. */
var NM_EMBED_BASE = "https://net27.cc";
var NM_STREAM_REFERER = "https://videodownloader.site/";
var NM_NEWTV_DOMAINS = ["https://mobiledetects.com", "https://mobiledetect.app", "https://mobidetect.art", "https://mobidetect.cc", "https://mobidetect.click", "https://mobidetect.ink", "https://mobidetect.live", "https://mobidetect.pro", "https://mobidetect.shop", "https://mobidetect.site", "https://mobidetect.space", "https://mobidetect.store", "https://mobidetect.vip", "https://mobidetect.wiki", "https://mobidetect.xyz"];
var nmResolvedApi = "";
var nmUaIndex = 0;
var nmUaPool = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"];
function nmNextUA() { return nmUaPool[nmUaIndex++ % nmUaPool.length]; }
function nmNorm(s) { var v = String(s || "").toLowerCase(); try { v = v.normalize("NFD"); } catch (e) {} return v.replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function nmB64Decode(s) { try { if (typeof atob === "function") return atob(s); } catch (e) {} return ""; }
function nmJson(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).catch(function () { return null; });
}
function nmEmbed(tmdbId, mediaType, season, episode, title) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var url = NM_EMBED_BASE + "/api/embed-tmdb/" + tmdbId + (type === "tv" ? ("?type=tv&se=" + (season || 1) + "&ep=" + (episode || 1)) : "");
  return nmJson(url, { "Accept": "application/json, text/plain, */*", "Referer": NM_EMBED_BASE + "/", "User-Agent": nmNextUA(), "Accept-Language": "en-US,en;q=0.9" }).then(function (d) {
    if (!d || d.ok !== true) return [];
    var headers = { "Referer": NM_STREAM_REFERER, "User-Agent": nmNextUA() };
    var disp = title || "NetMirror";
    var out = [];
    (d.streams || []).forEach(function (st) {
      if (!st || !st.url) return;
      var q = st.resolution ? (st.resolution + "p") : "Auto";
      var lbl = formatStreamLabel({ source: "NetMirror", title: title, quality: q,
        season: mediaType === "tv" ? season : undefined, episode: mediaType === "tv" ? episode : undefined,
        server: "Netflix", url: st.url });
      out.push({ name: lbl, title: lbl, url: st.url, quality: q, headers: headers });
    });
    if (out.length) return out;
    if (d.mp4) {
      var mlbl = formatStreamLabel({ source: "NetMirror", title: title, quality: "Auto",
        season: mediaType === "tv" ? season : undefined, episode: mediaType === "tv" ? episode : undefined,
        server: "Netflix", url: d.mp4 });
      return [{ name: mlbl, title: mlbl, url: d.mp4, quality: "Auto", headers: headers }];
    }
    return [];
  });
}
function nmNewTvApi() {
  if (nmResolvedApi) return Promise.resolve(nmResolvedApi);
  var i = 0;
  function next() {
    if (i >= NM_NEWTV_DOMAINS.length) return Promise.resolve("");
    var dom = NM_NEWTV_DOMAINS[i++];
    return nmJson(dom + "/checknewtv.php", { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0", "X-Requested-With": "NetmirrorNewTV v1.0", "Accept": "application/json, text/plain, */*", "Ott": "nf", "User-Agent": nmNextUA(), "Accept-Language": "en-US,en;q=0.9" }).then(function (d) {
      var th = d && d.token_hash;
      var api = th ? nmB64Decode(th).replace(/\/$/, "") : "";
      if (api) { nmResolvedApi = api; return api; }
      return next();
    });
  }
  return next();
}
function nmNewTvHeaders(ott, extra) {
  var h = { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0", "X-Requested-With": "NetmirrorNewTV v1.0", "Accept": "application/json, text/plain, */*", "Ott": ott, "User-Agent": nmNextUA(), "Accept-Language": "en-US,en;q=0.9" };
  if (extra) { for (var k in extra) h[k] = extra[k]; }
  return h;
}
function nmParseNum(v) {
  if (v === undefined || v === null) return null;
  var n = parseInt(String(v).replace(/\D/g, ""), 10);
  return isFinite(n) ? n : null;
}
function nmSeasonOf(ep, fallbackSeason) {
  var s = nmParseNum(ep.sNum);
  if (s !== null) return s;
  s = nmParseNum(ep.s);
  if (s !== null) return s;
  if (ep.info) {
    for (var i = 0; i < ep.info.length; i++) {
      var m = /S(\d+)/i.exec(String(ep.info[i]));
      if (m) return parseInt(m[1], 10);
    }
  }
  return fallbackSeason;
}
function nmNewTvEpisode(api, ott, post, season, episode) {
  function findIn(eps) {
    for (var i = 0; i < (eps || []).length; i++) {
      var ep = eps[i];
      if (!ep || !ep.id) continue;
      if (nmSeasonOf(ep, season) === season && nmParseNum(ep.ep !== undefined ? ep.ep : ep.epNum) === episode) return ep.id;
    }
    return null;
  }
  var found = findIn(post.episodes);
  if (found) return Promise.resolve(found);
  var seasons = post.season || [];
  var targetSeasonId = null;
  for (var si = 0; si < seasons.length; si++) {
    var label = seasons[si].s || "";
    var lm = /season\s*(\d+)/i.exec(label);
    var num = lm ? parseInt(lm[1], 10) : (si + 1);
    if (num === season && seasons[si].id) { targetSeasonId = seasons[si].id; break; }
  }
  if (!targetSeasonId) return Promise.resolve(null);
  var page = 1;
  function nextPage() {
    if (page > 10) return Promise.resolve(null);
    var p = page++;
    return nmJson(api + "/newtv/episodes.php?id=" + encodeURIComponent(targetSeasonId) + "&page=" + p, nmNewTvHeaders(ott)).then(function (data) {
      if (!data) return null;
      var f = findIn(data.episodes);
      if (f) return f;
      if (data.nextPageShow === 1) return nextPage();
      return null;
    });
  }
  return nextPage();
}
function nmNewTvPlayer(api, ott, targetId, title, platform, mediaType, season, episode) {
  return nmJson(api + "/newtv/player.php?id=" + encodeURIComponent(targetId), nmNewTvHeaders(ott, { "Usertoken": "" })).then(function (pl) {
    if (!pl || !pl.video_link) return null;
    var st = String(pl.status || "").toLowerCase();
    if (st !== "ok" && st !== "otp") return null;
    var label = platform === "primevideo" ? "Prime Video" : (platform.charAt(0).toUpperCase() + platform.slice(1));
    var nlbl = formatStreamLabel({ source: "NetMirror", title: title, quality: "Auto",
      season: mediaType === "tv" ? season : undefined, episode: mediaType === "tv" ? episode : undefined,
      server: label, url: pl.video_link });
    return { name: nlbl, title: nlbl, url: pl.video_link, quality: "Auto", headers: { "Referer": pl.referer || api, "User-Agent": nmNextUA() } };
  });
}
function nmNewTvPlatform(api, platform, ott, title, mediaType, season, episode) {
  return nmJson(api + "/newtv/search.php?s=" + encodeURIComponent(title), nmNewTvHeaders(ott)).then(function (sd) {
    var results = (sd && sd.searchResult) || [];
    var wanted = nmNorm(title);
    var exact = results.filter(function (it) { return it && it.id && nmNorm(it.t || it.title) === wanted; });
    if (!exact.length) return [];
    var j = 0;
    function attempt() {
      if (j >= Math.min(exact.length, 3)) return Promise.resolve([]);
      var id = exact[j++].id;
      return nmJson(api + "/newtv/post.php?id=" + encodeURIComponent(id), nmNewTvHeaders(ott, { "Lastep": "", "Usertoken": "" })).then(function (post) {
        if (!post) return attempt();
        if (mediaType === "tv") {
          return nmNewTvEpisode(api, ott, post, season, episode).then(function (epId) {
            if (!epId) return attempt();
            return nmNewTvPlayer(api, ott, epId, title, platform, mediaType, season, episode).then(function (st) { return st ? [st] : attempt(); });
          });
        }
        if (post.type === "t" || ((post.episodes || []).filter(Boolean).length > 0)) return attempt();
        var targetId = post.main_id || id;
        return nmNewTvPlayer(api, ott, targetId, title, platform, mediaType, season, episode).then(function (st) { return st ? [st] : attempt(); });
      });
    }
    return attempt();
  });
}
function nmNewTvAll(title, mediaType, season, episode, preferred) {
  return nmNewTvApi().then(function (api) {
    if (!api) return [];
    var plats = [["netflix", "nf"], ["primevideo", "pv"], ["hotstar", "hs"]];
    if (preferred && preferred !== "all") {
      var want = preferred === "disney" ? "hotstar" : preferred;
      plats.sort(function (a, b) { return (a[0] === want ? 0 : 1) - (b[0] === want ? 0 : 1); });
    }
    var out = [], k = 0;
    function nextPlat() {
      if (k >= plats.length) return out;
      var p = plats[k++];
      return nmNewTvPlatform(api, p[0], p[1], title, mediaType, season, episode).then(function (ss) {
        (ss || []).forEach(function (s) { out.push(s); });
        return nextPlat();
      });
    }
    return nextPlat();
  });
}
/* Abuse-clip guard (netmirror12, 2026-10-25): net52 video is currently
   served as a 10-minute STOP slideshow whenever the session is unverified
   (userver dead -> no t_hash_t -> playlist carries in=unknown). The fake
   playlist's segments are JPEG images, while real HLS video segments are
   .ts/.m4s/extensionless - so a net52 result is dropped ONLY when its
   first variant playlist positively identifies image segments. Fetch
   failures fail OPEN (streams kept): a failed check proves nothing, and
   dropping working streams on a transient error would be worse. When the
   session service recovers, real playlists pass this check untouched. */
function nmNet52Real(streams) {
  if (!streams || !streams.length) return Promise.resolve([]);
  var first = streams[0];
  var headers = first.headers || {};
  return fetch(first.url, { headers: headers }).then(function (r) { return r.text(); }).then(function (master) {
    var variant = null;
    var lines = master.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
        for (var j = i + 1; j < lines.length; j++) {
          var u = (lines[j] || "").trim();
          if (u && u.charAt(0) !== "#") { variant = u; break; }
        }
        break;
      }
    }
    if (!variant) return streams;
    var vurl = /^https?:\/\//i.test(variant) ? variant : (first.url.split("?")[0].replace(/[^\/]*$/, "") + variant);
    return fetch(vurl, { headers: headers }).then(function (r) { return r.text(); }).then(function (vt) {
      var segs = vt.split("\n").filter(function (l) { l = l.trim(); return l && l.charAt(0) !== "#"; });
      for (var k = 0; k < segs.length; k++) {
        if (/\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(segs[k].trim())) return [];
      }
      return streams;
    }).catch(function () { return streams; });
  }).catch(function () { return streams; });
}
function nmNet52Mobile(title, mediaType, season, episode, preferred) {
  var platforms = ["netflix", "primevideo", "hotstar", "disney"];
  if (preferred && preferred !== "all") {
    platforms = [preferred].concat(platforms.filter(function (p) { return p !== preferred; }));
  }
  var k = 0;
  function nextPlat() {
    if (k >= platforms.length) return Promise.resolve([]);
    var key = platforms[k++];
    return Promise.resolve().then(function () { return fetchFromPlatform(key, title, mediaType, season, episode); }).then(function (streams) {
      if (streams && streams.length) return streams;
      return nextPlat();
    }).catch(function () { return nextPlat(); });
  }
  return nextPlat();
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

function getStreams(tmdbId, mediaType, season, episode) {
  var settings = (typeof globalThis !== "undefined" && globalThis.SCRAPER_SETTINGS) || {};
  var preferred = settings.preferredPlatform || "all";
  var tmdbType = mediaType === "tv" ? "tv" : "movie";
  return fetch("https://api.themoviedb.org/3/" + tmdbType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "application/json"
    }
  }).then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (tmdbData) {
    var title = tmdbData ? (mediaType === "tv" ? tmdbData.name : tmdbData.title) : "";
    var effTitle = title || "";
    return nmEmbed(tmdbId, mediaType, season, episode, effTitle).then(function (direct) {
      if (direct && direct.length) return direct;
      if (!effTitle) return [];
      return nmNewTvAll(effTitle, mediaType, season, episode, preferred).then(function (ntv) {
        if (ntv && ntv.length) return ntv;
        return nmNet52Mobile(effTitle, mediaType, season, episode, preferred).then(function (m) { return nmNet52Real(m); });
      });
    });
  }).catch(function () { return []; });
}
function fetchFromPlatform(platformKey, title, mediaType, season, episode) {
  return __async(this, null, function* () {
    const platform = PLATFORM_MAP[platformKey];
    return fetchMobileContent(platformKey, platform, title, mediaType, season, episode);
  });
}
function fetchMobileContent(platformKey, platform, title, mediaType, season, episode) {
  return __async(this, null, function* () {
    var _a, _b;
    const base = "https://net52.cc";
    const cookie = yield bypass(base);
    const settings = globalThis.SCRAPER_SETTINGS || {};
    const cookies = [];
    if (cookie)
      cookies.push(`t_hash_t=${cookie}`);
    cookies.push(`ott=${platform.ott}`);
    if (settings.forceHd !== false)
      cookies.push("hd=on");
    const headers = __spreadProps(__spreadValues({}, BASE_HEADERS), { Cookie: cookies.join("; ") });
    const getJson = (_0, ..._1) => __async(this, [_0, ..._1], function* (url, referer = `${base}/home`, extraHeaders = {}) {
      const response = yield fetch(url, {
        headers: __spreadValues(__spreadProps(__spreadValues({}, headers), { Referer: referer }), extraHeaders)
      });
      if (!response.ok)
        throw new Error(`NetMirror mobile returned HTTP ${response.status}`);
      return response.json();
    });
    const search = yield getJson(`${base}${platform.search}?s=${encodeURIComponent(title)}&t=${Math.floor(Date.now() / 1e3)}`);
    const results = Array.isArray(search.searchResult) ? search.searchResult : [];
    if (!results.length)
      return null;
    const normalize = (value) => { let v = String(value || "").toLowerCase(); try { v = v.normalize("NFD"); } catch (e) {} return v.replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); };
    const wanted = normalize(title);
    // House gate (user rule: exact matches, zero mismatch tolerance):
    // the community build only SORTED by closeness and would fall
    // through to unrelated titles when the exact one yielded nothing -
    // that played the wrong movie on-device. Exact normalized title
    // or nothing.
    const exactResults = results.filter((item) => item && normalize(item.t || item.title) === wanted);
    const wantedSeason = Number(season);
    const wantedEpisode = Number(episode);
    for (const result of exactResults.slice(0, 8)) {
      if (!result.id)
        continue;
      /* 2026-10-24 (netmirror10): the verified-cookie bootstrap is dead -
         net52.cc/mobile/home?app=1 404s, so no t_hash_t can be minted and
         post.php answers {"status":"n","error":"Invalid User"} for every
         title - while the playlist endpoint still serves without the
         cookie. For movies the post step only validated, so fall through
         to the playlist with the search result's own id when post is
         unusable. TV still requires post (episode resolution lives
         there), so it keeps skipping. */
      let post = null;
      try {
        post = yield getJson(`${base}${platform.post}?id=${encodeURIComponent(result.id)}&t=${Math.floor(Date.now() / 1e3)}`);
      } catch (e) {
        post = null;
      }
      const postUsable = post && !(post.status === "n" && post.error);
      let targetId = result.id;
      if (mediaType === "tv") {
        if (!postUsable)
          continue;
        if (post.type !== "t" && !(post.episodes || []).some(Boolean))
          continue;
        let episodeEntry = findMobileEpisode(
          post.episodes,
          wantedSeason,
          wantedEpisode,
          ((_b = (_a = post.season) == null ? void 0 : _a.findIndex((s) => s.selected === true)) != null ? _b : -1) + 1
        );
        const seasonEntry = Array.isArray(post.season) ? post.season.find((s) => Number(String(s.s || "").replace(/\D/g, "")) === wantedSeason) : null;
        if (!episodeEntry && (seasonEntry == null ? void 0 : seasonEntry.id)) {
          let page = 1;
          while (page <= 30) {
            const url = `${base}${platform.episodes}?s=${encodeURIComponent(seasonEntry.id)}&series=${encodeURIComponent(result.id)}&t=${Math.floor(Date.now() / 1e3)}&page=${page}`;
            const data = yield getJson(url);
            episodeEntry = findMobileEpisode(data.episodes, wantedSeason, wantedEpisode, wantedSeason);
            if (episodeEntry || !data.nextPageShow || Number(data.nextPageShow) === 0)
              break;
            page++;
          }
        }
        if (!(episodeEntry == null ? void 0 : episodeEntry.id))
          continue;
        targetId = episodeEntry.id;
      } else if (postUsable && (post.type === "t" || (post.episodes || []).some(Boolean))) {
        continue;
      }
      const playlistUrl = `${base}${platform.playlist}?id=${encodeURIComponent(targetId)}&t=${encodeURIComponent(title)}&tm=${Math.floor(Date.now() / 1e3)}`;
      const playlist = yield getJson(playlistUrl, `${base}/mobile/home?app=1`, {
        "X-Requested-With": "app.netmirror.netmirrornew",
        "Accept": "*/*",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors"
      });
      const entries = Array.isArray(playlist) ? playlist : playlist.playlist || playlist.data || [];
      const streams = [];
      for (const entry of entries) {
        for (const source of entry.sources || []) {
          if (!source.file)
            continue;
          const streamUrl = /^https?:\/\//i.test(source.file) ? source.file : source.file.startsWith("//") ? `https:${source.file}` : `${base}${source.file.startsWith("/") ? "" : "/"}${source.file}`;
          const label = source.label || "Auto";
          const quality = (String(label).match(/\d{3,4}p?/i) || [])[0] || (/full\s*hd/i.test(label) ? "1080p" : /mid\s*hd/i.test(label) ? "720p" : /low\s*hd/i.test(label) ? "480p" : "Auto");
          const playbackHeaders = {
            "Accept": "*/*",
            "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
            "Referer": `${base}/mobile/home?app=1`,
            "sec-ch-ua": '"Android WebView";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Android"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/149.0.7827.91 Safari/537.36 /OS.Gatu v3.0",
            "X-Requested-With": "app.netmirror.netmirrornew"
          };
          if (settings.forceHd !== false)
            playbackHeaders.Cookie = "hd=on";
          var n52lbl = formatStreamLabel({ source: "NetMirror", title: title, quality: quality,
            season: mediaType === "tv" ? wantedSeason : undefined, episode: mediaType === "tv" ? wantedEpisode : undefined,
            server: platformKey, url: streamUrl });
          streams.push({
            name: n52lbl,
            title: n52lbl,
            url: streamUrl,
            quality,
            headers: playbackHeaders
          });
        }
      }
      if (streams.length)
        return streams;
    }
    return null;
  });
}
function findMobileEpisode(episodes, season, episode, fallbackSeason) {
  if (!Array.isArray(episodes))
    return null;
  return episodes.find((item) => {
    if (!item)
      return false;
    const epNumber = Number(String(item.ep || "").replace(/\D/g, ""));
    const seasonNumber = Number(String(item.s || item.sNum || "").replace(/\D/g, "")) || fallbackSeason;
    return epNumber === episode && seasonNumber === season;
  }) || null;
}
function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "Source Selection" },
      {
        type: "select",
        key: "preferredPlatform",
        label: "Preferred Streaming Source",
        description: "Select which platform to try first. If content isn't found, others will be searched as fallback.",
        options: [
          { label: "All Sources (Ordered)", value: "all" },
          { label: "Netflix", value: "netflix" },
          { label: "Prime Video", value: "primevideo" },
          { label: "Hotstar / Disney+", value: "hotstar" }
        ],
        defaultValue: "all"
      },
      { type: "header", label: "Advanced" },
      {
        type: "toggle",
        key: "forceHd",
        label: "Force HD Quality",
        description: "Attempts to force the player into HD mode when possible.",
        defaultValue: true
      }
    ];
  });
}
module.exports = { getStreams, onSettings };

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
