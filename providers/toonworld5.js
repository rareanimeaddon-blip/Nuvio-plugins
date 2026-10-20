// ToonWorld4All scraper for Nuvio
// Standalone, sandbox-compatible (no Node APIs, no external deps).
// Searches toonworld4all.me, resolves archive.toonworld4all.me encodes,
// decrypts /redirect/ tokens (AES-256-CTR, pure JS), extracts HubCloud/Pixeldrain links.

var BASE_URL = "https://toonworld4all.me";
var TMDB_API = "https://api.themoviedb.org/3";
var ARCV_BASE = "https://archive.toonworld4all.me";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

// ---------- tiny AES-256 (ECB single block, for CTR keystream) ----------
var AES_SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];
var AES_RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function aes256ExpandKey(key) {
  var w = new Array(60);
  for (var i = 0; i < 8; i++) {
    w[i] = (key[4*i]<<24)|(key[4*i+1]<<16)|(key[4*i+2]<<8)|key[4*i+3];
  }
  for (i = 8; i < 60; i++) {
    var t = w[i-1];
    if (i % 8 === 0) {
      t = (AES_SBOX[(t>>>16)&0xff]<<24)|(AES_SBOX[(t>>>8)&0xff]<<16)|(AES_SBOX[t&0xff]<<8)|AES_SBOX[(t>>>24)&0xff];
      t ^= AES_RCON[((i / 8) | 0) - 1] << 24;
    } else if (i % 8 === 4) {
      t = (AES_SBOX[(t>>>24)&0xff]<<24)|(AES_SBOX[(t>>>16)&0xff]<<16)|(AES_SBOX[(t>>>8)&0xff]<<8)|AES_SBOX[t&0xff];
    }
    w[i] = w[i-8] ^ t;
  }
  return w;
}
function xtime(a){ return ((a<<1)^((a&0x80)?0x1b:0))&0xff; }
function aesEncryptBlock(block, w) {
  var s = new Array(16);
  for (var i=0;i<16;i++) s[i]=block[i]^(w[i>>2]>>>(24-(i%4)*8)&0xff);
  for (var round=1; round<=14; round++) {
    for (i=0;i<16;i++) s[i]=AES_SBOX[s[i]];
    // shift rows
    var t=s[1];s[1]=s[5];s[5]=s[9];s[9]=s[13];s[13]=t;
    t=s[2];s[2]=s[10];s[10]=t;t=s[6];s[6]=s[14];s[14]=t;
    t=s[15];s[15]=s[11];s[11]=s[7];s[7]=s[3];s[3]=t;
    if (round<14) {
      for (var c=0;c<4;c++) {
        var a0=s[4*c],a1=s[4*c+1],a2=s[4*c+2],a3=s[4*c+3];
        s[4*c]=xtime(a0)^xtime(a1)^a1^a2^a3;
        s[4*c+1]=a0^xtime(a1)^xtime(a2)^a2^a3;
        s[4*c+2]=a0^a1^xtime(a2)^xtime(a3)^a3;
        s[4*c+3]=xtime(a0)^a0^a1^a2^xtime(a3);
      }
    }
    for (i=0;i<16;i++) s[i]^=(w[round*4+(i>>2)]>>>(24-(i%4)*8))&0xff;
  }
  return s;
}

