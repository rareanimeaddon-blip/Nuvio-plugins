/* __FETCH_RETRY_PRELUDE__ v5 (webOS TV): the TV plugin fetch service
   intermittently returns status-0 transport failures, sometimes in
   host-specific dead windows lasting tens of seconds. Wrap the global
   fetch: retry a rejection or status-0 up to 4 attempts with SHORT
   spin pauses (0.3/0.9/2s, ~3.2s span, no timers exist in the guest).
   Longer window-spanning is left to the chain-retry postlude, which
   re-runs the whole provider chain seconds later. v3's ~31s ladder
   blew the per-provider budget on long chains; v4's instant retries
   all landed inside dead windows and regressed medium chains. */
(function () {
  try {
    var cur = (typeof fetch !== "undefined") ? fetch : null;
    if (!cur || cur.__nuvioRetry) return;
    var raw = cur;
    var PAUSES = [300, 900, 2000];
    function spin(ms) { var t = Date.now(); while (Date.now() - t < ms) {} }
    var wrapped = function (url, opts) {
      var tries = 0;
      var attempt = function () {
        tries++;
        return raw(url, opts).then(function (r) {
          if (r && r.status === 0 && tries < 4) { spin(PAUSES[tries - 1]); return attempt(); }
          return r;
        }, function (e) {
          if (tries < 4) { spin(PAUSES[tries - 1]); return attempt(); }
          throw e;
        });
      };
      return attempt();
    };
    wrapped.__nuvioRetry = true;
    try { fetch = wrapped; } catch (e) {}
    if (typeof globalThis !== "undefined") { try { globalThis.fetch = wrapped; } catch (e) {} }
  } catch (e) {}
})();


// Xon scraper for Nuvio (xon4.js v1.0.0).
// FULL REMAKE from phisher98's XonProvider v2.0 (CloudStream .cs3,
// plugin version 11, class com.phisher98.xon.Xon) — the working file
// the user supplied. The v1 (CNCVerse) provider's API
// (xon-avens.xyz) is DEAD; v2.0 talks to a NEW live backend:
//
//   https://admin.xon.quest/apis
//   nzgetshows.php / nzgetlanguages.php / nzgetepisodes_v2.php
//
// Requests are HMAC-SHA256 signed: secretKey = HMAC(certHash, apiKey),
// signature = HMAC(path + ":" + timestampMs, secretKey), sent as
// API / CALLER / X-Timestamp / X-Signature headers (User-Agent
// okhttp/4.12.0). The TV guest has no WebCrypto, so the HMAC runs on
// the pure-JS SHA-256 block (test/tvcompat-block.js, vector-tested
// vs Node crypto). Verified live 2026-11-15: the shows catalog
// (last_updated 2026-11-15 11:18) and the episodes endpoint both
// answer 200 with the correct signature; a wrong signed path gets
// 403 "Invalid Signature!".
//
// Flow (TV): TMDB title -> gate-safe alias recall (TMDB alternative
// titles, Latin-script only, shortest first, cap 4, through the
// UNCHANGED exact gate) -> baked show/season map -> live episode
// fetch -> direct stream URLs from the episode record.
//
// WHY A BAKED MAP: the shows catalog (nzgetshows.php) is 2.2 MB and
// the full episode list is 14.9 MB — both over the TV guest's 1 MB
// fetch cap, and the server sends no gzip, ignores Range and has no
// server-side filter on the shows endpoint. So the small, slow-
// changing part (show id + title + language + season id per season,
// 159 shows / 534 seasons, ~9 KB) is baked in from the live API;
// the fast-changing part (episode records with the stream URLs) is
// fetched LIVE per season through the episodes endpoint's season_id
// filter (~45 KB for a 52-episode season, well under the cap).
// A show/season added to the catalog after this bake won't resolve
// until the map is re-baked from the live API.
//
// The .cs3's loadLinks adds, in order: basic "Basic (240p)", sd
// "SD (480p)", hd "HD (720p)", fhd "FHD (1080p)", aplayer1
// "Server 1" (direct vids.st mp4). aplayer2 / link / xPlayer4 are
// embed pages resolved by CloudStream's loadExtractor — no
// equivalent exists in the Nuvio guest, so they are skipped; the
// direct fields above are the playable rows. formatUrl: a URL that
// is not absolute gets "https://archive.org/download/" prepended
// (the .cs3's rule; the quality fields are absolute already).
//
// MOVIES: not in this version. A movie's stream URLs live ONLY in
// the 2.2 MB shows response — there is no per-movie endpoint, and
// baking all 603 movies' URLs is ~237 KB. Movies return [] (honest
// empty), same as xon2.js did. Shinchan movies can be baked
// individually if the user asks.
//
// Gate v3: exact title matching, zero mismatch tolerance. A show
// only counts when its API title matches the TMDB title/alias
// exactly (whole-word containment, whole-string equality, or the
// joined single-word form equal on both sides). Hindi (language 13)
// wins when several languages share a title.
// Verified catalog (Hindi show 55): Shinchan S1-S9 + S12-S15 with
// exact episode counts (S1:52, S2:51, S3:52, S4:51, S5:51, S6:52,
// S7:51, S8:47, S9:47, S12:52, S13:52, S14:51, S15:52). S10/S11 and
// S16+ do not exist in the catalog — honest 0, not a bug.


