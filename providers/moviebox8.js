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

// ---------- pure-JS MD5 ----------
function md5cycle(x, k) {
  var a=x[0],b=x[1],c=x[2],d=x[3];
  function ff(a,b,c,d,x,s,t){a=((a+((b&c)|(~b&d))+x+t)|0);return ((((a<<s)|(a>>>(32-s)))+b)|0);}
  function gg(a,b,c,d,x,s,t){a=((a+((b&d)|(c&~d))+x+t)|0);return ((((a<<s)|(a>>>(32-s)))+b)|0);}
  function hh(a,b,c,d,x,s,t){a=((a+(b^c^d)+x+t)|0);return ((((a<<s)|(a>>>(32-s)))+b)|0);}
  function ii(a,b,c,d,x,s,t){a=((a+(c^(b|~d))+x+t)|0);return ((((a<<s)|(a>>>(32-s)))+b)|0);}
  a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
  a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
  a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
  a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
  a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
  a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
  a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
  a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
  a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
  a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
  a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
  a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
  a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
  a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
  a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
  a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
  x[0]=(x[0]+a)|0;x[1]=(x[1]+b)|0;x[2]=(x[2]+c)|0;x[3]=(x[3]+d)|0;
}
function md5Bytes(msgBytes) {
  var origLen = msgBytes.length;
  var withOne = msgBytes.concat([0x80]);
  while (withOne.length % 64 !== 56) withOne.push(0);
  var bitLen = origLen * 8;
  for (var i = 0; i < 8; i++) withOne.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff);
  var h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (var off = 0; off < withOne.length; off += 64) {
    var w = new Array(16);
    for (var j = 0; j < 16; j++) {
      w[j] = withOne[off+j*4] | (withOne[off+j*4+1]<<8) | (withOne[off+j*4+2]<<16) | (withOne[off+j*4+3]<<24);
    }
    md5cycle(h, w);
  }
  var out = [];
  for (var k = 0; k < 4; k++) {
    out.push(h[k]&0xff, (h[k]>>>8)&0xff, (h[k]>>>16)&0xff, (h[k]>>>24)&0xff);
  }
  return out;
}
function utf8Bytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0|(c>>6), 0x80|(c&0x3f));
    else if (c < 0xd800 || c >= 0xe000) bytes.push(0xe0|(c>>12), 0x80|((c>>6)&0x3f), 0x80|(c&0x3f));
    else { i++; var cp = 0x10000 + (((c&0x3ff)<<10) | (str.charCodeAt(i)&0x3ff));
      bytes.push(0xf0|(cp>>18), 0x80|((cp>>12)&0x3f), 0x80|((cp>>6)&0x3f), 0x80|(cp&0x3f)); }
  }
  return bytes;
}
function bytesToHex(b) { return b.map(function(x){ var s=(x&0xff).toString(16); return s.length<2?"0"+s:s; }).join(""); }
function md5Hex(str) { return bytesToHex(md5Bytes(utf8Bytes(str))); }
function hmacMd5Base64(keyBytes, msgBytes) {
  var block = keyBytes.slice();
  if (block.length > 64) block = md5Bytes(block);
  while (block.length < 64) block.push(0);
  var okey = block.map(function(b){return b^0x5c;});
  var ikey = block.map(function(b){return b^0x36;});
  var inner = md5Bytes(ikey.concat(msgBytes));
  var outer = md5Bytes(okey.concat(inner));
  var bin = outer.map(function(b){return String.fromCharCode(b);}).join("");
  // base64 encode
  var b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "", i = 0;
  while (i < bin.length) {
    var c1 = bin.charCodeAt(i++), c2 = bin.charCodeAt(i++), c3 = bin.charCodeAt(i++);
    var n = (c1<<16)|(c2<<8)|c3;
    out += b64chars[(n>>>18)&63]+b64chars[(n>>>12)&63]+(isNaN(c2)?"=":b64chars[(n>>>6)&63])+(isNaN(c3)?"=":b64chars[n&63]);
  }
  return out;
}
function base64ToBytes(b64) {
  var bin = atob(b64);
  var out = [];
  for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i));
  return out;
}
var SECRET_KEY_DEFAULT = base64ToBytes("76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O");

// ---------- request signing ----------
var DEVICE_ID = (function(){
  var h = "";
  for (var i = 0; i < 32; i++) h += "0123456789abcdef"[Math.floor(Math.random()*16)];
  return h;
})();
var BRAND_MODELS = {
  Samsung: ["SM-S918B","SM-A528B"], Xiaomi: ["2201117TI","Redmi Note 11"],
  OnePlus: ["LE2111"], Google: ["Pixel 7","Pixel 8"], Realme: ["RMX3085"]
};
function randomBrandModel() {
  var brands = Object.keys(BRAND_MODELS);
  var b = brands[Math.floor(Math.random()*brands.length)];
  var ms = BRAND_MODELS[b];
  return { brand: b, model: ms[Math.floor(Math.random()*ms.length)] };
}

