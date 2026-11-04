/* CineVood Diag v1.0.0 — device diagnostic for the CineVood provider.
 *
 * The real provider (cinevood2) returns 7 streams in simulation but 0
 * on the user's device. This diag runs the SAME chain step by step on
 * the device and reports each step as a stream row, so the failing
 * hop is visible instead of a bare zero.
 *
 * Design notes (from the NetMirror/Goojara diag precedent):
 * - Summaries FIRST: the TV test-results view shows only the first 3
 *   rows, so row 1 is the verdict, rows 2-3 are the one-line summary.
 *   Detail rows follow for the phone view.
 * - RAW fetch on purpose: no v5 retry prelude, no chain-retry postlude.
 *   If the diag is all green but the real provider still gives 0, the
 *   wrapper/timing is implicated, not the chain.
 * - FAST by design: first hubcloud button only + one vidaraa call.
 *   No slow chains, no postlude re-runs, well inside the 60s budget.
 * - Never prints keys, tokens, or full URLs with signatures. The R2
 *   signed URL is reported as host + count only.
 *
 * Steps: TMDB -> SEARCH -> GATE -> DETAIL -> HUB1 -> VIDARA -> ENV.
 */

var CD_SITE = "https://cinevood.net";
var CD_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
var CD_KEY = (typeof TMDB_API_KEY !== "undefined") ? TMDB_API_KEY : "";