var XON_TMDB_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
var XON_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var XON_API = "https://admin.xon.quest/apis";
var XON_API_KEY = "553y845hfhdlfhjkl438943943839443943fdhdkfjfj9834lnfd98";
var XON_CALLER = "vion-official-app";
var XON_CERT_HASH = "b42c8c495d4b74f0e4d8881c0bfe76b09e665e496e0725bd4ccb3939feb5a00e";
var XON_HINDI = 13;
var XON_LANG_NAME = { 13: "Hindi", 14: "English", 17: "Telugu", 18: "Tamil" };

// Baked show/season map from the live API (2026-11-15):
// [showId, title, languageId, [[seasonNo, seasonId], ...]]
// See the header comment for why this part is baked.

var XON_SHOWS = [[52,"Doraemon",13,[[1,295],[1,205],[2,296],[3,297],[4,125],[5,84],[6,51],[7,48],[8,47],[10,298],[14,12],[15,248],[18,59],[19,2854],[20,2855]]],[54,"Pokémon",13,[[0,336],[1,2808],[2,20],[3,21],[4,85],[5,88],[6,135],[7,137],[8,146],[9,160],[10,132],[11,133],[12,134],[13,178],[14,30],[15,161],[16,86],[17,87],[18,189],[18,181],[19,190],[23,81],[24,126],[25,333],[25,209]]],[55,"Crayon Shin-chan",13,[[1,31],[2,35],[3,36],[4,37],[5,38],[6,39],[7,40],[8,41],[9,2765],[12,191],[13,198],[14,201],[15,212]]],[56,"Ninja Hattori",13,[[1,42],[2,43],[3,44],[4,45],[5,46]]],[57,"Miraculous",13,[[1,32],[2,33],[3,34],[4,62],[5,223]]],[58,"Iron Man",13,[[1,425],[2,429]]],[60,"Ultimate Spider-Man",13,[[1,258],[2,53],[3,54],[4,55]]],[61,"Super V",13,[[1,334]]],[62,"Zig and Sharko",13,[[1,64],[2,65],[3,66]]],[64,"Beyblade",13,[[8,221],[8,220],[10,82],[12,89],[13,90],[14,91],[15,94],[16,95],[17,96],[18,124]]],[65,"Pokémon",14,[[0,193],[1,2809],[1,172],[17,215],[18,73],[19,335],[20,76],[21,78],[22,79],[24,71],[25,104],[26,145]]],[68,"Slugterra",13,[[1,97],[2,98],[3,99]]],[69,"Teen Titans Go",13,[[1,100],[2,101],[3,102],[4,103]]],[70,"Ben 10",13,[[1,382],[2,383],[3,384],[4,385],[5,600],[5,386],[6,601],[6,387],[7,602],[7,388],[8,603],[8,389],[9,390],[10,391],[11,392],[12,393],[13,394],[14,395]]],[76,"Crayon Shin-chan",17,[[1,2827],[2,2828],[3,2829],[4,2830],[5,2831],[6,2832],[7,2833],[8,2834],[9,2767],[12,192],[13,199],[14,203],[15,213]]],[77,"Crayon Shin-chan",18,[[1,2812],[2,2813],[3,2814],[4,2815],[5,2816],[6,2817],[7,2818],[8,2819],[9,2766],[12,196],[13,200],[14,204],[15,214]]],[78,"Beyblade",14,[[8,2783],[8,2782],[8,166]]],[79,"Beyblade",17,[[8,167]]],[80,"Beyblade",18,[[8,168]]],[83,"Courage the Cowardly Dog",13,[[1,174],[2,175],[3,176],[4,177]]],[84,"Pokémon",17,[[0,337],[1,2811],[17,216],[18,194],[18,179],[19,321],[25,210]]],[85,"Pokémon",18,[[0,338],[1,2810],[17,217],[17,195],[18,180],[19,322],[25,211]]],[89,"Rent-A-Girlfriend",14,[[1,187],[2,188],[3,316],[4,476],[5,2781]]],[90,"Doraemon",17,[[15,249],[18,226],[19,2870],[20,2871]]],[91,"Doraemon",18,[[15,250],[18,228],[19,2862],[20,2863]]],[92,"Yo-kai Watch",13,[[1,218]]],[93,"Tom and Jerry",13,[[1,224],[2,229],[3,230]]],[94,"Tom and Jerry",14,[[1,2740],[2,2741],[3,2742]]],[98,"Idaten Jump",13,[[1,332]]],[100,"Jackie Chan Adventures",14,[[1,252]]],[101,"Jackie Chan Adventures",13,[[1,251]]],[103,"Jackie Chan Adventures",18,[[1,254]]],[104,"Hagemaru",13,[[1,255]]],[105,"Tottemo! Luckyman",13,[[1,378]]],[107,"Ultimate Spider-Man",14,[[1,259],[2,417],[3,420],[4,424]]],[108,"Ultimate Spider-Man",17,[[1,260],[2,419],[3,423]]],[109,"Ultimate Spider-Man",18,[[1,261],[2,418],[3,422]]],[112,"Spy × Family",13,[[1,353],[2,263]]],[136,"One-Punch Man",13,[[1,294],[2,375]]],[148,"More Than a Married Couple, But Not Lovers",13,[[1,306]]],[149,"More Than a Married Couple, But Not Lovers",14,[[1,307]]],[150,"Jujutsu Kaisen",13,[[1,308],[2,416],[3,2739]]],[151,"Jujutsu Kaisen",14,[[1,312],[2,310],[3,2843]]],[152,"Jujutsu Kaisen",18,[[1,313],[2,311],[3,2844]]],[153,"The Angel Next Door Spoils Me Rotten",13,[[1,314],[2,2750]]],[154,"Rent-A-Girlfriend",13,[[1,345],[2,346],[3,315],[4,475]]],[159,"Kung Fu Panda",13,[]],[160,"Kung Fu Panda",14,[]],[161,"Kung Fu Panda",18,[]],[162,"Kung Fu Panda",17,[]],[163,"Ultra B",13,[[1,331]]],[164,"Looney Tunes",13,[[1,339],[2,340]]],[165,"Looney Tunes",14,[[1,341],[2,342]]],[166,"Looney Tunes",17,[[1,343]]],[167,"Looney Tunes",18,[[1,344]]],[168,"Perman",13,[[1,347],[2,348]]],[169,"Perman",17,[[1,351],[2,352]]],[170,"Perman",18,[[1,349],[2,350]]],[172,"BoBoiBoy",13,[[1,358]]],[173,"BoBoiBoy",14,[[1,359]]],[174,"Tokyo Revengers",13,[[1,360]]],[175,"Junji Ito Collection",13,[[1,361]]],[176,"The World's Finest Assassin Gets Reincarnated In Another World As An Aristocrat",13,[[0,362]]],[187,"Mushoku Tensei Jobless Reincarnation",13,[[1,372],[2,373]]],[188,"Chhota Bheem",13,[[0,2747],[1,591],[2,592],[3,593],[4,594],[5,595],[6,596],[7,597],[8,598],[9,599]]],[189,"Attack ON Titan",13,[[1,477],[2,478],[3,479],[4,480]]],[191,"Krishna & Balram",13,[[1,2759],[2,2760],[3,2761],[4,2762]]],[192,"Naruto",13,[[1,514],[2,515],[3,516],[4,517],[5,518],[17,2845]]],[194,"Dragon Ball",13,[[1,638],[2,639],[3,640],[4,641],[5,654],[6,655],[7,656],[8,410],[9,411],[10,412],[11,413],[12,414],[13,397]]],[195,"Dragon Ball",14,[[1,642],[2,643],[3,644],[4,645],[5,657],[6,658],[7,659]]],[196,"Dragon Ball",17,[[1,650],[2,651],[3,652],[4,653],[5,663],[6,664],[7,665]]],[197,"Dragon Ball",18,[[1,646],[2,647],[3,648],[4,649],[5,660],[6,661],[7,662]]],[199,"Tottemo! Luckyman",17,[[1,380]]],[200,"Tottemo! Luckyman",18,[[1,379]]],[201,"Big Buck Bunny",14,[[1,381]]],[202,"Ranma ½",13,[[1,396],[2,2835],[3,2836]]],[203,"The New Adventures of Hanuman",13,[[1,398]]],[204,"Hunter × Hunter",13,[[1,399],[2,400],[3,401]]],[205,"DAN DA DAN",13,[[1,402]]],[206,"Classroom of the Elite",13,[[1,2774],[2,2775],[3,2776]]],[207,"My Hero Academia",13,[[1,406],[2,405],[3,407],[4,408],[5,409],[6,2743],[7,2744],[8,2745]]],[208,"Solo Leveling ",13,[[1,493],[2,494]]],[209,"Doraemon",14,[]],[210,"Ben 10",14,[[1,608],[1,604],[2,609],[2,605],[3,610],[3,606],[4,607],[8,611],[9,612],[10,613],[11,614],[12,615],[13,616],[14,617],[15,618],[16,619],[17,620],[18,621]]],[211,"My Hero Academia",14,[]],[212,"My Hero Academia",17,[]],[213,"My Hero Academia",18,[]],[214,"Iron Man",14,[[1,427],[2,430]]],[216,"Haddi Mera Buddy",13,[[1,431],[2,432],[3,433],[4,434],[5,435],[6,436]]],[217,"Haddi Mera Buddy",17,[[1,449],[2,450],[3,451],[4,452],[5,453],[6,454]]],[218,"Haddi Mera Buddy",18,[[1,443],[2,444],[3,445],[4,446],[5,447],[6,448]]],[219,"The Grim Adventures of Billy & Mandy",14,[[1,437],[2,438],[3,439],[4,440],[5,441],[6,442]]],[220,"Shaun the Sheep",13,[[1,455],[2,456],[3,457],[4,458]]],[221,"Shaun the Sheep",14,[[1,459],[2,460],[3,461],[4,462]]],[222,"Shaun the Sheep",17,[[1,467],[2,468],[3,469],[4,470]]],[223,"Shaun the Sheep",18,[[1,463],[2,464],[3,465],[4,466]]],[224,"Death Note",13,[[1,471]]],[225,"Death Note",14,[[1,474]]],[226,"Death Note",17,[[1,472]]],[227,"Death Note",18,[[1,473]]],[228,"Attack ON Titan",14,[[1,481],[2,482],[3,483],[4,484]]],[229,"Attack ON Titan",17,[[1,489],[2,490],[3,491],[4,492]]],[230,"Attack ON Titan",18,[[1,485],[2,486],[3,487],[4,488]]],[231,"Solo Leveling",14,[[1,497],[2,498]]],[232,"Solo Leveling",17,[[1,495],[2,500]]],[233,"Solo Leveling",18,[[1,496],[2,499]]],[234,"Demon Slayer",13,[[1,501],[2,503],[2,502],[3,504],[4,505]]],[235,"Demon Slayer",14,[[2,508],[2,506],[3,509]]],[236,"Demon Slayer",18,[[3,510],[4,511]]],[237,"Demon Slayer",17,[[3,512],[4,513]]],[238,"Naruto",14,[[1,524],[2,525],[3,526],[4,527],[5,528],[17,2846]]],[239,"Naruto",17,[[1,534],[2,535],[3,536],[4,537],[5,538],[17,2848]]],[240,"Naruto",18,[[1,529],[2,530],[3,531],[4,532],[5,533],[17,2847]]],[241,"Days with My Stepsister",13,[[1,539]]],[242,"Alya Sometimes Hides Her Feelings in Russian",13,[[1,540]]],[243,"Alya Sometimes Hides Her Feelings in Russian",14,[[1,541]]],[244,"Alya Sometimes Hides Her Feelings in Russian",17,[[1,543]]],[245,"Alya Sometimes Hides Her Feelings in Russian",18,[[1,542]]],[246,"I Got Married to the Girl I Hate Most in Class",13,[[1,544]]],[247,"I Got Married to the Girl I Hate Most in Class",17,[[1,546]]],[248,"I Got Married to the Girl I Hate Most in Class",18,[[1,545]]],[249,"365 Days to the Wedding",13,[[1,547]]],[250,"365 Days to the Wedding",17,[[1,549]]],[251,"365 Days to the Wedding",18,[[1,548]]],[252,"The Shiunji Family Children",13,[[1,550]]],[253,"The Shiunji Family Children",14,[[1,551]]],[254,"Jujutsu Kaisen",17,[[1,2840],[2,2841],[3,2842]]],[258,"One-Punch Man",14,[[1,552],[2,553]]],[259,"One-Punch Man",17,[[1,556],[2,557]]],[260,"One-Punch Man",18,[[1,554],[2,555]]],[262,"Detective Conan",13,[]],[264,"Detective Conan",14,[]],[265,"Detective Conan",17,[]],[266,"Detective Conan",18,[]],[267,"Roll No. 21",13,[[1,559],[2,560],[3,561],[4,562],[5,563],[6,564],[7,565],[8,566]]],[271,"Ben 10",17,[[1,630],[2,631],[3,632],[4,633],[5,634],[6,635],[7,636],[8,637]]],[273,"Ben 10",18,[[1,622],[2,623],[3,624],[4,625],[5,626],[6,627],[7,628],[8,629]]],[274,"Krishna & Balram",14,[[3,2763],[4,2764]]],[275,"Krishna & Balram",17,[]],[276,"Krishna & Balram",18,[]],[277,"Toy Story",13,[]],[278,"Chimpui",13,[[0,2746]]],[279,"Kid Krrish",13,[]],[280,"Kid Krrish",14,[]],[281,"Oggy and the Cockroaches",13,[[1,2751],[2,2752],[3,2753],[4,2754],[5,2755],[6,2756],[7,2757],[8,2758]]],[282,"Blue Box",13,[[1,2768]]],[283,"Blue Box",14,[[1,2769]]],[284,"Blue Box",17,[[1,2770]]],[285,"Blue Box",18,[[1,2771]]],[286,"Your Lie in April",13,[[1,2772]]],[287,"Your Lie in April",14,[[1,2773]]],[288,"Classroom of the Elite",14,[[1,2777],[2,2778],[3,2779],[4,2780]]],[291,"Roll No. 21",14,[[1,2784],[2,2785],[3,2786],[4,2787],[5,2788],[6,2789],[7,2790],[8,2791]]],[292,"Roll No. 21",18,[[1,2792],[2,2793],[3,2794],[4,2795],[5,2796],[6,2797],[7,2798],[8,2799]]],[293,"Roll No. 21",17,[[1,2800],[2,2801],[3,2802],[4,2803],[5,2804],[6,2805],[7,2806],[8,2807]]],[294,"Toy Story",14,[]],[295,"Ranma ½",14,[[0,2839],[1,2837],[2,2838]]],[296,"Cars (Hindi)",13,[]],[297,"Cars (English)",14,[]]];

