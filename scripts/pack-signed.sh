#!/bin/sh
# Build, sign and notarize the disk image, with the notarization credentials
# read out of 1Password for this one run rather than kept in a shell profile.
#
# The item "Octave Apple notarization" holds the Apple ID, the app-specific
# password and the team ID; electron-builder reads them from the three
# variables below (mac.notarize in electron-builder.yml). The password is
# stored with a trailing newline, hence the tr. The signing identity itself
# is in the keychain and found by name.
#
#   scripts/pack-signed.sh            release/Octave-<version>-arm64.dmg
set -eu
cd "$(dirname "$0")/.."

ITEM='op://Personal/Octave Apple notarization'
APPLE_ID="$(op read "$ITEM/username")"
APPLE_APP_SPECIFIC_PASSWORD="$(op read "$ITEM/password" | tr -d '[:space:]')"
APPLE_TEAM_ID="$(op read "$ITEM/team id" | tr -d '[:space:]')"
export APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID

npm run pack
