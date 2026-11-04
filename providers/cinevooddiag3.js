/* CineVood Diag v3 v1.0.0 — device diagnostic, failure-reason edition.
 *
 * Diag v2 on the phone showed the truth diag v1 hid behind its hardcoded
 * "OK" label: the detail fetch itself THROWS (LEN 0, NOHDR FAIL) while
 * TMDB + search.php succeed. So this edition reports the actual fetch
 * error messages plus a site-root HTML control probe: if the root page
 * also fails, HTML fetching on this host is broken on the phone; if it
 * loads, only the detail page fails. Error texts are generic transport
 * / HTTP messages only — no keys, tokens, or URLs are printed.
 *
 * Diag v1 on the user's phone gave FAIL AT DETAIL for Brand New Day:
 * TMDB OK, SEARCH 2 hits, GATE PASS to the WEBRip 1080p post, but the
 * detail fetch returned 200 with 0 buttons — while the sandbox fetches
 * the SAME post right now and gets 10 buttons (H3 G3 F3 V1). The site
 * has not changed and the result does not vary by User-Agent from the
 * sandbox, so the phone must be receiving DIFFERENT HTML for the same
 * URL. This diag fingerprints what the phone actually got:
 *   - DETAIL body length (sandbox: ~100055) + <title> text
 *   - marker presence (hubcloud/gdflix/filepress/vidaraa/download/
 *     watch-online/just-a-moment/cloudflare/captcha) as Y/N only
 *   - a second fetch of the same URL with NO custom headers, to test
 *     whether the app's header handling changes the served page
 * No keys, tokens, signed URLs, or body excerpts are printed — only
 * lengths, the page title, and Y/N flags.
 * Rows: verdict + summaries first, details after (same as v1).
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
function cdCountBtns(html) {
  var c = { hub: 0, gd: 0, fp: 0, vid: 0, oxx: 0, total: 0, hubUrls: [], vidUrls: [] };
  var re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1];
    if (/hubcloud/i.test(href)) { c.hub++; if (c.hubUrls.length < 1) c.hubUrls.push(href); }
    else if (/gdflix|gdlink/i.test(href)) c.gd++;
    else if (/filepress|filebee/i.test(href)) c.fp++;
    else if (/vidaraa\.cc\/e\//i.test(href)) { c.vid++; c.vidUrls.push(href); }
    else if (/oxxfile\.info\/s\//i.test(href)) c.oxx++;
  }
  c.total = c.hub + c.gd + c.fp + c.vid + c.oxx;
  return c;
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
    /* 4. DETAIL (custom-UA probe) + fingerprint */
    var btnCounts = { hub: 0, gd: 0, fp: 0, vid: 0, oxx: 0, total: 0 };
    var hubUrls = [], vidUrls = [];
    var detailUrl = "";
    var detailLen = 0, detailTitle = "?", detailMarks = "n/a";
    var nohdrLen = 0, nohdrBtns = 0, nohdrNote = "SKIP";
    var detailErr = "", nohdrErr = "", rootNote = "SKIP", rootLen = 0, rootErr = "";
    if (chosen) {
      detailUrl = chosen.permalink.charAt(0) === "/" ? CD_SITE + chosen.permalink : chosen.permalink;
      try {
        var html = await cdGetText(detailUrl, CD_SITE + "/");
        detailLen = html.length;
        var tm = html.match(/<title>([^<]*)<\/title>/i);
        detailTitle = tm ? tm[1].trim().slice(0, 60) : "?";
        var low = html.toLowerCase();
        function mk(s) { return low.indexOf(s) !== -1 ? "Y" : "N"; }
        detailMarks = "hub " + mk("hubcloud") + " gd " + mk("gdflix") + " fp " + mk("filepress") + " vid " + mk("vidaraa") + " dl " + mk("download") + " wo " + mk("watch online") + " jm " + mk("just a moment") + " cf " + mk("cloudflare") + " cap " + mk("captcha");
        var bc = cdCountBtns(html);
        btnCounts = bc; hubUrls = bc.hubUrls; vidUrls = bc.vidUrls;
      } catch (e) { failStep = failStep || "DETAIL"; detailErr = String((e && e.message) || e).slice(0, 60); }
      /* 4b. DETAIL with NO custom headers (same URL) */
      try {
        var html2 = await cdFetch(detailUrl, {}).then(function (r) {
          if (!r || r.status !== 200) throw new Error("http " + (r && r.status));
          return r.text();
        });
        nohdrLen = html2.length;
        nohdrBtns = cdCountBtns(html2).total;
        nohdrNote = "OK";
      } catch (e) { nohdrNote = "FAIL"; nohdrErr = String((e && e.message) || e).slice(0, 60); }
    }
    if (chosen && !btnCounts.total) failStep = failStep || "DETAIL-NO-BTNS";
    /* ROOT control: site home page HTML (same host, same UA) */
    try {
      var rootHtml = await cdGetText(CD_SITE + "/", CD_SITE + "/");
      rootLen = rootHtml.length;
      rootNote = "OK";
    } catch (e) { rootNote = "FAIL"; rootErr = String((e && e.message) || e).slice(0, 60); }
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

    /* Rows: verdict + summaries first, details after. */
    row("DIAG VERDICT: " + (failStep ? ("FAIL AT " + failStep) : "ALL GREEN"), detailUrl || CD_SITE + "/");
    row("TMDB " + (meta ? (meta.title + " " + (meta.year || "")) : "FAIL") + " | SEARCH " + hits.length + " hits | GATE " + gateNote, detailUrl || CD_SITE + "/");
    row("DETAIL btns " + btnCounts.total + " (H" + btnCounts.hub + " G" + btnCounts.gd + " F" + btnCounts.fp + " V" + btnCounts.vid + " O" + btnCounts.oxx + ") | LEN " + detailLen + " | NOHDR len " + nohdrLen + " btns " + nohdrBtns, detailUrl || CD_SITE + "/");
    row("STEP DETAIL: " + (detailErr ? ("FAIL " + detailErr) : ("OK len " + detailLen + " title: " + detailTitle)), detailUrl || CD_SITE + "/");
    row("STEP DETAIL-MARK: " + detailMarks, detailUrl || CD_SITE + "/");
    row("STEP DETAIL-ERR: " + (detailErr || "NONE"), detailUrl || CD_SITE + "/");
    row("STEP NOHDR-ERR: " + (nohdrErr || "NONE"), detailUrl || CD_SITE + "/");
    row("STEP ROOT: " + rootNote + " len " + rootLen + (rootErr ? (" " + rootErr) : ""), CD_SITE + "/");
    row("STEP DETAIL-NOHDR: " + nohdrNote + " len " + nohdrLen + " btns " + nohdrBtns, detailUrl || CD_SITE + "/");
    row("STEP TMDB: " + (meta ? ("OK " + meta.title + " " + (meta.year || "")) : "FAIL"), detailUrl || CD_SITE + "/");
    row("STEP SEARCH: " + hits.length + " hits" + (hits.length ? (" first: " + hits[0].title.slice(0, 60)) : ""), detailUrl || CD_SITE + "/");
    row("STEP GATE: " + gateNote + (chosen ? (" -> " + chosen.title.slice(0, 60)) : ""), detailUrl || CD_SITE + "/");
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