// ===================================================================
//  MovieBox — reference protocol (tapframe/NuvioStreamsAddon parity):
//  canonical content-type "application/json; charset=utf-8", search
//  /subject-api/search/v2, direct /subject-api/play-info. No JWT
//  bootstrap (the working implementation sends none). Exact-title
//  gate for subject matching. Pure-JS crypto above; no timers.
// ===================================================================
var TMDB_KEY_MB = "5f39fd16e987a9e3fce30d55cf09b438";
var MB_HOSTS = ["https://api.inmoviebox.com", "https://apig.inmoviebox.com"];
var MB_BASE = "/wefeed-mobile-bff";
var MB_UA = "com.community.mbox.in/50020042 (Linux; Android 16; sdk_gphone64_x86_64; Cronet/133.0.6876.3)";
var MB_PLAY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

function mbCanonicalOf(u) {
  var rest = u.replace(/^https?:\/\/[^/]+/, "");
  var qi = rest.indexOf("?");
  if (qi === -1) return rest;
  var path = rest.slice(0, qi), q = rest.slice(qi + 1);
  var pairs = [];
  q.split("&").forEach(function (p) {
    if (!p) return;
    var i = p.indexOf("=");
    var k = i === -1 ? p : p.slice(0, i);
    var v = i === -1 ? "" : p.slice(i + 1);
    try { k = decodeURIComponent(k); v = decodeURIComponent(v); } catch (e) {}
    pairs.push([k, v]);
  });
  pairs.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  var qs = pairs.map(function (p) { return p[0] + "=" + p[1]; }).join("&");
  return qs ? path + "?" + qs : path;
}
function mbSignHeaders(method, url, bodyStr, ts) {
  var bodyHash = "", bodyLength = "";
  if (bodyStr) {
    var bb = utf8Bytes(bodyStr);
    bodyLength = String(bb.length);
    bodyHash = bytesToHex(md5Bytes(bb));
  }
  var canonical = [method.toUpperCase(), "application/json", "application/json; charset=utf-8", bodyLength, String(ts), bodyHash, mbCanonicalOf(url)].join("\n");
  var sig = hmacMd5Base64(SECRET_KEY_DEFAULT, utf8Bytes(canonical));
  var rev = String(ts).split("").reverse().join("");
  return { "x-tr-signature": ts + "|2|" + sig, "x-client-token": ts + "," + md5Hex(rev) };
}
function mbApi(path, method, bodyStr) {
  function tryHost(i) {
    if (i >= MB_HOSTS.length) return Promise.reject(new Error("moviebox hosts failed"));
    var url = MB_HOSTS[i] + path;
    var headers = {
      "User-Agent": MB_UA,
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "x-client-info": "{\"package_name\":\"com.community.mbox.in\"}",
      "x-client-status": "0"
    };
    var sh = mbSignHeaders(method, url, bodyStr, Date.now());
    headers["x-tr-signature"] = sh["x-tr-signature"];
    headers["x-client-token"] = sh["x-client-token"];
    var opts = { method: method, headers: headers };
    if (bodyStr) opts.body = bodyStr;
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (j) {
      if (!j || typeof j !== "object") throw new Error("bad json");
      return j;
    }).catch(function (e) { return tryHost(i + 1); });
  }
  return tryHost(0);
}
function mbTmdb(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv" || mediaType === "series";
  var url;
  if (String(tmdbId).indexOf("tt") === 0) {
    url = "https://api.themoviedb.org/3/find/" + tmdbId + "?api_key=" + TMDB_KEY_MB + "&external_source=imdb_id";
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var arr = isTv ? j.tv_results : j.movie_results;
      var d = arr && arr[0];
      if (!d) return null;
      return { title: isTv ? d.name : d.title, year: (isTv ? d.first_air_date : d.release_date || "").slice(0, 4) };
    });
  }
  url = "https://api.themoviedb.org/3/" + (isTv ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_KEY_MB;
  return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
    if (!d || (!d.title && !d.name)) return null;
    return { title: isTv ? d.name : d.title, year: ((isTv ? d.first_air_date : d.release_date) || "").slice(0, 4) };
  });
}
function mbNormTitle(t) {
  var s = String(t || "").toLowerCase();
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\((?:19|20)\d{2}\)/g, " ");
  s = s.replace(/^(the|a|an)\s+/, "");
  s = s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}
