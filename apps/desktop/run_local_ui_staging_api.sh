#!/bin/bash
# Run desktop app with LOCAL UI (Vite hot reload) + STAGING API
# UI: localhost:5173 | API: lite-staging.navigator.app
NAVIGATOR_UI_URL=http://localhost:3000 NAVIGATOR_API_URL=https://lite-staging.navigator.app pnpm dev
