#!/usr/bin/env bash
#
# Wrap Extension/ in a Safari app extension, build it, and install the app.
#
#   ./scripts/build-safari.sh          build + install
#   ./scripts/build-safari.sh --open   …and launch it so Safari registers the extension
#   ./scripts/build-safari.sh --xcode  generate the Xcode project only, then open it
#
# Extension/ is the single source of truth. The Xcode project is regenerated from it
# on every run and is not tracked in git.
#
# Two locations matter here and they are not interchangeable:
#
#   WORK    scratch space for the generated project and DerivedData.
#   INSTALL where the finished .app lives permanently. Safari resolves the extension
#           from this path every launch, so it must be somewhere macOS will not
#           reclaim. NEVER ~/Library/Caches — macOS purges it without warning, the
#           app disappears, and Safari silently drops the extension.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Not the repo: a repo in iCloud Drive (or any file provider) gets com.apple.FinderInfo
# stamped on every file, and codesign refuses to sign a bundle carrying those.
# ~/Library/Developer is Xcode's own territory and is never purged.
WORK="${DISTILLER_BUILD_DIR:-$HOME/Library/Developer/anki-distiller}"

APP_NAME="Distiller"
# The converter derives the container app's id as <prefix>.<AppName>, so the last
# component here must match APP_NAME exactly or the embedded .appex id won't be a
# prefix match and ValidateEmbeddedBinary fails.
BUNDLE_ID="${DISTILLER_BUNDLE_ID:-com.jesjohannesen.Distiller}"
TEAM_ID="${DISTILLER_TEAM_ID:-}"
PROJECT="$WORK/$APP_NAME/$APP_NAME.xcodeproj"

if [ -n "${DISTILLER_INSTALL_DIR:-}" ]; then
  INSTALL_DIR="$DISTILLER_INSTALL_DIR"
elif [ -w /Applications ]; then
  INSTALL_DIR="/Applications"
else
  INSTALL_DIR="$HOME/Applications"
fi
APP="$INSTALL_DIR/$APP_NAME.app"

case "$WORK" in
  "$HOME/Library/Caches"*)
    echo "Refusing to build in ~/Library/Caches — macOS purges it and Safari would lose the extension." >&2
    exit 1 ;;
esac

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
mkdir -p "$WORK"
rm -rf "${WORK:?}/$APP_NAME"
# codesign refuses to sign a bundle carrying extended attributes, and macOS stamps
# com.apple.provenance on anything an app wrote. Strip before copying.
xattr -cr "$ROOT/Extension" 2>/dev/null || true
xcrun safari-web-extension-converter "$ROOT/Extension" \
  --project-location "$WORK" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

xattr -cr "$WORK/$APP_NAME" 2>/dev/null || true

# Optional: swap the MV3 service worker for a non-persistent background page.
#
# Off by default. It was introduced on the theory that Safari never starts the
# service worker, but that observation was made while Safari had the extension
# blocked outright (stale Launch Services records — see below), so it proved
# nothing, and "Failed to load data for extension" appeared in Safari's log only
# with this rewrite in place. background.js supports both shapes, so this is one
# env var away if the service worker really does turn out to be the problem:
#   DISTILLER_BACKGROUND_PAGE=1 ./scripts/build-safari.sh
if [ -n "${DISTILLER_BACKGROUND_PAGE:-}" ]; then
  echo "==> Rewriting background to a non-persistent page"
  /usr/bin/python3 - "$WORK/$APP_NAME/$APP_NAME Extension/Resources/manifest.json" <<'PY'
import json, sys, pathlib

path = pathlib.Path(sys.argv[1])
manifest = json.loads(path.read_text())
manifest["background"] = {
    "scripts": [
        "lib/shim.js",
        "lib/settings.js",
        "lib/ledger.js",
        "lib/openrouter.js",
        "lib/anki.js",
        "lib/prompt.js",
        "background.js",
    ],
}
path.write_text(json.dumps(manifest, indent=2) + "\n")
print(f"    background -> {json.dumps(manifest['background'])}")
PY
fi

if [ "$XCODE_ONLY" = true ]; then
  open "$PROJECT"
  exit 0
fi

