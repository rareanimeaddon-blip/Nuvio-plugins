// MeowTV scraper for Nuvio.
// Converted from the Stremio addon provider (api-server/src/providers/meowtv).
// Flow: Altcha PoW challenge -> solve (pure-JS SHA-256) -> ticket ->
// per-server stream fetch -> WASM deobfuscate(n, d) -> direct URL.
// The WASM binary is inlined as base64 below (standard WebAssembly API, sandbox-safe).
// Nuvio passes the TMDB ID directly, so no IMDB lookup is needed.

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var API_BASE = "https://api.meowtv.ru";
var TMDB_API_KEY = "5f39fd16e987a9e3fce30d55cf09b438";

var MEOW_SERVERS = [
  { id: "dcloud",  label: "Dcloud" },
  { id: "acme",    label: "Acme" },
  { id: "tik",     label: "TCloud" },
  { id: "ipcloud", label: "IPCloud" },
  { id: "turkce",  label: "Turkce", movieOnly: true },
  { id: "hindiv3", label: "Hindi v3" }
];

// ---- WASM binary (base64) ----
var MEOW_WASM_B64 = "AGFzbQEAAAABLwlgAn9/AX9gAX8Bf2ACf38AYAAAYAN/f38AYAF/AGAEf39/fwBgAAF/YAN/f34AAg0BA2VudgVhYm9ydAAGAy8uAwQFAAEAAAQBAAAEBwIFBAICAQUFAAABAwgDAAICAgADBAEAAAUBAwACAAEAAQUDAQABBkUNfwFBAAt/AUEAC38BQQALfwFBAAt/AUEAC38BQQALfwFBAAt/AUEAC38BQQALfwFBAAt/AUEAC38AQZAWC38BQbyWAgsHTAcFX19uZXcABAVfX3BpbgAnB19fdW5waW4AJglfX2NvbGxlY3QAKAtfX3J0dGlfYmFzZQMLBm1lbW9yeQIAC2Rlb2JmdXNjYXRlACsIASEMATEK+zwuGgAjDEG8FkgEQEHQlgJBgJcCQQFBARAAAAsLTQAjDEEEayQMEAEjDEEANgIAIwwgADYCACABIAAoAghPBEBB8A9B8BFBsgFBLRAAAAsjDCAANgIAIAAoAgQgAWogAjoAACMMQQRqJAwLJwAgAEUEQA8LIwcgAEEUayIAKAIEQQNxRgRAIAAQDyMDQQFqJAMLC6oBAQF/IABB7P///wNPBEBBsA5B8A5BhQJBHxAAAAsjACMBTwRAAkBBgBAhAgNAIAIQDWshAiMCRQRAIwBBAXRBgAhqJAEMAgsgAkEASg0ACyMAIwAjAWtBgAhJQQp0aiQBCwsjCUUEQBAZCyMJIABBEGoQJSICIAE2AgwgAiAANgIQIAIjCCMHEBAjACACKAIAQXxxQQRqaiQAIAJBFGoiAUEAIAD8CwAgAQslACMMQQRrJAwQASMMQQA2AgAjDCAANgIAIAAoAggjDEEEaiQMC0sAIwxBBGskDBABIwxBADYCACMMIAA2AgAgASAAKAIITwRAQfAPQfARQacBQS0QAAALIwwgADYCACAAKAIEIAFqLQAAIwxBBGokDAtKACMMQQRrJAwQASMMQQA2AgAjDCAANgIAIAEgAEEUaygCEEECdk8EQEHwD0GgE0HOAEEpEAAACyAAIAFBAnRqKAIAIwxBBGokDAtzAQF/IwxBBGskDBABIwxBADYCACMMIAA2AgAgASAAKAIMTwRAIAFBAEgEQEHwD0HAEUGCAUEWEAAACyAAIAFBAWoiAxAqIwwgADYCACAAIAM2AgwLIwwgADYCACAAKAIEIAFBAnRqIAI2AgAjDEEEaiQMCz4BAX8jDEEIayQMEAEjDEIANwMAIwxBDEEGEAQiATYCACMMIAE2AgQjDCABIAAQKSIANgIAIwxBCGokDCAACz8AIwxBBGskDBABIwxBADYCACMMIAA2AgAgASAAQRRrKAIQQQF2TwR/QX8FIAAgAUEBdGovAQALIwxBBGokDAtKACMMQQRrJAwQASMMQQA2AgAjDCAANgIAIAEgAEEUaygCEEECdk8EQEHwD0GgE0HOAEEpEAAACyAAIAFBAnRqKAIAIwxBBGokDAtTACMMQQRrJAwQASMMQQA2AgAjDCAANgIAIAEgAEEUaygCEEECdk8EQEHwD0GgE0HdAEEpEAAACyMMIAA2AgAgACABQQJ0aiACNgIAIwxBBGokDAurAwECfwJAAkACQAJAIwIOAwABAgMLQQEkAkEAJAMQGyMGJAUjAw8LIwdFIQEjBSgCBEF8cSEAA0AgACMGRwRAIAAkBSABIAAoAgRBA3FHBEAgACABEB5BACQDIABBFGoQFSMDDwsgACgCBEF8cSEADAELC0EAJAMQGyMGIwUoAgRBfHFGBEAjDCEAA0AgAEG8lgJJBEAgACgCABADIABBBGohAAwBCwsjBSgCBEF8cSEAA0AgACMGRwRAIAEgACgCBEEDcUcEQCAAIAEQHiAAQRRqEBULIAAoAgRBfHEhAAwBCwsjCCEAIwYkCCAAJAYgASQHIAAoAgRBfHEkBUECJAILIwMPCyMFIgAjBkcEQCAAKAIEQXxxJAUgACgCBBogAEG8lgJJBEAgAEEANgIEIABBADYCCAUjACAAKAIAQXxxQQRqayQAIABBBGoiAEG8lgJPBEAjCUUEQBAZCyAAQQRrIQEgAEEPcUEBIAAbBH9BAQUgASgCAEEBcQsaIAEgASgCAEEBcjYCACMJIAEQEgsLQQoPCyMGIwY2AgQjBiMGNgIIQQAkAgtBAAtHACABRQRADwsjByABQRRrIgEoAgRBA3FGBEAgAEEUaygCBEEDcSIAIwdFRgRAIAEQDwUjAkEBRiAAQQNGcQRAIAEQDwsLCwtjAQJ/IAAjBUYEQCAAKAIIJAULIAAQFCMGIQEgACgCDCICQQJNBH9BAQUgAkGQFigCAEsEQEHwD0GwEEEVQRwQAAALIAJBAnRBlBZqKAIAQSBxCyECIAAgASMHRUECIAIbEBALKQEBfyABKAIIIQMgACABIAJyNgIEIAAgAzYCCCADIAAQHSABIAA2AggLwwEBBH8gASgCAEF8cSIDQYACSQR/IANBBHYFQR9B/P///wMgAyADQfz///8DTxsiA2drIgRBB2shAiADIARBBGt2QRBzCyEDIAEoAgghBSABKAIEIgQEQCAEIAU2AggLIAUEQCAFIAQ2AgQLIAEgACACQQR0IANqQQJ0aiIBKAJgRgRAIAEgBTYCYCAFRQRAIAAgAkECdGoiASgCBEF+IAN3cSEDIAEgAzYCBCADRQRAIAAgACgCAEF+IAJ3cTYCAAsLCwu8AgEFfyABKAIAIQMgAUEEaiABKAIAQXxxaiIEKAIAIgJBAXEEQCAAIAQQESABIANBBGogAkF8cWoiAzYCACABQQRqIAEoAgBBfHFqIgQoAgAhAgsgA0ECcQRAIAFBBGsoAgAiASgCACEGIAAgARARIAEgBkEEaiADQXxxaiIDNgIACyAEIAJBAnI2AgAgBEEEayABNgIAIAAgA0F8cSICQYACSQR/IAJBBHYFQR9B/P///wMgAiACQfz///8DTxsiAmdrIgNBB2shBSACIANBBGt2QRBzCyICIAVBBHRqQQJ0aigCYCEDIAFBADYCBCABIAM2AgggAwRAIAMgATYCBAsgACAFQQR0IAJqQQJ0aiABNgJgIAAgACgCAEEBIAV0cjYCACAAIAVBAnRqIgAgACgCBEEBIAJ0cjYCBAsSACAAIAA2AgQgACAANgIIIAALKwEBfyAAKAIEQXxxIgFFBEAgACgCCBoPCyABIAAoAggiADYCCCAAIAEQHQttAAJAAkACQAJAAkACQAJAAkACQCAAQQhrKAIADgoAAQIDCAgEBQgGBwsPCw8LDwsgACgCABADDwsgACgCABADDwsPCw8LAAsjDEEEayQMEAEjDEEANgIAIwwgADYCACAAKAIAEAMjDEEEaiQMC0sAIwxBBGskDBABIwxBADYCACMMIAA2AgAgASAAKAIMTwRAQfAPQcARQfIAQSoQAAALIwwgADYCACAAKAIEIAFqLQAAIwxBBGokDAuOAQECfyABQYACSQR/IAFBBHYFQR8gARAYIgFnayIDQQdrIQIgASADQQRrdkEQcwshASAAIAJBAnRqKAIEQX8gAXRxIgEEfyAAIAFoIAJBBHRqQQJ0aigCYAUgACgCAEF/IAJBAWp0cSIBBH8gACAAIAFoIgBBAnRqKAIEaCAAQQR0akECdGooAmAFQQALCwsgACAAQf7///8BSQR/IABBAUEbIABna3RqQQFrBSAACwuXAQECfz8AIgFBAEwEf0EBIAFrQABBAEgFQQALBEAAC0HAlgJBADYCAEHgogJBADYCAANAIABBF0kEQCAAQQJ0QcCWAmpBADYCBEEAIQEDQCABQRBJBEAgAEEEdCABakECdEHAlgJqQQA2AmAgAUEBaiEBDAELCyAAQQFqIQAMAQsLQcCWAkHkogI/AKxCEIYQGkHAlgIkCQuGAQEDfyABQRNqQXBxQQRrIQEgACgCoAwiAwRAIAMgAUEQayIFRgRAIAMoAgAhBCAFIQELCyACp0FwcSABayIDQRRJBEAPCyABIARBAnEgA0EIayIDQQFycjYCACABQQA2AgQgAUEANgIIIAFBBGogA2oiA0ECNgIAIAAgAzYCoAwgACABEBILZgECf0HAChADQbALEANBoAwQA0GQDRADQfAPEANBwA0QA0GwDhADQaAVEANB4BUQA0GwEhADIwQiASgCBEF8cSEAA0AgACABRwRAIAAoAgQaIABBFGoQFSAAKAIEQXxxIQAMAQsLC0YBAn8gASAAQRRrIgMoAgBBfHFBEGtNBEAgAyABNgIQIAAPCyABIAMoAgwQBCICIAAgASADKAIQIgAgACABSxv8CgAAIAILEgAgACABIAAoAgRBA3FyNgIECxIAIAAgACgCBEF8cSABcjYCBAsPACAAIAE2AgAgACABEA4LTgAjDEEEayQMEAEjDEEANgIAIwwgADYCACABIAAoAgxPBEBB8A9BwBFB8gBBKhAAAAsjDCAANgIAIAAoAgQgAUECdGooAgAjDEEEaiQMCyYAPwBBEHRBvJYCa0EBdiQBQaAPEBMkBEHADxATJAZB0BAQEyQIC7ICAQJ/IAAgAUEBdGohAyACIQEDQCAAIANJBEAgAC8BACICQYABSQR/IAEgAjoAACABQQFqBSACQYAQSQR/IAEgAkEGdkHAAXIgAkE/cUGAAXJBCHRyOwEAIAFBAmoFIAJBgLgDSSAAQQJqIANJcSACQYDwA3FBgLADRnEEQCAALwECIgRBgPgDcUGAuANGBEAgASACQf8HcUEKdEGAgARqIARB/wdxciICQT9xQYABckEYdCACQQZ2QT9xQYABckEQdHIgAkEMdkE/cUGAAXJBCHRyIAJBEnZB8AFycjYCACABQQRqIQEgAEEEaiEADAULCyABIAJBDHZB4AFyIAJBBnZBP3FBgAFyQQh0cjsBACABIAJBP3FBgAFyOgACIAFBA2oLCyEBIABBAmohAAwBCwsLgAIBBH8jDEEEayQMEAEjDEEANgIAAkACQCMKQQFrDgMBAQEACwALIwwgADYCACMMQQhrJAwQASMMQgA3AwAjDCAANgIAIAAiAUEUaygCECABaiEDA0AgASADSQRAIAEvAQAiBEGAAUkEfyACQQFqBSAEQYAQSQR/IAJBAmoFIARBgPgDcUGAsANGIAFBAmogA0lxBEAgAS8BAkGA+ANxQYC4A0YEQCACQQRqIQIgAUEEaiEBDAULCyACQQNqCwshAiABQQJqIQEMAQsLIwwgAkEBEAQiATYCBCMMIAA2AgAgACAAQRRrKAIQQQF2IAEQIiMMQQhqJAwjDEEEaiQMIAELzwIBBX8jDEEEayQMEAEjDEEANgIAIAAgAWohBCMMIAFBAXRBAhAEIgI2AgAgAiEBA0AgACAESQRAAkAgAC0AACEFIABBAWohACAFQYABcQRAIAAgBEYNASAALQAAQT9xIQYgAEEBaiEAIAVB4AFxQcABRgRAIAEgBUEfcUEGdCAGcjsBAAUgACAERg0CIAAtAABBP3EhAyAAQQFqIQAgBUHwAXFB4AFGBEAgBUEPcUEMdCAGQQZ0ciADciEDBSAAIARGDQMgAC0AAEE/cSAFQQdxQRJ0IAZBDHRyIANBBnRyciEDIABBAWohAAsgA0GAgARJBEAgASADOwEABSABIANBgIAEayIDQQp2QYCwA3IgA0H/B3FBgLgDckEQdHI2AgAgAUECaiEBCwsFIAEgBTsBAAsgAUECaiEBDAILCwsgAiABIAJrEBwjDEEEaiQMC5YCAQN/IAFB/P///wNLBEBBsA5BgBFBzQNBHRAAAAsgAEEMIAFBE2pBcHFBBGsgAUEMTRsiAxAXIgFFBEAgA0GAAk8EfyADEBgFIAMLQQQgACgCoAw/ACIBQRB0QQRrR3RqQf//A2pBgIB8cUEQdiECIAEgAiABIAJKG0AAQQBIBEAgAkAAQQBIBEAACwsgACABQRB0PwCsQhCGEBogACADEBchAQsgASgCABogACABEBEgASgCACICQXxxIANrIgRBEE8EQCABIAMgAkECcXI2AgAgAUEEaiADaiICIARBBGtBAXI2AgAgACACEBIFIAEgAkF+cTYCACABQQRqIAEoAgBBfHFqIgAgACgCAEF9cTYCAAsgAQtDACAARQRADwsgAEEUayIAKAIEQQNxQQNHBEBB4BVB8A5B4AJBBRAAAAsjAkEBRgRAIAAQDwUgABAUIAAjCCMHEBALCzgBAX8gAARAIABBFGsiASgCBEEDcUEDRgRAQaAVQfAOQdICQQcQAAALIAEQFCABIwRBAxAQCyAACzkAIwJBAEoEQANAIwIEQBANGgwBCwsLEA0aA0AjAgRAEA0aDAELCyMArULIAX5C5ACAp0GACGokAQu2AQEBfyMMQRBrJAwQASMMQgA3AwAjDEIANwMIIABFBEAjDEEMQQMQBCIANgIACyMMIAA2AgQgAEEAEB8jDCAANgIEIABBADYCBCMMIAA2AgQgAEEANgIIIAFB/P///wNLBEBBwA1B8A1BE0E5EAAACyMMIAFBARAEIgI2AggjDCAANgIEIwwgAjYCDCAAIAIQHyMMIAA2AgQgACACNgIEIwwgADYCBCAAIAE2AggjDEEQaiQMIAALrgEBAn8jDEEEayQMEAEjDEEANgIAIwwgADYCACABIAAoAggiA0ECdksEQCABQf////8ASwRAQcANQcARQRNBMBAAAAsjDCAANgIAIAAoAgAiAkH8////AyADQQF0IgMgA0H8////A08bIgNBCCABIAFBCE0bQQJ0IgEgASADSRsiARAcIgMgAkcEQCAAIAM2AgAgACADNgIEIAAgAxAOCyAAIAE2AggLIwxBBGokDAsmACMMQQhrJAwQASMMIAA2AgAjDCABNgIEIAAgARAtIwxBCGokDAurCgIWfwF+IwxBHGskDBABIwxBAEEc/AsAIwwgADYCACAAEAWsQgOGIRcjDCAANgIAQcAAIAAQBUEJakHAAG9rIQEjDCAANgIAIAAQBSABQQAgAUHAAEcbakEJaiETIwwgExAJIhU2AgQDQCMMIAA2AgAgABAFIANKBEAjDCAVNgIAIwwgADYCCCAVIAMgACADEAYQAiADQQFqIQMMAQsLIwwgFTYCACMMIAA2AgggFSAAEAVBgAEQAkEAIQADQCAAQQhIBEAjDCAVNgIAIBUgE0EBayAAayAXIACsQgOGiEL/AYOnEAIgAEEBaiEADAELC0HnzKfQBiEPQYXdntt7IQ5B8ua74wMhDUG66r+qeiEMQf+kuYgFIQtBjNGV2HkhCkGrs4/8ASEJQZmag98FIQgjDCMMQQRrJAwQASMMQQA2AgAjDEGAAkEHEAQiFjYCACMMQQRqJAwgFjYCDANAIBIgE0gEQEEAIQMDQCADQRBIBEAjDCAWNgIAIwwgFTYCCCAVIBIgA0ECdGoiABAGQRh0IwwgFTYCCCAVIABBAWoQBkEQdHIjDCAVNgIIIBUgAEECahAGQQh0ciEBIwwgFTYCCCAWIAMgFSAAQQNqEAYgAXIQDCADQQFqIQMMAQsLQRAhAgNAIAJBwABIBEAjDCAWNgIAIBYgAkEPayIAEAchASMMIBY2AgAgFiAAEAchAyMMIBY2AgAgAUEZdCABQQd2ciADQQ50IANBEnZycyAWIAAQB0EDdnMhACMMIBY2AgAgFiACQQJrIgEQByEDIwwgFjYCACAWIAEQByEEIwwgFjYCACADQQ90IANBEXZyIARBDXQgBEETdnJzIBYgARAHQQp2cyEBIwwgFjYCACMMIBY2AgggFiACQRBrEAcgAGohACMMIBY2AgggFiACIBYgAkEHaxAHIABqIAFqEAwgAkEBaiECDAELCyAPIQcgDiECIA0hASAMIQQgCyEGIAohAyAJIQAgCCEFQQAhFANAIBRBwABIBEAjDEHACjYCAEHACiAUECAgBSAGQQd0IAZBGXZyIAZBGnQgBkEGdnIgBkEVdCAGQQt2cnNzaiADIAZxIAZBf3MgAHFzamohESMMIBY2AgAgB0EKdCAHQRZ2ciAHQR50IAdBAnZyIAdBE3QgB0ENdnJzcyABIAJxIAIgB3EgASAHcXNzaiAAIQUgAyEAIAYhAyAEIBYgFBAHIBFqIhFqIQYgASEEIAIhASAHIQIgEWohByAUQQFqIRQMAQsLIAcgD2ohDyACIA5qIQ4gASANaiENIAQgDGohDCAGIAtqIQsgAyAKaiEKIAAgCWohCSAFIAhqIQggEkFAayESDAELCyMMQSAQCSIANgIQIwwjDCMMQQRrJAwQASMMQQA2AgAjDEEgQQEQBCIDNgIAQRBBBBAEIgQgAzYCACAEIAMQDiAEIAM2AgQgBEEgNgIIIARBCDYCDCMMQQRqJAwgBDYCFCAEQQAgDxAIIARBASAOEAggBEECIA0QCCAEQQMgDBAIIARBBCALEAggBEEFIAoQCCAEQQYgCRAIIARBByAIEAggBDYCGEEAIQEDQCABQQhIBEAjDCAENgIAIAQgARAgIQIjDCAANgIAIAAgAUECdCIDIAJBGHYQAiMMIAA2AgAgACADQQFqIAJBEHZB/wFxEAIjDCAANgIAIAAgA0ECaiACQQh2Qf8BcRACIwwgADYCACAAIANBA2ogAkH/AXEQAiABQQFqIQEMAQsLIwxBHGokDCAAC4QGAQh/IwxBJGskDBABIwxBAEEk/AsAIwwjDEEMayQMEAEjDEIANwMAIwxBADYCCCMMQSAQCSIHNgIAA0AgA0EgSARAIwwgBzYCBCMMQbALNgIIQbALIAMQFiEJIwxBoAw2AghBoAwgAxAWIAlzIQkjDEGQDTYCCCAHIANBkA0gAxAWIAlzQf8BcRACIANBAWohAwwBCwsjDEEMaiQMIAc2AgAjDCAANgIEQQEkCiMMIAAQIyIINgIIIwwjDCAINgIEQQEkCiMMQQRrJAwQASMMQQA2AgACQAJAAkAjCkEBaw4DAQECAAsAC0F/IQILIwwgCDYCACMMQQxrJAwQASMMQgA3AwAjDEEANgIIIwwgCDYCACMMIAg2AgQgCEEUaygCECEDIAIiAEEASARAIABBf0YEfyADBUHADUHwEUHNDkEHEAAACyEABSAAIANKBEBBwA1B8BFB0g5BBxAAAAsLIwxBDEEGEAQiAjYCCCACIAg2AgAgAiAIEA4gAiAANgIIIAIgCDYCBCMMQQxqJAwjDEEEaiQMIAI2AgwjDCAHNgIEIwwgBxAFIQMjDCACNgIEIAIQBSADahAJIgA2AhADQCMMIAc2AgQgBxAFIAVKBEAjDCAANgIEIwwgBzYCFCAAIAUgByAFEAYQAiAFQQFqIQUMAQsLA0AjDCACNgIEIAIQBSAGSgRAIwwgADYCBCMMIAc2AhQgBxAFIAZqIQMjDCACNgIUIAAgAyACIAYQBhACIAZBAWohBgwBCwsjDCAANgIEIwwgABAsIgA2AhgjDCABNgIEIwwgARAuIgE2AhwjDCABNgIEIAEQBSECIwwgAhAJIgM2AiADQCACIARKBEAjDCADNgIEIwwgATYCFCABIAQQBiEFIwwgADYCFCADIAQgACAEQSBvEAYgBXNB/wFxEAIgBEEBaiEEDAELCyMMIAM2AhQjDCADKAIAIgA2AgQjDEEEayQMEAEjDEEANgIAIwwgADYCACAAIABBFGsoAhAQJCMMQQRqJAwjDEEkaiQMC6kGAQl/IwxBFGskDBABIwxBAEEU/AsAIwwjDEEEayQMEAEjDEEANgIAIwxBgAhBCRAEIgU2AgAjDEEEaiQMIAU2AgADQCAGQYACSARAIwwgBTYCBCAFIAZBfxAMIAZBAWohBgwBCwtBACEGA0AgBkHcEygCAEEBdkgEQCMMIAU2AgQgBUHgEyAGEAogBhAMIAZBAWohBgwBCwtBgBUhASMMQYAVNgIIQQAhBgNAIwwgADYCBCAGIABBFGsoAhBBAXZIBEACQCMMIAA2AgQgACAGEAoiAkE9Rg0AIwwgBTYCBCAFIAIQC0EATgRAIwwgATYCBCMMQQEkCiMMQQRrJAwQASMMQQA2AgAjDEECQQIQBCIHNgIAIAcgAjsBACMMQQRqJAwjDCAHNgIMIwxBCGskDBABIwxCADcDACMMIAE2AgAjDCAHNgIEIwxBCGskDBABIwxCADcDACMMIAEiAjYCACABQRRrKAIQQX5xIQgjDCAHNgIAAkAgB0EUaygCEEF+cSIJIAhqIgFFBEBBgBUhAQwBCyMMIAFBAhAEIgE2AgQgASACIAj8CgAAIAEgCGogByAJ/AoAAAsjDEEIaiQMIwxBCGokDCABNgIICyAGQQFqIQYMAgsLCyMMIAE2AgQjDCABQRRrKAIQQQF2IgJBA2xBAnUiAxAJIgY2AhBBACEAA0AgAiAESgRAIwwgBTYCBCMMIAE2AgwgBSABIAQQChALQRJ0IARBAWoiByACSAR/IwwgBTYCBCMMIAE2AgwgBSABIAcQChALBUEAC0EMdHIgBEECaiIHIAJIBH8jDCAFNgIEIwwgATYCDCAFIAEgBxAKEAsFQQALQQZ0ciAEQQNqIgcgAkgEfyMMIAU2AgQjDCABNgIMIAUgASAHEAoQCwVBAAtyIQcgACADSARAIwwgBjYCBCAGIAAgB0EQdUH/AXEQAiAAQQFqIQALIAAgA0gEQCMMIAY2AgQgBiAAIAdBCHVB/wFxEAIgAEEBaiEACyAAIANIBEAjDCAGNgIEIAYgACAHQf8BcRACIABBAWohAAsgBEEEaiEEDAELCyMMQRRqJAwgBgsLgAwxAEGMCAsCHAEAQZgIC4gCAQAAAAABAACYL4pCkUQ3cc/7wLWl27XpW8JWOfER8Vmkgj+S1V4cq5iqB9gBW4MSvoUxJMN9DFV0Xb5y/rHegKcG3Jt08ZvBwWmb5IZHvu/GncEPzKEMJG8s6S2qhHRK3KmwXNqI+XZSUT6YbcYxqMgnA7DHf1m/8wvgxkeRp9VRY8oGZykpFIUKtyc4IRsu/G0sTRMNOFNUcwpluwpqdi7JwoGFLHKSoei/oktmGqhwi0vCo1FsxxnoktEkBpnWhTUO9HCgahAWwaQZCGw3Hkx3SCe1vLA0swwcOUqq2E5Pypxb828uaO6Cj3RvY6V4FHjIhAgCx4z6/76Q62xQpPej+b7yeHHGAEGsCgsBLABBuAoLFQQAAAAQAAAAIAQAACAEAAAAAQAAQABB3AoLATwAQegKCygBAAAAIAAAAOCg+weDVdtJI1KV1U0QrIeAGphXK6W1KHEcnUIsAPgLAEGcCwsBLABBqAsLFQUAAAAQAAAAcAUAAHAFAAAgAAAAIABBzAsLATwAQdgLCygBAAAAIAAAAKIH7D21oSsA4lk4ykj7Z3LYy7LhTQ14IaOY4ZIb1jf3AEGMDAsBLABBmAwLFQUAAAAQAAAA4AUAAOAFAAAgAAAAIABBvAwLATwAQcgMCygBAAAAIAAAABH0W397lqYFk2/CV26iuIAQgljlC8yIXYX2Podbmb6FAEH8DAsBLABBiA0LFQUAAAAQAAAAUAYAAFAGAAAgAAAAIABBrA0LASwAQbgNCyMCAAAAHAAAAEkAbgB2AGEAbABpAGQAIABsAGUAbgBnAHQAaABB3A0LATwAQegNCy0CAAAAJgAAAH4AbABpAGIALwBhAHIAcgBhAHkAYgB1AGYAZgBlAHIALgB0AHMAQZwOCwE8AEGoDgsvAgAAACgAAABBAGwAbABvAGMAYQB0AGkAbwBuACAAdABvAG8AIABsAGEAcgBnAGUAQdwOCwE8AEHoDgsnAgAAACAAAAB+AGwAaQBiAC8AcgB0AC8AaQB0AGMAbQBzAC4AdABzAEHcDwsBPABB6A8LKwIAAAAkAAAASQBuAGQAZQB4ACAAbwB1AHQAIABvAGYAIAByAGEAbgBnAGUAQZwQCwEsAEGoEAsbAgAAABQAAAB+AGwAaQBiAC8AcgB0AC4AdABzAEHsEAsBPABB+BALJQIAAAAeAAAAfgBsAGkAYgAvAHIAdAAvAHQAbABzAGYALgB0AHMAQawRCwEsAEG4EQshAgAAABoAAAB+AGwAaQBiAC8AYQByAHIAYQB5AC4AdABzAEHcEQsBPABB6BELKwIAAAAkAAAAfgBsAGkAYgAvAHQAeQBwAGUAZABhAHIAcgBhAHkALgB0AHMAQZwSCwE8AEGoEgsrAgAAACQAAABVAG4AcABhAGkAcgBlAGQAIABzAHUAcgByAG8AZwBhAHQAZQBB3BILASwAQegSCyMCAAAAHAAAAH4AbABpAGIALwBzAHQAcgBpAG4AZwAuAHQAcwBBjBMLATwAQZgTCy0CAAAAJgAAAH4AbABpAGIALwBzAHQAYQB0AGkAYwBhAHIAcgBhAHkALgB0AHMAQcwTCwGcAEHYEwuHAQIAAACAAAAAQQBCAEMARABFAEYARwBIAEkASgBLAEwATQBOAE8AUABRAFIAUwBUAFUAVgBXAFgAWQBaAGEAYgBjAGQAZQBmAGcAaABpAGoAawBsAG0AbgBvAHAAcQByAHMAdAB1AHYAdwB4AHkAegAwADEAMgAzADQANQA2ADcAOAA5ACsALwBB7BQLARwAQfgUCwECAEGMFQsBPABBmBULMQIAAAAqAAAATwBiAGoAZQBjAHQAIABhAGwAcgBlAGEAZAB5ACAAcABpAG4AbgBlAGQAQcwVCwE8AEHYFQsvAgAAACgAAABPAGIAagBlAGMAdAAgAGkAcwAgAG4AbwB0ACAAcABpAG4AbgBlAGQAQZAWCyoKAAAAIAAAACAAAAAgAAAAAAAAAAIBAABCAAAAQQAAACQBAAACCQAAJAk=";
var MEOW_WASM_B64_CURRENT =
  MEOW_WASM_B64.slice(0, 11233) +
  "G0g32bMSiprwMvftlx6x7+wcceDl466eVAc5OgonK3rAEGcCwsBLABBqAsLFQUAAAAQAAAAcAUAAHAFAAAgAAAAIABBzAsLATwAQdgLCygBAAAAIAAAADhCRezUfBHbR2yR7/f2UOElRDZZTwWi1nZr721Q37X2AEGMDAsBLABBmAwLFQUAAAAQAAAA4AUAAOAFAAAgAAAAIABBvAwLATwAQcgMCygBAAAAIAAAAGRS/88rQULJ78wIapP+4BLTQpipitJ/2HZFaecsD0dE" +
  MEOW_WASM_B64.slice(-1328);

