| 🤖IT SUPPORT AI AGENTDecawork Engineering AssignmentComplete Project Plan & Implementation StrategyApril 2026 |
| --- |
| 1. PROJECT OVERVIEW |
| --- |

## What We Are Building

An end-to-end IT Support AI Agent system that accepts natural-language commands (e.g. "reset password for john@company.com") and autonomously navigates a web-based mock IT admin panel to complete the task — exactly as a human IT administrator would, using mouse clicks, form inputs, and page navigation.

## The Three Core Components

| Component | What It Is | Technology |
| --- | --- | --- |
| Mock IT Admin Panel | A browser-rendered web app that simulates a real IT admin tool with user management, password reset, and license features | Python + Flask + SQLite |
| AI Browser Agent | An autonomous agent that reads the screen via screenshots and interacts with the panel using real browser actions — no DOM shortcuts | Python + Playwright + Claude claude-sonnet-4-5 |
| Chat Trigger Interface | A minimal terminal/web chat interface to submit natural language IT tasks and watch them execute in real time | Python + Rich CLI (or Flask chat UI) |

## What This Is NOT

*   Not built on top of Navigator / NeoVerse-26 — this is a fresh standalone Python project
*   Not using direct DOM selectors, APIs, or shortcuts — the agent navigates like a real human
*   Not an Electron or TypeScript project — pure Python for the agent and panel
*   Not a UI beautification exercise — the admin panel is functional, not pretty

## What We Reuse from Navigator

While this is built from scratch, we draw architectural inspiration from Navigator:

