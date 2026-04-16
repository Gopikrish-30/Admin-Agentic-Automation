# Admin Agentic Automation Architecture

## 1. Purpose and Scope

This document explains how the Admin Agentic Automation system is built and how it executes tasks from user prompt to final result.

It focuses on:

- Overall system architecture
- Component responsibilities
- Tech stack by layer
- Browser automation design (Playwright vs alternatives)
- End-to-end prompt workflow with a concrete example

## 2. High-Level System View

The project is a pnpm monorepo with three major runtime surfaces:

- Desktop app (Electron): primary runtime host for the agent and automation bridge.
- Web client (React): renderer UI used inside desktop and also usable in web dev mode.
- Core runtime package (`@navigator_ai/agent-core`): task orchestration, OpenCode integration, MCP tooling, storage, and browser server orchestration.

At runtime, the architecture follows this flow:

1. User enters a prompt in the renderer UI.
2. Renderer calls a typed bridge API (`navigatorApp`) exposed by Electron preload.
3. Preload forwards requests over Electron IPC to main-process handlers.
4. Main process validates settings, starts/resumes tasks via `TaskManager` from `agent-core`.
5. `TaskManager` launches OpenCode CLI through `OpenCodeAdapter` (PTY process).
6. OpenCode uses configured MCP servers (start-task, complete-task, ask-user-question, dev-browser-mcp, and optional connectors).
7. Task updates, permission requests, todos, and status events stream back to renderer via IPC.
8. Storage persists task history, provider settings, and secure secrets.

## 3. Monorepo Layout and Responsibilities

- `apps/desktop`: Electron main/preload integration, IPC handlers, desktop packaging.
- `apps/web`: React UI pages, stores, execution timeline, provider settings.
- `apps/mock-admin`: local mock admin panel used as deterministic browser automation target.
- `packages/agent-core`: shared runtime engine (task manager, OpenCode adapter, storage, browser orchestration, MCP tools).
- `scripts`: root orchestration scripts for dev/runtime startup.

## 4. Tech Stack

### Frontend and UI

- React 19
- TypeScript
- Vite
- Zustand (state management)
- Tailwind CSS + Radix UI primitives
- Framer Motion for animation
- i18next for localization

### Desktop Runtime

- Electron 35
- Electron preload bridge for secure renderer-to-main API exposure
- Electron Builder for packaging

### Agent and Orchestration

- `@navigator_ai/agent-core` internal classes and factory APIs
- OpenCode CLI integration via pseudo-terminal (`node-pty`)
- MCP server integration via Model Context Protocol SDK

### Storage and Security

- SQLite through `better-sqlite3`
- DB migrations with schema versioning
- Secure credential storage via `SecureStorage`
- WAL mode and foreign-key enforcement enabled in DB initialization

### Browser Automation

- Playwright API, provided through dependency alias:
  - `playwright` -> `rebrowser-playwright`
- Custom local browser control server (`dev-browser`)
- MCP wrapper (`dev-browser-mcp`) exposing browser tools to the agent

## 5. Browser Automation Design Choice

## Is this using browser-use?

No. This codebase does not implement a browser-use SDK flow.

The browser stack is Playwright-based:

- `dev-browser` launches a persistent Chromium/Chrome context and exposes a local HTTP API for page allocation and CDP metadata.
- `dev-browser-mcp` is an MCP server that uses Playwright `Page`/`ElementHandle` types and tool handlers for navigation, clicking, typing, snapshots, tabs, screenshots, etc.
- MCP transport is stdio using `@modelcontextprotocol/sdk`.

## Why this approach

- Full control over browser runtime mode (`builtin`, `remote`, `none`).
- Tight integration with MCP tools already used by OpenCode.
- Shared local loopback model keeps browser control private to local runtime.
- Rebrowser Playwright keeps standard Playwright API ergonomics while using a hardened browser automation stack.

## 6. Core Runtime Components

### 6.1 TaskManager (`agent-core`)

`TaskManager` is the top-level orchestrator for task lifecycle.

Responsibilities:

- Enforce concurrency limits and queue overflow protection.
- Start task execution and map adapter events to application callbacks.
- Handle cancellation and interruption.
- Flush/cleanup message batchers and process queued tasks.

Key behavior:

- If max concurrent tasks reached, tasks enter a queue with `queued` status.
- On completion/error of active task, queue is processed automatically.
- `onBeforeTaskStart` hook is used for pre-flight setup (including browser setup and provider checks).

### 6.2 OpenCodeAdapter

`OpenCodeAdapter` is the process bridge to OpenCode CLI.

Responsibilities:

- Build CLI args and environment.
- Spawn OpenCode in PTY (`node-pty`) for interactive I/O.
- Parse stream output into structured events.
- Watch logs for auth/provider failures and emit normalized errors.
- Emit progress, tool usage, step-finish metrics, completion, and debug events.

### 6.3 Config Generator and MCP Server Registration

OpenCode config generation registers local MCP tools:

- `start-task`
- `complete-task`
- `ask-user-question`
- `dev-browser-mcp` (when browser mode is not `none`)

Optional remote MCP connectors are also attached when configured.

### 6.4 Browser Server Bootstrap

`ensureDevBrowserServer` in `agent-core`:

- Detects available browser runtime (system Chrome or Playwright installation).
- Installs Playwright Chromium when needed.
- Starts detached `dev-browser` server process.
- Waits for readiness on loopback port and returns startup result/logs.

## 7. Renderer and IPC Interaction Model

### 7.1 Renderer state (`apps/web`)

`useTaskStore` manages:

- Current task and task list
- Message stream and batched message updates
- Startup/progress indicators
- Permission dialog state
- Follow-up and interrupt actions
- Todo state per task

