const BASE_URL = 'https://vivarium.st';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const PROVIDERS = [
  { key: 'hades', label: 'Hades' },
  { key: 'hemera', label: 'Hemera', def: true },
  { key: 'hyperion', label: 'Hyperion', def: true },
  { key: 'nyx', label: 'Nyx' },
  { key: 'orion', label: 'Orion' },
  { key: 'poseidon', label: 'Poseidon' },
  { key: 'tethys', label: 'Tethys' },
  { key: 'theia', label: 'Theia' },
  { key: 'tyche', label: 'Tyche' },
];

const LANGUAGES = [
  { key: 'lang_ar', code: 'ar', label: 'Arabic' },
  { key: 'lang_bn', code: 'bn', label: 'Bengali' },
  { key: 'lang_zh', code: 'zh', label: 'Chinese' },
  { key: 'lang_nl', code: 'nl', label: 'Dutch' },
  { key: 'lang_fr', code: 'fr', label: 'French' },
  { key: 'lang_de', code: 'de', label: 'German' },
  { key: 'lang_hi', code: 'hi', label: 'Hindi', def: true },
  { key: 'lang_it', code: 'it', label: 'Italian' },
  { key: 'lang_ja', code: 'ja', label: 'Japanese' },
  { key: 'lang_kn', code: 'kn', label: 'Kannada' },
  { key: 'lang_ko', code: 'ko', label: 'Korean' },
  { key: 'lang_pl', code: 'pl', label: 'Polish' },
  { key: 'lang_pt', code: 'pt', label: 'Portuguese' },
  { key: 'lang_ru', code: 'ru', label: 'Russian' },
  { key: 'lang_es', code: 'es', label: 'Spanish' },
  { key: 'lang_ta', code: 'ta', label: 'Tamil' },
  { key: 'lang_te', code: 'te', label: 'Telugu' },
  { key: 'lang_tr', code: 'tr', label: 'Turkish' },
];

function enabledProviders() {
  const settings = (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) || {};
  const enabled = new Set();
  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i];
    if (settings[p.key] === undefined ? !!p.def : settings[p.key] === true) {
      enabled.add(p.label.toLowerCase());
    }
  }
  return enabled;
}

function enabledLanguages() {
  const settings = (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) || {};
  const enabled = new Set();
  for (let i = 0; i < LANGUAGES.length; i++) {
    const l = LANGUAGES[i];
    if (settings[l.key] === undefined ? !!l.def : settings[l.key] === true) {
      enabled.add(l.code);
    }
  }
  return enabled;
}

const RC256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function encodeUtf8(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    let codePoint = text.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint < 0xdc00 && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (codePoint < 0x80) bytes.push(codePoint);
    else if (codePoint < 0x800) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 63));
    else if (codePoint < 0x10000) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 63), 0x80 | (codePoint & 63));
    else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 63), 0x80 | ((codePoint >> 6) & 63), 0x80 | (codePoint & 63));
  }
  return bytes;
}

function sha256Digest(input) {
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const byteLength = input.length;
  const bitLengthHigh = Math.floor(byteLength / 0x20000000);
  const bitLengthLow = (byteLength << 3) >>> 0;
  const padded = input.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  padded.push(
    (bitLengthHigh >>> 24) & 255, (bitLengthHigh >>> 16) & 255, (bitLengthHigh >>> 8) & 255, bitLengthHigh & 255,
    (bitLengthLow >>> 24) & 255, (bitLengthLow >>> 16) & 255, (bitLengthLow >>> 8) & 255, bitLengthLow & 255
  );

  const schedule = new Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    let round;
    for (round = 0; round < 16; round++) {
      const base = offset + round * 4;
      schedule[round] = ((padded[base] << 24) | (padded[base + 1] << 16) | (padded[base + 2] << 8) | padded[base + 3]) | 0;
    }
    for (round = 16; round < 64; round++) {
      const early = schedule[round - 15];
      const late = schedule[round - 2];
      const sigma0 = ((early >>> 7) | (early << 25)) ^ ((early >>> 18) | (early << 14)) ^ (early >>> 3);
      const sigma1 = ((late >>> 17) | (late << 15)) ^ ((late >>> 19) | (late << 13)) ^ (late >>> 10);
      schedule[round] = (schedule[round - 16] + sigma0 + schedule[round - 7] + sigma1) | 0;
    }

    let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
    for (round = 0; round < 64; round++) {
      const bigSigma1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + bigSigma1 + choice + RC256[round] + schedule[round]) | 0;
      const bigSigma0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigma0 + majority) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0; state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
    state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0; state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
  }

  const digest = [];
  for (let i = 0; i < 8; i++) {
    digest.push((state[i] >>> 24) & 255, (state[i] >>> 16) & 255, (state[i] >>> 8) & 255, state[i] & 255);
  }
  return digest;
}

