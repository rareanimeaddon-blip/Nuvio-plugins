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

/* Purstream v1.0.4: Infinite Subtitles addon-only attach (osAttachSubtitles).
   Own HLS-master subtitles are kept; the addon overwrites on a release-fit hit.
   Purstream (api.purstream.club) - ported from the user-supplied
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
      imdbId: _0x273189.imdb_id || "",
      year: _0x2c562c ? _0x2c562c.split("-")[0] : "",
      duration: _0x21f96b === "movie" && _0x273189.runtime ? _0x273189.runtime + " min" : _0x21f96b === "tv" && _0x273189.episode_run_time && _0x273189.episode_run_time.length > 0 ? _0x273189.episode_run_time[0] + " min" : ""
    };
  }).catch(function () {
    return {
      enName: "Purstream",
      year: "",
      duration: "",
      imdbId: ""
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
// TMDB /tv/{id} details carry NO imdb_id (movies do); the addon is
// keyed by IMDb id, so TV needs the /external_ids lookup. Fails open.
function getTmdbExternalImdb(_0x4baaaa) {
  return fetch("https://api.themoviedb.org/3/tv/" + _0x4baaaa + "/external_ids?api_key=" + PUR_TMDB_KEY).then(function (_0x4d2459) {
    return _0x4d2459.ok ? _0x4d2459.json() : null;
  }).then(function (_0x45e527) {
    return (_0x45e527 && _0x45e527.imdb_id) || "";
  }).catch(function () { return ""; });
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
// __PURSTREAM_MASTER_SUBTITLES__: the HLS master playlists carry
// #EXT-X-MEDIA:TYPE=SUBTITLES tracks (real .vtt files) that the API
// never lists. Fetch each .m3u8 master, parse the SUBTITLES tracks and
// attach them as {id, url, lang, label} so the app shows them.
// Fails open to no subtitles on any error.
function purIso3To2(code) {
  var c = String(code || "").toLowerCase().trim();
  var map = { eng: "en", fre: "fr", fra: "fr", spa: "es", ger: "de", deu: "de", ita: "it", por: "pt", rus: "ru", ara: "ar", ben: "bn", chi: "zh", zho: "zh", jpn: "ja", kor: "ko", tam: "ta", tel: "te", mal: "ml", mar: "mr", pan: "pa", urd: "ur", ind: "id", msa: "ms", vie: "vi", tha: "th", fil: "tl", nld: "nl", swe: "sv", dan: "da", fin: "fi", nor: "no", pol: "pl", tur: "tr", ukr: "uk", ces: "cs", cze: "cs", ell: "el", heb: "he", ron: "ro", rum: "ro", hun: "hu", hin: "hi" };
  if (map[c]) return map[c];
  if (/^[a-z]{2}$/.test(c)) return c;
  return "";
}
function purSubLabel(code) {
  var names = { en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese", ru: "Russian", ar: "Arabic", bn: "Bengali", zh: "Chinese", ja: "Japanese", ko: "Korean", ta: "Tamil", te: "Telugu", ml: "Malayalam", mr: "Marathi", pa: "Punjabi", ur: "Urdu", id: "Indonesian", ms: "Malay", vi: "Vietnamese", th: "Thai", tl: "Filipino", nl: "Dutch", sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian", pl: "Polish", tr: "Turkish", uk: "Ukrainian", cs: "Czech", el: "Greek", he: "Hebrew", ro: "Romanian", hu: "Hungarian", hi: "Hindi" };
  return names[code] || code;
}
function purParseMasterSubTracks(masterText, masterUrl) {
  var out = [];
  var seen = {};
  try {
    var lines = String(masterText || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("#EXT-X-MEDIA") !== 0 || line.indexOf("TYPE=SUBTITLES") === -1) continue;
      var langM = line.match(/LANGUAGE="([^"]+)"/i);
      var uriM = line.match(/URI="([^"]+)"/i);
      if (!langM || !uriM) continue;
      var code = purIso3To2(langM[1]);
      if (!code) continue;
      var full = uriM[1];
      try { full = new URL(uriM[1], masterUrl).toString(); } catch (e) { full = uriM[1]; }
      if (!/^https?:\/\//i.test(full)) continue;
      if (seen[full]) continue;
      seen[full] = true;
      out.push({ id: "purstream-" + code + "-" + out.length, url: full, lang: code, label: purSubLabel(code), language: code });
    }
  } catch (e) {}
  return out;
}
function purFetchMasterSubtitles(masterUrl) {
  return fetch(masterUrl, { headers: { "User-Agent": PURSTREAM_UA, Referer: PURSTREAM_REFERER } }).then(function (r) {
    if (!r.ok) return [];
    return r.text();
  }).then(function (text) {
    return purParseMasterSubTracks(text, masterUrl);
  }).catch(function () { return []; });
}
function normalizeMovieSources(_0x29ba99, _0x22ed47) {
  var filtered = _0x29ba99.filter(function (_0x4fc8fa) {
    return _0x4fc8fa.url && (_0x4fc8fa.url.match(/\.m3u8/i) || _0x4fc8fa.url.match(/\.mp4/i));
  });
  return Promise.all(filtered.map(function (_0x1e197e) {
    var _0x56fac8 = parseQuality(_0x1e197e.name);
    var _0x168dce = _0x1e197e.url.match(/\.mp4/i) ? "mp4" : "m3u8";
    var _0x53c8d3 = parseLang(_0x1e197e.name);
    var _0x217d9a = buildPurstreamTitle(_0x22ed47, _0x56fac8, _0x53c8d3, _0x168dce, null, null, null, _0x1e197e.name);
    var _0xlbl = formatStreamLabel({ source: "Purstream", title: _0x22ed47.enName, quality: _0x56fac8, audio: _0x53c8d3, url: _0x1e197e.url });
    var _0xsz = formatStreamSize({ source: "Purstream", title: _0x22ed47.enName, year: _0x22ed47.year, quality: _0x56fac8, audio: _0x53c8d3, url: _0x1e197e.url });
    var row = {
      name: "Purstream",
      title: "Purstream",
      size: _0xsz,
      description: _0x217d9a,
      url: _0x1e197e.url,
      quality: _0x56fac8,
      language: "",
      format: _0x168dce,
      _releaseTitle: _0x22ed47.enName + " " + _0x56fac8,
      headers: {
        "User-Agent": PURSTREAM_UA,
        Referer: PURSTREAM_REFERER
      }
    };
    if (_0x168dce !== "m3u8") return row;
    return purFetchMasterSubtitles(_0x1e197e.url).then(function (subs) {
      if (subs.length) {
        row.subtitles = subs;
        row.size = formatStreamSize({ source: "Purstream", title: _0x22ed47.enName, year: _0x22ed47.year, quality: _0x56fac8, audio: _0x53c8d3, subtitles: subs, url: _0x1e197e.url });
      }
      return row;
    }).catch(function () { return row; });
  }));
}
function normalizeEpisodeSources(_0x3ffa77, _0x296e79, _0x46ea42, _0x42f2bb, _0x38e282) {
  return Promise.all(_0x3ffa77.map(function (_0x533f4c) {
    var _0xcb09c0 = parseQuality(_0x533f4c.source_name);
    var _0x40dc85 = _0x533f4c.format || "m3u8";
    var _0xa6c753 = parseLang(_0x533f4c.source_name);
    var _0x2f09cb = buildPurstreamTitle(_0x296e79, _0xcb09c0, _0xa6c753, _0x40dc85, _0x46ea42, _0x42f2bb, _0x38e282, _0x533f4c.source_name);
    var _0xlbl = formatStreamLabel({ source: "Purstream", title: _0x296e79.enName, quality: _0xcb09c0, season: _0x46ea42, episode: _0x42f2bb, audio: _0xa6c753, url: _0x533f4c.stream_url });
    var _0xsz = formatStreamSize({ source: "Purstream", title: _0x296e79.enName, year: _0x296e79.year, quality: _0xcb09c0, season: _0x46ea42, episode: _0x42f2bb, audio: _0xa6c753, url: _0x533f4c.stream_url });
    var row = {
      name: "Purstream",
      title: "Purstream",
      size: _0xsz,
      description: _0x2f09cb,
      url: _0x533f4c.stream_url,
      quality: _0xcb09c0,
      language: "",
      format: _0x40dc85,
      _releaseTitle: _0x296e79.enName + " " + _0xcb09c0,
      headers: {
        "User-Agent": PURSTREAM_UA,
        Referer: PURSTREAM_REFERER
      }
    };
    if (_0x40dc85 !== "m3u8") return row;
    return purFetchMasterSubtitles(_0x533f4c.stream_url).then(function (subs) {
      if (subs.length) {
        row.subtitles = subs;
        row.size = formatStreamSize({ source: "Purstream", title: _0x296e79.enName, year: _0x296e79.year, quality: _0xcb09c0, season: _0x46ea42, episode: _0x42f2bb, audio: _0xa6c753, subtitles: subs, url: _0x533f4c.stream_url });
      }
      return row;
    }).catch(function () { return row; });
  }));
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
        if (!hit && adSubs.length) {
          // No release fit at all (e.g. a 480p row when the addon only has
          // 1080p subtitles). The addon only returns subtitles for THIS
          // title, so the top-ranked non-Sunsync one is the right movie —
          // attach it, unless the row is a CAM/TS, where no proper-release
          // subtitle can match the recording's timing.
          var rl = (rows[i]._rel || '').toLowerCase();
          if (rl.indexOf('cam') === -1 && rl.indexOf('ts') === -1) {
            for (var k = 0; k < adSubs.length; k++) {
              var cand = adSubs[k];
              var cid = String(cand.id || '').toLowerCase();
              var crel = String(cand.release || '').toLowerCase();
              if (cid.indexOf('sunsync') === -1 && crel.indexOf('sunsync') === -1) { hit = cand; break; }
            }
          }
        }
        if (hit) rows[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
      }
      return cleanup();
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

function purOsCfg() {
  return {
    osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
    subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
    subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
    year: 0
  };
}

function getStreams(_0x4baaaa, _0x126066, _0x539bb1, _0x523727) {
  return Promise.all([getTmdbDetails(_0x4baaaa, _0x126066), _0x126066 === "tv" ? getEpisodeInfo(_0x4baaaa, _0x539bb1, _0x523727) : Promise.resolve(null), detectPurstreamDomain(), getTmdbSearchMeta(_0x4baaaa, _0x126066), _0x126066 === "tv" ? getTmdbExternalImdb(_0x4baaaa) : Promise.resolve("")]).then(function (_0x765f04) {
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
          return normalizeEpisodeSources(_0x5cea48, _0x558699, _0x539bb1, _0x523727, _0x3f90af).then(function (rows) { return osAttachSubtitles(rows, (_0x558699.imdbId || _0x765f04[4] || ""), true, _0x539bb1 || 1, _0x523727 || 1, purOsCfg()); });
        });
      } else {
        return fetchMovieSources(_0x2cac7b).then(function (_0x5023fe) {
          return normalizeMovieSources(_0x5023fe, _0x558699).then(function (rows) { return osAttachSubtitles(rows, _0x558699.imdbId || "", false, 0, 0, purOsCfg()); });
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
