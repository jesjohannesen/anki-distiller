#!/usr/bin/env bash
#
# Wrap Extension/ in a Safari app extension, build it, and drop the .app in build/.
#
#   ./scripts/build-safari.sh          generate + build
#   ./scripts/build-safari.sh --open   …and open the app so Safari registers it
#   ./scripts/build-safari.sh --xcode  generate only, then open the Xcode project
#
# Extension/ is the single source of truth. The Xcode project under build/ is
# regenerated from it every run and is not tracked in git.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Build outside the repo on purpose. A repo living in iCloud Drive (or any file
# provider) gets com.apple.FinderInfo stamped on every file, and codesign refuses
# to sign a bundle that carries those. Override with DISTILLER_BUILD_DIR.
BUILD="${DISTILLER_BUILD_DIR:-$HOME/Library/Caches/com.jesjohannesen.distiller}"
PROJECT="$BUILD/Distiller/Distiller.xcodeproj"
APP_NAME="Distiller"
# The converter derives the container app's id as <prefix>.<AppName>, so the last
# component here must match APP_NAME exactly or the embedded .appex id won't be a
# prefix match and ValidateEmbeddedBinary fails.
BUNDLE_ID="${DISTILLER_BUNDLE_ID:-com.jesjohannesen.Distiller}"
TEAM_ID="${DISTILLER_TEAM_ID:-}"

OPEN_APP=false
XCODE_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --open)  OPEN_APP=true ;;
    --xcode) XCODE_ONLY=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v xcrun >/dev/null || { echo "Xcode command line tools are required." >&2; exit 1; }

echo "==> Generating Safari app extension project"
mkdir -p "$BUILD"
rm -rf "$BUILD/Distiller"
# codesign refuses to sign a bundle carrying extended attributes, and macOS stamps
# com.apple.provenance on anything an app wrote. Strip before copying.
xattr -cr "$ROOT/Extension" 2>/dev/null || true
xcrun safari-web-extension-converter "$ROOT/Extension" \
  --project-location "$BUILD" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

xattr -cr "$BUILD/Distiller" 2>/dev/null || true

if [ "$XCODE_ONLY" = true ]; then
  open "$PROJECT"
  exit 0
fi

echo "==> Building"
# With no Apple developer identity on the machine we ad-hoc sign ("-"). Safari
# will only load an ad-hoc signed extension while Develop ▸ Allow Unsigned
# Extensions is on — see docs/INSTALL.md. Set DISTILLER_TEAM_ID to sign properly.
SIGN_ARGS=(CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" PROVISIONING_PROFILE_SPECIFIER="")
if [ -n "$TEAM_ID" ]; then
  SIGN_ARGS=(CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID")
fi

xcodebuild \
  -project "$PROJECT" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -derivedDataPath "$BUILD/DerivedData" \
  "${SIGN_ARGS[@]}" \
  build

APP_SRC="$BUILD/DerivedData/Build/Products/Release/$APP_NAME.app"
rm -rf "$BUILD/$APP_NAME.app"
cp -R "$APP_SRC" "$BUILD/$APP_NAME.app"

echo
echo "Built: $BUILD/$APP_NAME.app"
echo
echo "Next:"
echo "  1. Open the app once so Safari registers the extension."
echo "  2. Safari ▸ Settings ▸ Extensions ▸ tick Distiller."
echo "  3. If it does not appear: Safari ▸ Settings ▸ Advanced ▸ 'Show features for"
echo "     web developers', then Develop ▸ Allow Unsigned Extensions."

if [ "$OPEN_APP" = true ]; then
  open "$BUILD/$APP_NAME.app"
fi
