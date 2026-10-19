/**
 * DIAGNOSTIC v2 - Tests actual provider logic step-by-step
 */

function fetchWithTimeout(url, opts, ms) {
  opts = opts || {};
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, ms || 10000);
  opts.signal = controller.signal;
  return fetch(url, opts).then(function (res) {
    clearTimeout(timer);
    return res;
  }).catch(function (e) {
    clearTimeout(timer);
    throw e;
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var streams = [];
  var tests = [];

  // Test crypto.subtle.digest (used by anidisk, hindmovies, cinejoy)
  tests.push(
    (async function () {
      try {
        if (typeof crypto === "undefined" || !crypto.subtle) {
          return "crypto.subtle: MISSING";
        }
        var data = new TextEncoder().encode("test");
        var hash = await crypto.subtle.digest("SHA-256", data);
        return "crypto.subtle.digest: OK (" + hash.byteLength + " bytes)";
      } catch (e) {
        return "crypto.subtle.digest: FAIL " + (e.message || e);
      }
    })()
  );

  // Test crypto.subtle.importKey (used by hindmovies for HMAC)
  tests.push(
    (async function () {
      try {
        if (typeof crypto === "undefined" || !crypto.subtle) {
          return "crypto.subtle.importKey: SKIP (no subtle)";
        }
        var key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode("testkey"),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        return "crypto.subtle.importKey: OK";
      } catch (e) {
        return "crypto.subtle.importKey: FAIL " + (e.message || e);
      }
    })()
  );

  // Test WebAssembly (used by meowtv)
  tests.push(
    (async function () {
      try {
        if (typeof WebAssembly === "undefined") {
          return "WebAssembly: MISSING";
        }
        // Minimal wasm module (empty)
        var wasmCode = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
        var mod = await WebAssembly.instantiate(wasmCode);
        return "WebAssembly.instantiate: OK";
      } catch (e) {
        return "WebAssembly.instantiate: FAIL " + (e.message || e);
      }
    })()
  );

  // Test TextEncoder/TextDecoder
  tests.push(
    Promise.resolve().then(function () {
      try {
        var enc = new TextEncoder().encode("hello");
        var dec = new TextDecoder().decode(enc);
        return "TextEncoder/Decoder: OK";
      } catch (e) {
        return "TextEncoder/Decoder: FAIL " + (e.message || e);
      }
    })
  );

  // Test atob/btoa with large string (meowtv has large base64)
  tests.push(
    Promise.resolve().then(function () {
      try {
        var large = btoa("x".repeat(100000));
        var back = atob(large);
        return "atob/btoa large: OK (" + back.length + ")";
      } catch (e) {
        return "atob/btoa large: FAIL " + (e.message || e);
      }
    })
  );

  return Promise.all(tests).then(function (results) {
    results.forEach(function (r) {
      streams.push({
        name: "DIAG2",
        title: r,
        url: "https://example.com/",
        quality: "diag",
        type: "direct"
      });
    });
    return streams;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
