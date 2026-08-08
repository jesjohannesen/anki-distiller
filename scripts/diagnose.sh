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
  AUTHORITY=$(codesign -dvvv "$APP" 2>&1 | grep -E '^Authority=' | head -1 | cut -d= -f2-)
  if echo "$SIGLINE" | grep -q adhoc; then
    bad "Ad-hoc signed ($TEAM)."
    note "Safari refuses these — it logs \"Computing the code signing dictionary failed\""
    note "— unless Develop ▸ Allow Unsigned Extensions is ON, and that switch resets"
    note "every time Safari restarts."
    note "Fix: find your team id with"
    note "  security find-certificate -a -c 'Apple Development' -p | openssl x509 -noout -subject"
    note "(the OU field is the team id), then rebuild:"
    note "  DISTILLER_TEAM_ID=<team id> ./scripts/build-safari.sh --open"
  else
    ok "Signed as ${AUTHORITY:-unknown} / $TEAM"
    note "A real team identifier is what Safari needs; Allow Unsigned Extensions is"
    note "no longer required."
  fi
  # Gatekeeper judges *distribution*, so an Apple Development signature is rejected
  # by design. That is not what stops Safari, so it is a note, not a failure.
  spctl -a -t exec "$APP" >/dev/null 2>&1 \
    && ok "Gatekeeper accepts the app." \
    || note "Gatekeeper rejects the app: normal for a locally-signed build, and not"
  spctl -a -t exec "$APP" >/dev/null 2>&1 || note "what prevents Safari from loading the extension."
fi

echo
echo "── 4. Has Safari actually tried to load it? ──"
# Only Safari's own processes count. Launch Services and the build system mention the
# bundle id too, and matching those would report a load that never happened.
# Scope to Safari's Extensions subsystem. Without the category filter this drowns in
# sqlite and TCC chatter that merely happens to mention the bundle path.
HITS=$(log show --last 2h --info --debug --style compact \
  --predicate '(subsystem == "com.apple.Safari" AND category == "Extensions") OR process CONTAINS[c] "Distiller Extension"' \
  2>/dev/null | grep -i jesjohannesen | cut -c1-150 | tail -6)
if [ -z "$HITS" ]; then
  warn "Safari has not touched this extension in the last 2 hours."
  note "It has not loaded it, not run its background worker, and not rejected it."
  note "While this is true, nothing in the extension's own code can be the cause."
else
  ok "Safari log entries:"
  echo "$HITS" | sed 's/^/    /'
fi

echo
echo "── 5. Known Safari rejections ──"
# A rejection logged before the currently-installed build is history, not a live
# problem. Compare against the app's mtime so an old failure stops raising alarms.
APP_EPOCH=$([ -n "$APP" ] && stat -f %m "$APP" 2>/dev/null || echo 0)
LAST_SIGFAIL=$(log show --last 6h --info --debug --style compact \
  --predicate 'process == "Safari" AND eventMessage CONTAINS[c] "code signing dictionary failed"' \
  2>/dev/null | grep jesjohannesen | tail -1 | awk '{print $1" "$2}')
if [ -n "$LAST_SIGFAIL" ]; then
  FAIL_EPOCH=$(date -j -f "%Y-%m-%d %H:%M:%S" "${LAST_SIGFAIL%.*}" +%s 2>/dev/null || echo 0)
  if [ "$FAIL_EPOCH" -gt "$APP_EPOCH" ]; then
    bad "Safari rejected the signature at $LAST_SIGFAIL — after the current build."
    note "\"Computing the code signing dictionary failed\" means Safari will not load it."
    note "See section 3."
  else
    ok "Last signature rejection ($LAST_SIGFAIL) predates the installed build — historical."
  fi
else
  ok "No signature rejection logged."
fi

LAST_STALE=$(log show --last 6h --info --debug --style compact \
  --predicate 'process == "Safari" AND eventMessage CONTAINS[c] "com.jesjohannesen.distiller/Distiller.app"' \
  2>/dev/null | grep Caches | tail -1 | awk '{print $1" "$2}')
if [ -n "$LAST_STALE" ]; then
  STALE_EPOCH=$(date -j -f "%Y-%m-%d %H:%M:%S" "${LAST_STALE%.*}" +%s 2>/dev/null || echo 0)
  if [ "$STALE_EPOCH" -gt "$APP_EPOCH" ]; then
    bad "Safari is still resolving the app at the old ~/Library/Caches path."
    note "That copy was purged by macOS. Quit Safari completely (⌘Q) and reopen it."
  else
    ok "Stale ~/Library/Caches references predate the installed build — historical."
    note "Still quit and reopen Safari once so it picks up the app in /Applications."
  fi
fi

echo
echo "── 6. Launch Services records ──"
# Safari resolves the extension through the containing app's LS record. If that record
# points at a copy that no longer exists it logs "Couldn't find LSApplicationRecord"
# and then "Disabling and blocking extension" — and it stays blocked afterwards,
# whatever else is fixed. Rebuilds and Trashed copies each leave a record behind.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister
RECORDS=$("$LSREGISTER" -dump 2>/dev/null | grep -E "^[[:space:]]*path:" | grep "/$APP_NAME.app (" | grep -v appex | sed 's/^[[:space:]]*path:[[:space:]]*//')
COUNT=$(printf '%s\n' "$RECORDS" | grep -c . || true)
if [ "${COUNT:-0}" -le 1 ]; then
  ok "One app record: ${RECORDS:-none}"
else
  bad "$COUNT competing records for $APP_NAME.app — Safari may resolve a dead one:"
  printf '%s\n' "$RECORDS" | sed 's/^/      /'
  note "Purge the ones that are not the install, then re-register:"
  note "  $LSREGISTER -u <stale path>"
  note "  $LSREGISTER -f -R -trusted \"$APP\""
  note "Re-running ./scripts/build-safari.sh does this for you."
fi

BLOCKED=$(/usr/bin/log show --last 1h --info --debug --style compact \
  --predicate 'process == "Safari" AND eventMessage CONTAINS "LSApplicationRecord"' 2>/dev/null | grep -c . || true)
if [ "${BLOCKED:-0}" -gt 0 ]; then
  warn "Safari logged \"Couldn't find LSApplicationRecord\" $BLOCKED times in the last hour."
  note "Each one is followed by Safari disabling and blocking an extension. If any were"
  note "after the current install, re-enable Distiller in Safari ▸ Settings ▸ Extensions."
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
