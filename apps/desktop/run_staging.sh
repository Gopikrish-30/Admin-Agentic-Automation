#!/bin/bash
# Run desktop app with STAGING UI + STAGING API
# UI: lite-staging.navigator.app | API: lite-staging.navigator.app
# This builds an unpacked app and runs it (no hot reload)

set -e

echo "Building unpacked app for staging..."
pnpm -F @navigator/desktop build:unpack

echo "Launching app with staging configuration..."
NAVIGATOR_UI_URL=https://lite-staging.navigator.app \
NAVIGATOR_API_URL=https://lite-staging.navigator.app \
open apps/desktop/release/mac-arm64/Admin.app
