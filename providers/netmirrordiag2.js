// NetMirror Diag v1.0.1 — SUMMARY-FIRST.
// The TV test-results view shows only the first 3 entries and the
// "...and N more" line cannot be expanded, so the whole verdict is
// compressed into rows 1-2 (row 3 = compact ENV). Full per-probe
// details follow for the phone view. Probes are identical to v1.0.0.
// Deliberately NO session steps: no userver ping, no verify2 poll,
// no cookie handling, no search / post / player calls.
var NM_DIAG_TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var NM_DIAG_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36 /OS.Gatu v3.0";
var NM_DIAG_APP_UA = "Mozilla/5.0 (Linux; Android 12; RMX2117 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/147.0.7727.55 Mobile Safari/537.36 /OS.Gatu v3.0";
var NM_DIAG_NEWTV_DOMAINS = ["https://mobiledetects.com", "https://mobiledetect.app", "https://mobidetect.art"];

function nmDiagRow(label, detail, url) {
  var name = "DIAG " + label;
  var title = "DIAG " + label + " | " + detail;
  return { name: name, title: title, url: url || "https://api.themoviedb.org/3", quality: "Diag" };
}

function nmDiagProbe(url, headers) {
  return fetch(url, { headers: headers }).then(function (res) {
    return res.text().then(function (t) {
      return { status: res.status, ok: res.ok, text: t || "" };
    });
  }).catch(function (e) {
    return { error: String((e && e.message) || e) };
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var detail = [];
  var t0 = -1;
  try { t0 = Date.now(); } catch (e) { t0 = -1; }
  var isTv = /tv|series/i.test(String(mediaType || ""));
  var tmdbUrl = "https://api.themoviedb.org/3/" + (isTv ? "tv/" : "movie/") + tmdbId + "?api_key=" + NM_DIAG_TMDB_KEY + "&language=en-US";
  var embedUrl = "https://net27.cc/api/embed-tmdb/" + tmdbId + (isTv ? "?type=tv&se=" + (season || 1) + "&ep=" + (episode || 1) : "");
  var homeUrl = "https://net52.cc/mobile/home?app=1";
  var newtvUrl = NM_DIAG_NEWTV_DOMAINS[0] + "/checknewtv.php";

  var embShort = "E?";
  var homeShort = "H?";
  var newtvShort = "N?";
  var tmdbShort = "T?";

  var envParts = [];
  envParts.push("fetch=" + (typeof fetch === "function" ? "Y" : "N"));
  envParts.push("URL=" + (typeof URL === "function" ? "Y" : "N"));
  envParts.push("Date=" + (typeof Date === "function" ? "Y" : "N"));
  envParts.push("Promise=" + (typeof Promise === "function" ? "Y" : "N"));
  envParts.push("atob=" + (typeof atob === "function" ? "Y" : "N"));
  envParts.push("Abort=" + (typeof AbortController === "function" ? "Y" : "N"));
  envParts.push("TxtEnc=" + (typeof TextEncoder === "function" ? "Y" : "N"));
  envParts.push("Timer=" + (typeof setTimeout === "function" ? "Y" : "N"));
  envParts.push("SET=" + (typeof SCRAPER_SETTINGS !== "undefined" ? "Y" : "N"));
  envParts.push("KEY=" + (typeof TMDB_API_KEY !== "undefined" ? "Y" : "N"));
  var envRow = nmDiagRow("ENV", envParts.join(" "), tmdbUrl);

  detail.push(nmDiagRow("START", "id=" + tmdbId + " type=" + (mediaType || "?") + (isTv ? " S" + (season || 1) + "E" + (episode || 1) : ""), tmdbUrl));

  function finish() {
    var el = "?";
    try { if (t0 >= 0) el = String(Date.now() - t0) + "ms"; } catch (e) {}
    detail.push(nmDiagRow("DONE", "photo first 3 rows, do not play. elapsed=" + el, tmdbUrl));
    var sum1 = nmDiagRow("SUMMARY", embShort + " " + homeShort, embedUrl);
    var sum2 = nmDiagRow("SUMMARY", newtvShort + " " + tmdbShort, newtvUrl);
    return [sum1, sum2, envRow].concat(detail);
  }

  return nmDiagProbe(tmdbUrl, { "Accept": "application/json" }).then(function (r) {
    if (r.error) {
      tmdbShort = "TFAIL";
      detail.push(nmDiagRow("TMDB", "FAIL " + r.error.slice(0, 120), tmdbUrl));
    } else {
      var title = "?";
      var year = "?";
      try {
        var d = JSON.parse(r.text);
        title = d.title || d.name || "?";
        year = String(d.release_date || d.first_air_date || "").slice(0, 4) || "?";
      } catch (e) { title = "unparsed"; }
      tmdbShort = "T" + String(title).slice(0, 20) + "/" + year;
      detail.push(nmDiagRow("TMDB", "status=" + r.status + " title=" + String(title).slice(0, 60) + " year=" + year, tmdbUrl));
    }
    return nmDiagProbe(embedUrl, { "Accept": "application/json, text/plain, */*", "Referer": "https://net27.cc/", "User-Agent": NM_DIAG_UA, "Accept-Language": "en-US,en;q=0.9" });
  }).then(function (r) {
    if (r.error) {
      embShort = "EFAIL";
      detail.push(nmDiagRow("EMBED", "FAIL " + r.error.slice(0, 120), embedUrl));
    } else {
      var noSource = r.text.indexOf("noSource") >= 0 ? "nosrc" : "ok";
      var mp4refs = (r.text.match(/\.mp4/g) || []).length;
      var hasMp4 = "no";
      try { hasMp4 = JSON.parse(r.text).mp4 ? "yes" : "no"; } catch (e) {}
      embShort = "E" + r.status + "/" + noSource;
      detail.push(nmDiagRow("EMBED", "status=" + r.status + " len=" + r.text.length + " noSource=" + noSource + " mp4refs=" + mp4refs + " mp4field=" + hasMp4, embedUrl));
    }
    return nmDiagProbe(homeUrl, { "User-Agent": NM_DIAG_APP_UA, "X-Requested-With": "app.netmirror.netmirrornew" });
  }).then(function (r) {
    if (r.error) {
      homeShort = "HFAIL";
      detail.push(nmDiagRow("HOME", "FAIL " + r.error.slice(0, 120), homeUrl));
    } else {
      var addhash = r.text.indexOf("data-addhash") >= 0 ? "hash" : "nohash";
      homeShort = "H" + r.status + "/" + addhash;
      detail.push(nmDiagRow("HOME", "status=" + r.status + " len=" + r.text.length + " addhash=" + addhash, homeUrl));
    }
    var summary = [];
    var i = 0;
    function nextDomain() {
      if (i >= NM_DIAG_NEWTV_DOMAINS.length) {
        if (newtvShort === "N?") newtvShort = "Nallerr";
        detail.push(nmDiagRow("NEWTVDISC", summary.join(" ; ") || "none tried", newtvUrl));
        return finish();
      }
      var dom = NM_DIAG_NEWTV_DOMAINS[i++];
      return nmDiagProbe(dom + "/checknewtv.php", { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0", "X-Requested-With": "NetmirrorNewTV v1.0", "Accept": "application/json, text/plain, */*", "Ott": "nf", "User-Agent": NM_DIAG_UA, "Accept-Language": "en-US,en;q=0.9" }).then(function (dr) {
        if (dr.error) {
          summary.push(dom.replace("https://", "") + " ERR " + dr.error.slice(0, 60));
          return nextDomain();
        }
        var hasToken = "no";
        var api = "-";
        try {
          var dj = JSON.parse(dr.text);
          if (dj && dj.token_hash) {
            hasToken = "yes";
            try { api = atob(dj.token_hash).replace(/\/$/, "").replace(/^https?:\/\//, "").slice(0, 30); } catch (e) { api = "undecodable"; }
          }
        } catch (e) { hasToken = "unparsed"; }
        summary.push(dom.replace("https://", "") + " status=" + dr.status + " token=" + hasToken + " api=" + api);
        if (hasToken === "yes") {
          newtvShort = "Ntok/" + api;
          detail.push(nmDiagRow("NEWTVDISC", summary.join(" ; "), newtvUrl));
          return finish();
        }
        if (i >= NM_DIAG_NEWTV_DOMAINS.length) newtvShort = "Nnotok";
        return nextDomain();
      });
    }
    return nextDomain();
  }).catch(function (e) {
    detail.push(nmDiagRow("ERROR", String((e && e.message) || e).slice(0, 160), tmdbUrl));
    return finish();
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
try { if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams; } catch (e) {}
