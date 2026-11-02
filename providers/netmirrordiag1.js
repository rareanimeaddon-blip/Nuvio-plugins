// NetMirror Diag v1.0.0 — LIMITED reachability diagnostic.
// Reports, as stream rows (DO NOT PLAY — these rows are measurements):
//   1. TV guest globals present / missing
//   2. TMDB title + year the app resolves for this id
//   3. net27 embed API reachability (+ noSource?)
//   4. net52 home reachability (+ data-addhash present in HTML?)
//   5. NewTV discovery on the first 3 domains (token_hash present?)
// Deliberately NO session steps: no userver ping, no verify2 poll,
// no cookie handling, no search / post / player calls. If every row
// is green on the TV, the remaining suspect is the session step
// itself, proven by elimination rather than by re-running it.
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

function nmDiagEnvRow() {
  var parts = [];
  parts.push("fetch=" + typeof fetch);
  parts.push("URL=" + typeof URL);
  parts.push("Date=" + typeof Date);
  parts.push("Promise=" + typeof Promise);
  parts.push("atob=" + typeof atob);
  parts.push("TextEncoder=" + typeof TextEncoder);
  parts.push("setTimeout=" + typeof setTimeout);
  parts.push("AbortController=" + typeof AbortController);
  parts.push("SETTINGS=" + (typeof SCRAPER_SETTINGS !== "undefined" ? "yes" : "no"));
  parts.push("TMDBKEY=" + (typeof TMDB_API_KEY !== "undefined" ? "yes" : "no"));
  return nmDiagRow("ENV", parts.join(" "), "https://api.themoviedb.org/3");
}

function getStreams(tmdbId, mediaType, season, episode) {
  var rows = [];
  var t0 = -1;
  try { t0 = Date.now(); } catch (e) { t0 = -1; }
  var isTv = /tv|series/i.test(String(mediaType || ""));
  rows.push(nmDiagRow("START", "id=" + tmdbId + " type=" + (mediaType || "?") + (isTv ? " S" + (season || 1) + "E" + (episode || 1) : ""), "https://api.themoviedb.org/3"));
  rows.push(nmDiagEnvRow());

  var tmdbUrl = "https://api.themoviedb.org/3/" + (isTv ? "tv/" : "movie/") + tmdbId + "?api_key=" + NM_DIAG_TMDB_KEY + "&language=en-US";
  return nmDiagProbe(tmdbUrl, { "Accept": "application/json" }).then(function (r) {
    if (r.error) {
      rows.push(nmDiagRow("TMDB", "FAIL " + r.error.slice(0, 120), tmdbUrl));
    } else {
      var title = "?";
      var year = "?";
      try {
        var d = JSON.parse(r.text);
        title = d.title || d.name || "?";
        year = String(d.release_date || d.first_air_date || "").slice(0, 4) || "?";
      } catch (e) { title = "unparsed"; }
      rows.push(nmDiagRow("TMDB", "status=" + r.status + " title=" + String(title).slice(0, 60) + " year=" + year, tmdbUrl));
    }
    var embedUrl = "https://net27.cc/api/embed-tmdb/" + tmdbId + (isTv ? "?type=tv&se=" + (season || 1) + "&ep=" + (episode || 1) : "");
    return nmDiagProbe(embedUrl, { "Accept": "application/json, text/plain, */*", "Referer": "https://net27.cc/", "User-Agent": NM_DIAG_UA, "Accept-Language": "en-US,en;q=0.9" });
  }).then(function (r) {
    var embedUrl = "https://net27.cc/api/embed-tmdb/" + tmdbId + (isTv ? "?type=tv&se=" + (season || 1) + "&ep=" + (episode || 1) : "");
    if (r.error) {
      rows.push(nmDiagRow("EMBED", "FAIL " + r.error.slice(0, 120), embedUrl));
    } else {
      var noSource = r.text.indexOf("noSource") >= 0 ? "yes" : "no";
      var mp4refs = (r.text.match(/\.mp4/g) || []).length;
      var hasMp4 = "no";
      try { hasMp4 = JSON.parse(r.text).mp4 ? "yes" : "no"; } catch (e) {}
      rows.push(nmDiagRow("EMBED", "status=" + r.status + " len=" + r.text.length + " noSource=" + noSource + " mp4refs=" + mp4refs + " mp4field=" + hasMp4, embedUrl));
    }
    var homeUrl = "https://net52.cc/mobile/home?app=1";
    return nmDiagProbe(homeUrl, { "User-Agent": NM_DIAG_APP_UA, "X-Requested-With": "app.netmirror.netmirrornew" });
  }).then(function (r) {
    var homeUrl = "https://net52.cc/mobile/home?app=1";
    if (r.error) {
      rows.push(nmDiagRow("HOME", "FAIL " + r.error.slice(0, 120), homeUrl));
    } else {
      var addhash = r.text.indexOf("data-addhash") >= 0 ? "yes" : "no";
      rows.push(nmDiagRow("HOME", "status=" + r.status + " len=" + r.text.length + " addhash=" + addhash, homeUrl));
    }
    var summary = [];
    var i = 0;
    function nextDomain() {
      if (i >= NM_DIAG_NEWTV_DOMAINS.length) {
        rows.push(nmDiagRow("NEWTVDISC", summary.join(" ; ") || "none tried", NM_DIAG_NEWTV_DOMAINS[0] + "/checknewtv.php"));
        var el = "?";
        try { if (t0 >= 0) el = String(Date.now() - t0) + "ms"; } catch (e) {}
        rows.push(nmDiagRow("DONE", "photo these rows, do not play. elapsed=" + el, tmdbUrl2()));
        return rows;
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
            try { api = atob(dj.token_hash).replace(/\/$/, "").slice(0, 60); } catch (e) { api = "undecodable"; }
          }
        } catch (e) { hasToken = "unparsed"; }
        summary.push(dom.replace("https://", "") + " status=" + dr.status + " token=" + hasToken + " api=" + api);
        if (hasToken === "yes") {
          rows.push(nmDiagRow("NEWTVDISC", summary.join(" ; "), NM_DIAG_NEWTV_DOMAINS[0] + "/checknewtv.php"));
          var el2 = "?";
          try { if (t0 >= 0) el2 = String(Date.now() - t0) + "ms"; } catch (e) {}
          rows.push(nmDiagRow("DONE", "photo these rows, do not play. elapsed=" + el2, tmdbUrl2()));
          return rows;
        }
        return nextDomain();
      });
    }
    function tmdbUrl2() { return tmdbUrl; }
    return nextDomain();
  }).catch(function (e) {
    rows.push(nmDiagRow("ERROR", String((e && e.message) || e).slice(0, 160), "https://api.themoviedb.org/3"));
    return rows;
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
try { if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams; } catch (e) {}
