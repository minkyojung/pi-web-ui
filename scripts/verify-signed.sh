#!/bin/sh
# What a person's Mac will ask of the packaged app, asked here first.
#
# Three answers, each from the tool macOS itself uses: codesign, that every
# binary inside is signed and the signature holds; spctl, that Gatekeeper
# would let it open (which is what notarization buys); stapler, that the
# notarization ticket is attached, so it opens offline too. Then the one
# thing about this app in particular — its server is a child started with
# ELECTRON_RUN_AS_NODE, a fuse that signing must not have turned off — by
# running the packaged binary that way and asking it for its version.
#
#   scripts/verify-signed.sh [path/to/Octave.app]   default: the one under release/
set -eu
cd "$(dirname "$0")/.."

APP="${1:-release/mac-arm64/Octave.app}"
[ -d "$APP" ] || { echo "no app at $APP — run scripts/pack-signed.sh first" >&2; exit 1; }

echo "== codesign"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "^(Authority=Developer ID|TeamIdentifier|Runtime Version)"

echo "== gatekeeper"
spctl --assess --type execute --verbose=2 "$APP"

echo "== notarization ticket"
xcrun stapler validate "$APP"

echo "== the search tools are inside, signed, and run"
for tool in rg fd; do
	codesign --verify --strict "$APP/Contents/Resources/bin/$tool"
	"$APP/Contents/Resources/bin/$tool" --version | head -1
done

echo "== server starts under ELECTRON_RUN_AS_NODE"
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/Octave" -e 'console.log("node " + process.version + " inside " + process.execPath.split("/").slice(-1)[0])'

echo "ok"
