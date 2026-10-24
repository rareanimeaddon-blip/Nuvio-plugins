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

/* Purstream (api.purstream.club) - ported from the user-supplied
   plugin (Untitled-2__3__0_edjl.js, wooodyhood/nuvio-repo style).
   Chain: TMDB details -> API search (FR/orig/EN title, exact match
   + year) -> media sheet (movies) / episode sources (TV).
   First-result fallback removed; guest TMDB key; quality carried.
   TV-guest safe: Promise chains only, no timers/crypto/cheerio. */
var DOMAINS_URL = "https://raw.githubusercontent.com/wooodyhood/nuvio-repo/main/domains.json";
var PURSTREAM_FALLBACK = "club";
var PURSTREAM_API = "https://api.purstream." + PURSTREAM_FALLBACK + "/api/v1";
var PURSTREAM_REFERER = "https://purstream." + PURSTREAM_FALLBACK + "/";
var PURSTREAM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var PUR_TMDB_KEY = "";
try { PUR_TMDB_KEY = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : ""; } catch (e) { PUR_TMDB_KEY = ""; }


var _cachedEndpoint = null;
function getTmdbDetails(_0x2f23a7, _0x21f96b) {
  var _0x2f14da = "https://api.themoviedb.org/3/" + (_0x21f96b === "tv" ? "tv" : "movie") + "/" + _0x2f23a7 + "?api_key=" + PUR_TMDB_KEY + "&language=en-US";
  return fetch(_0x2f14da).then(function (_0x4c9287) {
    return _0x4c9287.json();
  }).then(function (_0x273189) {
    var _0x2c562c = _0x273189.release_date || _0x273189.first_air_date || "";
    return {
      enName: _0x273189.title || _0x273189.name || "Purstream",
      year: _0x2c562c ? _0x2c562c.split("-")[0] : "",
      duration: _0x21f96b === "movie" && _0x273189.runtime ? _0x273189.runtime + " min" : _0x21f96b === "tv" && _0x273189.episode_run_time && _0x273189.episode_run_time.length > 0 ? _0x273189.episode_run_time[0] + " min" : ""
    };
  }).catch(function () {
    return {
      enName: "Purstream",
      year: "",
      duration: ""
    };
  });
}
function getEpisodeInfo(_0x525c63, _0x3fa140, _0x45d76b) {
  if (!_0x525c63 || !_0x3fa140 || !_0x45d76b) {
    return Promise.resolve(null);
  }
  var _0x31e309 = "https://api.themoviedb.org/3/tv/" + _0x525c63 + "/season/" + _0x3fa140 + "/episode/" + _0x45d76b + "?api_key=" + PUR_TMDB_KEY + "&language=en-US";
  return fetch(_0x31e309).then(function (_0x4507ae) {
    return _0x4507ae.json();
  }).then(function (_0x4fc03a) {
    return {
      name: _0x4fc03a.name || null,
      duration: _0x4fc03a.runtime ? _0x4fc03a.runtime + " min" : null
    };
  }).catch(function () {
    return null;
  });
}
function buildPurstreamTitle(_0x24c2f6, _0x310b87, _0x2a3025, _0x3c8c25, _0x159a42, _0x480a76, _0x3e322a, _0x45fd1d) {
  var _0x33741f = _0x310b87.toLowerCase().replace(/p/g, "") + "p";
  var _0x201113 = "🔥";
  var _0x31c5b6 = "VF";
  var _0x4ca89f = "🇫🇷";
  var _0x13dd2c = (String(_0x45fd1d) + " " + String(_0x2a3025)).toUpperCase();
  if (_0x13dd2c.indexOf("MULTI") !== -1 || _0x13dd2c.indexOf("DUAL") !== -1) {
    _0x31c5b6 = "Dual-Audio";
    _0x4ca89f = "🇺🇸 • 🇫🇷";
  } else if (_0x13dd2c.indexOf("VOST") !== -1) {
    _0x31c5b6 = "VOSTFR";
    _0x4ca89f = "🇺🇸 • 🇫🇷";
  }
  var _0x4b9c9f = "🎬 ";
  if (_0x159a42 && _0x480a76) {
    _0x4b9c9f += "S" + _0x159a42 + " E" + _0x480a76 + (_0x3e322a && _0x3e322a.name ? " - " + _0x3e322a.name : "") + " | " + _0x24c2f6.enName;
  } else {
    _0x4b9c9f += _0x24c2f6.enName + (_0x24c2f6.year ? " - " + _0x24c2f6.year : "");
  }
  var _0x555470 = _0x201113 + " " + _0x33741f + " | 🔊 " + _0x31c5b6 + " | 🗣️ " + _0x4ca89f;
  var _0x176d23 = (_0x3c8c25 || "M3U8").toUpperCase();
  var _0x41647d = "H.264";
  if (_0x13dd2c.indexOf("HEVC") !== -1 || _0x13dd2c.indexOf("X265") !== -1 || _0x13dd2c.indexOf("H265") !== -1) {
    _0x41647d = "H.265";
  }
  var _0x3109f5 = _0x3e322a && _0x3e322a.duration ? _0x3e322a.duration : _0x24c2f6.duration;
  var _0x446916 = _0x3109f5 ? " | " + _0x3109f5 : "";
  var _0x2ba5be = "🎯 " + _0x176d23 + " • " + _0x41647d + " | 🎧 AAC" + _0x446916;
  return _0x4b9c9f + "\n" + _0x555470 + "\n" + _0x2ba5be;
}
function detectPurstreamDomain() {
  if (_cachedEndpoint) {
    return Promise.resolve(_cachedEndpoint);
  }
  return fetch(DOMAINS_URL).then(function (_0x4b1733) {
    if (!_0x4b1733.ok) {
      throw new Error();
    }
    return _0x4b1733.json();
  }).then(function (_0x464d75) {
    var _0x18f47a = _0x464d75.purstream || PURSTREAM_FALLBACK;
    _cachedEndpoint = {
      api: "https://api.purstream." + _0x18f47a + "/api/v1",
      referer: "https://purstream." + _0x18f47a + "/"
    };
    return _cachedEndpoint;
  }).catch(function () {
    return {
      api: "https://api.purstream." + PURSTREAM_FALLBACK + "/api/v1",
      referer: "https://purstream." + PURSTREAM_FALLBACK + "/"
    };
  });
}
function applyPurstreamDomain(_0x5d8c19) {
  PURSTREAM_API = _0x5d8c19.api;
  PURSTREAM_REFERER = _0x5d8c19.referer;
}
function cleanTitle(_0xfec9ff) {
  if (!_0xfec9ff) {
    return "";
  }
  return _0xfec9ff.toLowerCase().replace(/[àáâãäå]/g, "a").replace(/[èéêë]/g, "e").replace(/[ìíîï]/g, "i").replace(/[òóôõö]/g, "o").replace(/[ùúûü]/g, "u").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function extractYear(_0x43b6be) {
  if (!_0x43b6be) {
    return null;
  }
  var _0x3d72f1 = String(_0x43b6be).match(/(\d{4})/);
  if (_0x3d72f1) {
    return parseInt(_0x3d72f1[1], 10);
  } else {
    return null;
  }
}
function getTmdbSearchMeta(_0x4db8fc, _0x5cb50d) {
  var _0x184968 = _0x5cb50d === "tv" ? "tv" : "movie";
  var _0x331138 = "https://api.themoviedb.org/3/" + _0x184968 + "/" + _0x4db8fc + "?language=fr-FR&api_key=" + PUR_TMDB_KEY;
  return fetch(_0x331138).then(function (_0x4d2459) {
    return _0x4d2459.json();
  }).then(function (_0x45e527) {
    return {
      fr: _0x45e527.title || _0x45e527.name,
      orig: _0x45e527.original_title || _0x45e527.original_name,
      year: extractYear(_0x45e527.release_date || _0x45e527.first_air_date)
    };
  });
}
function findPurstreamIdByTitle(_0x280b47, _0x29fc0e, _0x4d2ef) {
  var _0x31b960 = encodeURIComponent(_0x280b47);
  return fetch(PURSTREAM_API + "/search-bar/search/" + _0x31b960, {
    headers: {
      "User-Agent": PURSTREAM_UA,
      Referer: PURSTREAM_REFERER
    }
  }).then(function (_0x2812dc) {
    return _0x2812dc.json();
  }).then(function (_0x53e343) {
    var _0x21b847 = _0x53e343.data.items.movies && _0x53e343.data.items.movies.items ? _0x53e343.data.items.movies.items : [];
    if (_0x21b847.length === 0) {
      throw new Error();
    }
    var _0x998c7 = cleanTitle(_0x280b47);
    var _0x2a29b2 = _0x21b847.find(function (_0x1715a5) {
      var _0x1d013f = extractYear(_0x1715a5.release_date);
      return cleanTitle(_0x1715a5.title) === _0x998c7 && (_0x1d013f == null || !_0x4d2ef || Math.abs(_0x4d2ef - _0x1d013f) <= 1);
    });
    if (!_0x2a29b2) throw new Error();
    return _0x2a29b2.id;
  });
}
function fetchMovieSources(_0x49430b) {
  return fetch(PURSTREAM_API + "/media/" + _0x49430b + "/sheet", {
    headers: {
      "User-Agent": PURSTREAM_UA,
      Referer: PURSTREAM_REFERER
    }
  }).then(function (_0x46650d) {
    return _0x46650d.json();
  }).then(function (_0x245ec2) {
    return _0x245ec2.data.items.urls || [];
  });
}
function fetchEpisodeSources(_0x259bef, _0x1b9d37, _0x2dd536) {
  return fetch(PURSTREAM_API + "/stream/" + _0x259bef + "/episode?season=" + (_0x1b9d37 || 1) + "&episode=" + (_0x2dd536 || 1), {
    headers: {
      "User-Agent": PURSTREAM_UA,
      Referer: PURSTREAM_REFERER
    }
  }).then(function (_0x4b363d) {
    return _0x4b363d.json();
  }).then(function (_0x57ed4f) {
    return _0x57ed4f.data.items.sources || [];
  });
}
function parseLang(_0x1b1bbc) {
  var _0x58076f = (_0x1b1bbc || "").toUpperCase();
  if (_0x58076f.indexOf("VOSTFR") !== -1) {
    return "VOSTFR";
  }
  if (_0x58076f.indexOf("VF") !== -1) {
    return "VF";
  }
  return "Dual-Audio";
}
function parseQuality(_0x11d4c6) {
  var _0x364254 = (_0x11d4c6 || "").toUpperCase();
  if (_0x364254.indexOf("4K") !== -1) {
    return "4K";
  }
  if (_0x364254.indexOf("1080") !== -1) {
    return "1080p";
  }
  if (_0x364254.indexOf("720") !== -1) {
    return "720p";
  }
  return "HD";
}
function normalizeMovieSources(_0x29ba99, _0x22ed47) {
  return _0x29ba99.filter(function (_0x4fc8fa) {
    return _0x4fc8fa.url && (_0x4fc8fa.url.match(/\.m3u8/i) || _0x4fc8fa.url.match(/\.mp4/i));
  }).map(function (_0x1e197e) {
    var _0x56fac8 = parseQuality(_0x1e197e.name);
    var _0x168dce = _0x1e197e.url.match(/\.mp4/i) ? "mp4" : "m3u8";
    var _0x53c8d3 = parseLang(_0x1e197e.name);
    var _0x217d9a = buildPurstreamTitle(_0x22ed47, _0x56fac8, _0x53c8d3, _0x168dce, null, null, null, _0x1e197e.name);
    return {
      name: "Purstream | " + _0x56fac8.toLowerCase() + " | " + _0x53c8d3,
      title: _0x217d9a,
      size: _0x217d9a,
      description: _0x217d9a,
      url: _0x1e197e.url,
      quality: _0x56fac8,
      language: "",
      format: _0x168dce,
      headers: {
        "User-Agent": PURSTREAM_UA,
        Referer: PURSTREAM_REFERER
      }
    };
  });
}
function normalizeEpisodeSources(_0x3ffa77, _0x296e79, _0x46ea42, _0x42f2bb, _0x38e282) {
  return _0x3ffa77.map(function (_0x533f4c) {
    var _0xcb09c0 = parseQuality(_0x533f4c.source_name);
    var _0x40dc85 = _0x533f4c.format || "m3u8";
    var _0xa6c753 = parseLang(_0x533f4c.source_name);
    var _0x2f09cb = buildPurstreamTitle(_0x296e79, _0xcb09c0, _0xa6c753, _0x40dc85, _0x46ea42, _0x42f2bb, _0x38e282, _0x533f4c.source_name);
    return {
      name: "Purstream | " + _0xcb09c0.toLowerCase() + " | " + _0xa6c753,
      title: _0x2f09cb,
      size: _0x2f09cb,
      description: _0x2f09cb,
      url: _0x533f4c.stream_url,
      quality: _0xcb09c0,
      language: "",
      format: _0x40dc85,
      headers: {
        "User-Agent": PURSTREAM_UA,
        Referer: PURSTREAM_REFERER
      }
    };
  });
}
function getStreams(_0x4baaaa, _0x126066, _0x539bb1, _0x523727) {
  return Promise.all([getTmdbDetails(_0x4baaaa, _0x126066), _0x126066 === "tv" ? getEpisodeInfo(_0x4baaaa, _0x539bb1, _0x523727) : Promise.resolve(null), detectPurstreamDomain(), getTmdbSearchMeta(_0x4baaaa, _0x126066)]).then(function (_0x765f04) {
    var _0x558699 = _0x765f04[0];
    var _0x3f90af = _0x765f04[1];
    var _0x455d6e = _0x765f04[2];
    var _0x400448 = _0x765f04[3];
    applyPurstreamDomain(_0x455d6e);
    return findPurstreamIdByTitle(_0x400448.fr, _0x126066, _0x400448.year).catch(function () {
      return findPurstreamIdByTitle(_0x400448.orig, _0x126066, _0x400448.year);
    }).catch(function () {
      return findPurstreamIdByTitle(_0x558699.enName, _0x126066, _0x400448.year);
    }).then(function (_0x2cac7b) {
      if (_0x126066 === "tv") {
        return fetchEpisodeSources(_0x2cac7b, _0x539bb1, _0x523727).then(function (_0x5cea48) {
          return normalizeEpisodeSources(_0x5cea48, _0x558699, _0x539bb1, _0x523727, _0x3f90af);
        });
      } else {
        return fetchMovieSources(_0x2cac7b).then(function (_0x5023fe) {
          return normalizeMovieSources(_0x5023fe, _0x558699);
        });
      }
    });
  }).catch(function () {
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams: getStreams
  };
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
