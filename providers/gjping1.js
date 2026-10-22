/* GJ Ping - load/execution bisection build (temporary).
   Returns ONE static row immediately. No fetch, no timers, no helpers.
   If THIS test also shows "Error / about:error" on the phone, the app
   is failing to load/run new provider files at all and the Goojara
   code is not the problem. If the row appears, provider code runs
   fine and the failure is inside Goojara's network behaviour. */
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return Promise.resolve([{
    name: "GJPing",
    title: "PING OK id=" + tmdbId + " type=" + mediaType + " - code loads and runs",
    url: "https://ww1.goojara.to/",
    quality: "HD",
    type: "direct"
  }]);
}
global.getStreams = getStreams;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