// ---- Pure-JS SHA-256 (synchronous, for the Altcha PoW loop) ----
var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function sha256Hex(str) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var bytes = [];
  for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0);
  bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
  var w = new Array(64);
  var a, b, c, d, e, f, g, h, t, S0, S1, ch, maj, t1, t2, s0, s1;
  for (var blk = 0; blk < bytes.length; blk += 64) {
    for (t = 0; t < 16; t++) {
      w[t] = ((bytes[blk + t * 4] << 24) | (bytes[blk + t * 4 + 1] << 16) | (bytes[blk + t * 4 + 2] << 8) | bytes[blk + t * 4 + 3]) >>> 0;
    }
    for (t = 16; t < 64; t++) {
      s0 = (((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3)) >>> 0;
      s1 = (((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    a = H[0]; b = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
    for (t = 0; t < 64; t++) {
      S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      ch = ((e & f) ^ (~e & g)) >>> 0;
      t1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  var out = "";
  for (var i = 0; i < 8; i++) out += ("00000000" + (H[i] >>> 0).toString(16)).slice(-8);
  return out;
}
function b64encode(str) {
  // utf8 -> binary string -> base64 (payload is ASCII, this is just belt-and-braces)
  var bin = unescape(encodeURIComponent(str));
  return btoa(bin);
}

// ---- WASM loader (lazy singleton) ----
var _wasmDeobfuscate = null;
function loadWasmDeobfuscate() {
  if (_wasmDeobfuscate) return Promise.resolve(_wasmDeobfuscate);
  var wasmBytes = Uint8Array.from(atob(MEOW_WASM_B64_CURRENT), function (ch) { return ch.charCodeAt(0); });
  return WebAssembly.compile(wasmBytes).then(function (mod) {
    return WebAssembly.instantiate(mod, {
      env: {
        abort: function () { throw new Error("WASM abort"); }
      }
    });
  }).then(function (inst) {
    var memory = inst.exports.memory;
    var deobfuscate = inst.exports.deobfuscate;
    var __new = inst.exports.__new;
    var __pin = inst.exports.__pin;
    var __unpin = inst.exports.__unpin;
    function writeStr(str) {
      var ptr = __new(str.length << 1, 2) >>> 0;
      var mem16 = new Uint16Array(memory.buffer);
      for (var i = 0; i < str.length; i++) mem16[(ptr >>> 1) + i] = str.charCodeAt(i);
      return ptr;
    }
    function readStr(ptr) {
      if (!ptr) return "";
      var mem32 = new Uint32Array(memory.buffer);
      var endPtr = (ptr + mem32[(ptr - 4) >>> 2]) >>> 1;
      var mem16 = new Uint16Array(memory.buffer);
      var result = "";
      for (var x = ptr >>> 1; endPtr - x > 1024; x += 1024) {
        result += String.fromCharCode.apply(null, mem16.subarray(x, x + 1024));
      }
      result += String.fromCharCode.apply(null, mem16.subarray(ptr >>> 1, endPtr));
      return result;
    }
    _wasmDeobfuscate = function (nonce, data) {
      var nPtr = __pin(writeStr(nonce));
      var dPtr = writeStr(data);
      var resPtr = deobfuscate(nPtr, dPtr) >>> 0;
      __unpin(nPtr);
      return readStr(resPtr);
    };
    return _wasmDeobfuscate;
  });
}

// ---- Altcha PoW + ticket ----
function solveAltcha(c) {
  for (var n = 0; n <= c.maxnumber; n++) {
    if (sha256Hex(c.salt + n.toString()) === c.challenge) {
      return b64encode(JSON.stringify({
        algorithm: c.algorithm,
        challenge: c.challenge,
        number: n,
        salt: c.salt,
        signature: c.signature
      }));
    }
  }
  throw new Error("MeowTV: failed to solve altcha");
}
function fetchWithTimeout(url, opts, ms) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, ms || 30000);
  opts = opts || {};
  opts.signal = ctrl.signal;
  return fetch(url, opts).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
}
function getTicket() {
  return fetchWithTimeout(API_BASE + "/altcha/challenge", {
    headers: { "User-Agent": UA, "Origin": "https://meowtv.ru", "Referer": "https://meowtv.ru/" }
  }).then(function (r) {
    if (!r.ok) throw new Error("MeowTV: altcha challenge failed (" + r.status + ")");
    return r.json();
  }).then(function (ch) {
    var altcha = solveAltcha(ch);
    return fetchWithTimeout(API_BASE + "/streams/ticket", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        "Origin": "https://meowtv.ru",
        "Referer": "https://meowtv.ru/"
      },
      body: JSON.stringify({ altcha: altcha })
    });
  }).then(function (r) {
    if (!r.ok) throw new Error("MeowTV: ticket fetch failed (" + r.status + ")");
    return r.json();
  }).then(function (j) { return j.ticket; });
}

// ---- Stream fetch + decrypt ----
function fetchServerStream(type, tmdbId, serverId, season, episode, ticket) {
  var mediaType = type === "movie" ? "movie" : "tv";
  var path = type === "movie"
    ? "/streams/movie/" + tmdbId + "?s=" + encodeURIComponent(serverId)
    : "/streams/tv/" + tmdbId + "/" + season + "/" + episode + "?s=" + encodeURIComponent(serverId);
  return fetchWithTimeout(API_BASE + path, {
    headers: {
      "User-Agent": UA,
      "Origin": "https://meowtv.ru",
      "Referer": "https://meowtv.ru/play/" + mediaType + "/" + tmdbId,
      "x-stream-ticket": ticket
    }
  }).then(function (r) {
    if (!r.ok) return null;
    return r.json();
  }).then(function (enc) {
    if (!enc || !enc.n || !enc.d) return null;
    return loadWasmDeobfuscate().then(function (deob) {
      return JSON.parse(deob(enc.n, enc.d));
    });
  }).catch(function () { return null; });
}

// ---- Helpers ----
function normalizeMeowLanguage(raw) {
  var l = (raw || "").toLowerCase().trim();
  if (!l || l === "auto" || l === "multi" || l === "multi audio" || l === "multiple" || l === "mul") return "Multi Audio";
  if (l === "dual" || l === "dual audio") return "Dual Audio";
  if (l === "hindi" || l === "hi") return "Hindi";
  if (l === "english" || l === "en") return "English";
  if (l === "tamil" || l === "ta") return "Tamil";
  if (l === "telugu" || l === "te") return "Telugu";
  if (l === "japanese" || l === "ja") return "Japanese";
  if (l === "korean" || l === "ko") return "Korean";
  if (l === "bengali" || l === "bn") return "Bengali";
  if (l === "arabic" || l === "ar") return "Arabic";
  if (l === "chinese" || l === "zh") return "Chinese";
  if (l === "original" || l === "original audio") return "Original Audio";
  var r0 = raw || "";
  return r0.charAt(0).toUpperCase() + r0.slice(1);
}
function qualityFromUrl(url) {
  var u = (url || "").toLowerCase().split("?")[0];
  if (/\b(2160|4k)\b/.test(u)) return "2160p";
  if (/\b1080\b/.test(u)) return "1080p";
  if (/\b720\b/.test(u)) return "720p";
  if (/\b480\b/.test(u)) return "480p";
  if (/\b360\b/.test(u)) return "360p";
  return "Unknown";
}
var URL_TITLE_FILLER = {
  "season": 1, "complete": 1, "hindi": 1, "english": 1, "dubbed": 1, "part": 1,
  "web": 1, "hd": 1, "series": 1, "download": 1, "full": 1, "episodes": 1,
  "special": 1, "episode": 1, "collection": 1, "remastered": 1, "extended": 1,
  "edition": 1, "version": 1, "theatrical": 1, "directors": 1, "cut": 1
};
function urlTitleMismatch(url, requestedTitle) {
  var pathParts = ((url || "").split("?")[0]).split("/").filter(function (p) { return !!p; });
  var titleSlug = null;
  for (var i = 1; i < pathParts.length; i++) {
    if (/^[Ss]\d{2}[Ee]\d{2}/.test(pathParts[i])) { titleSlug = pathParts[i - 1] || null; break; }
  }
  if (!titleSlug) return false;
  function tokenise(s) {
    return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._\-+]/g, " ")
      .toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
      .filter(function (w) { return w.length >= 4; });
  }
  var reqWords = {};
  tokenise(requestedTitle).forEach(function (w) { reqWords[w] = 1; });
  var slugWords = tokenise(titleSlug);
  var reqCount = Object.keys(reqWords).length;
  if (slugWords.length === 0 || reqCount === 0) return false;
  for (var k in reqWords) {
    if (slugWords.indexOf(k) === -1) return true;
  }
  for (var j = 0; j < slugWords.length; j++) {
    if (!reqWords[slugWords[j]] && !URL_TITLE_FILLER[slugWords[j]]) return true;
  }
  return false;
}
function tmdbTitle(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchWithTimeout("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, {}, 10000)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return j ? (j.title || j.name || null) : null; })
    .catch(function () { return null; });
}

// ---- Main ----
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var id = parseInt(tmdbId, 10);
  if (!id) return Promise.resolve([]);
  if (type === "tv" && (!seasonNum || !episodeNum)) return Promise.resolve([]);

  var servers = MEOW_SERVERS.filter(function (s) { return !(s.movieOnly && type === "tv"); });

  return tmdbTitle(id, type).then(function (title) {
    // Tickets are single-use: each server needs its own (matches source behavior).
    return Promise.all(servers.map(function (srv) {
      return getTicket().then(function (ticket) {
        return fetchServerStream(type, id, srv.id, seasonNum, episodeNum, ticket);
      }).then(function (data) {
        return { label: srv.label, serverId: srv.id, data: data };
      }).catch(function () {
        return { label: srv.label, serverId: srv.id, data: null };
      });
    })).then(function (results) {
      var out = [];
      for (var i = 0; i < results.length; i++) {
        var label = results[i].label;
        var data = results[i].data;
        if (!data || !data.url) continue;
        if (data.url.indexOf("decoy.invalid") !== -1) continue;
        if (title && urlTitleMismatch(data.url, title)) continue;
        var lang = normalizeMeowLanguage(data.language);
        var q = qualityFromUrl(data.url);
        out.push({
          name: "MeowTV",
          title: label + " | " + lang + " | " + q,
          url: data.url,
          quality: q,
          type: "direct",
          headers: { "Referer": "https://meowtv.ru/", "Origin": "https://meowtv.ru" }
        });
      }
      return out;
    });
  }).catch(function (e) {
    console.log("[MeowTV] error: " + (e && e.message ? e.message : e));
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.MeowTvScraperModule = { getStreams: getStreams };
}