const HMAC_KEY_BYTES = encodeUtf8('6af5200a03de9a234734d3ef385c84490dc4164881e408450b6c35973803bded');
const HMAC_INNER_PAD = [];
const HMAC_OUTER_PAD = [];
for (let i = 0; i < 64; i++) {
  const keyByte = i < HMAC_KEY_BYTES.length ? HMAC_KEY_BYTES[i] : 0;
  HMAC_INNER_PAD.push(keyByte ^ 0x36);
  HMAC_OUTER_PAD.push(keyByte ^ 0x5c);
}

function hmacSha256Hex(messageBytes) {
  const mac = sha256Digest(HMAC_OUTER_PAD.concat(sha256Digest(HMAC_INNER_PAD.concat(messageBytes))));
  let hex = '';
  for (let i = 0; i < mac.length; i++) hex += (mac[i] < 16 ? '0' : '') + mac[i].toString(16);
  return hex;
}

function signRequest(method, pathAndQuery, timestamp, nonce) {
  const message = method.toUpperCase() + '\n' + pathAndQuery + '\n' + timestamp + (nonce ? '\n' + nonce : '') + '\n' + 'b52856e7e79eca1ea3c8ef537932f11367cebc1d16e0e2dcde54c10d42701fbc';
  return hmacSha256Hex(encodeUtf8(message));
}

function defaultHeaders() {
  return { 'User-Agent': USER_AGENT, 'Referer': BASE_URL + '/', 'Accept': '*/*' };
}

let serverClockOffsetMs = 0;

function syncServerClock(response) {
  try {
    const dateHeader = response && response.headers && response.headers.get('date');
    if (dateHeader) {
      const serverTime = Date.parse(dateHeader);
      if (!isNaN(serverTime)) serverClockOffsetMs = serverTime - Date.now();
    }
  } catch (e) { }
}

async function getUnsigned(path) {
  const response = await fetch(BASE_URL + path, { headers: defaultHeaders() });
  syncServerClock(response);
  return response;
}

function getSigned(path, nonce) {
  const timestamp = String(Math.floor((Date.now() + serverClockOffsetMs) / 1000));
  const headers = defaultHeaders();
  headers['x-ts'] = timestamp;
  headers['x-cv'] = 'a0ea25ffaf1d';
  if (nonce) headers['x-nonce'] = nonce;
  headers['x-sig'] = signRequest('GET', path, timestamp, nonce || '');
  return fetch(BASE_URL + path, { headers: headers });
}

async function fetchNonces() {
  try {
    const response = await getUnsigned('/api/n');
    if (!response.ok) return [];
    const nonces = await response.json();
    return Array.isArray(nonces) ? nonces : [];
  } catch (e) {
    return [];
  }
}

function parseServerSentEvents(text) {
  const events = [];
  const blocks = String(text || '').split(/\r?\n\r?\n/);
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i]) continue;
    const event = { event: 'message', data: '' };
    const lines = blocks[i].split(/\r?\n/);
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0) continue;
      const field = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1).replace(/^ /, '');
      if (field === 'event') event.event = value;
      else if (field === 'data') event.data += (event.data ? '\n' : '') + value;
    }
    events.push(event);
  }
  return events;
}

function toAbsoluteUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  if (url.charAt(0) === '/') return BASE_URL + url;
  return BASE_URL + '/' + url;
}

