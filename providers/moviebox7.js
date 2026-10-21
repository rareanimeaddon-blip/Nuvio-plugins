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



// MovieBox scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Talks to the MovieBox mobile API (inmoviebox.com) with MD5/HMAC-MD5 request
// signing (pure JS) and JWT bootstrap. Title search via TMDB metadata.

var HOST_POOL = [
  "https://apig.inmoviebox.com",
  "https://api.inmoviebox.com",
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com",
];
var goodHost = 0;
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var H5_FALLBACK_ORIGINS = ["https://movie-box.co"];
var H5_DETAIL_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
var H5_PLAY_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";

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
function generateXClientToken(ts) {
  var timestamp = String(ts == null ? Date.now() : ts);
  var reversed = timestamp.split("").reverse().join("");
  return timestamp + "," + md5Hex(reversed);
}
function generateXTrSignature(method, accept, contentType, url, body, ts) {
  var timestamp = ts == null ? Date.now() : ts;
  var parsed = new URL(url);
  var path = parsed.pathname;
  var qp = [];
  parsed.searchParams.forEach(function(v,k){ qp.push([k,v]); });
  qp.sort(function(a,b){ return a[0] < b[0] ? -1 : 1; });
  var query = qp.map(function(p){ return p[0]+"="+p[1]; }).join("&");
  var canonicalUrl = query ? path+"?"+query : path;
  var bodyHash = "", bodyLength = "";
  if (body != null) {
    var bb = utf8Bytes(body);
    var trimmed = bb.length > 102400 ? bb.slice(0,102400) : bb;
    bodyHash = bytesToHex(md5Bytes(trimmed));
    bodyLength = String(bb.length);
  }
  var canonical = [method.toUpperCase(), accept||"", contentType||"", bodyLength, String(timestamp), bodyHash, canonicalUrl].join("\n");
  var sig = hmacMd5Base64(SECRET_KEY_DEFAULT, utf8Bytes(canonical));
  return timestamp + "|2|" + sig;
}
function buildClientInfo(versionName, versionCode, brand, model) {
  return JSON.stringify({
    package_name:"com.community.mbox.in", version_name:versionName, version_code:versionCode,
    os:"android", os_version:"16", install_ch:"ps", device_id:DEVICE_ID, install_store:"ps",
    gaid:"d7578036d13336cc", brand:brand, model:model, system_language:"en",
    net:"NETWORK_WIFI", region:"IN", timezone:"Asia/Calcutta", sp_code:""
  });
}
function mobileHeaders(method, url, body, token) {
  var bm = randomBrandModel();
  var ts = Date.now();
  var h = {
    "User-Agent":"com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; "+bm.brand+"; Build/BP22.250325.006; Cronet/133.0.6876.3)",
    accept:"application/json", "content-type":"application/json", connection:"keep-alive",
    "x-client-token":generateXClientToken(ts),
    "x-tr-signature":generateXTrSignature(method,"application/json","application/json",url,body,ts),
    "x-client-info":buildClientInfo("3.0.03.0529.03",50020042,bm.brand,bm.model),
    "x-client-status":"0", "x-play-mode":"2"
  };
  if (token) h["Authorization"]="Bearer "+token;
  return h;
}

// ---------- http ----------
function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}
var cachedToken = null, tokenExpiresAt = 0;
function tryParseXUser(header) {
  try { var d = JSON.parse(header); return d.token || null; } catch(e){ return null; }
}
function absorbToken(res) {
  var xu = res.headers.get("x-user");
  if (xu) {
    var tok = tryParseXUser(xu);
    if (tok) { cachedToken = tok; tokenExpiresAt = Date.now() + 50*60*1000; }
  }
}
function ensureToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return Promise.resolve(cachedToken);
  var path = "/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1";
  var order = [];
  for (var k = 0; k < HOST_POOL.length; k++) order.push((goodHost + k) % HOST_POOL.length);
  var tryOne = function (idx) {
    var url = HOST_POOL[idx] + path;
    return fetchWithTimeout(url, { headers: mobileHeaders("GET", url, undefined, undefined) }, 12000)
      .then(function (r) {
        absorbToken(r);
        if (cachedToken && Date.now() < tokenExpiresAt) { goodHost = idx; return cachedToken; }
        return null;
      })
      .catch(function () { return null; });
  };
  // Race the first three hosts in parallel - the old sequential walk
  // through dead hosts ate the whole TV search budget before search
  // even fired. Walk any remaining hosts only if the race found none.
  return Promise.all([tryOne(order[0]), tryOne(order[1]), tryOne(order[2])]).then(function () {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
    var walk = function (jj) {
      if (jj >= order.length) return Promise.resolve(null);
      return tryOne(order[jj]).then(function (t) { return t || walk(jj + 1); });
    };
    return walk(3);
  });
}

