#!/usr/bin/env bash
# Build the Zotero plugin into a .xpi file.
#
# Usage: ./build.sh
# Output: ./build/paper-updater-<version>.xpi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(grep -E '"version"' manifest.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')
if [ -z "$VERSION" ]; then
  echo "Could not read version from manifest.json" >&2
  exit 1
fi

OUT_DIR="build"
OUT_FILE="$OUT_DIR/paper-updater-$VERSION.xpi"

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

zip -r "$OUT_FILE" \
  manifest.json \
  bootstrap.js \
  prefs.js \
  icon-48.png \
  icon-96.png \
  icon-128.png \
  content \
  locale \
  -x "*.DS_Store" "*/.*"

echo ""
echo "Built: $OUT_FILE"
echo ""
echo "To install:"
echo "  1. Open Zotero"
echo "  2. Tools → Plugins → gear icon → Install Plugin From File..."
echo "  3. Select $OUT_FILE"
