/* Goojara Diag 4 - transport probes with PROVEN mechanisms only.
   Lessons applied from diag2/diag3 on-device results:
   - diag2 (plain fetch chains) DID return rows on Vi; diag3 (which
     polled fetches via a TMDB "tick" race) returned NOTHING on Wi-Fi,
     same as the regular provider. So diag4 uses no polling, no spin,
     no deadline races at all.
   - Every probe is launched as a boxed plain fetch: it records its
     outcome into a variable whenever (if ever) it settles. NOTHING in
     the returned promise ever awaits a probe directly.
   - The returned promise is a plain sequential chain of fetches to
     TMDB (a host every working provider reaches from this phone) -
     that chain is the clock. When it finishes, the rows report each
     probe as settled (status/error + time) or still PENDING, which is
     itself the answer: PENDING after ~10 clock fetches = the fetch
     hangs in the app bridge on this network. */
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
var TMDB_TICK = "https://api.themoviedb.org/3/movie/603?api_key=5f39fd16e987a9e3fce30d55cf09b438";

function getStreamsDiag(tmdbId, mediaType, seasonNum, episodeNum) {
  var T0 = Date.now();
  function el() { return ((Date.now() - T0) / 1000).toFixed(1) + "s"; }
  var boxes = [];
  function box(label, url, opts) {
    var b = { label: label, state: "PENDING", t: "" };
    boxes.push(b);
    var o = opts || {};
    o.headers = o.headers || {};
    if (!o.headers["User-Agent"]) o.headers["User-Agent"] = UA;
    try {
      fetch(url, o).then(function (r) {
        var st = r.status;
        return (typeof r.text === "function" ? r.text() : Promise.resolve("")).then(function (txt) {
          txt = txt || "";
          b.state = "HTTP " + st + " len=" + txt.length + (/data-ins|_3chk|goojara/i.test(txt) ? " GOOJARA" : "");
          b.t = el();
        });
      }).catch(function (e) {
        b.state = "ERR " + String((e && e.message) || e).slice(0, 42);
        b.t = el();
      });
    } catch (e) {
      b.state = "THROW " + String((e && e.message) || e).slice(0, 42);
      b.t = el();
    }
    return b;
  }

  box("https-ww1", "https://ww1.goojara.to/", {});
  box("http-ww1", "http://ww1.goojara.to/", { redirect: "manual" });
  box("https-www", "https://www.goojara.to/", {});
  box("ip+host", "http://104.21.33.208/", { headers: { "Host": "ww1.goojara.to" } });
  box("allorigins", "https://api.allorigins.win/raw?url=https%3A%2F%2Fww1.goojara.to%2F", {});
  box("cf-trace", "https://www.cloudflare.com/cdn-cgi/trace", {});

  // The clock: 10 sequential plain TMDB fetches, each individually
  // caught so one failure cannot break the chain.
  var steps = 0;
  var clock = Promise.resolve();
  for (var i = 0; i < 10; i++) {
    (function () {
      clock = clock.then(function () {
        return fetch(TMDB_TICK, { headers: { "User-Agent": UA } })
          .then(function (r) { return r.text(); })
          .then(function () { steps++; }, function () { steps++; });
      });
    })();
  }

  return clock.then(function () {
    var rows = [{
      name: "GoojaraDiag",
      title: ("GJD4 clock=" + steps + "/10 elapsed=" + el() + " id=" + tmdbId).slice(0, 110),
      url: "https://ww1.goojara.to/", quality: "HD", type: "direct"
    }];
    boxes.forEach(function (b) {
      rows.push({
        name: "GoojaraDiag",
        title: (b.label + ": " + b.state + (b.t ? " @" + b.t : "")).slice(0, 110),
        url: "https://ww1.goojara.to/", quality: "HD", type: "direct"
      });
    });
    return rows;
  }).catch(function (e) {
    return [{
      name: "GoojaraDiag",
      title: ("GJD4 CLOCK ERR " + String((e && e.message) || e).slice(0, 60) + " elapsed=" + el()).slice(0, 110),
      url: "https://ww1.goojara.to/", quality: "HD", type: "direct"
    }];
  });
}
global.getStreams = getStreamsDiag;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreamsDiag };
}
