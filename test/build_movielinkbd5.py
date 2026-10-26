#!/usr/bin/env python3
"""Assemble providers/movielinkbd5.js: house v5 fetch prelude +
test/movielinkbd5-core.js + chain-retry postlude v2 (canonical text
taken from providers/netmirror12.js)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "test/movielinkbd5-core.js"
DST = ROOT / "providers/movielinkbd5.js"
NETMIRROR = ROOT / "providers/netmirror12.js"


def main():
    nm = NETMIRROR.read_text()
    prelude_end = nm.index("})();") + len("})();")
    prelude = nm[:prelude_end]
    post_start = nm.index("/* __CHAIN_RETRY_POSTLUDE__")
    postlude = nm[post_start:]
    core = CORE.read_text()
    header = (
        "// MovieLinkBD Diag2 — TEMPORARY diagnostic provider (v2 chain), remove after use.\n"
        "// Reports each chain step as a labeled stream (name carries it).\n"
        "// House v5 fetch prelude + chain-retry postlude v2 spliced.\n"
    )
    DST.write_text(header + "\n" + prelude + "\n\n" + core + "\n" + postlude)
    print(f"wrote {DST}")


if __name__ == "__main__":
    main()
