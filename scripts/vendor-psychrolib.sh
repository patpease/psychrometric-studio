#!/usr/bin/env bash
# Fetch and verify the vendored PsychroLib JavaScript source.
#
# PsychroLib is vendored rather than taken from npm: the npm package is a
# third-party republish (nicfv/psychrolib-npm) whose package version does not
# track the library version. This tool stamps its calculation basis on every
# export, so the basis must be traceable to a specific upstream artifact.
#
# Usage:
#   scripts/vendor-psychrolib.sh          verify the vendored copy matches EXPECTED_SHA256
#   scripts/vendor-psychrolib.sh --update re-fetch from upstream and print the new hash
set -euo pipefail

REF="master"
SRC="https://raw.githubusercontent.com/psychrometrics/psychrolib/${REF}/src/js/psychrolib.js"
LIC="https://raw.githubusercontent.com/psychrometrics/psychrolib/${REF}/LICENSE.txt"
DEST="$(cd "$(dirname "$0")/.." && pwd)/web/vendor"
EXPECTED_SHA256="a46572b93a90263b8e19e8d1372fe3135429aa9611cd57e00674188640cc96c9"

if [[ "${1:-}" == "--update" ]]; then
  curl -sSLf -o "$DEST/psychrolib.js" "$SRC"
  curl -sSLf -o "$DEST/psychrolib.LICENSE.txt" "$LIC"
  echo "Fetched. New SHA256:"
  shasum -a 256 "$DEST/psychrolib.js" | awk '{print $1}'
  echo "Update EXPECTED_SHA256 in this script and web/vendor/PROVENANCE.md."
  exit 0
fi

ACTUAL="$(shasum -a 256 "$DEST/psychrolib.js" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED_SHA256" ]]; then
  echo "FAIL: vendored psychrolib.js checksum mismatch." >&2
  echo "  expected: $EXPECTED_SHA256" >&2
  echo "  actual:   $ACTUAL" >&2
  exit 1
fi
echo "OK: vendored psychrolib.js matches $EXPECTED_SHA256"
