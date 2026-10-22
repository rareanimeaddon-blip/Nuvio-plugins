/* Goojara Diag 5 - transport probes with an HONEST clock.
   Diag4's readout on the phone (2026-10-22 18:56) was inconclusive
   by design flaw: its 10 TMDB clock fetches were identical URLs and
   the app bridge answered them from cache in 0.2s total, so the
   probe snapshot fired at 0.2s - everything showed PENDING whether
   it was hung or merely slower than 0.2s. (One real signal did
   survive: cf-trace settled @0.1s, so the bridge and general
   internet are fast on that phone.)
   Diag5's clock: sequential fetches of DISTINCT URLs (TMDB movie
   ids 2000+i, cloudflare trace every 8th) in a plain awaited loop
   that runs until ~9s of wall time pass (step-capped) - probes get
   a genuine ~9s window to settle before the snapshot, which is
   several times the ~1-2s a goojara fetch took to fail on Vi.
   Nothing is raced, polled or abandoned: probes are boxed plain
   fetches that record their own outcome whenever they settle. */
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
var KEY = "5f39fd16e987a9e3fce30d55cf09b438";

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
  box("codetabs", "https://api.codetabs.com/v1/proxy?quest=https://ww1.goojara.to/", {});
  box("corsproxy", "https://corsproxy.io/?url=https%3A%2F%2Fww1.goojara.to%2F", {});
  box("cf-trace", "https://www.cloudflare.com/cdn-cgi/trace", {});

  var steps = 0;
  function clockStep() {
    steps++;
    var url = (steps % 8 === 0)
      ? "https://www.cloudflare.com/cdn-cgi/trace?n=" + steps + "-" + T0
      : "https://api.themoviedb.org/3/movie/" + (2000 + steps) + "?api_key=" + KEY;
    return fetch(url, { headers: { "User-Agent": UA } })
      .then(function (r) { return r.text(); })
      .then(function () {}, function () {});
  }
  var clock = Promise.resolve();
  function more() {
    if (Date.now() - T0 >= 9000 || steps >= 240) return null;
    return clockStep().then(more);
  }

  return more().then(function () {
    var rows = [{
      name: "GoojaraDiag",
      title: ("GJD5 clock=" + steps + " elapsed=" + el() + " window~9s").slice(0, 110),
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
      title: ("GJD5 CLOCK ERR " + String((e && e.message) || e).slice(0, 55) + " elapsed=" + el()).slice(0, 110),
      url: "https://ww1.goojara.to/", quality: "HD", type: "direct"
    }];
  });
}
global.getStreams = getStreamsDiag;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreamsDiag };
}
