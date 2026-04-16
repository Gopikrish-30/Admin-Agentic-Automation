#!/bin/bash
# Clean all files related to DMG/production installations of Admin
# This removes app data, preferences, caches, and optionally the app itself
# Useful for testing fresh installs or complete uninstallation

set -e

echo "=== ACCOMPLISH DMG INSTALLATION CLEANUP ==="
echo ""

# Parse arguments
REMOVE_APP=false
FORCE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --remove-app)
      REMOVE_APP=true
      shift
      ;;
    --force|-f)
      FORCE=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --remove-app    Also remove the application from /Applications"
      echo "  --force, -f     Skip confirmation prompts"
      echo "  --help, -h      Show this help message"
      echo ""
      echo "This script cleans up all user data, caches, and preferences"
      echo "for Admin production (DMG) installations."
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Confirm unless --force is used
if [ "$FORCE" != true ]; then
  echo "This will remove all Admin user data including:"
  echo "  - App settings and task history"
  echo "  - Cached data and logs"
  echo "  - Keychain credentials"
  if [ "$REMOVE_APP" = true ]; then
    echo "  - The Admin application itself"
  fi
  echo ""
  read -p "Are you sure you want to continue? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

echo ""

# Kill any running instances
echo "Stopping any running Admin processes..."
pkill -f "Admin" 2>/dev/null || true
pkill -f "Admin Lite" 2>/dev/null || true
sleep 1

# Application Support directories (electron-store data)
echo "Clearing Application Support data..."
APP_SUPPORT_DIRS=(
  "$HOME/Library/Application Support/Admin"
  "$HOME/Library/Application Support/Admin Lite"
  "$HOME/Library/Application Support/com.navigator.desktop"
  "$HOME/Library/Application Support/com.navigatorApp.lite"
  "$HOME/Library/Application Support/ai.navigator.desktop"
  "$HOME/Library/Application Support/ai.navigatorApp.lite"
  "$HOME/Library/Application Support/@navigator/desktop"
)

for dir in "${APP_SUPPORT_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    rm -rf "$dir"
    echo "  - Removed: $dir"
  fi
done

# Preferences (plist files)
echo "Clearing preferences..."
PLIST_FILES=(
  "$HOME/Library/Preferences/com.navigator.desktop.plist"
  "$HOME/Library/Preferences/com.navigatorApp.lite.plist"
  "$HOME/Library/Preferences/com.navigatorApp.app.plist"
  "$HOME/Library/Preferences/ai.navigator.desktop.plist"
  "$HOME/Library/Preferences/ai.navigatorApp.lite.plist"
)

for plist in "${PLIST_FILES[@]}"; do
  if [ -f "$plist" ]; then
    rm -f "$plist"
    echo "  - Removed: $plist"
  fi
done

# Caches
echo "Clearing caches..."
CACHE_DIRS=(
  "$HOME/Library/Caches/Admin"
  "$HOME/Library/Caches/Admin Lite"
  "$HOME/Library/Caches/com.navigator.desktop"
  "$HOME/Library/Caches/com.navigatorApp.lite"
  "$HOME/Library/Caches/ai.navigator.desktop"
  "$HOME/Library/Caches/ai.navigatorApp.lite"
  "$HOME/Library/Caches/@navigator/desktop"
)

for dir in "${CACHE_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    rm -rf "$dir"
    echo "  - Removed: $dir"
  fi
done

# Logs
echo "Clearing logs..."
LOG_DIRS=(
  "$HOME/Library/Logs/Admin"
  "$HOME/Library/Logs/Admin Lite"
  "$HOME/Library/Logs/ai.navigator.desktop"
  "$HOME/Library/Logs/ai.navigatorApp.lite"
  "$HOME/Library/Logs/@navigator/desktop"
)

for dir in "${LOG_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    rm -rf "$dir"
    echo "  - Removed: $dir"
  fi
done

# Saved Application State
echo "Clearing saved application state..."
SAVED_STATE_DIRS=(
  "$HOME/Library/Saved Application State/com.navigator.desktop.savedState"
  "$HOME/Library/Saved Application State/com.navigatorApp.lite.savedState"
  "$HOME/Library/Saved Application State/ai.navigator.desktop.savedState"
  "$HOME/Library/Saved Application State/ai.navigatorApp.lite.savedState"
)

for dir in "${SAVED_STATE_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    rm -rf "$dir"
    echo "  - Removed: $dir"
  fi
done

# Keychain entries
echo "Clearing keychain entries..."
KEYCHAIN_SERVICES=(
  "Admin"
  "Admin Lite"
  "com.navigator.desktop"
  "com.navigatorApp.lite"
  "ai.navigator.desktop"
  "ai.navigatorApp.lite"
  "@navigator/desktop"
)
KEYCHAIN_KEYS=("accessToken" "refreshToken" "userId" "tokenExpiresAt" "tokenIntegrity" "deviceSecret")

for service in "${KEYCHAIN_SERVICES[@]}"; do
  for key in "${KEYCHAIN_KEYS[@]}"; do
    if security delete-generic-password -s "$service" -a "$key" 2>/dev/null; then
      echo "  - Removed keychain: $service/$key"
    fi
  done
done

# Also try to delete any remaining keychain items by service name
for service in "${KEYCHAIN_SERVICES[@]}"; do
  # Try to delete all items for this service (may need multiple attempts)
  for _ in {1..10}; do
    if ! security delete-generic-password -s "$service" 2>/dev/null; then
      break
    fi
    echo "  - Removed additional keychain item for: $service"
  done
done

# Remove application if requested
if [ "$REMOVE_APP" = true ]; then
  echo "Removing application..."
  APP_PATHS=(
    "/Applications/Admin.app"
    "/Applications/Admin Lite.app"
    "$HOME/Applications/Admin.app"
    "$HOME/Applications/Admin Lite.app"
  )

  for app in "${APP_PATHS[@]}"; do
    if [ -d "$app" ]; then
      rm -rf "$app"
      echo "  - Removed: $app"
    fi
  done
fi

# Clear quarantine attributes if we're keeping the app
if [ "$REMOVE_APP" != true ]; then
  echo "Clearing quarantine attributes (if app exists)..."
  for app in "/Applications/Admin.app" "/Applications/Admin Lite.app"; do
    if [ -d "$app" ]; then
      xattr -rd com.apple.quarantine "$app" 2>/dev/null && echo "  - Cleared quarantine: $app" || true
    fi
  done
fi

echo ""
echo "=== CLEANUP COMPLETE ==="
echo ""

if [ "$REMOVE_APP" = true ]; then
  echo "All Admin data and applications have been removed."
  echo "You can reinstall from the DMG file."
else
  echo "All Admin user data has been cleared."
  echo "The app will behave like a fresh installation on next launch."
fi
