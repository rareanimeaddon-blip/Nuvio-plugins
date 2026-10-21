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
//  MovieBox — current app protocol (per the maintained moviebox-api
//  client, updated 2026-10-21): apig host, /wefeed-mobile-bff prefix,
//  guest Bearer token bootstrapped tokenlessly from ranking-list's
//  x-user response header (a stale Bearer poisons every request),
//  x-tr-signature canonical with "application/json;charset=UTF-8",
//  signed host=<netloc> query param on every request, POST search
//  (v1), GET play-info -> data.streamList[] + data.signCookie.
//  Exact-title gate for matching. Pure-JS crypto above; no timers.
// ===================================================================
var TMDB_KEY_MB = "5f39fd16e987a9e3fce30d55cf09b438";
var MB_HOSTS = ["https://apig.inmoviebox.com", "https://api.inmoviebox.com"];
var MB_BASE = "/wefeed-mobile-bff";
var MB_UA = "MovieBox/4.0.02 (Android 14; Pixel 6)";
var MB_MEDIA_UA = "ExoPlayerLib/2.18.7";
var MB_CLIENT_INFO = "{\"package_name\":\"com.community.oneroom\",\"version_name\":\"4.0.02\",\"version_code\":50020126,\"os\":\"android\",\"os_version\":\"14\",\"install_ch\":\"ps\",\"device_id\":\"868203051234567\",\"install_store\":\"ps\",\"gaid\":\"\",\"brand\":\"Google\",\"model\":\"Pixel 6\",\"system_language\":\"en\",\"net\":\"wifi\",\"region\":\"IN\",\"timezone\":\"Asia/Kolkata\",\"sp_code\":\"404\"}";
var MB_TOKEN = "";
function mbAbsorbToken(res) {
  try {
    var xu = res && res.headers && res.headers.get ? res.headers.get("x-user") : null;
    if (xu) { var u = JSON.parse(xu); if (u && u.token) MB_TOKEN = String(u.token); }
  } catch (e) {}
}
function mbBootstrap() {
  // Tokenless guest bootstrap: ranking-list issues a fresh guest JWT
  // via the x-user response header. A stale/expired Bearer poisons
  // every request (401, no re-issue), so this call sends NO token.
  var saved = MB_TOKEN;
  MB_TOKEN = "";
  return mbRequest("GET", MB_BASE + "/tab/ranking-list", { tabId: "0", categoryType: "4516404531735022304", page: "1", perPage: "1" }, null)
    .then(function () { return !!MB_TOKEN; })
    .catch(function () { if (!MB_TOKEN) MB_TOKEN = saved; return !!MB_TOKEN; });
}
function mbSortedQuery(params) {
  var keys = Object.keys(params).sort();
  return keys.map(function (k) { return k + "=" + params[k]; }).join("&");
}
function mbWireQuery(params) {
  var keys = Object.keys(params).sort();
  return keys.map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
}
function mbRequest(method, path, params, bodyStr) {
  function attempt(i, retried401) {
    if (i >= MB_HOSTS.length) return Promise.reject(new Error("moviebox hosts failed"));
    var hostBase = MB_HOSTS[i];
    var netloc = hostBase.replace(/^https?:\/\//, "");
    var p = {};
    Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    p.host = netloc;
    var resource = path + "?" + mbSortedQuery(p);
    var url = hostBase + path + "?" + mbWireQuery(p);
    var ts = Date.now();
    var bodyHash = "", bodyLen = "";
    if (bodyStr) { bodyLen = String(bodyStr.length); bodyHash = bytesToHex(md5Bytes(utf8Bytes(bodyStr))); }
    var canonical = [method.toUpperCase(), "application/json", "application/json;charset=UTF-8", bodyLen, String(ts), bodyHash, resource].join("\n");
    var sig = hmacMd5Base64(SECRET_KEY_DEFAULT, utf8Bytes(canonical));
    var rev = String(ts).split("").reverse().join("");
    var headers = {
      "User-Agent": MB_UA,
      Accept: "application/json",
      "Content-Type": "application/json;charset=UTF-8",
      "X-M-Version": "4.0.02",
      "X-Sign-Version": "2.0",
      "X-Play-Mode": "2",
      appid: "4U01pxRu278GqCZKY9",
      region: "IN",
      lang: "en",
      os: "android",
      "X-Timestamp": String(ts),
      "X-Client-Token": ts + "," + md5Hex(rev),
      "X-Client-Info": MB_CLIENT_INFO,
      "X-Client-Status": MB_TOKEN ? "0" : "1",
      "x-tr-signature": ts + "|2|" + sig,
      Referer: hostBase + "/"
    };
    if (MB_TOKEN) headers.Authorization = "Bearer " + MB_TOKEN;
    var opts = { method: method, headers: headers };
    if (bodyStr) opts.body = bodyStr;
    return fetch(url, opts).then(function (res) {
      mbAbsorbToken(res);
      if (res.status === 401 && !retried401) {
        MB_TOKEN = "";
        return mbBootstrap().then(function () { return attempt(i, true); });
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (j) {
      if (!j || typeof j !== "object") throw new Error("bad json");
      return j;
    }).catch(function (e) {
      if (e && e.message && e.message.indexOf("HTTP 401") === 0) throw e;
      return attempt(i + 1, retried401);
    });
  }
  return attempt(0, false);
}
function mbTmdb(tmdbId, mediaType) {
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
function mbQualityOf(s) {
  var cands = [];
  ["quality", "definition", "label", "videoQuality", "profile", "format"].forEach(function (k) { if (s[k]) cands.push(s[k]); });
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
  for (var i = 0; i < MB_LANGS.length; i++) if (hay.indexOf(MB_LANGS[i][0]) !== -1) return MB_LANGS[i][1];
  return "";
}
var MB_H5_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";
function mbRouteOf(detailUrl) {
  if (typeof detailUrl !== "string" || !detailUrl) return null;
  var m = detailUrl.match(/^(https?:\/\/[^/]+)(\/[^?#]*)?/);
  if (!m) return null;
  var segs = (m[2] || "").split("/").filter(function (s) { return !!s; });
  if (!segs.length) return null;
  return { origin: m[1], detailPath: segs[segs.length - 1] };
}
function mbH5(origin, path, referer) {
  return fetch(origin + path, { headers: { accept: "application/json", origin: origin, referer: referer, "User-Agent": MB_H5_UA, "x-client-info": "{\"timezone\":\"Asia/Calcutta\"}", "x-request-lang": "en" } })
    .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
    .then(function (j) {
      var root = (j && typeof j === "object" && !Array.isArray(j)) ? j : {};
      return (root.data && typeof root.data === "object") ? root.data : root;
    });
}
function mbQualityFromRes(r) {
  var parts = String(r || "").split(",");
  var best = 0;
  parts.forEach(function (p) { var m = p.match(/(\d{3,4})/); if (m) { var n = parseInt(m[1], 10); if (n > best) best = n; } });
  if (best >= 2160) return "2160p";
  if (best >= 1440) return "1440p";
  if (best >= 1080) return "1080p";
  if (best >= 720) return "720p";
  if (best >= 480) return "480p";
  if (best >= 360) return "360p";
  return "HD";
}
function mbParsePlay(data) {
  var groups = [{ key: "dash", format: "DASH" }, { key: "hls", format: "HLS" }, { key: "streams", format: "" }];
  var results = [];
  groups.forEach(function (g) {
    var raw = data[g.key];
    var values = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? [raw] : []);
    values.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var url = item.url || item.playUrl || item.videoUrl || item.link;
      if (!url || typeof url !== "string") return;
      results.push({
        url: url,
        format: String(item.format || item.type || g.format).toUpperCase(),
        resolutions: String(item.resolutions || item.resolution || item.quality || ""),
        lang: item.lang || item.lanName || item.language || "",
        signCookie: item.signCookie || "",
        isPreview: !!(item.isPreview || item.preview || item.isTrailer || item.trailer)
      });
    });
  });
  return results;
}
function mbPlayForSubject(subject, se, ep) {
  return mbRequest("GET", MB_BASE + "/subject-api/get", { subjectId: String(subject.subjectId) }, null).then(function (det) {
    var d = (det && det.data) || {};
    var route = mbRouteOf(d.detailUrl);
    if (!route) return [];
    var warm = mbH5(route.origin, "/wefeed-h5api-bff/detail?detailPath=" + encodeURIComponent(route.detailPath), "https://mzfi.me/").catch(function () { return null; });
    return warm.then(function () {
      var qs = "subjectId=" + encodeURIComponent(subject.subjectId) + "&se=" + se + "&ep=" + ep + "&detailPath=" + encodeURIComponent(route.detailPath) + "&streamSignType=1&" + encodeURIComponent("supportCodecs[hevc]") + "=1&" + encodeURIComponent("supportCodecs[h264]") + "=1";
      var referer = route.origin + "/movies/" + encodeURIComponent(route.detailPath) + "?id=" + encodeURIComponent(subject.subjectId) + "&type=/movie/detail&detailSe=&detailEp=&lang=en";
      return mbH5(route.origin, "/wefeed-h5api-bff/subject/play?" + qs, referer).then(function (data) {
        return mbParsePlay(data || {});
      }).catch(function () { return []; });
    });
  }).catch(function () { return []; });
}

// MB Diag: staged in-app probes for the MovieBox chain + CDN playback.
// Returns findings as stream entries (name = the finding). Summaries first.
function mbdProbe(url, headers) {
  var h = { Range: "bytes=0-1023" };
  Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
  return fetch(url, { headers: h }).then(function (res) {
    var st = res.status;
    return res.text().then(function () { return st; }).catch(function () { return st; });
  }).catch(function () { return -1; });
}
function getStreams(tmdbId, mediaType, season, episode) {
  var E = [];
  function push(name) { E.push({ name: name, title: name, url: "https://example.invalid/diag", quality: "HD" }); }
  var isTv = mediaType === "tv" || mediaType === "series";
  var boot = MB_TOKEN ? Promise.resolve() : mbBootstrap();
  return boot.then(function () { return mbTmdb(tmdbId, mediaType); }).then(function (meta) {
    if (!meta || !meta.title) { push("MBD chain: TMDB FAIL"); return E; }
    var body = JSON.stringify({ keyword: meta.title, q: meta.title, page: 1, pageSize: 20, type: 0 });
    return mbRequest("POST", MB_BASE + "/subject-api/search", {}, body).then(function (res) {
      var d = (res && res.data) || res || {};
      var items = [];
      if (Array.isArray(d.items)) items = d.items;
      var want = mbNormTitle(meta.title);
      var matched = items.filter(function (it) { return it && it.subjectId != null && mbNormTitle(String(it.title).split("[")[0]) === want; });
      var chainMsg = "MBD chain boot=" + (MB_TOKEN ? "OK" : "FAIL") + " items=" + items.length + " match=" + matched.length;
      if (!matched.length) { push("MBD mp4 probe: NO SUBJECT"); push(chainMsg); return E; }
      var s0 = { subjectId: matched[0].subjectId, title: String(matched[0].title).split("[")[0].trim() };
      var se = isTv ? (season || 1) : 0;
      var ep = isTv ? (episode || 1) : 0;
      return mbPlayForSubject(s0, se, ep).then(function (streams) {
        var mp4 = null, dash = null;
        streams.forEach(function (s) { if (!mp4 && s.format === "MP4") mp4 = s; if (!dash && (s.format === "DASH" || /\.mpd/.test(s.url))) dash = s; });
        var jobs = [];
        if (mp4) {
          jobs.push(mbdProbe(mp4.url, {}).then(function (a) {
            return mbdProbe(mp4.url, { "User-Agent": MB_H5_UA }).then(function (b) {
              push("MBD mp4 plain=" + a + " ua=" + b);
            });
          }));
        } else push("MBD mp4 probe: NONE FOUND");
        if (dash) {
          jobs.push(mbdProbe(dash.url, {}).then(function (a) {
            var hh = { "User-Agent": MB_H5_UA };
            if (dash.signCookie) hh.Cookie = dash.signCookie;
            return mbdProbe(dash.url, hh).then(function (b) { push("MBD dash plain=" + a + " ck=" + b); });
          }));
        }
        return Promise.all(jobs).then(function () {
          push(chainMsg + " mp4=" + streams.filter(function (s) { return s.format === "MP4"; }).length + " dash=" + streams.filter(function (s) { return s.format === "DASH"; }).length);
          return E;
        });
      }).catch(function () { push("MBD play: THREW"); push(chainMsg); return E; });
    }).catch(function () { push("MBD search: THREW boot=" + (MB_TOKEN ? "OK" : "FAIL")); return E; });
  }).catch(function () { return E; });
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