function apiGet(path) {
  return ensureToken().then(function(token){
    var tryHost = function(i, refreshed){
      if (i >= HOST_POOL.length) return Promise.reject(new Error("MovieBox: all hosts failed"));
      var idx = (goodHost + i) % HOST_POOL.length;
      var url = HOST_POOL[idx]+path;
      return fetchWithTimeout(url,{headers:mobileHeaders("GET",url,undefined,token)},12000)
        .then(function(res){
          absorbToken(res);
          if (res.ok) { goodHost = idx; return res.json().then(function(j){ return j.data; }); }
          if ((res.status===441||res.status===401)&&!refreshed){
            cachedToken=null; tokenExpiresAt=0;
            return ensureToken().then(function(t2){ token=t2; return tryHost(i,true); });
          }
          return tryHost(i+1, refreshed);
        }).catch(function(){ return tryHost(i+1, refreshed); });
    };
    return tryHost(0,false);
  });
}
function apiPost(path, body) {
  return ensureToken().then(function(token){
    var tryHost = function(i, refreshed){
      if (i >= HOST_POOL.length) return Promise.reject(new Error("MovieBox: all hosts failed"));
      var idx = (goodHost + i) % HOST_POOL.length;
      var url = HOST_POOL[idx]+path;
      return fetchWithTimeout(url,{method:"POST",headers:mobileHeaders("POST",url,body,token),body:body},12000)
        .then(function(res){
          absorbToken(res);
          if (res.ok) { goodHost = idx; return res.json().then(function(j){ return j.data; }); }
          if ((res.status===441||res.status===401)&&!refreshed){
            cachedToken=null; tokenExpiresAt=0;
            return ensureToken().then(function(t2){ token=t2; return tryHost(i,true); });
          }
          return tryHost(i+1, refreshed);
        }).catch(function(){ return tryHost(i+1, refreshed); });
    };
    return tryHost(0,false);
  });
}

