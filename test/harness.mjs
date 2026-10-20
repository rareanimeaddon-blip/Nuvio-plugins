#!/usr/bin/env node
/**
 * Nuvio sandbox test harness.
 * Loads a scraper JS file in a restricted VM context that mimics the Nuvio
 * on-device sandbox: fetch + web APIs only, NO Node built-ins (no require,
 * no process, no Buffer, no node: imports). Then calls
 * getStreams(tmdbId, mediaType, seasonNum, episodeNum) and validates output.
 *
 * Usage: node test/harness.mjs providers/<name>.js [tmdbId] [movie|tv] [season] [episode]
 */
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

const [scraperPath, tmdbIdArg, typeArg, seasonArg, episodeArg] = process.argv.slice(2);
if (!scraperPath) {
  console.error("usage: node test/harness.mjs <scraper.js> [tmdbId] [movie|tv] [season] [episode]");
  process.exit(2);
}

const tmdbId = tmdbIdArg ?? "603";      // default: The Matrix
const mediaType = typeArg ?? "movie";   // "movie" | "tv"
const season = seasonArg ? Number(seasonArg) : null;
const episode = episodeArg ? Number(episodeArg) : null;

const code = fs.readFileSync(scraperPath, "utf8");

// ---- sandbox globals (Nuvio-like) ----
// Nuvio provides require('cheerio-without-node-native') in its sandbox.
import { createRequire } from "node:module";
const __req = createRequire(import.meta.url + "/../");
function sandboxRequire(name) {
  if (name === "cheerio-without-node-native") return __req("cheerio-without-node-native");
  throw new Error("require not available for: " + name);
}
// Nuvio contract globals: the on-device sandbox provides TMDB_API_KEY
// (and SCRAPER_SETTINGS) to every provider. Define TMDB_API_KEY here so
// providers that rely on the Nuvio-provided global (e.g. cinejoy) are tested
// faithfully instead of failing with a ReferenceError.
const TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";
const SCRAPER_SETTINGS = {};
const sandbox = {
  console,
  require: sandboxRequire,
  fetch: globalThis.fetch.bind(globalThis),
  URL, URLSearchParams,
  TextEncoder, TextDecoder,
  setTimeout, clearTimeout, setInterval, clearInterval,
  AbortController, AbortSignal,
  Headers, Request, Response, FormData,
  Blob, File,
  crypto: globalThis.crypto, // webcrypto
  atob: globalThis.atob.bind(globalThis),
  btoa: globalThis.btoa.bind(globalThis),
  TMDB_API_KEY, SCRAPER_SETTINGS,
  JSON, Math, Date, RegExp, Error, Promise,
  Object, Array, String, Number, Boolean, Map, Set,
  encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
  parseInt, parseFloat, isNaN, isFinite,
  // module shim for `module.exports = { getStreams }`
  module: { exports: {} },
  global: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox, { name: "nuvio-sandbox" });

try {
  vm.runInContext(code, sandbox, { filename: path.basename(scraperPath), timeout: 5000 });
} catch (e) {
  console.error(`LOAD FAIL: ${e.message}`);
  process.exit(1);
}

const mod = sandbox.module.exports && Object.keys(sandbox.module.exports).length
  ? sandbox.module.exports
  : sandbox.global && Object.keys(sandbox.global).length
    ? Object.values(sandbox.global)[0]
    : null;

const getStreams = mod?.getStreams;
if (typeof getStreams !== "function") {
  console.error("LOAD FAIL: no getStreams export found");
  process.exit(1);
}

console.log(`calling getStreams(${JSON.stringify(tmdbId)}, ${JSON.stringify(mediaType)}, ${season}, ${episode}) ...`);
const t0 = Date.now();
let streams;
try {
  streams = await Promise.race([
    Promise.resolve().then(() => getStreams.call(sandbox, tmdbId, mediaType, season, episode)),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout after 90s")), 90000)),
  ]);
} catch (e) {
  console.error(`RUN FAIL: ${e.message}`);
  process.exit(1);
}
const dt = ((Date.now() - t0) / 1000).toFixed(1);

if (!Array.isArray(streams)) {
  console.error(`RUN FAIL: expected array, got ${typeof streams}`);
  process.exit(1);
}
console.log(`OK: ${streams.length} stream(s) in ${dt}s`);
let bad = 0;
for (const [i, s] of streams.slice(0, 10).entries()) {
  const okUrl = typeof s.url === "string" && /^https?:\/\//.test(s.url);
  if (!okUrl) bad++;
  console.log(`  [${i}] ${s.quality || "?"} | ${(s.name || "?").slice(0, 40)} | ${okUrl ? "url ok" : "BAD URL: " + JSON.stringify(s.url)?.slice(0, 80)}`);
}
if (streams.length > 10) console.log(`  ... and ${streams.length - 10} more`);
if (bad > 0) { console.error(`RUN FAIL: ${bad} bad stream URLs`); process.exit(1); }
// sandbox check: code must not reference node-isms (require is allowed ONLY
// for cheerio-without-node-native, which Nuvio provides)
for (const token of ["process.env", "node:crypto", "node:buffer", "Buffer.from", "__dirname"]) {
  if (code.includes(token)) { console.error(`SANDBOX FAIL: code contains ${JSON.stringify(token)}`); process.exit(1); }
}
const reqCalls = [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map(m => m[1]);
for (const r of reqCalls) {
  if (r !== "cheerio-without-node-native") { console.error(`SANDBOX FAIL: require(${JSON.stringify(r)}) not allowed`); process.exit(1); }
}
console.log("SANDBOX CHECK: pass (no node-isms)");
