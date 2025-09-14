#!/usr/bin/env python3
"""
Manifest builder for Arena Floor.

Usage:
1. Put images under project/GameFolder/<Player - Category>/
2. From project/, run: python tools/build_manifest.py
3. Serve project/ statically (e.g., python -m http.server) and open /web/operator.html
"""
import json, os, sys, re, datetime
from pathlib import Path

# Supported image extensions
EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
GAME_FOLDER = Path('GameFolder')
OUT_FILE = Path('web/manifest.json')

# Helpers ---------------------------------------------------------------
def slugify(name: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return slug or 'untitled'


def build_manifest(root: Path) -> dict:
    categories = []
    for cat_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        folder_name = cat_dir.name
        if ' - ' in folder_name:
            player, cat_name = folder_name.split(' - ', 1)
        else:
            player, cat_name = '', folder_name
        cat_id = slugify(cat_name)
        items = []
        files = [p for p in cat_dir.iterdir() if p.is_file() and p.suffix.lower() in EXTS]
        files.sort()
        auto_index = 1
        for f in files:
            m = re.match(r"^(\d+) - (.+)\.(\w+)$", f.name)
            if m:
                index = int(m.group(1))
                answer = m.group(2)
            else:
                index = auto_index
                answer = f.stem
                auto_index += 1
            item_id = f"{cat_id}-{index}"
            src = '/' + str((cat_dir / f.name).as_posix())
            items.append({'id': item_id, 'index': index, 'answer': answer, 'src': src})
        categories.append({'id': cat_id, 'name': cat_name, 'player': player, 'items': items})
    return {
        'version': 1,
        'generatedAt': datetime.datetime.utcnow().isoformat() + 'Z',
        'categories': categories,
    }


def main():
    project_root = Path(__file__).resolve().parents[1]
    os.chdir(project_root)
    if not GAME_FOLDER.exists():
        print(f"Missing {GAME_FOLDER}", file=sys.stderr)
        sys.exit(1)
    manifest = build_manifest(GAME_FOLDER)
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUT_FILE.open('w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    print(f"Manifest written to {OUT_FILE}")


if __name__ == '__main__':
    main()
