#!/usr/bin/env bash
#
# Answer "why isn't the button doing anything?" with facts instead of guesses.
#
#   ./scripts/diagnose.sh           one-shot report
#   ./scripts/diagnose.sh --watch   stream Safari's log while you press the button
#
# Safari's own preferences live in a TCC-protected container, so no script can read
# whether the extension is ticked. Everything below is a signal we *can* read.

set -uo pipefail

APP_NAME="Distiller"
EXT_ID="com.jesjohannesen.Distiller.Extension"
APP=""
for candidate in /Applications ~/Applications; do
  [ -d "$candidate/$APP_NAME.app" ] && APP="$candidate/$APP_NAME.app" && break
done

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
note() { printf '    %s\n' "$1"; }

if [ "${1:-}" = "--watch" ]; then
  echo "Streaming Safari's log for $EXT_ID."
  echo "Press the Distiller toolbar button now. Ctrl-C to stop."
  echo "If nothing appears when you press it, Safari has not loaded the extension at all."
  echo
  exec log stream --level debug --style compact \
    --predicate "eventMessage CONTAINS[c] \"distiller\" OR subsystem CONTAINS[c] \"jesjohannesen\" OR (process == \"Safari\" AND eventMessage CONTAINS[c] \"extension\")"
fi

echo
echo "── 1. Is the app installed where Safari can keep finding it? ──"
if [ -z "$APP" ]; then
  bad "No $APP_NAME.app in /Applications or ~/Applications."
  note "Run ./scripts/build-safari.sh — Safari resolves the extension from this path"
  note "every launch, so if the app is gone the extension silently ceases to exist."
else
  ok "$APP"
  case "$APP" in
    "$HOME/Library/Caches"*) bad "This is a purgeable directory. macOS will delete it. Reinstall elsewhere." ;;
  esac
  VERSION=$(plutil -extract version raw \
    "$APP/Contents/PlugIns/$APP_NAME Extension.appex/Contents/Resources/manifest.json" 2>/dev/null)
  [ -n "$VERSION" ] && ok "Extension version $VERSION" || bad "Could not read the bundled manifest.json."
fi

echo
echo "── 2. Has the system registered the app extension? ──"
PK=$(pluginkit -m -A -vvv 2>/dev/null | grep -A1 "$EXT_ID")
if [ -z "$PK" ]; then
  bad "Not registered with the system."
  note "Launch the app once: open \"$APP\""
else
  ok "Registered:"
  echo "$PK" | sed 's/^/    /'
  STATE=$(pluginkit -mAv 2>/dev/null | grep "$EXT_ID" | cut -c1)
  case "$STATE" in
    '+') ok "Marked enabled." ;;
    '-') bad "Marked DISABLED. Tick it in Safari ▸ Settings ▸ Extensions." ;;
    *)   warn "No enable/disable state recorded yet — Safari has never had it switched on." ;;
  esac
fi

echo
echo "── 3. Will Safari accept the signature? ──"
if [ -n "$APP" ]; then
  SIGLINE=$(codesign -dv "$APP" 2>&1 | grep -E '^Signature=' | head -1)
  TEAM=$(codesign -dv "$APP" 2>&1 | grep -E '^TeamIdentifier=' | head -1)
  if echo "$SIGLINE" | grep -q adhoc; then
    warn "Ad-hoc signed ($TEAM)."
    note "Safari refuses ad-hoc signed extensions unless Develop ▸ Allow Unsigned"
    note "Extensions is ON — and that switch resets every time Safari restarts."
    note "Permanent fix: add an Apple ID in Xcode ▸ Settings ▸ Accounts (free is fine),"
    note "then rebuild with DISTILLER_TEAM_ID=<team id> ./scripts/build-safari.sh"
  else
    ok "$SIGLINE / $TEAM"
  fi
  spctl -a -t exec "$APP" >/dev/null 2>&1 \
    && ok "Gatekeeper accepts the app." \
    || warn "Gatekeeper rejects the app — expected without a Developer ID; see above."
fi

echo
echo "── 4. Has Safari actually tried to load it? ──"
# Only Safari's own processes count here. Launch Services and the build system also
# mention the bundle id, and matching those would report a load that never happened.
HITS=$(log show --last 2h --info --debug --style compact \
  --predicate '(process == "Safari" OR process CONTAINS[c] "Distiller Extension" OR process CONTAINS[c] "WebExtension") AND (eventMessage CONTAINS[c] "distiller" OR eventMessage CONTAINS[c] "jesjohannesen")' \
  2>/dev/null | grep -v "^Timestamp" | head -12)
if [ -z "$HITS" ]; then
  bad "Safari has not touched this extension in the last 2 hours."
  note "It has not loaded it, not run its background worker, and not rejected it —"
  note "it simply is not switched on. While this is true, nothing in the extension's"
  note "own code can be the cause of the button doing nothing."
else
  ok "Safari has touched it. Recent entries:"
  echo "$HITS" | cut -c1-160 | sed 's/^/    /'
fi

echo
echo "── 5. Known Safari rejections ──"
SIGFAIL=$(log show --last 2h --info --debug --style compact \
  --predicate 'process == "Safari" AND eventMessage CONTAINS[c] "code signing dictionary"' 2>/dev/null | grep -c jesjohannesen)
if [ "${SIGFAIL:-0}" -gt 0 ]; then
  bad "Safari logged \"Computing the code signing dictionary failed\" ($SIGFAIL times)."
  note "This is Safari refusing the ad-hoc signature outright. It is THE reason the"
  note "extension never appears or never runs. Allow Unsigned Extensions works around"
  note "it per-session; signing with an Apple ID team fixes it for good."
else
  ok "No code-signing rejection logged."
fi

STALE=$(log show --last 2h --info --debug --style compact \
  --predicate 'process == "Safari" AND eventMessage CONTAINS[c] "com.jesjohannesen.distiller/Distiller.app"' 2>/dev/null | grep -c Caches)
if [ "${STALE:-0}" -gt 0 ]; then
  bad "Safari is still referencing the old ~/Library/Caches app path ($STALE times)."
  note "That app was purged by macOS. Quit Safari completely (⌘Q) and reopen it so it"
  note "drops the stale reference and finds the app in /Applications."
fi

echo
echo "── What to do ──"
echo "  Order matters: Allow Unsigned Extensions resets on every Safari launch, so"
echo "  quit FIRST, then switch it on, then enable the extension."
echo
echo "  1. Quit Safari completely (⌘Q), then reopen it."
echo "  2. Safari ▸ Settings ▸ Advanced ▸ tick 'Show features for web developers'."
echo "  3. Develop ▸ Allow Unsigned Extensions."
echo "  4. Safari ▸ Settings ▸ Extensions ▸ tick $APP_NAME."
echo "  5. Click its toolbar button ▸ Always Allow on Every Website."
echo "  6. Re-run this script — sections 2 and 5 should both come back clean."
echo
echo "  To stop doing this dance after every Safari restart, sign it properly:"
echo "    Xcode ▸ Settings ▸ Accounts ▸ add your Apple ID (free personal team is enough)"
echo "    DISTILLER_TEAM_ID=<team id> ./scripts/build-safari.sh --open"
echo