function cdFetch(url, headers, body) {
  var opts = { headers: headers || {} };
  if (body !== undefined) { opts.method = "POST"; opts.body = body; }
  return fetch(url, opts);
}
function cdGetText(url, referer) {
  var h = { "User-Agent": CD_UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
  if (referer) h["Referer"] = referer;
  return cdFetch(url, h).then(function (r) {
    if (!r || r.status !== 200) throw new Error("http " + (r && r.status));
    return r.text();
  });
}
function cdGetJson(url, referer) {
  var h = { "User-Agent": CD_UA, Accept: "application/json,*/*" };
  if (referer) h["Referer"] = referer;
  return cdFetch(url, h).then(function (r) {
    if (!r || r.status !== 200) throw new Error("http " + (r && r.status));
    return r.json();
  });
}
function cdPostJson(url, referer, obj) {
  var h = { "User-Agent": CD_UA, "Content-Type": "application/json", Accept: "application/json,*/*" };
  if (referer) h["Referer"] = referer;
  return cdFetch(url, h, JSON.stringify(obj || {})).then(function (r) {
    if (!r || (r.status !== 200 && r.status !== 201)) throw new Error("http " + (r && r.status));
    return r.json();
  });
}
function cdOrigin(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/);
  return m ? m[1] : "";
}
function cdStripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
}
function cdFold(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function cdWords(s) {
  var stop = { the: 1, a: 1, an: 1, watch: 1, online: 1, download: 1, free: 1,
    hd: 1, full: 1, movie: 1, hindi: 1, english: 1, dubbed: 1, dual: 1,
    audio: 1, bluray: 1, webrip: 1, web: 1, dl: 1, hevc: 1, x264: 1, x265: 1,
    avc: 1, aac: 1, esub: 1, msub: 1, unrated: 1, hq: 1, hdtc: 1, cam: 1 };
  return String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(function (w) {
    return w && !stop[w] && !/^\d+$/.test(w) && !/^\d+p$/.test(w);
  });
}
function cdDice(a, b) {
  var sa = {}, i, inter = 0;
  for (i = 0; i < a.length; i++) sa[a[i]] = 1;
  for (i = 0; i < b.length; i++) { if (sa[b[i]]) inter++; }
  var t = a.length + b.length;
  return t ? (2 * inter) / t : 0;
}
function cdYearOf(title) {
  var m = String(title || "").match(/\((19\d{2}|20\d{2})\)/) || String(title || "").match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  var rows = [];
  function row(text, url) {
    rows.push({ name: text, title: text, url: url || CD_SITE + "/", quality: "Unknown", type: "direct", headers: {} });
  }
  try {
    if (!tmdbId) { row("DIAG VERDICT: NO TMDB ID GIVEN"); return rows; }
    var isSeries = mediaType === "tv";
    var kind = isSeries ? "tv" : "movie";
    var failStep = null;

    /* 1. TMDB */
    var meta = null;
    try {
      var td = await cdGetJson("https://api.themoviedb.org/3/" + kind + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + CD_KEY + "&language=en-US", null);
      var title = td.title || td.name || "";
      var date = td.release_date || td.first_air_date || "";
      meta = { title: title, year: date ? date.slice(0, 4) : null };
    } catch (e) { failStep = failStep || "TMDB"; }
    /* 2. SEARCH */
    var hits = [];
    try {
      var q = encodeURIComponent(meta ? meta.title : "");
      var sd = await cdGetJson(CD_SITE + "/search.php?q=" + q + "&page=1", CD_SITE + "/search.html?q=" + q);
      var all = (sd && sd.hits) || [];
      for (var i = 0; i < all.length; i++) {
        var doc = all[i] && all[i].document;
        if (!doc || doc.post_type !== "post") continue;
        var cats = doc.category || [], blocked = false;
        for (var j = 0; j < cats.length; j++) {
          if (cats[j] === "XXX" || cats[j] === "Trailer" || cats[j] === "18+ Adult") { blocked = true; break; }
        }
        if (!blocked) hits.push({ title: doc.post_title || "", permalink: doc.permalink || "" });
      }
    } catch (e) { failStep = failStep || "SEARCH"; }
    /* 3. GATE */
    var chosen = null, gateNote = "NONE";
    if (meta && hits.length) {
      for (var k = 0; k < hits.length; k++) {
        var cn = cdFold(hits[k].title), tn = cdFold(meta.title);
        var ok = (cn && cn === tn) || cdDice(cdWords(hits[k].title), cdWords(meta.title)) >= 0.8;
        if (!ok) continue;
        var hy = cdYearOf(hits[k].title);
        if (hy && meta.year && hy !== meta.year) { gateNote = "YEAR " + hy + "!=" + meta.year; continue; }
        chosen = hits[k];
        gateNote = "PASS";
        break;
      }
      if (!chosen && gateNote === "NONE") gateNote = "NO TITLE MATCH";
    } else if (!hits.length) { gateNote = "NO HITS"; }
    if (!chosen) failStep = failStep || "GATE";
    /* 4. DETAIL */
    var btnCounts = { hub: 0, gd: 0, fp: 0, vid: 0, oxx: 0, total: 0 };
    var hubUrls = [], vidUrls = [];
    var detailUrl = "";
    if (chosen) {
      detailUrl = chosen.permalink.charAt(0) === "/" ? CD_SITE + chosen.permalink : chosen.permalink;
      try {
        var html = await cdGetText(detailUrl, CD_SITE + "/");
        var re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi, m;
        while ((m = re.exec(html)) !== null) {
          var href = m[1];
          if (/hubcloud/i.test(href)) { btnCounts.hub++; if (hubUrls.length < 1) hubUrls.push(href); }
          else if (/gdflix|gdlink/i.test(href)) btnCounts.gd++;
          else if (/filepress|filebee/i.test(href)) btnCounts.fp++;
          else if (/vidaraa\.cc\/e\//i.test(href)) { btnCounts.vid++; vidUrls.push(href); }
          else if (/oxxfile\.info\/s\//i.test(href)) btnCounts.oxx++;
        }
        btnCounts.total = btnCounts.hub + btnCounts.gd + btnCounts.fp + btnCounts.vid + btnCounts.oxx;
      } catch (e) { failStep = failStep || "DETAIL"; }
    }
    if (chosen && !btnCounts.total) failStep = failStep || "DETAIL-NO-BTNS";
    /* 5. HUB1 (first hubcloud button only) */
    var hubNote = "SKIP";
    if (hubUrls.length) {
      try {
        var idm = hubUrls[0].match(/\/drive\/([A-Za-z0-9_-]+)/);
        if (!idm) { hubNote = "NO DRIVE ID"; }
        else {
          var driveUrl = cdOrigin(hubUrls[0]) + "/drive/" + idm[1];
          var dpage = await cdGetText(driveUrl, detailUrl);
          var gm = dpage.match(/var\s+url\s*=\s*'([^']+)'/);
          if (!gm) { hubNote = "DRIVE OK / NO GEN URL"; }
          else {
            var gen = await cdGetText(gm[1], driveUrl);
            var links = [], seen = {}, am, href2;
            var are = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
            while ((am = are.exec(gen)) !== null) {
              href2 = am[1];
              if (/^https?:\/\//i.test(href2) && !seen[href2] && /pixeldrain|cloudflarestorage|gpdl[^\/]*\.hubcloud/i.test(href2)) {
                seen[href2] = true;
                links.push(href2);
              }
            }
            hubNote = "DRIVE OK / GEN OK / LINKS " + links.length;
          }
        }
      } catch (e) { hubNote = "FAIL " + String((e && e.message) || e).slice(0, 40); failStep = failStep || "HUB1"; }
    }
    /* 6. VIDARA */
    var vidNote = "SKIP";
    if (vidUrls.length) {
      try {
        var cm = vidUrls[0].match(/\/e\/([A-Za-z0-9]+)/);
        if (!cm) { vidNote = "NO CODE"; }
        else {
          var vr = await cdPostJson("https://vidaraa.cc/api/stream", vidUrls[0], { filecode: cm[1], device: "web", codecs: ["h265"] });
          vidNote = (vr && vr.streaming_url) ? "HLS YES" : "HLS NO";
          if (!vr || !vr.streaming_url) failStep = failStep || "VIDARA";
        }
      } catch (e) { vidNote = "FAIL " + String((e && e.message) || e).slice(0, 40); failStep = failStep || "VIDARA"; }
    }
    /* ENV (no secrets printed, only presence) */
    var envNote = "KEY " + (CD_KEY ? "Y" : "N") + " FETCH " + (typeof fetch !== "undefined" ? "Y" : "N");

    /* Rows: verdict + summaries first (TV shows 3), details after. */
    row("DIAG VERDICT: " + (failStep ? ("FAIL AT " + failStep) : "ALL GREEN"), detailUrl || CD_SITE + "/");
    row("TMDB " + (meta ? (meta.title + " " + (meta.year || "")) : "FAIL") + " | SEARCH " + hits.length + " hits | GATE " + gateNote, detailUrl || CD_SITE + "/");
    row("DETAIL btns " + btnCounts.total + " (H" + btnCounts.hub + " G" + btnCounts.gd + " F" + btnCounts.fp + " V" + btnCounts.vid + " O" + btnCounts.oxx + ") | HUB1 " + hubNote + " | VIDARA " + vidNote, detailUrl || CD_SITE + "/");
    row("STEP TMDB: " + (meta ? ("OK " + meta.title + " " + (meta.year || "")) : "FAIL"), detailUrl || CD_SITE + "/");
    row("STEP SEARCH: " + hits.length + " hits" + (hits.length ? (" first: " + hits[0].title.slice(0, 60)) : ""), detailUrl || CD_SITE + "/");
    row("STEP GATE: " + gateNote + (chosen ? (" -> " + chosen.title.slice(0, 60)) : ""), detailUrl || CD_SITE + "/");
    row("STEP DETAIL: " + (chosen ? ("OK " + btnCounts.total + " buttons") : "SKIP (no chosen post)"), detailUrl || CD_SITE + "/");
    row("STEP HUB1: " + hubNote, hubUrls[0] || CD_SITE + "/");
    row("STEP VIDARA: " + vidNote, vidUrls[0] || CD_SITE + "/");
    row("STEP ENV: " + envNote, CD_SITE + "/");
    return rows;
  } catch (e) {
    rows.unshift({ name: "DIAG VERDICT: ERROR " + String((e && e.message) || e).slice(0, 60), title: "DIAG ERROR", url: CD_SITE + "/", quality: "Unknown", type: "direct", headers: {} });
    return rows;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
try {
  if (typeof global !== "undefined") global.getStreams = getStreams;
} catch (e) {}
