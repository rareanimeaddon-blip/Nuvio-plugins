#!/usr/bin/env python3
"""Assemble providers/movielinkbd6.js: house v5 fetch prelude +
test/movielinkbd6-core.js + chain-retry postlude v2 (canonical text
taken from providers/movielinkbd3.js, the restore base)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "test/movielinkbd6-core.js"
DST = ROOT / "providers/movielinkbd6.js"
BASE = ROOT / "providers/movielinkbd3.js"


def main():
    base = BASE.read_text()
    prelude_start = base.index("/* __FETCH_RETRY_PRELUDE__")
    prelude_end = base.index("})();", prelude_start) + len("})();")
    prelude = base[prelude_start:prelude_end]
    post_start = base.index("/* __CHAIN_RETRY_POSTLUDE__")
    postlude = base[post_start:]
    core = CORE.read_text()
    header = (
        "// MovieLinkBD — revert to the movielinkbd3 device-verified chain, plus emoji stream labels.\n"
        "// House v5 fetch prelude + chain-retry postlude v2 spliced.\n"
    )
    DST.write_text(header + "\n" + prelude + "\n\n" + core + "\n" + postlude)
    print(f"wrote {DST}")


if __name__ == "__main__":
    main()