*   The screenshot-observe-act loop pattern (Navigator's Playwright browser module)
*   The streaming task status / thought events concept (adapted as terminal output)
*   The idea of a task lifecycle with discrete states: pending → running → success/failed

| 2. GOALS & SUCCESS CRITERIA |
| --- |

## Primary Goals

1.  Agent completes at least 2 distinct IT tasks end-to-end without human intervention
2.  All interactions happen through the real browser UI — no API shortcuts
3.  Natural language input is correctly interpreted into concrete browser actions
4.  The full flow is recordable as a 2-minute Loom demo
5.  Code is clean, well-commented, and easy to understand for engineering reviewers

## Bonus Goals (Target to Achieve)

*   Multi-step conditional logic: "Check if user exists, if not create them, then assign a license"
*   Agent chat triggered from a simple web UI (not just terminal)
*   Deployable to a cloud VM or Railway for remote access

## Success Criteria for Loom Demo

| Criteria | Definition |
| --- | --- |
| Task 1 Completes | Agent resets password for a user — navigates to user, fills form, submits |
| Task 2 Completes | Agent creates a new user — fills multi-field form, confirms creation |
| Bonus Task Completes | Agent checks user existence, creates if missing, then assigns license |
| Architecture Walkthrough | Narrator explains the 3-layer system in under 60 seconds |
| 3. TECH STACK — FULL BREAKDOWN |
| --- |

## What We Use (and Why)

### A. Mock IT Admin Panel

| Technology | Purpose | Why This Choice |
| --- | --- | --- |
| Python 3.11+ | Language | Task requirement, best agent ecosystem |
| Flask 3.x | Web framework for admin panel | Minimal setup, fast to build 3 pages, no overhead |
| SQLite + sqlite3 | Mock user/license database | Zero config, file-based, perfect for mock data |
| Jinja2 | HTML templating | Ships with Flask, renders server-side HTML forms |
| Plain HTML/CSS | Admin panel UI | Functional over beautiful; easy to interact with via browser agent |
| WTForms (optional) | Form validation | Adds CSRF and validation to forms without complexity |

### B. AI Browser Agent

| Technology | Purpose | Why This Choice |
| --- | --- | --- |
| Playwright (Python) | Browser automation engine | Real browser, real interactions, screenshot capture, cross-platform |
| Anthropic Python SDK | Call Claude claude-sonnet-4-5 | Computer use + vision + function calling support |
| Claude claude-sonnet-4-5 | The LLM brain | Best-in-class for computer use tasks, Decawork's stack |
| Pillow / base64 | Screenshot encoding | Required to send screenshots to Claude Vision API |
| asyncio | Async task execution | Non-blocking agent loops |
| Rich (Python) | Terminal output styling | Pretty real-time task logs in the demo |

### C. Chat Interface (Bonus)

| Technology | Purpose | Why This Choice |
| --- | --- | --- |
| Flask + SSE | Web chat UI | Server-Sent Events streams agent progress to browser |
| Vanilla JS | Frontend chat | No build step needed; lightweight for a demo |

## What We DO NOT Use (and Why)

| Technology | Why Excluded | Alternative Used |
| --- | --- | --- |
| Electron / Node.js | This is a Python assignment; Navigator is TS/Node | Python + Flask |
| Direct DOM selectors in agent | Violates the 'no API shortcuts' rule | Claude Vision reads screenshots |
| Selenium | Outdated; slower than Playwright; less reliable | Playwright |
| LangChain / AutoGPT | Heavy abstraction; obscures clarity of thought | Raw Anthropic SDK + custom loop |
| FastAPI (for admin panel) | More complex than needed for 3 pages | Flask is simpler for this scope |
| React / Next.js | Overkill for a mock admin panel | Jinja2 server-rendered HTML |
| OpenAI CUA | We're using Anthropic's stack | Claude claude-sonnet-4-5 with computer use |
| browser-use library | Adds abstraction; we want direct control to demonstrate clarity | Raw Playwright + Claude Vision loop |
| Docker (for demo) | Adds complexity to local demo setup | Direct Python execution |
| 4. SYSTEM ARCHITECTURE |
| --- |

## High-Level Architecture

| User Input (natural language) → Chat Interface → AI Agent Brain → Playwright Browser → Mock Admin Panel → Result |
| --- |

## Component Diagram (Described)

The system has three layers that communicate in sequence:

### Layer 1 — Mock IT Admin Panel (Flask App)

*   Runs on http://localhost:5000
*   Three pages: Dashboard, User Management, Audit Log
*   Backed by SQLite with tables: users, licenses, audit\_log
*   Exposes real HTML form-based pages (not a REST API — the agent uses the browser UI)
*   Has visible feedback: success/error banners, updated table rows after actions

### Layer 2 — AI Agent Brain (Python)

*   Receives a natural language task string
*   Opens a Playwright Chromium browser, navigates to http://localhost:5000
*   Runs an observe → think → act loop:
    *   OBSERVE: Takes a full-page screenshot
    *   THINK: Sends screenshot + task + history to Claude claude-sonnet-4-5 Vision API
    *   ACT: Parses Claude's response for actions (click, type, navigate, done)
    *   Executes actions via Playwright, then loops back to OBSERVE
*   Terminates when Claude signals DONE or max iterations reached
*   Streams step-by-step logs to the chat interface via SSE

### Layer 3 — Chat Interface (Flask SSE endpoint)

*   Minimal web page with a text input and a scrollable log window
*   User types: "Reset password for john@company.com to Welcome@123"
*   POST /run-task triggers the agent in a background thread
*   GET /task-stream/<id> streams agent logs in real time via SSE

## The Agent Loop in Detail

| Step | Action | Detail |
| --- | --- | --- |
| 1 | Screenshot | Playwright captures full page PNG, encodes as base64 |
| 2 | Vision API Call | Screenshot + task + action history sent to Claude claude-sonnet-4-5 |
| 3 | Parse Action | Claude returns JSON: {action: 'click', target: 'Reset Password button'} or {action: 'type', field: 'email', value: 'john@...'} |
| 4 | Execute Action | Playwright executes: page.get_by_text('Reset Password').click() — visual coordinates only, no CSS selectors in the agent prompt |
| 5 | Loop or Done | If Claude returns {action: 'done', result: '...'}, terminate. Otherwise go to step 1. |
| 5. MOCK IT ADMIN PANEL — FULL SPECIFICATION |
| --- |

## Database Schema (SQLite)

users(id, email, full\_name, role, status, password\_hash, created\_at)

licenses(id, user\_id, product, assigned\_at, expires\_at, status)

audit\_log(id, action, target\_email, performed\_by, details, timestamp)

## Pages & Routes

### Page 1 — Dashboard (GET /)

*   Shows summary cards: Total Users, Active Users, Licenses Assigned
*   Quick links to User Management and Audit Log
*   Recent activity feed (last 5 audit log entries)

### Page 2 — User Management (GET /users)

*   Table listing all users with columns: Email, Name, Role, Status, Actions
*   Action buttons per row: \[Reset Password\] \[Disable/Enable\] \[Assign License\]
*   "Add New User" button at top opens inline form (on same page, no modal JS needed)
*   Form fields for new user: Email, Full Name, Role (dropdown: admin/user/viewer), Initial Password
*   After actions: page reloads with green/red flash message banner

### Page 3 — Audit Log (GET /audit)

*   Paginated table of all actions: Timestamp, Action Type, Target, Performed By, Details
*   Filter by action type (dropdown: all, create\_user, reset\_password, assign\_license, disable\_user)

## Flask Routes (Backend)

| Route | Method | What It Does |
| --- | --- | --- |
| GET / | GET | Dashboard page |
| GET /users | GET | List all users |
| POST /users/create | POST | Create new user from form |
| POST /users/<id>/reset-password | POST | Reset user password |
| POST /users/<id>/toggle-status | POST | Enable or disable a user |
| POST /users/<id>/assign-license | POST | Assign a product license |
| GET /audit | GET | Show audit log with optional filter |
| 6. AI AGENT — FULL SPECIFICATION |
| --- |

## Agent Class Design

The agent is a single Python class: ITSupportAgent, with these key methods:

| Method | Responsibility |
| --- | --- |
| __init__(task, stream_callback) | Set up Playwright browser, Anthropic client, task string, action history |
| run() | Main entry point — async loop until done or max_steps |
| _take_screenshot() | Capture page as base64 PNG using Playwright |
| _ask_claude(screenshot) | Call Claude claude-sonnet-4-5 with screenshot + system prompt + history |
| _parse_action(response) | Extract JSON action block from Claude's response |
| _execute_action(action) | Route to click/type/navigate/select/scroll/done handlers |
| _click(description) | Find element by visible text/label using Playwright get_by_* methods |
| _type(field, value) | Find input by label/placeholder, clear, type value |
| _navigate(url) | Navigate to a specific page URL |
| _done(result) | Terminate loop, return final result string |

## System Prompt for Claude

| You are an IT support automation agent. You are operating a web browser and can see the current state of the screen as a screenshot. Your job is to complete the following IT task: {TASK}. On each step, analyze the screenshot and decide what single action to take next. Respond ONLY with a valid JSON object: - To click a button or link: {"action": "click", "target": "<visible text of element>"} - To type in a field: {"action": "type", "field": "<field label or placeholder>", "value": "<text to type>"} - To navigate to a URL: {"action": "navigate", "url": "<full URL>"} - To select from a dropdown: {"action": "select", "field": "<field label>", "value": "<option text>"} - When the task is complete: {"action": "done", "result": "<what was accomplished>"} Always start at http://localhost:5000. Never use developer tools. Act only on what you can see. |
| --- |

## Action Schema (Claude Output)

{ "action": "click", "target": "Reset Password" }

{ "action": "type", "field": "Email", "value": "john@company.com" }

{ "action": "navigate", "url": "http://localhost:5000/users" }

{ "action": "select", "field": "Role", "value": "admin" }

{ "action": "done", "result": "Password reset for john@company.com successfully" }

## Action Execution Strategy — No DOM Selectors

The key engineering constraint: the AI agent must NOT use CSS selectors or XPath directly. Instead:

*   click: Uses page.get\_by\_text(target) or page.get\_by\_role('button', name=target) — matches by visible text
*   type: Uses page.get\_by\_label(field) or page.get\_by\_placeholder(field) — matches by visible form label
*   select: Uses page.get\_by\_label(field).select\_option(value) — selects by option visible text
*   navigate: Uses page.goto(url) — explicit URL navigation

This mirrors how a real human would interact — they read the page and click what they see.

## Conditional Multi-Step Logic (Bonus Task)

For the task: "Check if sarah@company.com exists. If not, create her. Then assign her a GitHub Copilot license."

1.  Agent navigates to /users
2.  Agent scans the screenshot — if 'sarah@company.com' is visible in the table, records 'user exists'
3.  If not visible, agent clicks 'Add New User', fills form, submits
4.  Agent then finds the user row, clicks 'Assign License'
5.  Selects 'GitHub Copilot' from dropdown, submits
6.  Agent reads success banner, returns DONE with summary

This multi-step conditional flow happens purely through the observe-think-act loop — Claude infers conditions from screenshots.

| 7. PROJECT STRUCTURE |
| --- |

## Directory Layout

it-support-agent/

├── admin\_panel/ # Mock IT Admin Panel (Flask)

│ ├── app.py # Flask app, all routes

│ ├── database.py # SQLite schema + seed data

│ ├── models.py # User, License, AuditLog models

│ ├── templates/

│ │ ├── base.html # Shared layout, nav, flash

│ │ ├── dashboard.html # Dashboard with summary cards

│ │ ├── users.html # User table + add user form

│ │ └── audit.html # Audit log with filter

│ └── static/

│ └── style.css # Minimal clean CSS

│

├── agent/ # AI Browser Agent

│ ├── agent.py # ITSupportAgent class (main loop)

│ ├── actions.py # Action execution handlers

│ ├── prompts.py # System prompt templates

│ └── stream.py # SSE stream helper

│

├── chat/ # Chat Interface

│ ├── chat\_app.py # Flask app with /run-task + /task-stream

│ └── templates/

│ └── chat.html # Chat UI (SSE-driven)

│

├── tests/

│ ├── test\_panel\_routes.py # Flask route tests

│ └── test\_agent\_actions.py # Agent action handler tests

│

├── run\_panel.py # Start Flask admin panel on :5000

├── run\_chat.py # Start chat interface on :8080

├── run\_agent.py # CLI: python run\_agent.py 'reset password...'

├── requirements.txt

├── .env.example

└── README.md

## Key Files Explained

| File | Purpose |
| --- | --- |
| admin_panel/app.py | All Flask routes. Reads/writes SQLite, renders Jinja2 templates, writes audit log on every action |
| admin_panel/database.py | Creates tables, seeds 5 mock users and 3 license types on first run |
| agent/agent.py | ITSupportAgent class — the observe-think-act loop, max 15 iterations, full action history passed to Claude each step |
| agent/actions.py | Maps Claude JSON actions to Playwright calls. Uses get_by_text / get_by_label — never CSS selectors |
| agent/prompts.py | System prompt with task injection. Instructs Claude on JSON schema and human-like navigation |
| chat/chat_app.py | Receives task, spawns agent in thread, streams logs via SSE to browser chat UI |
| 8. IMPLEMENTATION STRATEGY — STEP BY STEP |
| --- |

## Phase 1 — Mock Admin Panel (Day 1, Hours 1–4)

### Step 1.1 — Database & Models

1.  Create database.py with SQLite schema for users, licenses, audit\_log
2.  Add seed function that inserts 5 users with different roles and statuses
3.  Test: python -c "from database import init\_db; init\_db()" confirms tables created

### Step 1.2 — Flask Routes

1.  Build app.py with all 7 routes listed in Section 5
2.  Each POST route: validates form data, performs DB operation, logs to audit\_log, redirects with flash message
3.  Test each route manually in browser before touching the agent

### Step 1.3 — Templates

1.  base.html with nav (Dashboard | Users | Audit) and flash message rendering
2.  users.html with a <table> of users and per-row forms for actions
3.  dashboard.html with 3 stat cards and recent activity
4.  audit.html with paginated table and action type filter

### Step 1.4 — Verification

1.  Run: python run\_panel.py
2.  Manually perform: create a user, reset a password, assign a license
3.  Confirm audit log records every action
4.  Check all flash messages appear correctly

## Phase 2 — AI Agent Core (Day 1, Hours 5–10)

### Step 2.1 — Playwright Setup

1.  Install: pip install playwright && playwright install chromium
2.  Write a basic smoke test: open browser, go to localhost:5000, take screenshot, save to disk
3.  Verify screenshot is readable (full page, all text visible)

### Step 2.2 — Claude Vision Integration

1.  Set ANTHROPIC\_API\_KEY in .env
2.  Write \_ask\_claude() — encodes screenshot to base64, builds message with image + task + history
3.  Test: send a screenshot of the users page, ask 'what actions are available on this page?'
4.  Verify Claude can read the page content accurately from the screenshot

### Step 2.3 — Action Handlers

1.  Implement each action type: click, type, navigate, select, done
2.  For click: try get\_by\_text first, fall back to get\_by\_role, then get\_by\_label
3.  Add 500ms wait after each action for page to settle
4.  Add retry logic: if Playwright throws, log the error and let Claude see the unchanged screenshot

### Step 2.4 — The Main Loop

1.  Implement run() as an async method
2.  Initialize: navigate to http://localhost:5000
3.  Loop: screenshot → Claude → parse → execute → log → repeat
4.  Termination: action == 'done' OR iteration > 15
5.  Stream each step to stream\_callback for real-time logging

### Step 2.5 — Test Task 1: Reset Password

1.  python run\_agent.py "Reset the password for john@company.com to NewPass@456"
2.  Watch agent navigate to /users, find the user, click Reset Password, fill form, submit
3.  Check SQLite: password\_hash should be updated
4.  Check audit log: new entry for reset\_password action

### Step 2.6 — Test Task 2: Create New User

1.  python run\_agent.py "Create a new user with email jane@company.com, name Jane Smith, role viewer"
2.  Watch agent click Add New User, fill all fields, submit
3.  Check SQLite: new row in users table
4.  Check admin panel: Jane now appears in the user list

## Phase 3 — Bonus: Multi-Step Conditional Task (Day 2, Hours 1–3)

### Step 3.1 — Test Conditional Task

1.  python run\_agent.py "Check if sarah@company.com exists. If not, create her with role user. Then assign her a GitHub Copilot license."
2.  Agent scans screenshot for email in table
3.  If not found: creates user, then assigns license
4.  If found: skips creation, goes directly to assign license
5.  Verify both branches work correctly

## Phase 4 — Chat Interface (Day 2, Hours 3–5)

### Step 4.1 — Chat Server

1.  Build chat\_app.py with POST /run-task (starts agent in background thread)
2.  Build GET /task-stream/<id> as SSE endpoint that yields log lines
3.  Thread safety: use queue.Queue per task for log buffering

### Step 4.2 — Chat UI

1.  chat.html: text input + submit button + scrollable <div> for log output
2.  JavaScript: EventSource to subscribe to SSE stream, append each log line
3.  Show agent steps in real time: '🖥️ Screenshot taken', '🤔 Claude thinking...', '🖱️ Clicking Reset Password'

## Phase 5 — Loom Recording (Day 2, Hours 5–6)

### What to Show

1.  Start both servers: python run\_panel.py and python run\_chat.py
2.  Show the admin panel manually (30 seconds) — dashboard, user list, audit log
3.  Open chat interface, type Task 1 (reset password), watch agent run
4.  Show audit log after — confirm action was logged
5.  Type Task 2 (create user), watch agent run
6.  If time: show conditional multi-step task (bonus)
7.  Briefly walk the code: agent.py loop, prompts.py, actions.py (30 seconds)

| 9. RISKS & MITIGATIONS |
| --- |
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Claude misreads screenshot / wrong element | High | Use large viewport (1280x900), ensure admin panel has clear visible labels on all buttons and inputs |
| Playwright element not found | Medium | Wrap all actions in try/except; on failure, take screenshot and re-ask Claude what went wrong |
| Infinite loop / max iterations hit | Medium | Hard cap at 15 iterations; log a clear TIMEOUT message and return partial result |
| Claude returns invalid JSON | Low | Wrap _parse_action in try/except; retry the same screenshot with 'your last response was not valid JSON, please retry' |
| API rate limit | Low | Use claude-sonnet-4-5 (high rate limits); add 1s delay between steps; use streaming=False for simplicity |
| 10. REQUIREMENTS & SETUP |
| --- |

## requirements.txt

flask==3.1.0

playwright==1.44.0

anthropic==0.30.0

python-dotenv==1.0.1

rich==13.7.0

pillow==10.4.0

werkzeug==3.0.3

## Environment Variables (.env)

ANTHROPIC\_API\_KEY=sk-ant-...

FLASK\_SECRET\_KEY=your-secret-key

ADMIN\_PANEL\_URL=http://localhost:5000

## Setup Commands

1.  git clone <repo> && cd it-support-agent
2.  python -m venv venv && source venv/bin/activate
3.  pip install -r requirements.txt
4.  playwright install chromium
5.  cp .env.example .env && add your ANTHROPIC\_API\_KEY
6.  python run\_panel.py # starts admin panel on :5000
7.  python run\_chat.py # starts chat UI on :8080 (bonus)
8.  python run\_agent.py "Reset password for john@company.com to Test@123"

| 11. DEMO TASKS FOR LOOM VIDEO |
| --- |

## Task 1 — Password Reset

| "Reset the password for john@company.com to Welcome@2026" |
| --- |

Expected agent flow:

1.  Navigate to http://localhost:5000
2.  Click 'Users' in nav
3.  Find john@company.com row in table
4.  Click 'Reset Password' button for that row
5.  Fill 'New Password' field with Welcome@2026
6.  Click Submit
7.  Confirm success banner appears
8.  Return DONE with confirmation message

## Task 2 — Create New User

| "Create a new IT user: email=alice@company.com, name=Alice Kumar, role=admin" |
| --- |

Expected agent flow:

1.  Navigate to /users
2.  Click 'Add New User' button
3.  Fill Email field with alice@company.com
4.  Fill Name field with Alice Kumar
5.  Select 'admin' from Role dropdown
6.  Fill initial password field
7.  Click 'Create User' button
8.  Confirm user appears in table
9.  Return DONE with confirmation

## Task 3 — Conditional Multi-Step (Bonus)

| "Check if sarah@company.com exists. If not, create her with role viewer. Then assign her a GitHub Copilot license." |
| --- |

Expected agent flow:

1.  Navigate to /users, scan screenshot for sarah@company.com
2.  If not found: perform full user creation flow
3.  Navigate back to /users, find sarah's row
4.  Click 'Assign License' for sarah
5.  Select 'GitHub Copilot' from license dropdown
6.  Submit and confirm
7.  Return DONE with full summary of what was done

| 12. TIMELINE — 48 HOUR EXECUTION PLAN |
| --- |
| Hour Block | Phase | Deliverable |
| --- | --- | --- |
| Hours 1–2 | DB & Models | SQLite schema created, seeded with 5 users and 3 licenses |
| Hours 3–4 | Flask Routes | All 7 routes working, manually verified in browser |
| Hours 4–5 | Templates | 3 HTML pages complete with forms, table, flash messages |
| Hours 5–6 | Playwright Smoke | Browser opens, screenshot taken, saved to disk |
| Hours 6–8 | Claude Vision | Screenshot sent to Claude, response received and logged |
| Hours 8–10 | Agent Loop | Full observe-think-act loop running, Task 1 completes |
| Hours 10–12 | Task 2 + Debug | Task 2 (create user) completes end-to-end |
| Hours 12–16 | Conditional Logic | Bonus Task 3 works for both 'user exists' and 'user missing' branches |
| Hours 16–18 | Chat Interface | SSE-based chat UI working, logs stream to browser |
| Hours 18–20 | README + Code Polish | Code cleaned, README written, .env.example added |
| Hours 20–22 | Testing | Route tests pass, agent action handler tests pass |
| Hours 22–24 | Loom Recording | 2-minute demo video recorded, architecture explained |
| Hours 24–36 | Buffer | Bug fixes, edge case handling, deployment (Railway) if time |
| Hours 36–48 | Submission | GitHub repo public, Loom link ready, submitted |
| 13. KEY ARCHITECTURAL DECISIONS |
| --- |

## Why Flask over FastAPI for the Admin Panel?

Flask renders server-side HTML with Jinja2 and handles form submissions with standard HTML POST. This creates a panel that behaves exactly like a legacy enterprise IT tool — the kind of thing a human IT admin would actually use. FastAPI is REST-first, which would push us toward JSON APIs and JavaScript-heavy frontends — harder for the browser agent to interact with naturally.

## Why Raw Playwright + Claude over browser-use Library?

The browser-use library is a black box. Using raw Playwright with a Claude Vision loop gives us full control and lets us clearly demonstrate our architecture thinking to Decawork. It also makes the code much easier to explain in the Loom video. Evaluators can follow the logic directly.

## Why Not Use CSS Selectors in the Agent?

The task specification says 'no direct DOM selectors or API shortcuts — the agent navigates the panel and completes tasks like a human would.' Playwright's get\_by\_text(), get\_by\_label(), and get\_by\_role() match elements by their visible properties — exactly how a human reads a page. CSS selectors like #reset-btn would be a shortcut that bypasses the browser agent's vision entirely.

## Why Claude claude-sonnet-4-5 over GPT-4o?

Decawork is exploring Anthropic's computer use capabilities specifically. Claude claude-sonnet-4-5 has native computer use support and excellent vision capabilities for reading web UIs. Using it directly signals alignment with Decawork's technology choices.

## Why Not Use LangChain?

LangChain adds significant abstraction that obscures the agent logic. For a 48-hour demo where clarity of thought is explicitly evaluated, a raw implementation where the evaluator can follow every step in agent.py is far more impressive and honest than a LangChain wrapper.

| 14. WHAT TO BORROW FROM NAVIGATOR (NeoVerse-26) |
| --- |

As instructed, this project is built from scratch — not on top of Navigator. However, we can study and adapt specific patterns:

| Navigator Component | Concept to Borrow | How We Adapt It |
| --- | --- | --- |
| packages/agent-core/src/browser/ | Playwright browser detection and setup patterns | Adapt browser launch config to Python Playwright API |
| Streaming thought events concept | Real-time log streaming to UI | Implement as Python SSE via Flask — same concept, different stack |
| Task lifecycle states (pending/running/done/failed) | Clean state machine for task progress | Use an enum in agent.py: TaskState.RUNNING / DONE / FAILED |
| Permission handler pattern | Explicit consent before destructive actions | Not needed for mock panel, but structure code to add it later |
| createLogWriter() rotating log | Structured logging per task | Use Python's logging module with a RotatingFileHandler |
| IT Support AI Agent — Decawork Engineering AssignmentBuilt with Python • Flask • Playwright • Claude claude-sonnet-4-5 |
| --- |