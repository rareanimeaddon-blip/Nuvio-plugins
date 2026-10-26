#!/usr/bin/env python3
"""Assemble providers/multimovies11.js: fetch-retry prelude + tvcompat
block (pure-JS AES/SHA) + multimovies11 core
(test/multimovies11-core.js, derived from the multimovies8 core) +
chain-retry postlude — prefix and postlude taken verbatim from
providers/multimovies8.js, the restore base (unlike
build_multimovies10.py, no md5Hex splice is needed: the base is
already self-contained)."""
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
base = (root / "providers" / "multimovies8.js").read_text()
core = (root / "test" / "multimovies11-core.js").read_text()

# prefix: prelude + tvcompat, everything before the core header comment
core_start = base.index("// MultiMovies scraper for Nuvio")
prefix = base[:core_start]

# postlude: from the marker comment to EOF
postlude = base[base.index("/* __CHAIN_RETRY_POSTLUDE__"):]

out = prefix + core + postlude
dest = root / "providers" / "multimovies11.js"
dest.write_text(out)
print("wrote", dest, len(out), "bytes")
