// TV DIAG v5 - step-by-step chains for the failing provider families.
var ANIDISK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var FF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
var API = "https://api.deadbase.host/api/v1/public";
var KARTOONS_TOKEN = "DNU1ZBzyTpwPldcjg09_RBKp5KgrQaMv0tdqDr9SX48";
function entry(name, msg) { return { name: "D5 " + name + ": " + msg, url: "https://example.com/" }; }
function probe(name, fn) {
  return fn().then(function (msg) { return entry(name, msg); })
    .catch(function (e) { return entry(name, "FAIL " + String((e && e.message) || e).slice(0, 80)); });
}
function apiGet(path) {
  return fetch(API + path, { headers: { "User-Agent": ANIDISK_UA, "origin": "https://anidisk.org", "referer": "https://anidisk.org/", "accept": "application/json" } })
    .then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        return { status: r.status, ok: r.ok, len: t.length, json: j, text: t };
      });
    });
}
function anidiskChain() {
  var log = [];
  return apiGet("/anime/search?q=Shin%20Chan").then(function (s) {
    log.push("search " + s.status + "/" + s.len);
    var hits = Array.isArray(s.json) ? s.json : (s.json && (s.json.results || s.json.data)) || [];
    log.push("hits=" + (Array.isArray(hits) ? hits.length : "?"));
    var slug = null;
    if (Array.isArray(hits)) for (var i = 0; i < hits.length; i++) {
      if (hits[i] && hits[i].slug && String(hits[i].slug).indexOf("shin") >= 0) { slug = hits[i].slug; break; }
    }
    if (!slug && Array.isArray(hits) && hits.length && hits[0].slug) slug = hits[0].slug;
    log.push("slug=" + (slug ? String(slug).slice(0, 24) : "NONE"));
    if (!slug) return log.join(" | ");
    return apiGet("/anime/" + encodeURIComponent(slug) + "/season/1/episode/1").then(function (ep) {
      log.push("ep " + ep.status + "/" + ep.len);
      var servers = (ep.json && ep.json.watch_servers) || [];
      log.push("srv=" + servers.length);
      var hyd = null;
      for (var i = 0; i < servers.length; i++) {
        if (servers[i] && typeof servers[i].name === "string" && servers[i].name.trim().toLowerCase() === "hydrax") { hyd = servers[i]; break; }
      }
      log.push(hyd ? "hydrax=" + hyd.link_server_id : "hydrax=NONE");
      if (!hyd) return log.join(" | ");
      return apiGet("/watch/" + hyd.link_server_id + "/resolve").then(function (rv) {
        var embed = rv.json && rv.json.embed_url;
        log.push("resolve " + rv.status + " embed=" + (embed ? String(embed).slice(0, 34) : "NONE"));
        if (!embed) return log.join(" | ");
        return fetch(embed, { headers: { "User-Agent": ANIDISK_UA, "referer": "https://anidisk.org/" } }).then(function (pr) {
          return pr.text().then(function (html) {
            var m = /const\s+datas\s*=\s*"([^"]*)"/.exec(html);
            log.push("page " + pr.status + "/" + html.length + " datas=" + (m ? "Y" : "N"));
            if (m) {
              try {
                var meta = JSON.parse(atob(m[1]));
                log.push("meta slug=" + (typeof meta.slug) + " md5=" + (typeof meta.md5_id) + " uid=" + (typeof meta.user_id) + " media=" + (typeof meta.media) + "/" + (meta.media ? meta.media.length : 0));
              } catch (e) { log.push("meta FAIL " + String(e.message || e).slice(0, 30)); }
            }
            return log.join(" | ");
          });
        });
      });
    });
  });
}
function goojaraFlow() {
  var jar = {};
  function absorb(res) {
    try {
      var sc = res.headers && res.headers.get ? res.headers.get("set-cookie") : null;
      if (sc) String(sc).split(/,(?=[^;,]+=)/).forEach(function (c) {
        var pair = c.split(";")[0], i = pair.indexOf("=");
        if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
      });
    } catch (e) {}
  }
  function cookies() { return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; "); }
  return fetch("https://ww1.goojara.to/", { headers: { "User-Agent": FF_UA, "Accept": "text/html" } }).then(function (r) {
    absorb(r);
    return r.text().then(function (html) {
      var log = "home " + r.status + "/" + html.length;
      var chk = /_3chk\(\s*'([^']+)'\s*,\s*'([^']+)'\)/.exec(html);
      var ins = /id="res"[^>]*data-ins="([^"]+)"/.exec(html) || /data-ins="([^"]+)"/.exec(html);
      log += " chk=" + (chk ? "Y" : "N") + " ins=" + (ins ? "Y" : "N") + " jar=" + Object.keys(jar).length;
      if (!ins) return log;
      if (chk) jar[chk[1]] = chk[2];
      var h = { "User-Agent": FF_UA, "Content-Type": "application/x-www-form-urlencoded", "Referer": "https://ww1.goojara.to/", "X-Requested-With": "XMLHttpRequest" };
      if (cookies()) h["Cookie"] = cookies();
      var body = "z=" + encodeURIComponent(ins[1]) + "&x=bcb23b0360&q=" + encodeURIComponent("Project Hail Mary");
      return fetch("https://ww1.goojara.to/xmre.php", { method: "POST", headers: h, body: body }).then(function (r2) {
        return r2.text().then(function (t2) {
          return log + " | xmre " + r2.status + "/" + t2.length + " links=" + ((t2.indexOf("/m") >= 0 || t2.indexOf("go.php") >= 0) ? "Y" : "N");
        });
      });
    });
  });
}
function piratexFlow() {
  return fetch("https://piratexplay.cc/api/search-ajax.php?keyword=Naruto", { headers: { "User-Agent": FF_UA, "Accept": "application/json" } }).then(function (r) {
    return r.text().then(function (t) {
      var log = "search " + r.status + "/" + t.length + " naruto=" + (t.toLowerCase().indexOf("naruto") >= 0 ? "Y" : "N");
      return fetch("https://piratexplay.cc/episode/naruto-season-1-46260-1x1/", { headers: { "User-Agent": FF_UA, "Accept": "text/html" } }).then(function (r2) {
        return r2.text().then(function (t2) {
          var ifr = (t2.match(/<iframe/g) || []).length;
          return log + " | epPage " + r2.status + "/" + t2.length + " iframes=" + ifr;
        });
      });
    });
  });
}
function getStreams() {
  var tests = [];
  tests.push(probe("ANIDISK chain", anidiskChain));
  tests.push(probe("GOOJARA flow", goojaraFlow));
  tests.push(probe("PIRATEX flow", piratexFlow));
  tests.push(probe("ANIMEWORLD search", function () {
    return fetch("https://watchanimeworld.top/?s=Shin%20Chan", { headers: { "User-Agent": ANIDISK_UA, "Accept": "text/html" } }).then(function (r) {
      return r.text().then(function (t) { return "HTTP " + r.status + " len=" + t.length + " shin=" + (t.toLowerCase().indexOf("shin") >= 0 ? "Y" : "N"); });
    });
  }));
  tests.push(probe("TOONWORLD search", function () {
    return fetch("https://toonworld4all.me/?s=Shin%20Chan", { headers: { "User-Agent": ANIDISK_UA, "Accept": "text/html" } }).then(function (r) {
      return r.text().then(function (t) { return "HTTP " + r.status + " len=" + t.length + " shin=" + (t.toLowerCase().indexOf("shin") >= 0 ? "Y" : "N"); });
    });
  }));
  tests.push(probe("KARTOONS catalog", function () {
    return fetch("https://api.kartoons.to/api/stremio/catalog/movie/kartoons_movies.json?token=" + KARTOONS_TOKEN, { headers: { "User-Agent": ANIDISK_UA, "Accept": "application/json" } }).then(function (r) {
      return r.text().then(function (t) {
        var n = "?"; try { var j = JSON.parse(t); n = (j.metas || []).length; } catch (e) {}
        return "HTTP " + r.status + " len=" + t.length + " metas=" + n;
      });
    });
  }));
  tests.push(probe("STREAMFLIX index", function () {
    return fetch("https://raw.githubusercontent.com/rareanimeaddon-blip/Nuvio-plugins/refs/heads/main/streamflix-data/index.json", {}).then(function (r) {
      return r.text().then(function (t) { return "HTTP " + r.status + " len=" + t.length; });
    });
  }));
  tests.push(probe("ONETOUCH search", function () {
    return fetch("https://api3.devcorp.me/vod/search?keyword=" + encodeURIComponent("The Matrix"), { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Referer": "https://onetouchtv.xyz/" } }).then(function (r) {
      return r.text().then(function (t) { return "HTTP " + r.status + " len=" + t.length + " head=" + t.slice(0, 24).replace(/\s+/g, " "); });
    });
  }));
  return Promise.all(tests);
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
