/* Goojara Diag 6 - CHAIN readout (transport is now proven good).
   Diag5 on-device (2026-10-22 19:18): https-ww1 HTTP 200 with the
   real homepage (len 7768, GOOJARA), http 301, www 200 - the site
   is fully reachable from the phone's Wi-Fi. Yet the regular
   provider still errors, so the break is INSIDE the chain:
   session cookies -> xmre search POST -> watch page -> embeds.
   Diag6 runs that exact chain sequentially with plain fetches and
   returns one row per step. It also reports whether the app bridge
   exposes Set-Cookie at all - the session needs BOTH the server
   Set-Cookie session cookie and the _3chk pair from the page;
   without the server cookie the search POST answers empty. */
var BASE = "https://ww1.goojara.to";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
var KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var LOG = [];
function dlog(s) { LOG.push(String(s).slice(0, 108)); }
function rows(summary) {
  var out = [{ name: "GoojaraDiag", title: String(summary).slice(0, 108), url: BASE + "/", quality: "HD", type: "direct" }];
  LOG.slice(0, 12).forEach(function (t) {
    out.push({ name: "GoojaraDiag", title: t, url: BASE + "/", quality: "HD", type: "direct" });
  });
  return out;
}

var jar = {};
var dataIns = "";
function absorb(res) {
  var info = "fn=n/a hdr=n/a";
  try {
    var list = null;
    if (res.headers && typeof res.headers.getSetCookie === "function") {
      list = res.headers.getSetCookie();
      info = "getSetCookie count=" + (list ? list.length : "null");
    } else if (res.headers && typeof res.headers.get === "function") {
      var sc = res.headers.get("set-cookie");
      info = "set-cookie hdr=" + (sc === null ? "NULL" : "len " + String(sc).length);
      if (sc) list = String(sc).split(/,(?=[^;,]+=)/);
    }
    if (list) list.forEach(function (c) {
      var pair = String(c).split(";")[0];
      var i = pair.indexOf("=");
      if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    });
  } catch (e) { info = "absorb ERR " + (e && e.message); }
  return info;
}
function cookieHeader() {
  return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; ");
}
function jarDesc() {
  return Object.keys(jar).map(function (k) { return k + "(" + String(jar[k]).length + ")"; }).join(",") || "EMPTY";
}
function rawFetch(url, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  if (!opts.headers["User-Agent"]) opts.headers["User-Agent"] = UA;
  return fetch(url, opts).then(function (r) {
    var scInfo = absorb(r);
    return (typeof r.text === "function" ? r.text() : Promise.resolve("")).then(function (t) {
      return { status: r.status, url: r.url || "", text: t || "", loc: (r.headers && r.headers.get) ? r.headers.get("location") : null, scInfo: scInfo };
    });
  });
}

