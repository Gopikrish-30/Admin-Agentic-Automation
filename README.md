# Admin Agentic Automation

**Admin Agentic Automation** is a desktop-first, AI-powered automation platform that lets you describe administrative tasks in plain language and watches an intelligent agent carry them out — navigating real browser interfaces, filling forms, managing records, and reporting back in real time.

It is built as a pnpm monorepo combining an Electron desktop runtime, a React web UI, a shared agent-core package, and a mock admin panel used as a local automation target for development and testing.

---

## Table of Contents

- [What This Project Is](#what-this-project-is)
- [How It Works](#how-it-works)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Browser Automation](#browser-automation)
- [AI Providers](#ai-providers)
- [Workspace Structure](#workspace-structure)
- [Requirements](#requirements)
- [Install](#install)
- [Run Locally](#run-locally)
- [Build and Validate](#build-and-validate)
- [Deployment Model](#deployment-model)
- [License](#license)

---

## What This Project Is

Admin Agentic Automation is an **agentic desktop application** — an AI coworker that lives on your desktop and handles repetitive administrative tasks for you.

You type a natural-language request such as:

> "Open the admin panel, find john@company.com, reset his password, and upgrade his license to Pro."

The agent plans the task, opens a browser, navigates to the correct pages, performs the actions, and streams a live execution timeline back to you — including every tool call, decision, and result. If it needs a clarification, it stops and asks. If it needs your approval for a sensitive action, it waits for your response before proceeding.

**Key capabilities:**

- Natural-language task execution against real web admin interfaces
- Persistent browser context (your actual Chrome profile or Playwright Chromium)
- Human-in-the-loop: the agent asks questions and waits for permission when needed
- Resumable sessions — follow up on completed tasks without losing context
- Support for 15+ AI providers with automatic model selection
- Fully local operation — the browser, agent runtime, and APIs run on your machine

---

## How It Works

### End-to-end flow

```
User types a prompt
        │
        ▼
React UI (apps/web)
  └─ useTaskStore calls bridge API
        │
        ▼
Electron preload bridge (navigatorApp)
  └─ forwards over Electron IPC
        │
        ▼
Electron main process (apps/desktop)
  └─ validates settings, resolves provider/model
  └─ calls TaskManager.startTask(...)
        │
        ▼
TaskManager (packages/agent-core)
  └─ enforces concurrency limits & queue
  └─ creates OpenCodeAdapter
        │
        ▼
OpenCodeAdapter
  └─ spawns OpenCode CLI in PTY (node-pty)
  └─ builds CLI args and environment
  └─ parses streaming output into events
        │
        ▼
OpenCode CLI
  └─ uses registered MCP tool servers:
       • start-task        (task plan registration)
       • complete-task     (task finalization)
       • ask-user-question (clarifications → UI)
       • dev-browser-mcp   (browser automation)
        │
        ▼
dev-browser-mcp (MCP server)
  └─ connects to dev-browser HTTP API
  └─ allocates/retrieves named browser pages
  └─ runs Playwright actions: navigate, click, type, snapshot, screenshot
        │
        ▼
dev-browser (local browser control server)
  └─ manages persistent Chromium/Chrome context
  └─ exposes CDP over loopback HTTP/WebSocket
        │
        ▼
Events stream back to UI via Electron IPC:
  task:update, task:status-change,
  permission:request, task:todo-update, debug events
        │
        ▼
React ExecutionPage renders live timeline
```

### Human-in-the-loop

When the agent needs a decision from you it calls one of two local loopback HTTP servers that the desktop starts at runtime:

| Server | Purpose |
|---|---|
| **Permission API** | File/action permission requests — the desktop shows an approval dialog and returns allow/deny to the tool process |
| **Question API** | Clarifying questions — the UI shows the question with options or a free-text field; the user's answer is sent back to the tool |

Both servers bind to `127.0.0.1` only and support an optional local auth token for hardening.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  apps/desktop  (Electron)                                           │
│  ┌────────────┐  IPC  ┌─────────────────────────────────────────┐  │
│  │  Renderer  │◄─────►│  Main Process                           │  │
│  │ (apps/web) │       │  IPC handlers, TaskManager, services    │  │
│  └────────────┘       │  Permission API, Question API           │  │
│                       │  Thought Stream API, SecureStorage      │  │
│                       └────────────────┬────────────────────────┘  │
└────────────────────────────────────────┼────────────────────────────┘
                                         │
                          packages/agent-core
                    ┌────────────────────┼────────────────────────┐
                    │                    │                         │
             TaskManager         OpenCodeAdapter            BrowserServer
           concurrency &          PTY process              Playwright +
           queue mgmt             stream parser            Chrome CDP
                    │
              MCP Tool Servers (stdio)
          ┌─────────┬──────────┬──────────────┐
      start-task  complete  ask-user-question  dev-browser-mcp
                                                    │
                                             dev-browser
                                      (persistent browser context)
                                                    │
                                        apps/mock-admin
                                     (local automation target)
```

### Component responsibilities

| Component | Responsibility |
|---|---|
| `apps/web` | React UI — task input, execution timeline, provider settings, permission dialogs |
| `apps/desktop` | Electron main/preload — IPC routing, privilege layer, local API servers, packaging |
| `apps/mock-admin` | Express server serving a simulated admin panel (user records, licenses, audit log) used as a local browser automation target |
| `packages/agent-core` | Shared runtime: TaskManager, OpenCodeAdapter, browser orchestration, MCP tools, storage, provider configs |

---

## Tech Stack

### Frontend & UI

| Technology | Role |
|---|---|
| **React 19** | Component model and rendering |
| **TypeScript** | Type safety across all packages |
| **Vite** | Dev server and bundler for web |
| **Zustand** | Lightweight client state management |
| **Tailwind CSS** | Utility-first styling |
| **Radix UI** | Accessible primitive components |
| **Framer Motion** | Animations and transitions |
| **i18next** | Internationalisation / localization |

### Desktop Runtime

| Technology | Role |
|---|---|
| **Electron 35** | Desktop shell, native APIs, IPC bridge |
| **Electron preload** | Secure context-isolated bridge API (`navigatorApp`) |
| **Electron Builder** | Cross-platform packaging (macOS, Windows, Linux) |
| **node-pty** | PTY (pseudo-terminal) for spawning interactive CLI processes |

### Agent & Orchestration

| Technology | Role |
|---|---|
| **OpenCode CLI** | AI task engine — multi-step reasoning, tool calling |
| **MCP SDK** (`@modelcontextprotocol/sdk`) | Tool transport protocol (stdio) |
| **Custom MCP servers** | start-task, complete-task, ask-user-question, dev-browser-mcp |

### Storage & Security

| Technology | Role |
|---|---|
| **SQLite** (`better-sqlite3`) | Task history, messages, settings, todos |
| **DB migrations** | Automatic schema versioning and forward migration |
| **SecureStorage** | Encrypted credential storage for API keys and tokens |

### Code Quality

| Tool | Role |
|---|---|
| **ESLint** | Linting (TypeScript + React rules) |
| **Prettier** | Code formatting |
| **Husky + lint-staged** | Pre-commit hooks |
| **TypeScript** | Strict type checking across all packages |

---

## Browser Automation

### Design

Admin Agentic Automation uses a **custom Playwright-based browser stack** — not a browser-use SDK or any third-party browser automation service.

The browser stack has two layers:

#### 1. `dev-browser` — the browser control server

A standalone HTTP/WebSocket server (`packages/agent-core/mcp-tools/dev-browser`) that:

- Launches a **persistent Chromium browser context** using your existing Chrome profile or falls back to a Playwright-managed Chromium installation
- Exposes a loopback REST API for page allocation (`POST /pages`, `GET /pages`, `DELETE /pages/:name`)
- Provides the CDP WebSocket endpoint (`ws://127.0.0.1:9224/cdp`) so Playwright can drive individual tabs
- Runs as a **detached background process** — survives the parent process and is re-used across tasks
- Has an optional **extension relay mode** (`relay.ts`) for bridging a browser extension's CDP connection to Playwright clients over WebSocket

Startup sequence:

```
ensureDevBrowserServer()
  ├─ isSystemChromeInstalled() → use system Chrome with --remote-debugging-port
  ├─ isPlaywrightInstalled()   → use Playwright Chromium
  └─ (neither)                 → download Playwright Chromium (one-time, ~2 min)
        │
  startDevBrowserServer()
  └─ spawn detached node process running server.cjs
  └─ waitForDevBrowserServer() — polls loopback port with 15s timeout
```

#### 2. `dev-browser-mcp` — the MCP tool server

An MCP server (`packages/agent-core/mcp-tools/dev-browser-mcp`) that:

- Connects to the active `dev-browser` control server
- Exposes browser actions as MCP tools that OpenCode can call:
  - `navigate` — load a URL in a named tab
  - `click` — click elements by selector or accessibility snapshot
  - `type` — fill inputs and text areas
  - `snapshot` — capture an accessibility tree snapshot for AI reasoning
  - `screenshot` — capture a screenshot and return it to the agent
  - `tab management` — open, close, and switch between named browser tabs
- Uses **rebrowser-playwright** (a drop-in Playwright replacement with automation-hardened Chromium behavior) to keep the standard Playwright API while reducing bot-detection triggers

### Why this approach

- **Full local control** — the browser runs on your machine; no external service sees your session
- **Persistent profile** — the agent uses your real Chrome cookies and logged-in sessions
- **Tight MCP integration** — browser tools are first-class MCP tools, consistent with all other agent tooling
- **Configurable runtime modes** — `builtin` (local Playwright), `remote` (connect to existing CDP endpoint), or `none` (disable browser)

---

## AI Providers

The agent supports **15+ AI providers** out of the box. Provider settings and API keys are stored securely and never leave your machine.

| Provider | Models |
|---|---|
| **Anthropic** | Claude Opus, Sonnet, Haiku |
| **OpenAI** | GPT-5, GPT-4.1, o3, o4 series |
| **Google AI** | Gemini 3 Pro, Flash |
| **xAI** | Grok 4, Grok 3 |
| **DeepSeek** | DeepSeek Chat, Coder |
| **Moonshot AI** | Kimi K2 |
| **Amazon Bedrock** | All supported foundation models |
| **Google Vertex AI** | Gemini on Vertex |
| **Groq** | Llama 3.3 70B, others |
| **MiniMax** | M2, M2.1, M2.5 |
| **Z.AI** | GLM series |
| **OpenRouter** | Any model via OpenRouter |
| **Ollama** | Local models |
| **LM Studio** | Local models |
| **Azure AI Foundry** | Azure-hosted deployments |
| **LiteLLM** | Any LiteLLM-compatible gateway |

Providers that offer a models endpoint are queried dynamically at runtime so the model list stays current without a code update.

---

## Workspace Structure

```
.
├── apps/
│   ├── desktop/          # Electron app — main process, preload, IPC, packaging
│   ├── web/              # React + Vite frontend — UI pages, stores, components
│   └── mock-admin/       # Express mock admin panel (browser automation target)
├── packages/
│   └── agent-core/       # Shared runtime engine
│       ├── src/
│       │   ├── browser/          # Browser server detection & lifecycle
│       │   ├── internal/classes/ # TaskManager, OpenCodeAdapter, services
│       │   ├── opencode/         # CLI config generation, message processing
│       │   ├── providers/        # Provider configs and model resolution
│       │   ├── storage/          # SQLite DB, migrations, repositories
│       │   ├── connectors/       # MCP OAuth connector support
│       │   └── services/         # Permission handler, speech, summarizer
│       └── mcp-tools/
│           ├── dev-browser/      # Browser control HTTP server (Playwright)
│           ├── dev-browser-mcp/  # MCP server wrapping browser tools
│           ├── start-task/       # MCP tool: task plan registration
│           ├── complete-task/    # MCP tool: task finalization
│           └── ask-user-question/ # MCP tool: human-in-the-loop questions
├── docs/
│   └── architecture.md   # Detailed architecture reference
├── scripts/              # Workspace dev/runtime orchestration scripts
├── package.json          # Root workspace config and scripts
└── pnpm-workspace.yaml   # pnpm workspace definition
```

---

## Requirements

- **Node.js** 20 or newer
- **pnpm** 9 or newer

> On first run the app will automatically download Playwright Chromium (~150 MB) if Google Chrome is not installed on your system.

---

## Install

```bash
pnpm install
```

---

## Run Locally

Start the full development workflow (web + desktop + mock admin):

```bash
pnpm dev
```

Start only the web client (browser dev mode, no Electron):

```bash
pnpm dev:web
```

Start only the mock admin panel:

```bash
pnpm dev:mock-admin
```

Start with a clean build first:

```bash
pnpm dev:clean
```

---

## Build and Validate

Type-check all workspace packages:

```bash
pnpm typecheck
```

Lint and type-check:

```bash
pnpm lint
```

Format code:

```bash
pnpm format
```

Build all workspace packages:

```bash
pnpm build
```

Build only the web client:

```bash
pnpm build:web
```

Build only the desktop app:

```bash
pnpm build:desktop
```

---

## Deployment Model

### Desktop (default)

The full agent runtime runs inside the Electron desktop app. This is the primary supported mode — all local APIs, browser orchestration, and secure storage are managed by the desktop process.

### Web-only (partial)

The `apps/web` React client can be deployed to a static host independently. In this mode the UI is available but task execution requires a separately running backend runtime that exposes the same IPC-equivalent HTTP/WebSocket API.

### Cloud / server (advanced)

To run the agent runtime in a cloud environment:

1. Extract the runtime from `apps/desktop` into a standalone Node.js service
2. Replace Electron IPC with HTTP or WebSocket transport
3. Connect `apps/web` to the remote service endpoint
4. Configure browser automation to use a remote CDP endpoint or a headless Chromium instance

The local loopback servers (Permission API, Question API) would need to become real HTTP endpoints with appropriate authentication when deployed remotely.

---

## License

MIT