### 7.2 Bridge and IPC

- Renderer uses `navigatorApp` API (from preload) rather than direct Node access.
- Preload exposes typed methods/events for task operations and settings.
- Desktop main handlers execute privileged operations and return results.

Common channels include:

- Start task
- Resume session / follow-up
- Interrupt/cancel task
- Provider settings read/write
- Permission response
- Task updates/status/debug/todo events

## 8. Local Runtime APIs for Human-in-the-Loop

Desktop starts local loopback HTTP servers for tool-to-UI communication:

- Permission API
  - Receives file permission requests.
  - Emits permission dialogs to renderer.
  - Resolves allow/deny back to tool caller.

- Question API
  - Receives clarifying-question requests.
  - Sends question prompts/options to renderer.
  - Returns user selection/text back to tool caller.

- Thought Stream API
  - Receives thought/checkpoint events for active tasks.
  - Forwards events to renderer for live reasoning/checkpoint display.

Security model:

- Bound to `127.0.0.1`.
- Supports local auth header token (`LOCAL_API_AUTH_TOKEN`) when configured.

## 9. Data and Persistence

Data is split across SQL and secure key storage:

- Task history, messages, statuses, summaries, todos: SQLite tables/repositories.
- App settings and provider settings: repository APIs over SQLite.
- API keys, connector tokens, client secrets: secure storage abstraction.

Migration behavior:

- Schema version checked on init.
- New migrations applied automatically.
- Future-schema mismatch throws defensive error.

## 10. End-to-End Prompt Workflow (Step-by-Step)

This section describes the complete execution path for a user prompt.

### Step 1: User submits prompt

On Home page, user enters a request (example: "Reset John Carter password and upgrade license to Pro").

### Step 2: Renderer pre-checks

Frontend verifies provider readiness and selected model context.
If provider config is missing, it opens settings instead of starting a task.

### Step 3: Renderer calls bridge

`useTaskStore.startTask` invokes the preload-exposed API through `navigatorApp`.

### Step 4: Main process receives `task:start`

Desktop IPC handler:

- Validates request payload.
- Resolves provider/model settings from storage.
- Creates task callbacks for streaming updates.
- Calls `TaskManager.startTask(...)`.

### Step 5: Pre-flight setup

Before task execution, runtime hooks may:

- Ensure browser server is available when browser mode is enabled.
- Register active task for thought/checkpoint stream validation.
- Emit setup progress back to renderer.

### Step 6: OpenCode session starts

`OpenCodeAdapter` spawns OpenCode CLI in PTY and starts parsing output.

It emits:

- Progress stages
- Structured messages
- Tool activity
- Permission/question requests
- Completion/error status

### Step 7: MCP tools execute actions

OpenCode uses configured MCP tools, for example:

- `start_task` to declare plan
- Browser tools via `dev-browser-mcp` for navigation/form actions
- `AskUserQuestion` when clarification is needed
- `complete-task` to finalize task state

### Step 8: Browser execution path

When browser tools are called:

1. `dev-browser-mcp` connects to active browser context.
2. It gets/creates pages through `dev-browser` page registry.
3. Playwright actions execute against selected page/tab.
4. Tool results and snapshots are returned to OpenCode.

### Step 9: Event streaming to UI

Task callbacks in desktop forward events via IPC:

- `task:update` / batched updates
- `task:status-change`
- `permission:request`
- `task:todo-update`
- debug and auth error events

`ExecutionPage` listens to these and updates timeline, tool progress, and dialogs in real time.

### Step 10: Human-in-the-loop decisions

If a tool needs user approval or answer:

1. MCP tool posts to local Permission/Question API.
2. Desktop emits request to renderer dialog.
3. User responds in UI.
4. Desktop resolves pending promise and returns response to tool process.

### Step 11: Completion and persistence

On task completion/error/interruption:

- Final status is persisted.
- Session ID is stored for follow-ups.
- Queue processing starts next pending task (if any).
- Task is unregistered from thought stream tracking.

### Step 12: Follow-up prompts

For completed/interrupted tasks with session context, user sends follow-up from Execution page.
Desktop resumes session through `session:resume` flow and repeats the same event pipeline.

## 11. Example Prompt Walkthrough

Prompt:

"Open the mock admin panel, find john@company.com, reset the password, then change the license to pro."

Execution outline:

1. Task starts from Home page and moves to Execution page.
2. Runtime ensures browser server availability.
3. OpenCode calls `start_task` (plan registration).
4. OpenCode uses browser MCP tools to navigate and locate the user row.
5. It triggers reset-password action and updates license.
6. If ambiguous account match appears, `AskUserQuestion` is invoked.
7. UI shows streamed tool actions and final assistant summary.
8. Task is marked completed and session is saved for follow-up.

## 12. Reliability and Safety Characteristics

- Concurrency controls with active-task cap and queue.
- Loopback-only local APIs for sensitive user-approval flows.
- Optional local auth token for API hardening.
- Structured interruption/cancel handling and pending-request denial.
- Graceful browser server startup with retries and readiness checks.
- Persistent storage plus secure secrets handling.

## 13. Development and Runtime Notes

- Root `pnpm dev` orchestrates web and desktop dev flows.
- In mock-admin-only mode, mock admin server is started/verified before desktop runtime.
- Desktop dev script validates native modules and applies platform-specific rebuild behavior.

## 14. Summary

This system is a desktop-first, agentic automation runtime that combines:

- React/Electron UI for operator control,
- an OpenCode-driven task engine,
- MCP-based tool ecosystem,
- and Playwright-powered browser automation.

The prompt lifecycle is fully event-driven, stateful, and designed for human-in-the-loop operation with persistent history and resumable sessions.