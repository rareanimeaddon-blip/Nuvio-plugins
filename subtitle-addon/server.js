// Infinite Streams Subtitles — Stremio-compatible subtitle addon server.
// No dependencies: built-in http only. Node 18+ (global fetch).
//
// Endpoints:
//   GET /manifest.json
//   GET /subtitles/:type/:id.json
//   GET /subtitles/:type/:id/:extra.json
//   GET /  (landing page)
//
// Keys via environment (never hardcoded, never logged):
//   SUBDL_API_KEY, SUBDL_API_KEY2, WYZIE_API_KEY, WYZIE_API_KEY2
// Port via PORT (default 3000).
'use strict';

var http = require('http');
var engine = require('./engine');

var ADDON_ID = 'com.infinite.streams.subtitles';
var ADDON_VERSION = '1.0.0';

function manifest() {
  return {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: 'Infinite Streams Subtitles',
    description: 'Subtitles for Infinite Streams — SubDL, Wyzie and OpenSubtitles, ranked with the best first. Works in Nuvio and Stremio.',
    resources: ['subtitles'],
    types: ['movie', 'series', 'anime'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false }
  };
}

function keysFromEnv() {
  var subdl = [];
  var wyzie = [];
  if (process.env.SUBDL_API_KEY) subdl.push(String(process.env.SUBDL_API_KEY).trim());
  if (process.env.SUBDL_API_KEY2 && process.env.SUBDL_API_KEY2 !== process.env.SUBDL_API_KEY) subdl.push(String(process.env.SUBDL_API_KEY2).trim());
  if (process.env.WYZIE_API_KEY) wyzie.push(String(process.env.WYZIE_API_KEY).trim());
  if (process.env.WYZIE_API_KEY2 && process.env.WYZIE_API_KEY2 !== process.env.WYZIE_API_KEY) wyzie.push(String(process.env.WYZIE_API_KEY2).trim());
  return { subdlKeys: subdl, wyzieKeys: wyzie };
}

function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

function parseSubtitlesPath(pathname) {
  // /subtitles/movie/tt12042730.json
  // /subtitles/series/tt0903747:1:1.json
  // /subtitles/anime/tt1234567:1:1.json
  // /subtitles/movie/tt12042730/<extra>.json
  var m = pathname.match(/^\/subtitles\/([^\/]+)\/([^\/]+)(?:\/[^\/]+)?\.json$/);
  if (!m) return null;
  var type = m[1].toLowerCase();
  if (type !== 'movie' && type !== 'series' && type !== 'anime') return null;
  var rawId = decodeURIComponent(m[2]);
  var parts = rawId.split(':');
  var imdbId = parts[0];
  if (!/^tt\d+$/.test(imdbId)) return null;
  var season = 1, episode = 1;
  if (parts.length >= 3) {
    season = parseInt(parts[1], 10) || 1;
    episode = parseInt(parts[2], 10) || 1;
  }
  return { type: type, imdbId: imdbId, season: season, episode: episode };
}

var server = http.createServer(function (req, res) {
  try {
    var u = new URL(req.url, 'http://localhost');
    var pathname = u.pathname;
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }

    if (pathname === '/manifest.json') { sendJson(res, 200, manifest()); return; }

    if (pathname === '/' || pathname === '/index.html') {
      var html = '<!doctype html><html><head><meta charset="utf-8"><title>Infinite Streams Subtitles</title></head>'
        + '<body style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:0 16px">'
        + '<h1>Infinite Streams Subtitles</h1>'
        + '<p>A subtitle addon for Nuvio and Stremio. It searches SubDL, Wyzie and OpenSubtitles and returns the best subtitles first.</p>'
        + '<p>Install by adding this addon in Nuvio / Stremio with the manifest URL:</p>'
        + '<p><code>' + (process.env.PUBLIC_URL || '') + '/manifest.json</code></p>'
        + '<p><a href="/manifest.json">View manifest.json</a></p>'
        + '</body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    if (pathname.indexOf('/subtitles/') === 0) {
      var parsed = parseSubtitlesPath(pathname);
      if (!parsed) { sendJson(res, 404, { subtitles: [] }); return; }
      var k = keysFromEnv();
      engine.searchSubtitles({
        imdbId: parsed.imdbId,
        type: parsed.type,
        season: parsed.season,
        episode: parsed.episode,
        subdlKeys: k.subdlKeys,
        wyzieKeys: k.wyzieKeys
      }).then(function (list) {
        var out = list.map(function (s) {
          return {
            id: String(s.id),
            url: s.url,
            lang: 'en',
            movieReleaseName: s.release || undefined,
            subtitleFileName: s.release || undefined
          };
        });
        sendJson(res, 200, { subtitles: out });
      }).catch(function () {
        sendJson(res, 200, { subtitles: [] });
      });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    sendJson(res, 500, { subtitles: [] });
  }
});

var port = parseInt(process.env.PORT, 10) || 3000;
server.listen(port, function () {
  console.log('Infinite Streams Subtitles addon listening on port ' + port);
  console.log('Manifest: http://localhost:' + port + '/manifest.json');
});