function _xonStr(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
function _xonNorm(s) {
  return _xonStr(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function _xonSlug(s) {
  return _xonNorm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function _xonPad(n, w) {
  var s = String(n);
  while (s.length < w) s = "0" + s;
  return s;
}
// Whole-word exact match on normalized text: the alias must appear
// as a complete word (or the whole string), never as a substring of
// another word. This is gate v3 — never weakened.
function _xonTitleMatches(haystack, alias) {
  var h = " " + _xonNorm(haystack) + " ";
  var a = _xonNorm(alias);
  if (!a) return false;
  if (h === " " + a + " ") return true;
  return h.indexOf(" " + a + " ") !== -1;
}
function _xonIsLatin(s) {
  return /^[\x00-\x7F]*$/.test(_xonStr(s));
}
function _xonFetchJson(url) {
  return fetch(url, { headers: { Accept: "application/json", "User-Agent": XON_UA } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

// ---------- TMDB ----------
function _xonTmdbDetails(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return _xonFetchJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + XON_TMDB_KEY)
    .then(function (j) {
      if (!j) return { title: "", year: "", runtime: 0 };
      var t = j.title || j.name || "";
      var d = j.release_date || j.first_air_date || "";
      var rt = 0;
      if (typeof j.runtime === "number" && j.runtime > 0) rt = j.runtime;
      else if (Array.isArray(j.episode_run_time) && j.episode_run_time.length && j.episode_run_time[0] > 0) rt = j.episode_run_time[0];
      return { title: t, year: d ? String(d).slice(0, 4) : "", runtime: rt };
    });
}
function _xonTmdbAliases(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return _xonFetchJson("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "/alternative_titles?api_key=" + XON_TMDB_KEY)
    .then(function (j) {
      var out = [];
      var arr = (j && (j.titles || j.results)) || [];
      for (var i = 0; i < arr.length; i++) {
        var t = arr[i] && (arr[i].title || arr[i].name);
        if (t && _xonIsLatin(t)) out.push(t);
      }
      // Shortest first (most likely the short site name, e.g. "Shinchan"),
      // cap 4, de-duplicated. Gate is unchanged; only the candidate list.
      out.sort(function (a, b) { return a.length - b.length; });
      var seen = {}, res = [];
      for (var k = 0; k < out.length && res.length < 4; k++) {
        var key = _xonNorm(out[k]);
        if (key && !seen[key]) { seen[key] = true; res.push(out[k]); }
      }
      return res;
    });
}
function _xonEpRuntime(tmdbId, season, episode) {
  return _xonFetchJson("https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + XON_TMDB_KEY)
    .then(function (j) { return (j && typeof j.runtime === "number" && j.runtime > 0) ? j.runtime : 0; });
}


function _xonFileSizeLabel(bytes) {
  var n = Number(bytes);
  if (!n || n <= 0) return "";
  if (n >= 1073741824) return (n / 1073741824).toFixed(2).replace(/\.00$/, "") + " GB";
  if (n >= 1048576) return Math.round(n / 1048576) + " MB";
  return Math.round(n / 1024) + " KB";
}


// ---------- v4 formatter ----------
// __STREAM_LABEL_FORMATTER__ v4 (size): user-spec body — heading is the
// provider name (in `name`), body is the essential info. Only lines
// with data are shown. Pure string work, no timers, no TextEncoder,
// no fetch. Never throws.
function formatStreamSize(o) {
  try {
    o = o || {};
    function str(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
    function langName(v) {
      var k = str(v).toLowerCase();
      var map = { en: "English", eng: "English", english: "English", hi: "Hindi", hin: "Hindi", hindi: "Hindi",
        es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", ru: "Russian",
        ar: "Arabic", bn: "Bengali", zh: "Chinese", ja: "Japanese", ko: "Korean", ta: "Tamil", te: "Telugu",
        ml: "Malayalam", mr: "Marathi", pa: "Punjabi", ur: "Urdu", id: "Indonesian", ms: "Malay",
        vi: "Vietnamese", th: "Thai", tl: "Filipino", nl: "Dutch", sv: "Swedish", da: "Danish",
        fi: "Finnish", no: "Norwegian", pl: "Polish", tr: "Turkish", uk: "Ukrainian", cs: "Czech",
        el: "Greek", he: "Hebrew", ro: "Romanian", hu: "Hungarian" };
      if (map[k]) return map[k];
      return str(v);
    }
    var lines = [];
    var title = str(o.title);
    if (title) {
      var t = "🎬 " + title;
      var year = str(o.year);
      if (year) t += " (" + year + ")";
      lines.push(t);
    }
    if (o.season !== undefined && o.season !== null && String(o.season) !== "" &&
        o.episode !== undefined && o.episode !== null && String(o.episode) !== "")
      lines.push("📂 Season " + o.season + " • 🎞️ Episode " + o.episode);
    var q = str(o.quality);
    if (q && q.toLowerCase() !== "unknown") lines.push("💎 " + q);
    var rt = o.runtime;
    var rtMin = 0;
    if (typeof rt === "number" && rt > 0) rtMin = Math.round(rt);
    else if (typeof rt === "string" && /^\d+$/.test(rt.trim())) rtMin = parseInt(rt.trim(), 10);
    if (rtMin > 0) {
      var rh = Math.floor(rtMin / 60), rm = rtMin % 60;
      lines.push("⏱️ " + (rh > 0 ? rh + "h " + (rm < 10 ? "0" : "") + rm + "m" : rm + "m"));
    }
    var audio = o.audio;
    if (Array.isArray(audio)) audio = audio.filter(function (a) { return str(a); }).join(" / ");
    audio = str(audio);
    if (audio && audio.toLowerCase() !== "unknown") lines.push("🔊 " + audio);
    var size = str(o.size);
    if (size) lines.push("💾 " + size);
    var server = str(o.server);
    if (!server && str(o.url)) {
      var h = str(o.url).split("/")[2] || "";
      server = h.replace(/^www\./, "");
    }
    if (server) lines.push("🗄️ " + server);
    var subs = o.subtitles;
    var langs = [];
    if (Array.isArray(subs)) {
      for (var i = 0; i < subs.length; i++) {
        var lg = (subs[i] && typeof subs[i] === "object") ? (subs[i].language || subs[i].name) : subs[i];
        lg = langName(lg);
        if (lg && langs.indexOf(lg) === -1) langs.push(lg);
      }
    } else if (typeof subs === "string" && str(subs)) { langs = [langName(subs)]; }
    if (langs.length) {
      var shown = langs.slice(0, 3).join(", ");
      if (langs.length > 3) shown += " +" + (langs.length - 3) + " more";
      lines.push("💬 " + shown);
    }
    return lines.join("\n");
  } catch (e) { return ""; }
}



// ---------- pure-JS SHA-256 + HMAC (no WebCrypto in the guest) ----------
// sha256BytesPure: copied verbatim from test/tvcompat-block.js
// (vector-tested vs Node crypto). Takes bytes (array/Uint8Array),
// returns Uint8Array(32).

function sha256BytesPure(inputBytes) {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  function rr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  var msg = Array.prototype.slice.call(inputBytes);
  var bitLen = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  // 64-bit length (inputs here are small; high 32 bits handled properly anyway)
  var hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
  msg.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
           (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  var w = new Array(64);
  for (var off = 0; off < msg.length; off += 64) {
    var t;
    for (t = 0; t < 16; t++) w[t] = ((msg[off + 4 * t] << 24) | (msg[off + 4 * t + 1] << 16) | (msg[off + 4 * t + 2] << 8) | msg[off + 4 * t + 3]) >>> 0;
    for (t = 16; t < 64; t++) {
      var s0 = (rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      var s1 = (rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (t = 0; t < 64; t++) {
      var S1 = (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      var S0 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      var temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  var out = new Uint8Array(32);
  for (var i = 0; i < 8; i++) {
    out[4 * i] = (H[i] >>> 24) & 255; out[4 * i + 1] = (H[i] >>> 16) & 255;
    out[4 * i + 2] = (H[i] >>> 8) & 255; out[4 * i + 3] = H[i] & 255;
  }
  return out;
}


// UTF-8 encode a string to a byte array (pure JS; the guest has no
// TextEncoder). All HMAC inputs here are ASCII, but this is correct
// for the general case too.
function _xonUtf8Bytes(s) {
  s = _xonStr(s);
  var out = [], i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}
function _xonHex(bytes) {
  var h = "0123456789abcdef", out = "";
  for (var i = 0; i < bytes.length; i++) out += h[(bytes[i] >> 4) & 15] + h[bytes[i] & 15];
  return out;
}
// HMAC-SHA256, hex output. Key and message are strings; both are
// UTF-8 encoded exactly like the .cs3's hmacSha256 (key.getBytes
// UTF-8). Verified against Node crypto: HMAC(certHash, apiKey) =
// 5f19ced7d1023abbbe38ece5514b63eb539a64ddbf0fdc1da9c78434c7f21931.
function _xonHmacSha256Hex(keyStr, msgStr) {
  var key = _xonUtf8Bytes(keyStr);
  var msg = _xonUtf8Bytes(msgStr);
  if (key.length > 64) key = Array.prototype.slice.call(sha256BytesPure(key));
  var block = new Array(64), ipad = [], opad = [], i;
  for (i = 0; i < 64; i++) block[i] = i < key.length ? key[i] : 0;
  for (i = 0; i < 64; i++) { ipad.push(block[i] ^ 0x36); opad.push(block[i] ^ 0x5c); }
  var inner = sha256BytesPure(ipad.concat(msg));
  var outer = sha256BytesPure(opad.concat(Array.prototype.slice.call(inner)));
  return _xonHex(outer);
}
var _xonSecretKeyHex = null;
function _xonSecretKey() {
  if (!_xonSecretKeyHex) _xonSecretKeyHex = _xonHmacSha256Hex(XON_API_KEY, XON_CERT_HASH);
  return _xonSecretKeyHex;
}
// Signed headers for an API path (e.g. "/apis/nzgetepisodes_v2.php").
// The .cs3 signs path + ":" + currentTimeMillis with the secretKey;
// the query string is NOT part of the signed path (verified: signing
// "/apis/nzgetepisodes_v2.php?since=0" gets 403, signing the bare
// path with ?since=0 on the URL gets 200). The URL itself is
// mainUrl + "/nzgetepisodes_v2.php" (no doubled /apis).
function _xonSignedHeaders(path) {
  var ts = String(Date.now());
  var sig = _xonHmacSha256Hex(_xonSecretKey(), path + ":" + ts);
  return { "API": XON_API_KEY, "CALLER": XON_CALLER, "X-Timestamp": ts, "X-Signature": sig,
    "User-Agent": "okhttp/4.12.0", "Connection": "Keep-Alive", "Cache-Control": "no-cache" };
}
function _xonApiJson(endpoint, query) {
  var url = XON_API + "/" + endpoint + (query ? "?" + query : "");
  return fetch(url, { headers: _xonSignedHeaders("/apis/" + endpoint) })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}


// ---------- API resolution ----------
// Find the show for a candidate title (gate v3 — see header).
// Hindi wins when several languages share the title.
function _xonFindShow(cand) {
  var norm = _xonNorm(cand);
  if (!norm) return null;
  var joined = norm.replace(/\s+/g, "");
  var best = null;
  for (var i = 0; i < XON_SHOWS.length; i++) {
    var sh = XON_SHOWS[i];
    var t = _xonNorm(sh[1]);
    var ok = _xonTitleMatches(sh[1], cand) || t === norm || (joined && t.replace(/\s+/g, "") === joined);
    if (!ok) continue;
    if (!best) best = sh;
    if (sh[2] === XON_HINDI) { best = sh; break; }
  }
  return best;
}
function _xonSeasonId(show, season) {
  var seasons = show[3] || [];
  for (var i = 0; i < seasons.length; i++) if (seasons[i][0] === season) return seasons[i][1];
  return 0;
}
// The .cs3's formatUrl: absolute URLs pass through; anything else
// gets the archive.org download prefix. Blank or "none" is skipped.
function _xonFormatUrl(url) {
  var u = _xonStr(url);
  if (!u || u.toLowerCase() === "none") return "";
  if (/^https?:\/\//i.test(u)) return u;
  return "https://archive.org/download/" + u;
}
// The .cs3's loadLinks order and labels. aplayer1 is a direct
// vids.st mp4 ("Server 1"); aplayer2/link/xPlayer4 are embed pages
// (loadExtractor in CloudStream) and are skipped — not playable
// directly in the Nuvio guest.
var XON_API_QUALITIES = [
  ["basic", "Basic (240p)", "240p"],
  ["sd", "SD (480p)", "480p"],
  ["hd", "HD (720p)", "720p"],
  ["fhd", "FHD (1080p)", "1080p"]
];
function _xonMakeApiStream(url, meta, season, episode, label, quality, audio) {
  var size = formatStreamSize({
    title: meta.title, year: meta.year, runtime: meta.runtime,
    quality: quality, season: season, episode: episode,
    audio: audio || "Hindi", source: "Xon", server: label, url: url
  });
  return {
    name: "Xon", title: "Xon", size: size,
    url: url, quality: quality, type: "direct",
    headers: { "User-Agent": XON_UA },
    behaviorHints: { notWebReady: true, proxyHeaders: { request: { "User-Agent": XON_UA } } }
  };
}
function _xonStreamsFromEpisode(ep, meta, season, episode, audio) {
  var out = [], seen = {};
  function add(url, label, quality) {
    var u = _xonFormatUrl(url);
    if (!u || seen[u]) return;
    seen[u] = true;
    out.push(_xonMakeApiStream(u, meta, season, episode, label, quality, audio));
  }
  for (var i = 0; i < XON_API_QUALITIES.length; i++) {
    var q = XON_API_QUALITIES[i];
    add(ep[q[0]], q[1], q[2]);
  }
  add(ep.aplayer1, "Server 1", "720p");
  return out;
}
// Resolve one TV episode through the live API.
// candidates: title strings (canonical first, then aliases, shortest
// first). For each, find the show (gate), the season id (baked map),
// fetch that season's episodes live, and return the streams for the
// exact episode number.
function _xonResolveEpisodeApi(candidates, season, episode, meta) {
  var ci = 0;
  function nextCandidate() {
    if (ci >= candidates.length) return Promise.resolve([]);
    var cand = candidates[ci++];
    var show = _xonFindShow(cand);
    if (!show) return nextCandidate();
    var seasonId = _xonSeasonId(show, season);
    if (!seasonId) return nextCandidate();
    var audio = XON_LANG_NAME[show[2]] || "Hindi";
    return _xonApiJson("nzgetepisodes_v2.php", "season_id=" + seasonId).then(function (j) {
      var eps = (j && j.episodes) || [];
      if (!eps.length) {
        // Season fetch came back empty — retry once with the whole
        // show (covers a transient failure of the filtered call).
        return _xonApiJson("nzgetepisodes_v2.php", "show_id=" + show[0]).then(function (j2) {
          var eps2 = (j2 && j2.episodes) || [];
          var ep2 = null;
          for (var k = 0; k < eps2.length; k++) {
            if (eps2[k] && Number(eps2[k].no) === episode && Number(eps2[k].season_id) === seasonId) { ep2 = eps2[k]; break; }
          }
          if (!ep2) return nextCandidate();
          var out2 = _xonStreamsFromEpisode(ep2, meta, season, episode, audio);
          return out2.length ? out2 : nextCandidate();
        }).catch(function () { return nextCandidate(); });
      }
      var ep = null;
      for (var i = 0; i < eps.length; i++) {
        if (eps[i] && Number(eps[i].no) === episode && Number(eps[i].season_id) === seasonId) { ep = eps[i]; break; }
      }
      if (!ep) return nextCandidate();
      var out = _xonStreamsFromEpisode(ep, meta, season, episode, audio);
      return out.length ? out : nextCandidate();
    }).catch(function () { return nextCandidate(); });
  }
  return nextCandidate();
}


function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var season = seasonNum || 1, episode = episodeNum || 1;
  return Promise.all([
    _xonTmdbDetails(tmdbId, mediaType),
    _xonTmdbAliases(tmdbId, mediaType),
    kind === "tv" ? _xonEpRuntime(tmdbId, season, episode) : Promise.resolve(0)
  ]).then(function (res) {
    var meta = res[0] || { title: "", year: "", runtime: 0 };
    if (kind === "tv" && !meta.runtime && res[2] > 0) meta.runtime = res[2];
    if (!meta.title) return [];
    // Candidate titles: canonical first, then aliases (shortest
    // first, cap 4). The gate is unchanged for every candidate.
    // Each candidate also contributes its joined single-word form
    // (spaces/hyphens removed), because sites name shows that way:
    // TMDB's alias "Shin-chan" never matches the API title
    // "Crayon Shin-chan" as a whole word, but the joined
    // "Shinchan" matches a show titled "Shinchan". The joined form
    // is still the full title/alias, so the gate (exact title
    // match + exact S/E) is not weakened.
    var candidates = [meta.title].concat(res[1] || []);
    var seen = {}, ordered = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var k = _xonNorm(c);
      if (k && !seen[k]) { seen[k] = true; ordered.push(c); }
      var joined = _xonNorm(c).replace(/\s+/g, "");
      if (joined && joined !== k && !seen[joined]) {
        seen[joined] = true;
        // Capitalise first letter for a natural title form.
        ordered.push(joined.charAt(0).toUpperCase() + joined.slice(1));
      }
    }
    if (kind === "tv") return _xonResolveEpisodeApi(ordered, season, episode, meta);
    // Movies: no per-movie endpoint exists — a movie's stream URLs
    // live only in the 2.2 MB shows response (over the 1 MB guest
    // cap). Honest empty, same as xon2.js.
    return [];
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.XonScraperModule = { getStreams: getStreams };
}

/* __CHAIN_RETRY_POSTLUDE__ v2: in a full TV search, providers die when
   the fetch service drops a hop or sits in a dead window. If a chain
   comes back empty, re-run it - the re-run is naturally spaced by the
   first attempt's own duration, which spans the short windows. Up to
   3 attempts, gated on total elapsed (<20s for #2, <38s for #3) so a
   slow provider never overruns the app budget. */
(function () {
  try {
    var g = (typeof globalThis !== "undefined") ? globalThis : null;
    var orig = null;
    if (typeof module !== "undefined" && module.exports && typeof module.exports.getStreams === "function") orig = module.exports.getStreams;
    else if (g && typeof g.getStreams === "function") orig = g.getStreams;
    if (!orig || orig.__chainRetry) return;
    var wrapped = function () {
      var args = arguments;
      var t0 = Date.now();
      var tries = 0;
      var run = function () {
        tries++;
        return Promise.resolve().then(function () { return orig.apply(null, args); }).then(function (res) {
          var el = Date.now() - t0;
          if (Array.isArray(res) && res.length === 0 && ((tries === 1 && el < 20000) || (tries === 2 && el < 38000))) return run();
          return res;
        }, function () {
          var el = Date.now() - t0;
          if ((tries === 1 && el < 20000) || (tries === 2 && el < 38000)) return run();
          return [];
        });
      };
      return run();
    };
    wrapped.__chainRetry = true;
    if (typeof module !== "undefined" && module.exports) module.exports.getStreams = wrapped;
    if (g) { try { g.getStreams = wrapped; } catch (e) {} }
  } catch (e) {}
})();

