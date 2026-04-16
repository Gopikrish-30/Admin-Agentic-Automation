#!/bin/bash
# Run desktop app with LOCAL UI (Vite hot reload) + PRODUCTION API
# UI: localhost:5173 | API: lite.navigator.app
NAVIGATOR_UI_URL=http://localhost:3000 NAVIGATOR_API_URL=https://lite.navigator.app pnpm dev
