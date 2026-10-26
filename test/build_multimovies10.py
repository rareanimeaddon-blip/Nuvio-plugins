#!/usr/bin/env python3
"""Assemble providers/multimovies10.js:
fetch-retry prelude (from multimovies7) + tvcompat block (pure-JS AES/SHA)
+ multimovies8 core (test/multimovies10-core.js, with md5Hex spliced in
from anidisk13) + chain-retry postlude (from multimovies7)."""
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
mm7 = (root / "providers" / "multimovies7.js").read_text()
core = (root / "test" / "multimovies10-core.js").read_text()
tvcompat = (root / "test" / "tvcompat-block.js").read_text()
anidisk = (root / "providers" / "anidisk13.js").read_text().splitlines()

# prelude: everything before the old core's header comment
prelude_end = mm7.index("// MultiMovies scraper for Nuvio")
prelude = mm7[:prelude_end].rstrip() + "\n"

# postlude: from the marker comment to EOF
postlude = mm7[mm7.index("/* __CHAIN_RETRY_POSTLUDE__"):]

# md5Hex from anidisk13 (lines 123..171, 1-indexed, verified vector)
md5_fn = "\n".join(anidisk[122:167])
assert md5_fn.startswith("function md5Hex(bytes) {"), md5_fn[:60]
assert core.count("// __MD5HEX__") == 1
core = core.replace("// __MD5HEX__", md5_fn)

out = prelude + "\n" + tvcompat.rstrip() + "\n\n" + core.rstrip() + "\n\n" + postlude
dest = root / "providers" / "multimovies10.js"
dest.write_text(out)
print("wrote", dest, len(out), "bytes")