// ---------- H5 playback ----------
var playbackRoutes = {};
function getH5Json(origin, path, referer, userAgent) {
  var origins = [origin].concat(H5_FALLBACK_ORIGINS.filter(function(o){return o!==origin;}));
  var tryO = function(i){
    if (i>=origins.length) return Promise.reject(new Error("MovieBox H5 failed"));
    var base = origins[i];
    var url = new URL(path, base+"/").toString();
    return fetchWithTimeout(url,{headers:{
      accept:"application/json", origin:base, referer:referer, "User-Agent":userAgent,
      "x-client-info":JSON.stringify({timezone:"Asia/Calcutta"}), "x-request-lang":"en"
    }},12000).then(function(res){
      if (!res.ok) return tryO(i+1);
      return res.json().then(function(j){
        var root=(j&&typeof j==="object"&&!Array.isArray(j))?j:{};
        return (root.data&&typeof root.data==="object")?root.data:root;
      });
    }).catch(function(){ return tryO(i+1); });
  };
  return tryO(0);
}
function parseYear(rd){
  if(typeof rd!=="string") return undefined;
  var m=rd.match(/\b(19|20)\d{2}\b/);
  return m?parseInt(m[0],10):undefined;
}
function searchMovieBox(query){
  var body=JSON.stringify({keyword:query,page:1,perPage:15,subjectType:0});
  return apiPost("/wefeed-mobile-bff/subject-api/search",body).then(function(data){
    var items=(data&&data.items)||[];
    var out=[];
    items.forEach(function(it){
      var sid=it.subjectId, raw=it.title;
      var title=raw?String(raw).split("[")[0].trim():"";
      if(sid&&title) out.push({subjectId:sid,title:title,subjectType:it.subjectType||1,year:parseYear(it.releaseDate)});
    });
    return out;
  }).catch(function(){return [];});
}
function getSubjectDetails(subjectId){
  return apiGet("/wefeed-mobile-bff/subject-api/get?subjectId="+encodeURIComponent(subjectId))
    .then(function(d){
      d=d||{};
      var detailUrl=d.detailUrl, route=null;
      if(typeof detailUrl==="string"&&detailUrl.trim()){
        try{
          var u=new URL(detailUrl);
          var segs=u.pathname.split("/").filter(Boolean);
          var dp=segs[segs.length-1];
          if(dp) route={detailPath:dp,origin:u.origin,fetchedAt:Date.now()};
        }catch(e){}
      }
      if(route){
        playbackRoutes[subjectId]=route;
        var dq=new URLSearchParams({detailPath:route.detailPath});
        return getH5Json(route.origin,"/wefeed-h5api-bff/detail?"+dq.toString(),"https://mzfi.me/")
          .catch(function(){return null;});
      }
      return null;
    }).catch(function(){return null;});
}
function parsePlayStreams(data,subjectId,season,episode,route){
  var groups=[{key:"dash",format:"DASH"},{key:"hls",format:"HLS"},{key:"streams",format:""}];
  var results=[];
  groups.forEach(function(g){
    var raw=data[g.key];
    var values=Array.isArray(raw)?raw:(raw&&typeof raw==="object"?[raw]:[]);
    values.forEach(function(item){
      if(!item||typeof item!=="object") return;
      var url=item.url||item.playUrl||item.videoUrl||item.link;
      if(!url||typeof url!=="string") return;
      var format=String(item.format||item.type||g.format).toUpperCase();
      var resolutions=String(item.resolutions||item.resolution||item.quality||"");
      var id=item.id||item.streamId||item.resourceId||(subjectId+"|"+season+"|"+episode);
      results.push({url:url,format:format,resolutions:resolutions,id:String(id),
        lang:item.lang||item.lanName||item.language||"",
        isPreview:!!(item.isPreview||item.preview||item.isTrailer||item.trailer)});
    });
  });
  return results;
}
function getPlayInfo(subjectId,season,episode){
  var route=playbackRoutes[subjectId];
  var ready=(route&&Date.now()-route.fetchedAt<6*60*60*1000)?Promise.resolve(route):
    getSubjectDetails(subjectId).then(function(){return playbackRoutes[subjectId];});
  return ready.then(function(rt){
    if(!rt) return [];
    var params=new URLSearchParams({subjectId:subjectId,se:String(season),ep:String(episode),
      detailPath:rt.detailPath,streamSignType:"1","supportCodecs[hevc]":"1","supportCodecs[h264]":"1"});
    var referer=rt.origin+"/movies/"+encodeURIComponent(rt.detailPath)+"?id="+encodeURIComponent(subjectId)+"&type=/movie/detail&detailSe=&detailEp=&lang=en";
    return getH5Json(rt.origin,"/wefeed-h5api-bff/subject/play?"+params.toString(),referer,H5_PLAY_UA)
      .then(function(data){return parsePlayStreams(data||{},subjectId,season,episode,rt);})
      .catch(function(){return [];});
  });
}
function normTitle(s){return String(s||"").toLowerCase().replace(/\[[^\]]*\]/g,"").replace(/[^a-z0-9]+/g," ").trim();}
function pickBest(subjects,title){
  var nt=normTitle(title),best=null,bs=-1;
  subjects.forEach(function(s){
    var ns=normTitle(s.title);
    if(!ns) return;
    var sc=0;
    if(ns===nt) sc=3; else if(ns.indexOf(nt)===0||nt.indexOf(ns)===0) sc=2;
    else{ var tw=nt.split(" ").filter(Boolean),hit=0;
      tw.forEach(function(w){ if(ns.indexOf(w)!==-1) hit++; });
      sc=tw.length?hit/tw.length:0; }
    if(sc>bs){bs=sc;best=s;}
  });
  return bs>0?best:null;
}
function tmdbMetadata(tmdbId,mediaType){
  var kind=mediaType==="tv"?"tv":"movie";
  return fetchWithTimeout("https://api.themoviedb.org/3/"+kind+"/"+tmdbId+"?api_key="+TMDB_API_KEY,{},12000)
    .then(function(r){return r.ok?r.json():null;})
    .then(function(j){
      if(!j) return null;
      var title=j.title||j.name||j.original_title||j.original_name;
      return title?{title:title}:null;
    }).catch(function(){return null;});
}
function qualityFromRes(r){
  var m=String(r||"").match(/(\d{3,4})/);
  if(m){var n=parseInt(m[1],10);
    if(n>=2160)return "2160p";if(n>=1440)return "1440p";if(n>=1080)return "1080p";
    if(n>=720)return "720p";if(n>=480)return "480p";if(n>=360)return "360p";}
  return "Unknown";
}
function getStreams(tmdbId,mediaType,seasonNum,episodeNum,suppliedTitle){
  var isSeries=mediaType==="tv";
  var sn=isSeries?(seasonNum==null?1:Number(seasonNum)):0;
  var en=isSeries?(episodeNum==null?1:Number(episodeNum)):0;
  var titleP=suppliedTitle?Promise.resolve({title:suppliedTitle}):tmdbMetadata(tmdbId,mediaType);
  return titleP.then(function(meta){
    if(!meta||!meta.title) return [];
    return searchMovieBox(meta.title).then(function(subjects){
      var best=pickBest(subjects,meta.title);
      if(!best) return [];
      return getPlayInfo(best.subjectId,sn,en).then(function(streams){
        var out=[],seen={};
        streams.forEach(function(s){
          if(!s.url||seen[s.url]||s.isPreview) return;
          seen[s.url]=1;
          var q=qualityFromRes(s.resolutions)||(/m3u8/i.test(s.url)?"1080p":"Unknown");
          out.push({name:"MovieBox",title:"MovieBox • "+(s.format||"")+" "+(s.resolutions||"")+(s.lang?" • "+s.lang:""),
            url:s.url,quality:q,type:"direct"});
        });
        return out;
      });
    });
  }).catch(function(){return [];});
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