// ---------- helpers ----------
function fetchWithTimeout(url, options, timeoutMs) {
  // Timer-free (webOS TV QuickJS has no setTimeout): plain fetch;
  // the platform service bounds each request.
  return fetch(url, options || {});
}
function safeFetch(url, options) {
  var headers = Object.assign({ "User-Agent": USER_AGENT }, (options && options.headers) || {});
  var opts = Object.assign({}, options, { headers: headers });
  return fetchWithTimeout(url, opts, 15000).catch(function(){
    return { ok:false, status:504, url:"", headers:{get:function(){return "";}}, text:function(){return Promise.resolve("");}, json:function(){return Promise.resolve(null);} };
  });
}
function hexToBytes(hex){
  var b=[];
  for(var i=0;i+1<hex.length;i+=2) b.push(parseInt(hex.substr(i,2),16));
  return b;
}
function bytesToUtf8(bytes){
  try{
    var s="";
    for(var i=0;i<bytes.length;i++) s+="%"+(bytes[i]<16?"0":"")+bytes[i].toString(16);
    return decodeURIComponent(s);
  }catch(e){
    return String.fromCharCode.apply(null,bytes);
  }
}
function decryptRedirectToken(tokenHex){
  try{
    if(!tokenHex||tokenHex.length<34) return null;
    var raw=hexToBytes(tokenHex);
    var counter=raw.slice(0,16), cipher=raw.slice(16);
    var blocks=Math.ceil(cipher.length/16);
    var key=hexToBytes("556151c9cefdee6ea51aec956e6b8682312bb609c0167d4adc71f365a928920f");
    var w=aes256ExpandKey(key);
    var plain=[];
    var ctr=counter.slice();
    for(var b=0;b<blocks;b++){
      var ks=aesEncryptBlock(ctr,w);
      for(var i=0;i<16 && b*16+i<cipher.length;i++) plain.push(cipher[b*16+i]^ks[i]);
      for(var j=15;j>=0;j--){ ctr[j]=(ctr[j]+1)&0xff; if(ctr[j]!==0) break; }
    }
    var payload=JSON.parse(bytesToUtf8(plain));
    return (payload&&payload.url)||null;
  }catch(e){ return null; }
}
function extractEmbeddedProps(html){
  var mi=html.indexOf("__PROPS__");
  if(mi===-1) return null;
  var js=html.indexOf("{",mi);
  if(js===-1) return null;
  var je=html.indexOf("</script>",js);
  if(je===-1) return null;
  try{ return JSON.parse(html.slice(js,je).trim().replace(/;\s*$/,"")); }
  catch(e){ return null; }
}
function resolveRedirectTarget(redirectPath){
  var raw=String(redirectPath||"");
  var tm=raw.match(/\/redirect\/([0-9a-fA-F]{32,})/);
  if(tm){
    var u=decryptRedirectToken(tm[1]);
    if(u&&u.indexOf("http")===0) return Promise.resolve(u);
  }
  var absUrl=raw.indexOf("http")===0?raw:ARCV_BASE+(raw.charAt(0)==="/"?"":"/")+raw;
  return safeFetch(absUrl).then(function(res){
    if(!res.ok) return null;
    return res.text().then(function(html){
      var props=extractEmbeddedProps(html);
      if(props){
        if(props.link&&props.link.domain&&props.link.hidden) return props.link.domain+props.link.hidden;
        if(props.destination&&props.destination.indexOf("http")===0) return props.destination;
      }
      var ob=html.match(/<code>(https?:\/\/[^<]+)<span[^>]*>([^<]+)<\/span><\/code>/i);
      if(ob) return ob[1]+ob[2];
      var hm=html.match(/https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:hubcloud\.[a-z]+|pixeldrain\.[a-z]+)\/[^\s"<>']+/i);
      if(hm) return hm[0];
      return null;
    });
  }).catch(function(){ return null; });
}
function fetchTmdbMetadata(tmdbId,isSeries){
  var nid=String(tmdbId||"").replace(/\D/g,"");
  if(!nid||!TMDB_API_KEY) return Promise.resolve(null);
  return safeFetch(TMDB_API+"/"+(isSeries?"tv":"movie")+"/"+nid+"?api_key="+TMDB_API_KEY)
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(!d) return null;
      var title=isSeries?(d.name||d.original_name):(d.title||d.original_title);
      var rd=isSeries?d.first_air_date:d.release_date;
      if(!title) return null;
      return { title:title, year:rd?parseInt(rd.split("-")[0],10):null };
    }).catch(function(){ return null; });
}
function normalizeTitle(v){
  return String(v||"").toLowerCase().replace(/^download\s+/i,"").replace(/\b(the|a|an)\b/g," ").replace(/[^\w\s]/g," ").replace(/\s+/g," ").trim();
}
// Exact-title gate (zero-mismatch): every distinctive word of the TMDB title
// must appear as a whole word in the result title, and the word sets must be
// near-identical (dice >= 0.8) once release/season noise words are dropped.
// Kills substring false hits like "Young Sheldon" -> "Young Justice Season 1".
var TITLE_NOISE = { the: 1, a: 1, an: 1, with: 1, season: 1, seasons: 1, episode: 1, episodes: 1, ep: 1,
  english: 1, hindi: 1, dub: 1, dubbed: 1, sub: 1, subbed: 1, subtitle: 1, subtitles: 1, subs: 1, multi: 1, audio: 1, complete: 1,
  hevc: 1, x264: 1, x265: 1, h264: 1, webdl: 1, hdtv: 1, bluray: 1, brrip: 1, hdrip: 1,
  "480p": 1, "720p": 1, "1080p": 1, "1440p": 1, "2160p": 1, "4k": 1, uhd: 1, hd: 1,
  watch: 1, download: 1, online: 1, sony: 1, yay: 1, uncensored: 1, uncut: 1, hungama: 1, tamil: 1, telugu: 1 };