const LANG_NAMES = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu',
  kn: 'Kannada', fr: 'French', de: 'German', es: 'Spanish', ja: 'Japanese',
  ko: 'Korean', zh: 'Chinese', ar: 'Arabic', pt: 'Portuguese', ru: 'Russian',
  it: 'Italian', tr: 'Turkish', pl: 'Polish', nl: 'Dutch', sv: 'Swedish',
  fi: 'Finnish', da: 'Danish', nb: 'Norwegian', cs: 'Czech', sk: 'Slovak',
  hu: 'Hungarian', ro: 'Romanian', bg: 'Bulgarian', hr: 'Croatian',
  el: 'Greek', he: 'Hebrew', id: 'Indonesian', ms: 'Malay', th: 'Thai',
  vi: 'Vietnamese', uk: 'Ukrainian', is: 'Icelandic', et: 'Estonian',
  lt: 'Lithuanian', lv: 'Latvian'
};

function langName(code) {
  return LANG_NAMES[code] || code.toUpperCase();
}

function extractCandidates(events) {
  const candidates = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].event !== 'source') continue;
    let payload;
    try { payload = JSON.parse(events[i].data); } catch (e) { continue; }
    const sources = (payload && payload.streams) || [];
    for (let j = 0; j < sources.length; j++) {
      const source = sources[j];
      if (!source || !source.url) continue;

      const inlineSubs = [];
      if (Array.isArray(source.subs)) {
        for (let k = 0; k < source.subs.length; k++) {
          const sub = source.subs[k];
          if (sub && sub.url && sub.lang) {
            inlineSubs.push({
              url: toAbsoluteUrl(sub.url),
              label: sub.label || langName(sub.lang),
              language: sub.lang,
              lang: sub.lang
            });
          }
        }
      }

      candidates.push({
        url: toAbsoluteUrl(String(source.url)),
        quality: String(source.quality || 'Auto'),
        provider: String(source.provider || (payload && payload.provider) || '?'),
        rank: +source.rank || 0,
        type: String(source.type || 'hls'),
        hevc: !!source.hevc,
        hdr: !!source.hdr,
        optional: !!source.opt,
        pinned: !!source.pin,
        lang: String(source.lang || 'en'),
        dub: !!source.dub,
        inlineSubs: inlineSubs
      });
    }
  }
  return candidates;
}

function scoreCandidate(candidate) {
  let score = candidate.rank || 720;
  if (candidate.optional) score -= 1200;
  if (candidate.hevc) score -= 150;
  if (candidate.hdr) score -= 100;
  if (candidate.pinned) score += 500;
  if (candidate.type !== 'hls') score -= 100;
  return score;
}

function resolutionLabel(candidate) {
  const match = /(\d{3,4})\s*p/i.exec(candidate.quality);
  if (match) return match[1] + 'p';
  return candidate.rank >= 1000 ? candidate.rank + 'p' : 'Auto';
}

function resolutionHeight(candidate) {
  const match = /(\d{3,4})/.exec(resolutionLabel(candidate));
  return match ? +match[1] : (candidate.rank || 0);
}

function resolutionTier(candidate) {
  const height = resolutionHeight(candidate);
  if (height >= 1800) return 5;
  if (height >= 900) return 4;
  if (height >= 600) return 3;
  if (height >= 420) return 2;
  if (height >= 300) return 1;
  return 0;
}

function buildSortTag(tier, maxTier) {
  const inverted = Math.max(0, maxTier - tier);
  let bits = inverted.toString(2);
  while (bits.length < 20) bits = '0' + bits;
  return bits.split('').map(function (bit) { return bit === '1' ? '\uFEFF' : '\u200B'; }).join('');
}

// v4 stream formatter (same as the other providers): heading = provider
// name, multi-line body in the `size` field (title/year, season/episode,
// quality, runtime, audio, file size, server, subtitles). Only fields
// that exist are shown; Vivarium has no runtime/file-size data.
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

