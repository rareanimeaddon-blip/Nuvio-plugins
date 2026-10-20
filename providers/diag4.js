// TV DIAG v4 - timer-free probes of the failing providers' real first hops.
var TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var ANIDISK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var FF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
function entry(name, msg) { return { name: "D4 " + name + ": " + msg, url: "https://example.com/" }; }
function probe(name, fn) {
  return fn().then(function (msg) { return entry(name, msg); })
    .catch(function (e) { return entry(name, "FAIL " + String((e && e.message) || e).slice(0, 70)); });
}
function get(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (r) {
    return r.text().then(function (t) { return { status: r.status, ok: r.ok, headers: r.headers, body: t }; });
  });
}
function getStreams() {
  var tests = [];
  tests.push(probe("GLOBALS", function () {
    var names = ["setTimeout", "AbortController", "TextEncoder", "TextDecoder", "URLSearchParams", "Headers", "FormData", "queueMicrotask", "atob", "Promise"];
    var missing = [];
    for (var i = 0; i < names.length; i++) {
      var t = eval("typeof " + names[i]);
      if (t === "undefined") missing.push(names[i]);
    }
    var cs = "no-crypto";
    try { cs = (typeof crypto !== "undefined" && crypto.subtle) ? "subtle-OK" : "no-subtle"; } catch (e) { cs = "crypto-err"; }
    return Promise.resolve("missing=[" + missing.join(",") + "] " + cs);
  }));
  tests.push(probe("DEADBASE lowercase-ua", function () {
    return get("https://api.deadbase.host/api/v1/public/anime/search?q=Shin%20Chan",
      { "user-agent": ANIDISK_UA, "origin": "https://anidisk.org", "referer": "https://anidisk.org/", "accept": "application/json" })
      .then(function (r) { return "HTTP " + r.status + " len=" + r.body.length + (r.body.indexOf("shin") >= 0 ? " has-shin" : " NO-shin") + " " + r.body.slice(0, 40).replace(/\s+/g, " "); });
  }));
  tests.push(probe("DEADBASE proper-UA", function () {
    return get("https://api.deadbase.host/api/v1/public/anime/search?q=Shin%20Chan",
      { "User-Agent": ANIDISK_UA, "origin": "https://anidisk.org", "referer": "https://anidisk.org/", "accept": "application/json" })
      .then(function (r) { return "HTTP " + r.status + " len=" + r.body.length + (r.body.indexOf("shin") >= 0 ? " has-shin" : " NO-shin") + " " + r.body.slice(0, 40).replace(/\s+/g, " "); });
  }));
  tests.push(probe("GOOJARA flow", function () {
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
        var home = "home HTTP " + r.status + " len=" + html.length;
        var chk = /_3chk\(\s*'([^']+)'\s*,\s*'([^']+)'\)/.exec(html);
        var ins = /id="res"[^>]*data-ins="([^"]+)"/.exec(html) || /data-ins="([^"]+)"/.exec(html);
        home += chk ? " chk=Y" : " chk=N";
        home += ins ? " ins=Y" : " ins=N";
        home += " jar=" + Object.keys(jar).length;
        if (!ins) return home + " | xmre skipped";
        if (chk) jar[chk[1]] = chk[2];
        var h = { "User-Agent": FF_UA, "Content-Type": "application/x-www-form-urlencoded", "Referer": "https://ww1.goojara.to/", "X-Requested-With": "XMLHttpRequest" };
        if (cookies()) h["Cookie"] = cookies();
        var body = "z=" + encodeURIComponent(ins[1]) + "&x=bcb23b0360&q=" + encodeURIComponent("Project Hail Mary");
        return fetch("https://ww1.goojara.to/xmre.php", { method: "POST", headers: h, body: body }).then(function (r2) {
          return r2.text().then(function (t2) {
            return home + " | xmre HTTP " + r2.status + " len=" + t2.length + (t2.indexOf("/m") >= 0 || t2.indexOf("go.php") >= 0 ? " links=Y" : " links=N");
          });
        });
      });
    });
  }));
  tests.push(probe("ANIMEWORLD search", function () {
    return get("https://watchanimeworld.top/?s=Shin%20Chan", { "User-Agent": ANIDISK_UA, "Accept": "text/html" })
      .then(function (r) { return "HTTP " + r.status + " len=" + r.body.length + (r.body.toLowerCase().indexOf("shin") >= 0 ? " has-shin" : " NO-shin"); });
  }));
  tests.push(probe("PIRATEX search", function () {
    return get("https://piratexplay.cc/api/search-ajax.php?keyword=Naruto", { "User-Agent": FF_UA, "Accept": "application/json" })
      .then(function (r) { return "HTTP " + r.status + " len=" + r.body.length + (r.body.toLowerCase().indexOf("naruto") >= 0 ? " has-naruto" : " NO-naruto") + " " + r.body.slice(0, 40).replace(/\s+/g, " "); });
  }));
  return Promise.all(tests);
}
if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;
if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