var ACCENT_MAP = { "ā": "a", "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
  "ē": "e", "é": "e", "è": "e", "ê": "e", "ë": "e", "ī": "i", "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ō": "o", "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ū": "u", "ú": "u", "ù": "u", "û": "u",
  "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y" };
function foldAccents(s){
  return String(s).replace(/[āáàâäãåēéèêëīíìîïōóòôöõūúùûüñçýÿ]/g, function(ch){ return ACCENT_MAP[ch] || ch; });
}
function exactWords(v){
  var seen={}, out=[];
  normalizeTitle(foldAccents(String(v).toLowerCase())).split(" ").forEach(function(w){
    if(!w || TITLE_NOISE[w] || /^\d+$/.test(w) || /^s\d{1,2}(e\d{1,2})?$/.test(w) || /^e\d{1,2}$/.test(w)) return;
    if(!seen[w]){ seen[w]=1; out.push(w); }
  });
  return out;
}
var TAIL_JUNK = { mal: 1, ben: 1, jap: 1, kor: 1, chi: 1, eng: 1, hq: 1, dvdrip: 1, xvid: 1, aac: 1,
  proper: 1, repack: 1, extended: 1, unrated: 1, remastered: 1, dual: 1, web: 1, dl: 1 };
function isTailJunk(w) { return !!TAIL_JUNK[w] || /^\d{3,4}p$/.test(w) || /^\d+bit$/.test(w); }
function isExactTitle(queryTitle, candTitle){
  var q=exactWords(queryTitle), c=exactWords(candTitle);
  if(!q.length || !c.length) return false;
  if(q.join("") === c.join("")) return true; // one-word listings: "Shinchan" == "Shin Chan"
  var cset={};
  c.forEach(function(w){ cset[w]=1; });
  var contained=true;
  for(var i=0;i<q.length;i++) if(!cset[q[i]]){ contained=false; break; }
    if (contained && (2*q.length)/(q.length+c.length) >= 0.8) return true;
  // Release-junk tail: the title words lead and only tech/release tokens
  // follow (e.g. "Shinchan Season 1 ... 480p HQ DVDRip 10bit HEVC").
  var stripped = [];
  for (var j = 0; j < c.length; j++) { if (!isTailJunk(c[j])) stripped.push(c[j]); }
  if (stripped.length && stripped.join("") === q.join("") && c.slice(0, stripped.length).join("") === q.join("")) return true;
  return false;
}
function scoreSearchResult(rt,tt,ty,isSeries,seasonNumber){
  if(!isExactTitle(tt,rt)) return -1;
  var nt=normalizeTitle(tt),nr=normalizeTitle(rt);
  var tw=nt.split(" ").filter(Boolean);
  var mw=tw.filter(function(w){return nr.indexOf(w)!==-1;});
  if(tw.length>0&&mw.length===0) return -1;
  var s=tw.length>0?mw.length/tw.length:0;
  if(nr.indexOf(nt)===0) s+=0.35; else if(nr.indexOf(nt)!==-1) s+=0.15;
  if(ty&&rt.indexOf(String(ty))!==-1) s+=0.25;
  if(isSeries){
    var ps=String(seasonNumber).padStart(2,"0");
    var sp=new RegExp("\\b(?:Season\\s*0*"+seasonNumber+"|S"+ps+"|S0*"+seasonNumber+")\\b","i");
    if(sp.test(rt)) s+=0.4; else if(/\b(?:Season\s*\d+|S\d{1,2})\b/i.test(rt)) s-=0.45;
    var spin=/\b(?:spin[\s-]?off|gaiden)\b/i.test(tt);
    if(!spin&&/\b(?:spin[\s-]?off|gaiden)\b/i.test(rt)) s-=0.75;
  }else if(/\b(?:Season\s*\d+|S\d{1,2}|Episodes)\b/i.test(rt)) s-=0.4;
  return s;
}
function detectQuality(fn,fl){
  var m=String(fn||"").match(/\b(2160p|4K|UHD|1440p|2K|1080p|720p|540p|480p|360p)\b/i)||String(fl||"").match(/\b(2160p|4K|UHD|1440p|2K|1080p|720p|540p|480p|360p)\b/i);
  if(!m) return "1080p";
  var q=m[1].toUpperCase();
  if(q==="2160P"||q==="4K"||q==="UHD") return "2160p";
  if(q==="1440P") return "1440p"; if(q==="2K") return "1440p";
  if(q==="1080P") return "1080p"; if(q==="720P") return "720p";
  if(q==="540P") return "480p"; if(q==="480P") return "480p";
  if(q==="360P") return "360p";
  return "1080p";
}
// regex-based article parsing (no cheerio in sandbox)
function parseSearchArticles(html){
  var out=[];
  var re=/<article[\s\S]*?<\/article>/gi, m;
  while((m=re.exec(html))){
    var a=m[0];
    var hm=a.match(/<a[^>]+href="([^"]+)"/i);
    var tm=a.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)||a.match(/class="entry-title"[^>]*>([\s\S]*?)</i);
    var url=hm?hm[1].trim():"";
    var title=tm?tm[1].replace(/<[^>]+>/g,"").trim():"";
    if(!title&&hm){
      var tm2=a.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
      title=tm2?tm2[1].replace(/<[^>]+>/g,"").trim():"";
    }
    if(url&&title&&!/shows-list|movies-list/i.test(url)) out.push({url:url,title:title});
  }
  return out;
}
function parseArchiveLinks(html,isSeries,epPattern){
  var set={},out=[];
  var re=/<a[^>]+href="([^"]*archive\.toonworld4all[^"]*)"[^>]*>/gi,m;
  while((m=re.exec(html))){
    var href=m[1].trim();
    if(!href||set[href]) continue;
    if(isSeries){
      if(href.indexOf("/episode/")!==-1&&epPattern.test(href)){set[href]=1;out.push(href);}
    }else if(href.indexOf("/movie/")!==-1){set[href]=1;out.push(href);}
  }
  return out;
}
function parseHubCloud(html){
  var fileName="",fileSize="",genUrl="";
  var ch=html.match(/<div[^>]*class="card-header"[^>]*>([\s\S]*?)<\/div>/i);
  if(ch) fileName=ch[1].replace(/<[^>]+>/g,"").trim();
  var sm=html.match(/<i[^>]*id="size"[^>]*>([\s\S]*?)<\/i>/i);
  if(sm){
    var s2=sm[1].match(/(\d+(?:\.\d+)?\s*(?:GB|MB))/i);
    fileSize=s2?s2[1]:"";
  }
  var gm=html.match(/<a[^>]*id="download"[^>]*href="([^"]+)"/i)||html.match(/<a[^>]*class="[^"]*btn-primary[^"]*"[^>]*href="([^"]*hubcloud\.php[^"]*)"/i);
  if(gm) genUrl=gm[1];
  else{ var fm=html.match(/https?:\/\/[^"'\s>]+hubcloud\.php\?[^"'\s>]+/i); if(fm) genUrl=fm[0]; }
  return {fileName:fileName,fileSize:fileSize,genUrl:genUrl};
}
function parseGenLinks(html){
  var out=[];
  var re=/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(html))) out.push({href:m[1].trim(),text:m[2].replace(/<[^>]+>/g,"").trim()});
  return out;
}
function searchPosts(query,metadata,isSeries,seasonNumber){
  return safeFetch(BASE_URL+"/?s="+encodeURIComponent(query)).then(function(r){
    if(!r.ok) return [];
    return r.text().then(function(html){
      var cands=[];
      parseSearchArticles(html).forEach(function(a){
        var s=scoreSearchResult(a.title,metadata.title,metadata.year,isSeries,seasonNumber);
        if(s>=0.35) cands.push({url:a.url,score:s});
      });
      return cands;
    });
  }).catch(function(){return [];});
}
function findBestMatchingPost(metadata,isSeries,seasonNumber){
  var nq=metadata.title.toLowerCase().replace(/[()[\]!?&'",:._-]/g," ").replace(/\s+/g," ").trim();
  var sq=nq.split(" ").slice(0,3).join(" ");
  var tqs=[nq]; if(sq&&sq!==nq) tqs.push(sq);
  var qs=[];
  if(isSeries&&seasonNumber>0) tqs.forEach(function(q){qs.push(q+" season "+seasonNumber);});
  tqs.forEach(function(q){qs.push(q);});
  var seen={},uq=[];
  qs.forEach(function(q){ if(q&&!seen[q]){seen[q]=1;uq.push(q);} });
  return Promise.all(uq.map(function(q){return searchPosts(q,metadata,isSeries,seasonNumber);}))
    .then(function(all){
      var seenU={},best=null;
      all.forEach(function(cands){
        cands.forEach(function(c){
          if(seenU[c.url]) return; seenU[c.url]=1;
          if(!best||c.score>best.score) best=c;
        });
      });
      return best;
    });
}
function buildEpisodePattern(sn,en){
  var ps=String(sn).padStart(2,"0");
  var p="(?:-"+sn+"x0*"+en+"|-"+ps+"x0*"+en+"|-(?:ep|episode)-?0*"+en;
  if(sn===1) p+="|-[xX]0*"+en;
  return new RegExp(p+")(?:/|\\?|$)","i");
}
function createStream(serverLabel,url,fileName,fallbackLabel,fileSize){
  var label="ToonWorld4All • "+serverLabel+" • Multi-Dub";
  var q=detectQuality(fileName,fallbackLabel);
  return { name:label, title:label+(fileSize?" • "+fileSize:""), url:url, quality:q, type:"direct" };
}
function createPixeldrainStream(link,fileName,label,fileSize){
  var m=link.match(/\/u\/([A-Za-z0-9_-]+)/);
  if(!m) return null;
  return createStream("Pixeldrain","https://pixeldrain.com/api/file/"+m[1]+"?download",fileName,label,fileSize);
}
function extractHubCloudStreams(pageUrl,label,fallbackSize){
  return safeFetch(pageUrl).then(function(r){
    if(!r.ok) return [];
    return r.text().then(function(html){
      var p=parseHubCloud(html);
      if(!p.genUrl) return [];
      return safeFetch(p.genUrl,{headers:{Referer:pageUrl}}).then(function(gr){
        if(!gr.ok) return [];
        return gr.text().then(function(ghtml){
          var streams=[];
          if(!p.fileName){
            var ch=ghtml.match(/<div[^>]*class="card-header"[^>]*>([\s\S]*?)<\/div>/i);
            if(ch) p.fileName=ch[1].replace(/<[^>]+>/g,"").trim();
          }
          parseGenLinks(ghtml).forEach(function(a){
            if(a.href.indexOf("http")!==0) return;
            if(/FSLv2/i.test(a.text)) streams.push(createStream("FSLv2",a.href,p.fileName,label,p.fileSize||fallbackSize));
            else if(/FSL\s*Server/i.test(a.text)) streams.push(createStream("FSL Server",a.href,p.fileName,label,p.fileSize||fallbackSize));
            else if(/pixeldrain|pixelserver/i.test(a.text)||a.href.indexOf("pixeldrain.")!==-1){
              var ps=createPixeldrainStream(a.href,p.fileName,label,p.fileSize||fallbackSize);
              if(ps) streams.push(ps);
            }
          });
          return streams;
        });
      });
    });
  }).catch(function(){return [];});
}
function resolveStreamsFromRedirect(redirectLink,label,size){
  return resolveRedirectTarget(redirectLink).then(function(dest){
    if(!dest) return [];
    if(dest.indexOf("hubcloud.")!==-1) return extractHubCloudStreams(dest,label,size);
    if(dest.indexOf("pixeldrain.")!==-1){
      var ps=createPixeldrainStream(dest,"",label,size);
      return ps?[ps]:[];
    }
    return [];
  }).catch(function(){return [];});
}
function extractArchivePageStreams(archiveUrl,postTitle){
  return safeFetch(archiveUrl).then(function(r){
    if(!r.ok) return [];
    return r.text().then(function(html){
      var jobs=[];
      var props=extractEmbeddedProps(html);
      var encodes=(props&&props.data&&props.data.data&&props.data.data.encodes)||[];
      encodes.forEach(function(enc){
        var codec=(enc.readable&&enc.readable.codec)||enc.resolution||"";
        var size=(enc.readable&&enc.readable.size)||"";
        var label=[codec,postTitle].filter(Boolean).join(" ");
        (enc.files||[]).forEach(function(f){
          if(f&&f.link) jobs.push(resolveStreamsFromRedirect(f.link,label,size));
        });
      });
      if(jobs.length===0){
        var re=/<a[^>]+href="([^"]*\/redirect\/[^"]*)"[^>]*>/gi,m,seen={};
        while((m=re.exec(html))){
          var href=m[1].trim();
          if(href&&!seen[href]){seen[href]=1;jobs.push(resolveStreamsFromRedirect(href,postTitle,""));}
        }
      }
      return Promise.all(jobs).then(function(all){
        var flat=[];
        all.forEach(function(a){flat=flat.concat(a);});
        return flat;
      });
    });
  }).catch(function(){return [];});
}
var SUPPORTED_Q=new Set(["2160p","1440p","1080p","720p","480p","360p"]);
function getStreams(tmdbId,mediaType,seasonNum,episodeNum,suppliedMetadata){
  var isSeries=mediaType==="tv";
  if(isSeries&&(seasonNum==null||episodeNum==null)) return Promise.resolve([]);
  var sn=isSeries?Number(seasonNum):null,en=isSeries?Number(episodeNum):null;
  var metaPromise=(suppliedMetadata&&suppliedMetadata.title)
    ? Promise.resolve(suppliedMetadata)
    : fetchTmdbMetadata(tmdbId,isSeries);
  return metaPromise.then(function(metadata){
    if(!metadata) return [];
    return findBestMatchingPost(metadata,isSeries,sn||0).then(function(post){
      if(!post) return [];
      return safeFetch(post.url).then(function(r){
        if(!r.ok) return [];
        return r.text().then(function(html){
          var epPat=isSeries?buildEpisodePattern(sn,en):null;
          var urls=parseArchiveLinks(html,isSeries,epPat);
          return Promise.all(urls.map(function(u){return extractArchivePageStreams(u,post.title);}))
            .then(function(all){
              var seen={},out=[];
              all.forEach(function(arr){
                arr.forEach(function(s){
                  if(s&&s.url&&SUPPORTED_Q.has(s.quality)&&!seen[s.url]){seen[s.url]=1;out.push(s);}
                });
              });
              out.sort(function(a,b){
                var qa=parseInt(a.quality)||0,qb=parseInt(b.quality)||0;
                return qb-qa;
              });
              return out;
            });
        });
      });
    });
  }).catch(function(){return [];});
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.ToonWorldScraperModule = { getStreams: getStreams };
}