function buildStream(candidate, label, subtitles, langLabel, ctx) {
  const sortTag = buildSortTag(resolutionTier(candidate), 6);
  const body = formatStreamSize({
    source: 'Vivarium',
    title: ctx && ctx.title,
    year: ctx && ctx.year,
    season: ctx && ctx.season,
    episode: ctx && ctx.episode,
    quality: resolutionLabel(candidate),
    audio: langName(candidate.lang),
    server: candidate.provider,
    subtitles: subtitles,
    url: candidate.url
  });
  return {
    name: sortTag + 'Vivarium',
    title: sortTag + 'Vivarium',
    size: body,
    url: candidate.url,
    quality: resolutionLabel(candidate),
    headers: { 'Referer': BASE_URL + '/', 'User-Agent': USER_AGENT },
    subtitles: subtitles
  };
}

function pushGroup(streams, seenUrls, candidates, subtitles, langLabel, ctx) {
  const fresh = [];
  for (let i = 0; i < candidates.length; i++) {
    if (seenUrls[candidates[i].url]) continue;
    seenUrls[candidates[i].url] = true;
    fresh.push(candidates[i]);
  }
  if (!fresh.length) return false;

  let best = fresh[0];
  for (let i = 1; i < fresh.length; i++) {
    if (scoreCandidate(fresh[i]) > scoreCandidate(best)) best = fresh[i];
  }

  fresh.sort(function (a, b) {
    return (resolutionHeight(b) - resolutionHeight(a)) || (scoreCandidate(b) - scoreCandidate(a));
  });
  for (let i = 0; i < fresh.length; i++) {
    streams.push(buildStream(fresh[i], fresh[i] === best ? 'Auto' : null, subtitles, langLabel, ctx));
  }
  return true;
}

async function fetchEventStream(queryString, nonce) {
  try {
    const response = await getSigned('/api/es?' + queryString, nonce || '');
    if (!response.ok) return '';
    return await response.text();
  } catch (e) {
    return '';
  }
}

async function resolveStreams(tmdbId, mediaType, season, episode, meta) {
  const isTv = mediaType === 'tv';
  if (isTv && (season == null || episode == null)) return [];

  // Display context for the v4 formatter: title/year from TMDB, S/E for TV.
  const ctx = {
    title: (meta && meta.title) || '',
    year: (meta && meta.year) || null,
    season: isTv ? season : undefined,
    episode: isTv ? episode : undefined
  };

  const allowedProviders = enabledProviders();
  const allowedLangs = enabledLanguages();
  if (allowedProviders.size === 0 && allowedLangs.size === 0) return [];

  const baseQuery = 'id=' + encodeURIComponent(tmdbId) +
    '&type=' + (isTv ? 'tv' : 'movie') +
    (isTv ? '&s=' + season + '&e=' + episode : '');

  const nonces = await fetchNonces();
  let nonceIndex = 0;

  const baseEventText = await fetchEventStream(baseQuery, nonces[nonceIndex++] || '');
  const allBaseCandidates = extractCandidates(parseServerSentEvents(baseEventText));
  if (!allBaseCandidates.length) return [];

  const streams = [];
  const seenUrls = {};

  let englishSubs = [];
  if (allowedProviders.size > 0) {
    const engCandidates = allBaseCandidates.filter(function (c) {
      return !c.dub && allowedProviders.has(c.provider.toLowerCase());
    });
    if (engCandidates.length > 0) {
      engCandidates.sort(function (a, b) { return scoreCandidate(b) - scoreCandidate(a); });
      englishSubs = engCandidates[0].inlineSubs;
      pushGroup(streams, seenUrls, engCandidates, englishSubs, null, ctx);
    }
  }

  if (allowedLangs.size === 0) return streams;

  const coveredDubLangs = new Set();
  const dubGroups = {};
  for (let i = 0; i < allBaseCandidates.length; i++) {
    const c = allBaseCandidates[i];
    if (!c.dub || !allowedLangs.has(c.lang)) continue;
    (dubGroups[c.lang] = dubGroups[c.lang] || []).push(c);
  }
  const baseDubLangs = Object.keys(dubGroups);
  for (let i = 0; i < baseDubLangs.length; i++) {
    const lang = baseDubLangs[i];
    if (pushGroup(streams, seenUrls, dubGroups[lang], englishSubs, langName(lang), ctx)) {
      coveredDubLangs.add(lang);
    }
  }

  const missingDubLangs = Array.from(allowedLangs).filter(function (lang) {
    return !coveredDubLangs.has(lang);
  });

  if (missingDubLangs.length > 0) {
    const dubEventTexts = await Promise.all(missingDubLangs.map(function (lang) {
      return fetchEventStream(baseQuery + '&dubs=1&al=' + encodeURIComponent(lang), nonces[nonceIndex++] || '');
    }));

    for (let d = 0; d < missingDubLangs.length; d++) {
      const lang = missingDubLangs[d];
      const dubCandidates = extractCandidates(parseServerSentEvents(dubEventTexts[d]))
        .filter(function (c) { return c.dub && c.lang === lang; });
      pushGroup(streams, seenUrls, dubCandidates, englishSubs, langName(lang), ctx);
    }
  }

  return streams;
}


