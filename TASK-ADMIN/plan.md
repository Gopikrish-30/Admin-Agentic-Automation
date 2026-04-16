# Implementation Plan (TASK-ADMIN)

## Scope Guardrail
All development is restricted to TASK-ADMIN only. No changes are made outside this folder.

## Phase 1: Foundation
- Create Python project structure for admin_panel, agent, chat, tests.
- Add requirements, .env example, run entrypoints.

## Phase 2: Mock IT Admin Panel
- Build Flask + SQLite panel with routes:
  - GET /
  - GET /users
  - POST /users/create
  - POST /users/<id>/reset-password
  - POST /users/<id>/toggle-status
  - POST /users/<id>/assign-license
  - GET /audit
- Seed initial users and license products.
- Add visible labels/buttons to support reliable browser automation.
- Log every mutation to audit_log.

## Phase 3: Browser Agent
- Implement observe-think-act loop:
  - Screenshot current page
  - Ask OpenAI model for one JSON action
  - Execute with Playwright using visible text/labels
  - Repeat until done or max steps
- Supported actions: navigate, click, type, select, wait, done.
- Add retries/fallback and bounded time/step limits.

## Phase 4: Chat Trigger
- Build local Flask chat UI.
- POST /run-task starts background agent thread.
- GET /task-stream/<id> streams events via SSE.

## Phase 5: Validation
- Unit/integration tests for routes, parsing, and baseline flow.
- Demo commands and README runbook.

## Deferred (later)
- Real SaaS admin panel automation.
- Slack/MS Teams integration.
- Cloud deployment.
