#!/usr/bin/env python3
"""Rewrite BrawlBox COLLADA 1.5 exports as COLLADA 1.4.1 for three.js's ColladaLoader.

BrawlBox writes two 1.5-only constructs that three.js r187 does not understand:

* the 2008/03 COLLADA namespace and version="1.5.0";
* <init_from><ref>texture.png</ref></init_from> instead of <init_from>texture.png</init_from>.

Everything else in these files is already 1.4.1-shaped. We edit the XML text in place
(no reserialisation) so whitespace, ordering and number formatting stay byte-identical.

Usage:
    python -I tools/stage/collada15to14.py [--in stage-assets] [--out stage-assets/_dae14]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

V15_NS = "http://www.collada.org/2008/03/COLLADASchema"
V14_NS = "http://www.collada.org/2005/11/COLLADASchema"

INIT_FROM_REF = re.compile(r"<init_from>\s*<ref>(.*?)</ref>\s*</init_from>", re.DOTALL)
SKELETON = re.compile(r"<skeleton>\s*#([^<\s]+)\s*</skeleton>")
ID_ATTR = re.compile(r'\bid="([^"]+)"')
MATERIAL = re.compile(r"<material\b([^>]*?)>")


def add_material_names(text: str) -> str:
    """BrawlBox omits <material name>, so three.js ends up with unnamed materials. Copy the id."""

    def fix(match: re.Match[str]) -> str:
        attrs = match.group(1)
        if "name=" in attrs:
            return match.group(0)
        found = ID_ATTR.search(attrs)
        if not found:
            return match.group(0)
        return f'<material{attrs} name="{found.group(1)}">'

    return MATERIAL.sub(fix, text)


def convert(text: str, name: str) -> tuple[str, int]:
    out = text.replace(V15_NS, V14_NS)
    out = out.replace('version="1.5.0"', 'version="1.4.1"', 1)
    out, refs = INIT_FROM_REF.subn(r"<init_from>\1</init_from>", out)
    out = add_material_names(out)

    # <skeleton> points at the node's sid, not its id; three.js looks nodes up by id.
    ids = set(ID_ATTR.findall(out))

    def fix_skeleton(match: re.Match[str]) -> str:
        ref = match.group(1)
        if ref in ids:
            return match.group(0)
        candidate = f"{ref}-ID"
        if candidate in ids:
            return f"<skeleton>#{candidate}</skeleton>"
        return match.group(0)

    out = SKELETON.sub(fix_skeleton, out)

    if V15_NS in out:
        raise ValueError(f"{name}: 1.5 namespace still present")
    if 'version="1.5.0"' in out:
        raise ValueError(f"{name}: version 1.5 still present")
    return out, refs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="src", default="stage-assets", help="folder with the BrawlBox .dae files")
    ap.add_argument("--out", dest="dst", default="stage-assets/_dae14", help="output folder")
    args = ap.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)
    files = sorted(src.glob("*.dae"))
    if not files:
        print(f"no .dae files in {src}", file=sys.stderr)
        return 1
    dst.mkdir(parents=True, exist_ok=True)

    total_refs = 0
    for f in files:
        text = f.read_bytes().decode("utf-8")
        out, refs = convert(text, f.name)
        (dst / f.name).write_bytes(out.encode("utf-8"))
        total_refs += refs
        print(f"{f.name}: {refs} image refs")

    print(f"\n{len(files)} files -> {dst} ({total_refs} image refs rewritten)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