function getStreamsDiag(tmdbId, mediaType, seasonNum, episodeNum) {
  LOG = []; jar = {}; dataIns = "";
  var T0 = Date.now();
  function el() { return ((Date.now() - T0) / 1000).toFixed(1) + "s"; }
  dlog("start " + el());
  // S1 session (TMDB first, like the real provider)
  return fetch("https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + KEY, { headers: { "User-Agent": UA } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      dlog("S0 tmdb: " + (j && j.title ? j.title + " (" + String(j.release_date || "").slice(0, 4) + ")" : "NO TITLE") + " " + el());
      var h = { "Accept": "text/html" };
      if (cookieHeader()) h["Cookie"] = cookieHeader();
      return rawFetch(BASE + "/", { headers: h });
    })
    .then(function (s1) {
      var m = /_3chk\(\s*'([^']+)'\s*,\s*'([^']+)'\)/.exec(s1.text);
      if (m) jar[m[1]] = m[2];
      var d = /id="res"[^>]*data-ins="([^"]+)"/.exec(s1.text) || /data-ins="([^"]+)"/.exec(s1.text);
      if (d) dataIns = d[1];
      dlog("S1 session HTTP " + s1.status + " len=" + s1.text.length + " " + el());
      dlog("S1 cookies: " + s1.scInfo);
      dlog("S1 chk=" + !!m + " dataIns=" + (dataIns ? "yes(" + dataIns.length + ")" : "NO") + " jar=" + jarDesc());
      if (!dataIns) throw new Error("no dataIns - chain stops");
      // S2 search POST exactly like the provider
      var body = "z=" + encodeURIComponent(dataIns) + "&x=bcb23b0360&q=" + encodeURIComponent("The Matrix");
      var h = { "Content-Type": "application/x-www-form-urlencoded", "Referer": BASE + "/", "X-Requested-With": "XMLHttpRequest" };
      if (cookieHeader()) h["Cookie"] = cookieHeader();
      return rawFetch(BASE + "/xmre.php", { method: "POST", headers: h, body: body });
    })
    .then(function (s2) {
      var results = [], m;
      var re = /<a href="(\/[mt][A-Za-z0-9]+)">\s*<div class="i[mt]">\s*<strong>([^<]+)<\/strong>\s*\((\d{4})\)/g;
      while ((m = re.exec(s2.text)) !== null) { results.push({ href: m[1], title: m[2] }); if (results.length >= 12) break; }
      dlog("S2 search HTTP " + s2.status + " len=" + s2.text.length + " hits=" + results.length + " " + el());
      dlog("S2 cookies: " + s2.scInfo + " jar=" + jarDesc());
      if (!results.length) {
        dlog("S2 raw head: " + s2.text.slice(0, 60).replace(/\s+/g, " "));
        throw new Error("search empty - chain stops");
      }
      var first = results[0];
      dlog("S2 first: " + first.title + " " + first.href);
      var h = { "Referer": BASE + "/" };
      if (cookieHeader()) h["Cookie"] = cookieHeader();
      return rawFetch(BASE + first.href, { headers: h }).then(function (s3) {
        var links = [], lm;
        var lre = /href="(https?:\/\/[^"]*go\.php\?url=[^"]+)"/g;
        while ((lm = lre.exec(s3.text)) !== null) { if (links.indexOf(lm[1]) === -1) links.push(lm[1]); }
        dlog("S3 page HTTP " + s3.status + " len=" + s3.text.length + " golinks=" + links.length + " " + el());
        if (!links.length) throw new Error("no go links - chain stops");
        var go = links[0].replace(/^https?:\/\/[^/]+/, BASE);
        var gh = { "Referer": BASE + first.href };
        if (cookieHeader()) gh["Cookie"] = cookieHeader();
        return rawFetch(go, { method: "GET", redirect: "manual", headers: gh });
      });
    })
    .then(function (s4) {
      var target = s4.loc || (s4.url && s4.url.indexOf("go.php") === -1 ? s4.url : null);
      dlog("S4 go.php HTTP " + s4.status + " loc=" + (target ? String(target).slice(0, 52) : "NONE") + " " + el());
      if (!target) throw new Error("go.php no redirect - stops");
      return rawFetch(target, { headers: { "Referer": BASE + "/" } }).then(function (s5) {
        var media = /(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/.exec(s5.text) || /(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/.exec(s5.text);
        var packed = s5.text.indexOf("eval(function(p,a,c,k,e,d)") !== -1;
        dlog("S5 embed HTTP " + s5.status + " len=" + s5.text.length + " media=" + (media ? "DIRECT" : packed ? "PACKED" : "none") + " " + el());
        dlog("DONE " + el());
        return rows("GJD6 DONE " + el());
      });
    })
    .catch(function (e) {
      dlog("STOP: " + String((e && e.message) || e).slice(0, 70) + " " + el());
      return rows("GJD6 STOPPED " + el());
    });
}
global.getStreams = getStreamsDiag;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreamsDiag };
}