echo "==> Building"
# With no Apple developer identity on the machine we ad-hoc sign ("-"). Safari will
# only load an ad-hoc signed extension while Develop ▸ Allow Unsigned Extensions is
# on — see docs/INSTALL.md. Set DISTILLER_TEAM_ID to sign properly.
SIGN_ARGS=(CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" PROVISIONING_PROFILE_SPECIFIER="")
EXTRA_ARGS=()
if [ -n "$TEAM_ID" ]; then
  SIGN_ARGS=(CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID")
  # Lets xcodebuild register the app ids and mint the provisioning profile itself,
  # which the Xcode GUI would otherwise have to be opened to do.
  EXTRA_ARGS=(-allowProvisioningUpdates)
fi

xcodebuild \
  -project "$PROJECT" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -derivedDataPath "$WORK/DerivedData" \
  "${SIGN_ARGS[@]}" \
  "${EXTRA_ARGS[@]}" \
  build

BUILT="$WORK/DerivedData/Build/Products/Release/$APP_NAME.app"
[ -d "$BUILT" ] || { echo "Build reported success but $BUILT is missing." >&2; exit 1; }

echo "==> Installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
rm -rf "$APP"
# ditto, not cp: it preserves bundle metadata and the code signature intact.
ditto "$BUILT" "$APP"

# Verify what we just installed rather than trusting the copy.
codesign --verify --deep --strict "$APP" 2>&1 || { echo "Signature verification failed on the installed app." >&2; exit 1; }
INSTALLED_VERSION="$(/usr/bin/python3 -c "
import json
print(json.load(open('$APP/Contents/PlugIns/$APP_NAME Extension.appex/Contents/Resources/manifest.json'))['version'])
")"

# Launch Services hygiene. Safari resolves the extension through the containing app's
# LS record; if it resolves to a copy that no longer exists it logs
#   "Couldn't find LSApplicationRecord … Disabling and blocking extension"
# and the extension stays blocked no matter what is fixed afterwards. Every rebuild
# used to leave another record behind (the DerivedData product, the previous install,
# anything dragged to the Trash), so purge them and register exactly one.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister

"$LSREGISTER" -u "$BUILT" 2>/dev/null || true
for stale in \
  "$HOME/Library/Caches/com.jesjohannesen.distiller/DerivedData/Build/Products/Release/$APP_NAME.app" \
  "$ROOT/build/DerivedData/Build/Products/Release/$APP_NAME.app" \
  "$HOME/.Trash/$APP_NAME.app"; do
  [ "$stale" = "$APP" ] && continue
  "$LSREGISTER" -u "$stale" 2>/dev/null || true
done

"$LSREGISTER" -f -R -trusted "$APP" 2>/dev/null || true

DUPES=$("$LSREGISTER" -dump 2>/dev/null | grep -E "^\s*path:" | grep -c "/$APP_NAME.app (" || true)
if [ "${DUPES:-1}" -gt 2 ]; then
  warn_dupes=1
fi

echo
echo "Installed: $APP  (extension v$INSTALLED_VERSION)"

if [ -n "${warn_dupes:-}" ]; then
  echo
  echo "  ⚠  Launch Services still lists other $APP_NAME.app copies. Safari may resolve"
  echo "     the extension to a dead one and block it. Inspect with:"
  echo "       ./scripts/diagnose.sh"
fi

if [ -z "$TEAM_ID" ]; then
  cat <<'WARN'

  ⚠  Ad-hoc signed — no Apple developer identity on this Mac.

     Safari logs "Computing the code signing dictionary failed" and refuses to load
     the extension unless Develop ▸ Allow Unsigned Extensions is on, and that switch
     resets every time Safari launches.

     To be rid of it: Xcode ▸ Settings ▸ Accounts, add your Apple ID (a free personal
     team works), then rebuild with
         DISTILLER_TEAM_ID=<your team id> ./scripts/build-safari.sh --open

     Run ./scripts/diagnose.sh any time the button seems dead.
WARN
fi

echo
echo "Next (order matters — Allow Unsigned Extensions resets on each Safari launch):"
echo "  1. Open the app once — it registers the extension with Safari."
echo "  2. Quit Safari completely (⌘Q) and reopen it."
echo "  3. Safari ▸ Settings ▸ Advanced ▸ 'Show features for web developers',"
echo "     then Develop ▸ Allow Unsigned Extensions."
echo "  4. Safari ▸ Settings ▸ Extensions ▸ tick Distiller."
echo "  5. Click the Distiller toolbar button ▸ 'Always Allow on Every Website'."

if [ "$OPEN_APP" = true ]; then
  open "$APP"
fi
