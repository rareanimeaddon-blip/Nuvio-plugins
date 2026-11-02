// NetMirror Diag v1.0.2 — IP-STABILITY probe.
// v1.0.1 proved every limited probe green on the TV guest (TMDB,
// embed, home, NewTV discovery all 200). What it could NOT probe is
// the session step. This build tests the leading session hypothesis
// WITHOUT running any session step: if the TV fetch service's egress
// IP changes between requests, an IP-bound session can never validate
// (the same failure mode as sandbox egress rotation), while the
// phone's stable residential IP works fine.
// Probes (plain GETs only, summary-first for the TV 3-row limit):
//   1-2. Public IP as seen by an echo service, twice in a row.
//   3. Bare reachability of the session host (no query, no token,
//      no registration, no cookie, no POST — host answers or not).
// Deliberately NO userver-with-token ping, NO verify2 poll,
// NO cookies, NO search / post / player calls.
var NM_DIAG_IP_URL = "https://api.ipify.org?format=json";
var NM_DIAG_USERVER_URL = "https://userver.net52.cc/";

function nmDiagRow(label, detail, url) {
  var name = "DIAG " + label;
  var title = "DIAG " + label + " | " + detail;
  return { name: name, title: title, url: url || NM_DIAG_IP_URL, quality: "Diag" };
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

function nmDiagIp(text) {
  try {
    var d = JSON.parse(text);
    if (d && d.ip) return String(d.ip);
  } catch (e) {}
  return "";
}

function getStreams(tmdbId, mediaType, season, episode) {
  var detail = [];
  var t0 = -1;
  try { t0 = Date.now(); } catch (e) { t0 = -1; }
  var ip1 = "";
  var ip2 = "";
  var usrv = "?";

  return nmDiagProbe(NM_DIAG_IP_URL, { "Accept": "application/json" }).then(function (r) {
    if (r.error) {
      detail.push(nmDiagRow("IP1D", "FAIL " + r.error.slice(0, 120), NM_DIAG_IP_URL));
    } else {
      ip1 = nmDiagIp(r.text);
      detail.push(nmDiagRow("IP1D", "status=" + r.status + " ip=" + (ip1 || ("unparsed:" + r.text.slice(0, 60))), NM_DIAG_IP_URL));
    }
    return nmDiagProbe(NM_DIAG_IP_URL, { "Accept": "application/json" });
  }).then(function (r) {
    if (r.error) {
      detail.push(nmDiagRow("IP2D", "FAIL " + r.error.slice(0, 120), NM_DIAG_IP_URL));
    } else {
      ip2 = nmDiagIp(r.text);
      detail.push(nmDiagRow("IP2D", "status=" + r.status + " ip=" + (ip2 || ("unparsed:" + r.text.slice(0, 60))), NM_DIAG_IP_URL));
    }
    return nmDiagProbe(NM_DIAG_USERVER_URL, { "Accept": "text/html,application/xhtml+xml,*/*" });
  }).then(function (r) {
    if (r.error) {
      usrv = "FAIL";
      detail.push(nmDiagRow("USERVER", "FAIL " + r.error.slice(0, 120), NM_DIAG_USERVER_URL));
    } else {
      usrv = String(r.status);
      detail.push(nmDiagRow("USERVER", "status=" + r.status + " len=" + r.text.length + " head=" + r.text.slice(0, 80).replace(/\s+/g, " "), NM_DIAG_USERVER_URL));
    }
    var same = "?";
    if (ip1 && ip2) same = (ip1 === ip2) ? "Y" : "N";
    var el = "?";
    try { if (t0 >= 0) el = String(Date.now() - t0) + "ms"; } catch (e) {}
    detail.push(nmDiagRow("DONE", "photo first 3 rows, do not play. elapsed=" + el, NM_DIAG_IP_URL));
    var sum = nmDiagRow("SUMMARY", "IPSAME=" + same + " USERVER=" + usrv, NM_DIAG_USERVER_URL);
    var row1 = nmDiagRow("IP1", ip1 || "FAIL", NM_DIAG_IP_URL);
    var row2 = nmDiagRow("IP2", ip2 || "FAIL", NM_DIAG_IP_URL);
    return [sum, row1, row2].concat(detail);
  }).catch(function (e) {
    detail.push(nmDiagRow("ERROR", String((e && e.message) || e).slice(0, 160), NM_DIAG_IP_URL));
    var sum = nmDiagRow("SUMMARY", "IPSAME=? USERVER=" + usrv, NM_DIAG_USERVER_URL);
    var row1 = nmDiagRow("IP1", ip1 || "FAIL", NM_DIAG_IP_URL);
    var row2 = nmDiagRow("IP2", ip2 || "FAIL", NM_DIAG_IP_URL);
    return [sum, row1, row2].concat(detail);
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
try { if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams; } catch (e) {}