function mbSubjectYear(s) {
  var y = s.year || s.releaseYear || s.release_year || "";
  if (!y && s.releaseDate) y = String(s.releaseDate).slice(0, 4);
  if (!y && s.title) { var m = String(s.title).match(/\((?:19|20)\d{2}\)/); if (m) y = m[0].slice(1, 5); }
  return String(y || "").slice(0, 4);
}
function mbQualityOf(s) {
  var cands = [];
  if (s.quality) cands.push(s.quality);
  if (s.definition) cands.push(s.definition);
  if (s.label) cands.push(s.label);
  if (s.videoQuality) cands.push(s.videoQuality);
  if (s.profile) cands.push(s.profile);
  if (Array.isArray(s.resolutions)) s.resolutions.forEach(function (r) { cands.push(r); });
  else if (typeof s.resolutions === "string") s.resolutions.split(",").forEach(function (r) { cands.push(r.trim()); });
  else if (s.resolution) cands.push(s.resolution);
  if (s.width && s.height) cands.push(s.width + "x" + s.height);
  for (var i = 0; i < cands.length; i++) {
    var q = String(cands[i] || "");
    var mx = q.match(/(\d{3,4})\s*x\s*(\d{3,4})/);
    if (mx) return mx[2] + "p";
    var mp = q.match(/(\d{3,4})\s*p/i);
    if (mp) return mp[1] + "p";
    var mn = q.match(/^(\d{3,4})$/);
    if (mn) return mn[1] + "p";
    if (/2160|4k|uhd/i.test(q)) return "2160p";
  }
  return "HD";
}
var MB_LANGS = [["hindi", "Hindi"], ["english", "English"], ["tamil", "Tamil"], ["telugu", "Telugu"], ["malayalam", "Malayalam"], ["kannada", "Kannada"], ["bengali", "Bengali"], ["punjabi", "Punjabi"], ["marathi", "Marathi"], ["urdu", "Urdu"], ["spanish", "Spanish"], ["french", "French"], ["german", "German"], ["japanese", "Japanese"], ["korean", "Korean"], ["chinese", "Chinese"], ["arabic", "Arabic"], ["russian", "Russian"]];
function mbLangOf(subject, s) {
  var hay = "";
  if (Array.isArray(s.audioTracks)) hay += " " + s.audioTracks.join(" ");
  if (s.format) hay += " " + s.format;
  if (subject.title) hay += " " + subject.title;
  hay = hay.toLowerCase();
  for (var i = 0; i < MB_LANGS.length; i++) {
    if (hay.indexOf(MB_LANGS[i][0]) !== -1) return MB_LANGS[i][1];
  }
  return "";
}
function getStreams(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv" || mediaType === "series";
  return mbTmdb(tmdbId, mediaType, season, episode).then(function (meta) {
    if (!meta || !meta.title) return [];
    var body = JSON.stringify({ page: 1, perPage: 10, keyword: meta.title });
    return mbApi(MB_BASE + "/subject-api/search/v2", "POST", body).then(function (res) {
      var data = res.data || res;
      var subjects = [];
      var results = data.results || [];
      results.forEach(function (r) { (r.subjects || []).forEach(function (s) { subjects.push(s); }); });
      if (!subjects.length && Array.isArray(data.subjects)) subjects = data.subjects;
      var want = mbNormTitle(meta.title);
      var wantYear = parseInt(meta.year, 10) || 0;
      var matched = subjects.filter(function (s) {
        if (!s || !s.title || s.subjectId == null) return false;
        if (mbNormTitle(s.title) !== want) return false;
        var sy = parseInt(mbSubjectYear(s), 10) || 0;
        if (wantYear && sy && Math.abs(sy - wantYear) > 1) return false;
        return true;
      }).slice(0, 4);
      if (!matched.length) return [];
      return Promise.all(matched.map(function (s) {
        var path = MB_BASE + "/subject-api/play-info?subjectId=" + encodeURIComponent(s.subjectId);
        if (isTv && season && episode) path += "&se=" + season + "&ep=" + episode;
        return mbApi(path, "GET", null).then(function (pr) {
          var d = pr.data || pr;
          var streams = d.streams || (d.playInfo && d.playInfo.streams) || [];
          return { subject: s, streams: streams };
        }).catch(function () { return { subject: s, streams: [] }; });
      })).then(function (perSubject) {
        var out = [];
        perSubject.forEach(function (ps) {
          ps.streams.forEach(function (s) {
            if (!s || !s.url) return;
            var q = mbQualityOf(s);
            var lang = mbLangOf(ps.subject, s);
            var title = "MovieBox • " + q + (lang ? " • " + lang : "") + "\n" + (ps.subject.title || meta.title) + (s.format ? " • " + s.format : "");
            out.push({
              name: "MovieBox",
              title: title,
              url: s.url,
              quality: q,
              behaviorHints: { proxyHeaders: { request: { Referer: "https://api.inmoviebox.com", "User-Agent": MB_PLAY_UA } } }
            });
          });
        });
        out.sort(function (a, b) { return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0); });
        return out.slice(0, 25);
      });
    });
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.MovieBoxScraperModule = { getStreams: getStreams };
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
