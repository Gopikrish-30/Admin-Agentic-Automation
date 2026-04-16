#!/bin/bash
# Run desktop app with PRODUCTION UI + PRODUCTION API
# UI: lite.navigator.app | API: lite.navigator.app
# This builds an unpacked app and runs it (no hot reload)

set -e

echo "Building unpacked app for production..."
pnpm -F @navigator/desktop build:unpack

echo "Launching app with production configuration..."
NAVIGATOR_UI_URL=https://lite.navigator.app \
NAVIGATOR_API_URL=https://lite.navigator.app \
open apps/desktop/release/mac-arm64/Admin.app
