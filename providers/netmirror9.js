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
var VERIFY_ATTEMPTS = 7;
var VERIFY_DELAY = 1e4;
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
      const userverResponse = yield request(userverUrl, { headers: appHeaders });
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
      console.error("[NetMirror] Mobile cookie verification failed:", error.message);
      return "";
    }
  });
}

// src/netmirror/index.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      const settings = globalThis.SCRAPER_SETTINGS || {};
      const preferred = settings.preferredPlatform || "all";
      const tmdbType = mediaType === "tv" ? "tv" : "movie";
      const tmdbResp = yield fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });
      const tmdbData = yield tmdbResp.json();
      const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
      if (!title)
        throw new Error("Could not fetch title from TMDB");
      let platforms = ["netflix", "primevideo", "hotstar", "disney"];
      if (preferred !== "all") {
        platforms = [preferred, ...platforms.filter((p) => p !== preferred)];
      }
      for (const platformKey of platforms) {
        try {
          const streams = yield fetchFromPlatform(platformKey, title, mediaType, season, episode);
          if (streams && streams.length > 0)
            return streams;
        } catch (e) {
        }
      }
      return [];
    } catch (error) {
      return [];
    }
  });
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
      const post = yield getJson(`${base}${platform.post}?id=${encodeURIComponent(result.id)}&t=${Math.floor(Date.now() / 1e3)}`);
      if (!post || post.status === "n" && post.error)
        continue;
      let targetId = result.id;
      if (mediaType === "tv") {
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
      } else if (post.type === "t" || (post.episodes || []).some(Boolean)) {
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
          streams.push({
            name: `NetMirror (${platformKey})`,
            title: mediaType === "tv" ? `${title} S${wantedSeason}E${wantedEpisode} - ${label}` : `${title} - ${label}`,
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
