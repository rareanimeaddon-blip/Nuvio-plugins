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
// Release string for subtitle matching (osAttachSubtitles). The row URL
// basename is a hex hash (or "index" for DASH), so without this no
// subtitle ever scores. Built per row from data the provider already
// parses: the subject title + year, the source tag from the subject's
// postTitle (e.g. [CAM], [WEB-DL] — the only place the source lives),
// the row's own quality, and the play response's codecName. The res
// comes from the ROW, not the postTitle, because one subject's streams
// span several resolutions and a 720p row must not claim 1080p.
function mbReleaseTitle(subject, s, q) {
  var parts = [];
  if (subject.title) parts.push(subject.title);
  if (subject.year) parts.push(subject.year);
  var pt = String(subject.postTitle || "");
  var tag = "";
  var m = pt.match(/\b(CAM|TELESYNC|HDTS|HDTC|TS|WEB-?DL|WEBRip|BluRay|BDRip|HDTV|HDRip|DVDRip)\b/i);
  if (m) tag = m[1].toUpperCase().replace(/^WEBDL$/, "WEB-DL");
  if (tag) parts.push(tag);
  if (q) parts.push(q);
  var codec = String((s && s.codec) || "").toLowerCase();
  if (codec) parts.push(codec);
  return parts.join(" ");
}
// The playable DASH manifest URL is not the one in the play response
// (index_web.mpd); it is rebuilt from the sign cookie: the
// Edge-Cache-Cookie urlprefix (base64) is the manifest directory, and
// the manifest is its index.mpd. CloudFront-signed items carry the
// resource in the decoded policy instead. (Pattern proven by the
// mavonyx provider, whose streams play on-device.)
function mbB64UrlDecode(s) {
  var b = String(s).replace(/_/g, "/").replace(/-/g, "+");
  while (b.length % 4) b += "=";
  return atob(b);
}
function mbDashUrlFromCookie(signCookie) {
  if (!signCookie) return null;
  var edge = /Edge-Cache-Cookie=urlprefix=([^:;\s]+)/.exec(signCookie);
  if (edge) {
    try { return mbB64UrlDecode(edge[1]).replace(/\/+$/, "") + "/index.mpd"; } catch (e) { return null; }
  }
  var pol = /CloudFront-Policy=([^;]+)/.exec(signCookie);
  if (!pol) return null;
  var attempts = [pol[1].replace(/-/g, "+").replace(/~/g, "/").replace(/_/g, "="), pol[1].replace(/-/g, "+").replace(/_/g, "/")];
  for (var i = 0; i < attempts.length; i++) {
    try {
      var policy = JSON.parse(mbB64UrlDecode(attempts[i]));
      var resource = policy && policy.Statement && policy.Statement[0] && policy.Statement[0].Resource;
      if (resource) {
        var trimmed = String(resource).replace(/[*\/]+$/, "");
        return /\.mpd$/i.test(trimmed) ? trimmed : trimmed + "/index.mpd";
      }
    } catch (e) {}
  }
  return null;
}
// Playback headers the player must send (top-level `headers` field,
// the form the app honors): the site origin/referer pair plus the
// minting UA, and for cookie-signed streams the sign cookie under
// both its named header and Cookie.
function mbPlaybackHeaders(s) {
  var origin = s._origin || "https://movie-box.co";
  var headers = {
    Origin: origin,
    Referer: origin + "/movies/" + (s._detailPath || "") + "?id=" + (s._subjectId || "") + "&type=/movie/detail&detailSe=&detailEp=&lang=en",
    "User-Agent": MB_H5_UA,
    Accept: "*/*"
  };
  if (s.signCookie) {
    headers[s.signHeaderKey || "X-MB-Token"] = s.signCookie;
    headers.Cookie = s.signCookie;
  }
  return headers;
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
      var format = String(item.format || item.type || g.format).toUpperCase();
      var signCookie = item.signCookie || "";
      if ((format === "DASH" || /\.mpd/i.test(url)) && signCookie) {
        var rebuilt = mbDashUrlFromCookie(signCookie);
        if (rebuilt) url = rebuilt;
      }
      results.push({
        url: url,
        format: format,
        resolutions: String(item.resolutions || item.resolution || item.quality || ""),
        codec: String(item.codecName || ""),
        lang: item.lang || item.lanName || item.language || "",
        signCookie: signCookie,
        signHeaderKey: item.signHeaderKey || "",
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
        var parsed = mbParsePlay(data || {});
        parsed.forEach(function (s) { s._origin = route.origin; s._detailPath = route.detailPath; s._subjectId = subject.subjectId; });
        return parsed;
      }).catch(function () { return []; });
    });
  }).catch(function () { return []; });
}
function mbDirectStreams(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv" || mediaType === "series";
  var boot = MB_TOKEN ? Promise.resolve(true) : mbBootstrap();
  return boot.then(function () {
    // No guest token = the app gateway is unreachable from this
    // client; the signed search cannot succeed, so stop here and
    // let the caller fall back to the web-player chain.
    if (!MB_TOKEN) return [];
    return mbTmdb(tmdbId, mediaType);
  }).then(function (meta) {
    if (Array.isArray(meta)) return meta;
    if (!meta || !meta.title) return [];
    var body = JSON.stringify({ keyword: meta.title, q: meta.title, page: 1, pageSize: 20, type: 0 });
    return mbRequest("POST", MB_BASE + "/subject-api/search", {}, body).then(function (res) {
      var d = (res && res.data) || res || {};
      var items = [];
      if (Array.isArray(d.items)) items = d.items;
      else if (Array.isArray(d.results)) d.results.forEach(function (r) { (r.subjects || []).forEach(function (s) { items.push(s); }); });
      else if (Array.isArray(d.subjects)) items = d.subjects;
      var subjects = [];
      items.forEach(function (it) {
        if (!it || it.subjectId == null || !it.title) return;
        var y = it.year || "";
        if (!y && it.releaseDate) y = String(it.releaseDate).slice(0, 4);
        var rawT = String(it.title);
      var lang = "";
      for (var li = 0; li < MB_LANGS.length; li++) { if (rawT.toLowerCase().indexOf(MB_LANGS[li][0]) !== -1) { lang = MB_LANGS[li][1]; break; } }
      subjects.push({ subjectId: it.subjectId, title: rawT.split("[")[0].trim(), year: String(y).slice(0, 4), lang: lang, postTitle: String(it.postTitle || "") });
      });
      var want = mbNormTitle(meta.title);
      var wantYear = parseInt(meta.year, 10) || 0;
      var matched = subjects.filter(function (s) {
        if (mbNormTitle(s.title) !== want) return false;
        var sy = parseInt(s.year, 10) || 0;
        if (wantYear && sy && Math.abs(sy - wantYear) > 1) return false;
        return true;
      }).slice(0, 3);
      if (!matched.length) return [];
      var se = isTv ? (season || 1) : 0;
      var ep = isTv ? (episode || 1) : 0;
      return Promise.all(matched.map(function (s) {
        return mbPlayForSubject(s, se, ep).then(function (streams) { return { subject: s, streams: streams }; })
          .catch(function () { return { subject: s, streams: [] }; });
      })).then(function (perSubject) {
        var out = [], seen = {};
        perSubject.forEach(function (ps) {
          ps.streams.forEach(function (s) {
            if (!s || !s.url || s.isPreview || seen[s.url]) return;
            seen[s.url] = 1;
            var q = mbQualityFromRes(s.resolutions);
            if (q === "HD" && /m3u8|\.mpd/i.test(s.url)) q = "1080p";
            var lang = s.lang || ps.subject.lang || mbLangOf(ps.subject, s);
            // DASH segments on this CDN are gated by an Edge-Cache-Cookie
            // issued per play response; without it every segment fails.
            // Forward it (and the UA the signs were minted with) to the
            // player as proxy headers.
            var reqH = { "User-Agent": MB_H5_UA };
            if (s.signCookie) reqH.Cookie = s.signCookie;
            // The app list renders only name + quality, so the format and
            // language must be IN the name to tell entries apart.
            var mbBody = formatStreamSize({ source: "MovieBox", title: ps.subject.title || meta.title, year: meta.year, quality: q,
              season: isTv ? se : undefined, episode: isTv ? ep : undefined, audio: lang || undefined,
              extra: s.format || undefined, url: s.url });
            out.push({
              name: "MovieBox",
              title: "MovieBox",
              size: mbBody,
              url: s.url,
              quality: q,
              headers: mbPlaybackHeaders(s),
              behaviorHints: { proxyHeaders: { request: reqH } },
              _releaseTitle: mbReleaseTitle(ps.subject, s, q)
            });
          });
        });
        out.sort(function (a, b) {
          var dq = (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
          if (dq) return dq;
          var ra = /dash|\.mpd/i.test(a.format + a.url) ? 1 : 0;
          var rb = /dash|\.mpd/i.test(b.format + b.url) ? 1 : 0;
          return ra - rb;
        });
        return out.slice(0, 25);
      });
    });
  }).catch(function () { return []; });
}

// ===================================================================
//  Web-player (H5) chain: same service, different front door. The
//  app gateway (apig/api.inmoviebox.com) is unreachable from some
//  clients (the LG TV's fetch service gets 407 proxy refusals
//  there), while movie-box.co answers and its BFF needs only its
//  own guest token. Search returns subjectId + detailPath directly,
//  and the play step is the same one the app chain uses.
// ===================================================================
var MB_H5_ORIGIN = "https://movie-box.co";
var MB_H5_TOKEN = "";
function mbH5ClientToken() {
  var e = String(Math.floor(Date.now() / 1000));
  return e + "," + md5Hex(e.split("").reverse().join(""));
}
function mbH5Api(path, method, bodyStr) {
  var headers = { accept: "application/json", "User-Agent": MB_H5_UA, referer: MB_H5_ORIGIN + "/", "x-client-info": "{\"timezone\":\"Asia/Calcutta\"}", "x-request-lang": "en" };
  if (bodyStr) headers["content-type"] = "application/json";
  if (MB_H5_TOKEN) headers.Authorization = "Bearer " + MB_H5_TOKEN;
  else headers["X-Client-Token"] = mbH5ClientToken();
  var opts = { method: method || "GET", headers: headers };
  if (bodyStr) opts.body = bodyStr;
  return fetch(MB_H5_ORIGIN + path, opts).then(function (res) {
    try {
      var xu = res.headers && res.headers.get ? res.headers.get("x-user") : null;
      if (xu) { var p = JSON.parse(xu); if (p && p.token) MB_H5_TOKEN = p.token; }
    } catch (e) {}
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function (j) {
    var root = (j && typeof j === "object" && !Array.isArray(j)) ? j : {};
    return (root.data && typeof root.data === "object") ? root.data : root;
  });
}
function mbPlayWithRoute(subject, route, se, ep) {
  // No /detail warm-up: the play endpoint answers cold (verified).
  var qs = "subjectId=" + encodeURIComponent(subject.subjectId) + "&se=" + se + "&ep=" + ep + "&detailPath=" + encodeURIComponent(route.detailPath) + "&streamSignType=1&" + encodeURIComponent("supportCodecs[hevc]") + "=1&" + encodeURIComponent("supportCodecs[h264]") + "=1";
  var referer = route.origin + "/movies/" + encodeURIComponent(route.detailPath) + "?id=" + encodeURIComponent(subject.subjectId) + "&type=/movie/detail&detailSe=&detailEp=&lang=en";
  return mbH5(route.origin, "/wefeed-h5api-bff/subject/play?" + qs, referer).then(function (data) {
    var parsed = mbParsePlay(data || {});
    parsed.forEach(function (s) { s._origin = route.origin; s._detailPath = route.detailPath; s._subjectId = subject.subjectId; });
    return parsed;
  }).catch(function () { return []; });
}
function mbFormatResults(perSubject, meta, isTv, se, ep) {
  var out = [], seen = {};
  perSubject.forEach(function (ps) {
    ps.streams.forEach(function (s) {
      if (!s || !s.url || s.isPreview || seen[s.url]) return;
      seen[s.url] = 1;
      var q = mbQualityFromRes(s.resolutions);
      if (q === "HD" && /m3u8|\.mpd/i.test(s.url)) q = "1080p";
      var lang = s.lang || ps.subject.lang || mbLangOf(ps.subject, s);
      var reqH = { "User-Agent": MB_H5_UA };
      if (s.signCookie) reqH.Cookie = s.signCookie;
      var mbBody = formatStreamSize({ source: "MovieBox", title: ps.subject.title || meta.title, year: meta.year, quality: q,
        season: isTv ? se : undefined, episode: isTv ? ep : undefined, audio: lang || undefined,
        extra: s.format || undefined, url: s.url });
      out.push({
        name: "MovieBox",
        title: "MovieBox",
        size: mbBody,
        url: s.url,
        quality: q,
        headers: mbPlaybackHeaders(s),
        behaviorHints: { proxyHeaders: { request: reqH } },
        _releaseTitle: mbReleaseTitle(ps.subject, s, q)
      });
    });
  });
  out.sort(function (a, b) {
    var dq = (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
    if (dq) return dq;
    var ra = /dash|\.mpd/i.test(a.format + a.url) ? 1 : 0;
    var rb = /dash|\.mpd/i.test(b.format + b.url) ? 1 : 0;
    return ra - rb;
  });
  return out.slice(0, 25);
}
function mbH5Streams(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv" || mediaType === "series";
  return mbTmdb(tmdbId, mediaType).then(function (meta) {
    if (!meta || !meta.title) return [];
    var boot = MB_H5_TOKEN ? Promise.resolve() : mbH5Api("/wefeed-h5api-bff/country-code", "GET", null).catch(function () { return null; });
    return boot.then(function () {
      // The web search is fuzzy and its ranking varies between calls,
      // so probe a few query forms and pool the candidates; the exact
      // title/year gate below decides what is usable.
      var mediaTypeNum = isTv ? 2 : 1;
      var probes = [
        { keyword: meta.title, page: 1, perPage: 20, subjectType: 0 },
        { keyword: meta.title, page: 1, perPage: 20, subjectType: mediaTypeNum },
        { keyword: meta.title, page: 2, perPage: 20, subjectType: mediaTypeNum }
      ];
      var words = String(meta.title).split(/\s+/).filter(Boolean);
      if (words.length >= 3) probes.push({ keyword: words.slice(words.length - 2).join(" "), page: 1, perPage: 20, subjectType: mediaTypeNum });
      var pooled = [];
      var poolIds = {};
      // The web catalog renders one entry per season ("Breaking Bad
      // S1".."S5", all the same subjectId) and sometimes drops the
      // leading article from titles. Its dates are real release
      // dates, so the year check stays mandatory - it is what keeps
      // a same-named different film (e.g. "Matrix" 2020, IMDb 5.8)
      // from ever matching "The Matrix" (1999).
      function h5BaseTitle(t) {
        var s = String(t || "").split("[")[0].trim();
        s = s.replace(/\s+S\d+(\s*-\s*S?\d+)?$/i, "");
        return s;
      }
      function h5Norm(t) {
        return mbNormTitle(h5BaseTitle(t)).replace(/^(the|a|an) /, "");
      }
      var wantH5 = h5Norm(meta.title);
      var wantYearH5 = parseInt(meta.year, 10) || 0;
      function h5ItemYear(it) {
        var y = it.year || (it.releaseDate ? String(it.releaseDate).slice(0, 4) : "");
        return parseInt(y, 10) || 0;
      }
      function h5ItemSeason(it) {
        if (it.season != null) { var n = parseInt(it.season, 10); if (n > 0) return n; }
        var m = String(it.title || "").match(/\sS(\d+)(\s*-\s*S?\d+)?$/i);
        return m ? parseInt(m[1], 10) : 0;
      }
      // A single item validates when its title matches and its date
      // fits: for movies the release year (±1); for series the item
      // is a per-season rendering whose date is that season's year,
      // so it is checked season-adjusted (season 1 anchors on the
      // series year). The final acceptance groups by subjectId.
      function h5Matches(it) {
        if (!it || it.subjectId == null || !it.title || !it.detailPath) return false;
        if (h5Norm(it.title) !== wantH5) return false;
        var sy = h5ItemYear(it);
        if (!wantYearH5 || !sy) return true;
        if (!isTv) return Math.abs(sy - wantYearH5) <= 1;
        var sn = h5ItemSeason(it) || 1;
        return Math.abs(sy - (sn - 1) - wantYearH5) <= 2;
      }
      function gateCount(list) { return list.filter(h5Matches).length; }
      function runProbe(i) {
        if (i >= probes.length) return pooled;
        if (i > 0 && gateCount(pooled) > 0) return pooled;
        return mbH5Api("/wefeed-h5api-bff/subject/search", "POST", JSON.stringify(probes[i])).then(function (d) {
          var items = Array.isArray(d.items) ? d.items : [];
          items.forEach(function (it) { if (it && it.subjectId != null && !poolIds[it.subjectId]) { poolIds[it.subjectId] = 1; pooled.push(it); } });
          return runProbe(i + 1);
        }).catch(function () { return runProbe(i + 1); });
      }
      return runProbe(0).then(function (items) {
        var subjects = [];
        var seenSubj = {};
        items.forEach(function (it) {
          if (!h5Matches(it) || seenSubj[it.subjectId]) return;
          seenSubj[it.subjectId] = 1;
          var y = it.year || "";
          if (!y && it.releaseDate) y = String(it.releaseDate).slice(0, 4);
          var rawT = String(it.title);
          var lang = "";
          for (var li = 0; li < MB_LANGS.length; li++) { if (rawT.toLowerCase().indexOf(MB_LANGS[li][0]) !== -1) { lang = MB_LANGS[li][1]; break; } }
          subjects.push({ subjectId: it.subjectId, title: h5BaseTitle(rawT), year: String(y).slice(0, 4), lang: lang, detailPath: it.detailPath, postTitle: String(it.postTitle || "") });
        });
        var matched = subjects.slice(0, 3);
        if (!matched.length) return [];
        var se = isTv ? (season || 1) : 0;
        var ep = isTv ? (episode || 1) : 0;
        return Promise.all(matched.map(function (s) {
          return mbPlayWithRoute(s, { origin: MB_H5_ORIGIN, detailPath: s.detailPath }, se, ep).then(function (streams) { return { subject: s, streams: streams }; })
            .catch(function () { return { subject: s, streams: [] }; });
        })).then(function (perSubject) { return mbFormatResults(perSubject, meta, isTv, se, ep); });
      });
    });
  }).catch(function () { return []; });
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


var OS_MIRROR = 'https://opensubtitles-v3.strem.io';
var SD_API = 'https://api.subdl.com/api/v2/subtitles/search';
var SD_DL = 'https://dl.subdl.com';
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
  else if (set['ts'] || set['telesync'] || set['cam']) source = 'ts';
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
  var best = null, bestScore = 0, bestF = null;
  for (var k = 0; k < subs.length; k++) {
    var sf = osReleaseFeatures(subs[k].release);
    var sc = osScore(ff, sf);
    if (sc > bestScore) { bestScore = sc; best = subs[k]; bestF = sf; }
  }
  if (!best) return null;
  if (bestScore >= 4) return best;
  // CAM/TELESYNC releases carry no group and are often re-encoded, so
  // source+res is the whole signal: a same-resolution TS subtitle for a
  // TS file is the right class (the codec is only the re-encode, not
  // the timing). Accept that at 3; anything else still needs 4.
  if (bestScore === 3 && ff.source === 'ts' && bestF && bestF.source === 'ts' && ff.res && ff.res === bestF.res) return best;
  return null;
}
function osMirrorSubs(imdbId, isSeries, season, episode) {
  var path = isSeries
    ? '/subtitles/series/' + imdbId + ':' + season + ':' + episode + '.json'
    : '/subtitles/movie/' + imdbId + '.json';
  return fetch(OS_MIRROR + path).then(function (r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function (j) {
    var list = (j && j.subtitles) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var lang = String(it.lang || '').toLowerCase();
      if (lang !== 'eng' && lang !== 'en') continue;
      var url = it.url || '';
      if (url.indexOf('https://') !== 0) continue;
      var host = '';
      try { host = new URL(url).hostname; } catch (e) {}
      if (host.indexOf('strem.io') === -1) continue;
      var rel = it.movieReleaseName || it.subtitleFileName || '';
      if (!rel) continue;
      out.push({ id: it.id, url: url, release: rel });
    }
    return out;
  }).catch(function () { return []; });
}
// Try each SubDL key in order; the first key that returns a usable list wins.
// A 401/429/non-ok response falls through to the next key. Returns [] if all fail.
// NOTE: the JSON parse is nested INSIDE the r.ok branch — a failed key's
// attempt() must return directly, not flow into the JSON-parsing .then()
// (that swallowed the good key's result: the array has no .subtitles).
function sdSearchSubs(imdbId, year, keys) {
  if (!keys || !keys.length) return Promise.resolve([]);
  var u = SD_API + '?imdb_id=' + encodeURIComponent(imdbId) + '&year=' + year + '&languages=en&type=movie';
  var idx = 0;
  var attempt = function () {
    if (idx >= keys.length) return Promise.resolve([]);
    var key = keys[idx++];
    return fetch(u, { headers: { 'Authorization': 'Bearer ' + key } }).then(function (r) {
      if (!r.ok) return attempt();
      return r.json().then(function (j) {
        var list = (j && j.subtitles) || [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var it = list[i] || {};
          if (String(it.language || '').toLowerCase() !== 'en') continue;
          var rel = it.release_name || '';
          var url = it.url || '';
          if (!rel || !url) continue;
          out.push({ id: it.id, url: SD_DL + url, release: rel });
        }
        if (!out.length) return attempt();
        return out;
      }).catch(function () { return attempt(); });
    }).catch(function () { return attempt(); });
  };
  return attempt();
}
function osAttachSubtitles(rows, imdbId, isSeries, season, episode, cfg) {
  try {
    if (cfg && cfg.osSubtitles === false) return Promise.resolve(rows);
    if (!imdbId || !rows || !rows.length) return Promise.resolve(rows);
    var year = cfg && cfg.year ? cfg.year : 0;
    var cleanup = function () {
      for (var c = 0; c < rows.length; c++) { try { delete rows[c]._rel; delete rows[c]._releaseTitle; } catch (e) {} }
      return rows;
    };
    var prep = function () {
      for (var i = 0; i < rows.length; i++) {
        var rel = rows[i]._releaseTitle || '';
        if (!rel && rows[i].url) {
          try { rel = decodeURIComponent(String(rows[i].url).split('/').pop() || '').replace(/\.[^.]+$/, ''); } catch (e) {}
        }
        rows[i]._rel = rel;
      }
    };
    // 1. SubDL FIRST (primary). 2. Mirror as BACKUP for rows SubDL missed.
    return getSubdlKeys(cfg).then(function (keys) {
      prep();
      var need = rows.slice();
      var useSubdl = function () {
        if (!keys.length) return Promise.resolve(need);
        return sdSearchSubs(imdbId, year, keys).then(function (sdSubs) {
          var still = [];
          for (var i = 0; i < need.length; i++) {
            var hit = osBestMatch(need[i]._rel, sdSubs);
            if (hit) need[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
            else still.push(need[i]);
          }
          return still;
        }).catch(function () { return need; });
      };
      return useSubdl().then(function (still) {
        if (!still.length) return cleanup();
        return osMirrorSubs(imdbId, isSeries, season, episode).then(function (mirrorSubs) {
          for (var j = 0; j < still.length; j++) {
            var hit2 = osBestMatch(still[j]._rel, mirrorSubs);
            if (hit2) still[j].subtitles = [{ id: String(hit2.id), url: hit2.url, lang: 'en' }];
          }
          return cleanup();
        }).catch(function () { return cleanup(); });
      });
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}

function getStreams(tmdbId, mediaType, season, episode) {
  // Standalone by design: no dependency on any external addon/proxy.
  // App gateway first (proven path); if it yields nothing - e.g. the
  // gateway is unreachable from this client - fall back to the
  // web-player chain on movie-box.co.
  var _mbImdbP = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY)
    ? fetch("https://api.themoviedb.org/3/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.imdb_id) ? String(j.imdb_id) : null; })
        .catch(function () { return null; })
    : Promise.resolve(null);
  var _mbYearP = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY)
    ? fetch("https://api.themoviedb.org/3/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_API_KEY)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var d = j ? (j.release_date || j.first_air_date || "") : "";
          return d ? parseInt(d.slice(0, 4), 10) : 0;
        })
        .catch(function () { return 0; })
    : Promise.resolve(0);
  return Promise.all([_mbImdbP, _mbYearP]).then(function (metaVals) {
    var _imdbId = metaVals[0], _year = metaVals[1] || 0;
    return mbDirectStreams(tmdbId, mediaType, season, episode).then(function (streams) {
      if (streams && streams.length) return streams;
      return mbH5Streams(tmdbId, mediaType, season, episode);
    }).catch(function () {
      return mbH5Streams(tmdbId, mediaType, season, episode);
    }).then(function (rows) {
      return osAttachSubtitles(rows, _imdbId, mediaType === "tv", season, episode, {
        osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
        subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
        subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
        year: _year
      });
    });
  });
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