// ---------- TMDB ----------
// imdbId (for the subtitle addon) + title/year (for _releaseTitle).
// Uses the TMDB_API_KEY contract global the app/harness provides; if it
// is absent the lookup returns null and rows still return with the
// source's own inline subtitles.
function tmdbMetaViv(tmdbId, mediaType) {
  try {
    var key = (typeof TMDB_API_KEY !== 'undefined' && TMDB_API_KEY) ? TMDB_API_KEY : '';
    if (!key) return Promise.resolve(null);
    var kind = mediaType === 'tv' ? 'tv' : 'movie';
    return fetch('https://api.themoviedb.org/3/' + kind + '/' + tmdbId + '?api_key=' + key).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json();
    }).then(function (j) {
      if (!j || !(j.title || j.name)) return null;
      var d = j.release_date || j.first_air_date || '';
      return { title: j.title || j.name, year: d ? parseInt(d.slice(0, 4), 10) : null, imdbId: j.imdb_id || null };
    }).catch(function () { return null; });
  } catch (e) { return Promise.resolve(null); }
}

// Secret gist holding the user's tokens (same file the showbox/gramcinema
// tokens live in). SCRAPER_SETTINGS always wins; the gist is only read when
// a key is missing from settings. The keys are never in the repo.
var TOKEN_FILE_URL = 'https://gist.githubusercontent.com/rareanimeaddon-blip/6fc363ac74cb8921d61c07a2c6bb59d6/raw/gistfile1.txt';
var _fileTokens = null;
var _fileTokensPromise = null;
function loadTokenFile() {
  if (_fileTokens) return Promise.resolve(_fileTokens);
  if (_fileTokensPromise) return _fileTokensPromise;
  if (!TOKEN_FILE_URL) { _fileTokens = {}; return Promise.resolve(_fileTokens); }
  try {
    _fileTokensPromise = fetch(TOKEN_FILE_URL).then(function (r) { return r && r.ok ? r.json() : null; }).then(function (j) { _fileTokens = j || {}; return _fileTokens; }).catch(function () { _fileTokens = {}; return _fileTokens; });
  } catch (e) { _fileTokens = {}; return Promise.resolve(_fileTokens); }
  return _fileTokensPromise;
}
function _setting(cfg, key) {
  try {
    if (cfg && cfg[key]) return String(cfg[key]).trim();
  } catch (e) {}
  return '';
}
function getSubdlKeys(cfg) {
  var k1 = _setting(cfg, 'subdlApiKey');
  var k2 = _setting(cfg, 'subdlApiKey2');
  if (k1 && k2) return Promise.resolve([k1, k2]);
  return loadTokenFile().then(function (t) {
    if (!k1) { try { if (t && t.subdlApiKey) k1 = String(t.subdlApiKey).trim(); } catch (e) {} }
    if (!k2) { try { if (t && t.subdlApiKey2) k2 = String(t.subdlApiKey2).trim(); } catch (e) {} }
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  }).catch(function () {
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  });
}
function getWyzieKeys(cfg) {
  var k1 = _setting(cfg, 'wyzieApiKey');
  var k2 = _setting(cfg, 'wyzieApiKey2');
  if (k1 && k2) return Promise.resolve([k1, k2]);
  return loadTokenFile().then(function (t) {
    if (!k1) { try { if (t && t.wyzieApiKey) k1 = String(t.wyzieApiKey).trim(); } catch (e) {} }
    if (!k2) { try { if (t && t.wyzieApiKey2) k2 = String(t.wyzieApiKey2).trim(); } catch (e) {} }
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  }).catch(function () {
    var out = [];
    if (k1) out.push(k1);
    if (k2 && k2 !== k1) out.push(k2);
    return out;
  });
}
// ---- Subtitle addon (Infinite Streams Subtitles, Cloudflare Worker) ----
// The provider asks the addon for this title's subtitles instead of
// calling SubDL/Wyzie/mirror directly. The addon returns its ranked list
// (Sunsync pre-synced first, then SubDL, Wyzie, mirror); the provider
// picks the best match per row with the existing token scorer, so each
// stream carries the subtitle that fits its own release. The addon needs
// the user's keys in the URL config to return SubDL/Wyzie results —
// without them it returns Sunsync + mirror only. Pure-JS base64url
// (no Buffer/btoa in the TV guest); keys are ASCII so one char = one byte.
var ADDON_BASE = 'https://infinite-subtitles.teghvirsingh-work.workers.dev';
function b64urlEncodeAscii(str) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  for (var i = 0; i < str.length; i += 3) {
    var c1 = str.charCodeAt(i) & 255;
    var c2 = (i + 1 < str.length) ? str.charCodeAt(i + 1) & 255 : NaN;
    var c3 = (i + 2 < str.length) ? str.charCodeAt(i + 2) & 255 : NaN;
    var n = (c1 << 16) | ((isNaN(c2) ? 0 : c2) << 8) | (isNaN(c3) ? 0 : c3);
    out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63] + (isNaN(c2) ? '=' : chars[(n >>> 6) & 63]) + (isNaN(c3) ? '=' : chars[n & 63]);
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function addonConfigStr(sdKeys, wzKeys) {
  var o = {};
  if (sdKeys && sdKeys[0]) o.s = sdKeys[0];
  if (sdKeys && sdKeys[1] && sdKeys[1] !== sdKeys[0]) o.s2 = sdKeys[1];
  if (wzKeys && wzKeys[0]) o.w = wzKeys[0];
  if (wzKeys && wzKeys[1] && wzKeys[1] !== wzKeys[0]) o.w2 = wzKeys[1];
  var has = o.s || o.s2 || o.w || o.w2;
  if (!has) return '';
  return b64urlEncodeAscii(JSON.stringify(o));
}
// One addon call per title; returns the addon's ranked English subtitles
// as {id, url, release} for the per-row matcher. [] on any failure.
function addonSubs(imdbId, isSeries, season, episode, cfg) {
  return Promise.all([getSubdlKeys(cfg), getWyzieKeys(cfg)]).then(function (ks) {
    var cfgStr = addonConfigStr(ks[0], ks[1]);
    var path = isSeries
      ? '/subtitles/series/' + imdbId + ':' + season + ':' + episode + '.json'
      : '/subtitles/movie/' + imdbId + '.json';
    var url = ADDON_BASE + (cfgStr ? '/' + cfgStr : '') + path;
    return fetch(url).then(function (r) {
      if (!r.ok) return [];
      return r.json();
    }).then(function (j) {
      var list = (j && j.subtitles) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        var lang = String(it.lang || '').toLowerCase();
        if (lang !== 'en' && lang !== 'eng') continue;
        var u2 = it.url || '';
        if (u2.indexOf('https://') !== 0) continue;
        var rel = it.movieReleaseName || it.subtitleFileName || '';
        if (!rel) continue;
        out.push({ id: it.id, url: u2, release: rel });
      }
      return out;
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}
function osTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (t) { return t.length > 0; });
}
function osGroup(name) {
  var s = String(name || '');
  // Last parenthesised chunk that is NOT just a year (e.g. "(2026)") — the
  // year is not a release group, and treating it as one makes every
  // same-year release "match" (+4). Skip pure years / pure numbers.
  var groups = s.match(/\(([^)]+)\)/g) || [];
  for (var gi = groups.length - 1; gi >= 0; gi--) {
    var g = groups[gi].replace(/[()]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s*4khdhub\s*$/, '').trim();
    if (!g) continue;
    if (/^\d{4}$/.test(g) || /^\d+$/.test(g)) continue;
    return g;
  }
  var m = s.match(/[-.]([A-Za-z][A-Za-z0-9]{1,})\s*$/);
  if (m) return m[1].toLowerCase();
  return '';
}
function osReleaseFeatures(name) {
  var toks = osTokens(name);
  var set = {};
  for (var i = 0; i < toks.length; i++) set[toks[i]] = true;
  var squashed = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  var source = '';
  if (squashed.indexOf('bluray') !== -1) source = 'bluray';
  else if (squashed.indexOf('webdl') !== -1) source = 'webdl';
  else if (squashed.indexOf('webrip') !== -1) source = 'webrip';
  else if (squashed.indexOf('hdtv') !== -1) source = 'hdtv';
  else if (squashed.indexOf('dvdrip') !== -1) source = 'dvdrip';
  else if (set['ts'] || set['telesync']) source = 'ts';
  return {
    group: osGroup(name),
    source: source,
    res: set['2160p'] ? '2160p' : set['1080p'] ? '1080p' : set['720p'] ? '720p' : set['480p'] ? '480p' : '',
    codec: (set['x265'] || set['hevc'] || squashed.indexOf('h265') !== -1) ? 'hevc' : (set['x264'] || set['avc'] || squashed.indexOf('h264') !== -1) ? 'avc' : '',
    imax: !!set['imax'],
    remux: !!set['remux']
  };
}
function osScore(fileF, subF) {
  var s = 0;
  if (fileF.group && subF.group && fileF.group === subF.group) s += 4;
  else if (fileF.group && subF.group) {
    var fg = fileF.group.split(' '), sg = subF.group.split(' ');
    for (var i = 0; i < fg.length; i++) { if (sg.indexOf(fg[i]) !== -1) { s += 2; break; } }
  }
  if (fileF.source && fileF.source === subF.source) s += 2;
  if (fileF.res && fileF.res === subF.res) s += 1;
  if (fileF.codec && fileF.codec === subF.codec) s += 1;
  if (fileF.imax && subF.imax) s += 1;
  if (fileF.remux && subF.remux) s += 1;
  return s;
}
function osBestMatch(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0;
  for (var k = 0; k < subs.length; k++) {
    var sc = osScore(ff, osReleaseFeatures(subs[k].release));
    if (sc > bestScore) { bestScore = sc; best = subs[k]; }
  }
  return (best && bestScore >= 4) ? best : null;
}
// Best subtitle by release fit, with no threshold — returns {sub, score}.
// Used as the fallback when osBestMatch finds nothing: the highest-scoring
// subtitle for this row's release (same resolution class at least) is
// far better than the addon's top-ranked one, which is ranked by source
// quality, not by how well it fits this row. A BluRay-synced subtitle on
// a CAM row scores 0 here and is never picked.
function osBestAny(releaseTitle, subs) {
  if (!releaseTitle || !subs || !subs.length) return null;
  var ff = osReleaseFeatures(releaseTitle);
  var best = null, bestScore = 0;
  for (var k = 0; k < subs.length; k++) {
    var sf = osReleaseFeatures(subs[k].release);
    var sc = osScore(ff, sf);
    if (sc > bestScore) { bestScore = sc; best = subs[k]; }
  }
  if (!best) return null;
  return { sub: best, score: bestScore };
}
function osAttachSubtitles(rows, imdbId, isSeries, season, episode, cfg) {
  // Subtitles come ONLY from the Infinite Subtitles addon. One addon call
  // per title; the best subtitle for each row’s own release is attached
  // automatically. No direct SubDL/Wyzie/mirror calls from this provider.
  try {
    if (cfg && cfg.osSubtitles === false) return Promise.resolve(rows);
    if (!imdbId || !rows || !rows.length) return Promise.resolve(rows);
    var cleanup = function () {
      for (var c = 0; c < rows.length; c++) { try { delete rows[c]._rel; delete rows[c]._releaseTitle; } catch (e) {} }
      return rows;
    };
    var prep = function () {
      for (var i = 0; i < rows.length; i++) {
        var rel = rows[i]._releaseTitle || '';
        if (!rel && rows[i].url) {
          try { rel = decodeURIComponent(String(rows[i].url).split('/').pop() || '').replace(/.[^.]+$/, ''); } catch (e) {}
        }
        rows[i]._rel = rel;
      }
    };
    prep();
    return addonSubs(imdbId, isSeries, season, episode, cfg).then(function (adSubs) {
      for (var i = 0; i < rows.length; i++) {
        var hit = osBestMatch(rows[i]._rel, adSubs);
        if (!hit) {
          var any = osBestAny(rows[i]._rel, adSubs);
          if (any && any.score >= 1) hit = any.sub;
        }
        if (!hit && adSubs.length) {
          // No release fit at all (e.g. a 480p row when the addon only has
          // 1080p subtitles). The addon only returns subtitles for THIS
          // title, so the top-ranked non-Sunsync one is the right movie —
          // attach it, unless the row is a CAM/TS, where no proper-release
          // subtitle can match the recording's timing.
          var rl = (rows[i]._rel || '').toLowerCase();
          if (rl.indexOf('cam') === -1 && rl.indexOf('ts') === -1) {
            for (var k = 0; k < adSubs.length; k++) {
              var cand = adSubs[k];
              var cid = String(cand.id || '').toLowerCase();
              var crel = String(cand.release || '').toLowerCase();
              if (cid.indexOf('sunsync') === -1 && crel.indexOf('sunsync') === -1) { hit = cand; break; }
            }
          }
        }
        if (hit) rows[i].subtitles = [{ id: String(hit.id), url: hit.url, lang: 'en' }];
      }
      return cleanup();
    }).catch(function () { return cleanup(); });
  } catch (e) { return Promise.resolve(rows); }
}
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (!/^\d+$/.test(String(tmdbId))) return [];
    var isTv = mediaType === 'tv';
    var meta = await tmdbMetaViv(tmdbId, mediaType);
    var rows = await resolveStreams(tmdbId, mediaType, season, episode, meta);
    if (!rows || !rows.length) return [];
    var title = (meta && meta.title) || '';
    for (var i = 0; i < rows.length; i++) {
      // No filename on these HLS rows, so release = title + quality.
      if (!rows[i]._releaseTitle) rows[i]._releaseTitle = (title ? title + ' ' : '') + (rows[i].quality || '');
    }
    if (meta && meta.imdbId) {
      return osAttachSubtitles(rows, meta.imdbId, isTv, isTv ? season : undefined, isTv ? episode : undefined, {
        osSubtitles: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.osSubtitles : undefined,
        subdlApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey : undefined,
        subdlApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.subdlApiKey2 : undefined,
        wyzieApiKey: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.wyzieApiKey : undefined,
        wyzieApiKey2: (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS.wyzieApiKey2 : undefined,
        year: (meta && meta.year) || 0
      });
    }
    for (var j = 0; j < rows.length; j++) { try { delete rows[j]._releaseTitle; } catch (e) {} }
    return rows;
  } catch (e) {
    return [];
  }
}

async function onSettings() {
  const fields = [
    { type: 'header', label: 'Providers' }
  ];
  for (let i = 0; i < PROVIDERS.length; i++) {
    fields.push({
      type: 'toggle',
      key: PROVIDERS[i].key,
      label: PROVIDERS[i].label,
      defaultValue: !!PROVIDERS[i].def
    });
  }
  fields.push({ type: 'header', label: 'Dub Languages' });
  for (let i = 0; i < LANGUAGES.length; i++) {
    fields.push({
      type: 'toggle',
      key: LANGUAGES[i].key,
      label: LANGUAGES[i].label,
      defaultValue: !!LANGUAGES[i].def
    });
  }
  return fields;
}

module.exports = { getStreams, onSettings };
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
