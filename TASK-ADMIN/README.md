# IT Support Browser Agent (TASK-ADMIN)

Standalone Python project that takes a natural-language IT support request and performs it through browser interaction on a mock IT admin panel.

This implementation is scoped to TASK-ADMIN only.

## What is included now

- Mock IT admin panel (Flask + SQLite)
- AI browser agent (Playwright + pluggable LLM planner backends)
- Local chat trigger UI (Flask + SSE)
- Multi-step task support through iterative observe-think-act actions
- Navigator-style workflow primitives:
	- Todo generation before execution
	- Model-decided tool calls each step
	- Mid-task user questions in frontend
	- Skill injection into planning prompts
	- Connector tool calls (`recent_audit`, `get_user`)

## Deferred for later

- Real SaaS admin panel integration (Notion/HubSpot)
- Slack / MS Teams trigger
- Cloud deployment

## Folder structure

- admin_panel/: mock panel app, templates, static files, DB logic
- agent/: core browser agent logic and action execution
- chat/: local web chat trigger and event streaming
- tests/: route, agent, and integration tests
- run_panel.py: start panel on port 5000
- run_agent.py: run a single task via CLI
- run_chat.py: start chat UI on port 8080

## Setup

1. Create and activate a virtual environment
2. Install dependencies

```bash
pip install -r requirements.txt
playwright install chromium
```

3. Configure environment

```bash
cp .env.example .env
# default backend uses OpenCode CLI (no OPENAI_API_KEY needed)
```

4. If you want no API key mode, ensure OpenCode CLI is installed and logged in

```bash
opencode auth login
```

5. Optional: switch to OpenAI SDK backend

```bash
# in .env
AGENT_BACKEND=openai
OPENAI_API_KEY=your_key
```

## Run locally

Terminal 1:

```bash
python run_panel.py
```

Terminal 2:

```bash
python run_chat.py
```

Optional terminal 3 (CLI task):

```bash
python run_agent.py "Reset password for john@company.com to Welcome@2026"
```

## Demo tasks

- Reset password for john@company.com to Welcome@2026
- Create a new IT user: email=alice@company.com, name=Alice Kumar, role=admin
- Check if sarah@company.com exists. If not, create her with role viewer. Then assign her a GitHub Copilot license.

## Notes on interaction constraints

The agent action executor only uses visible-target interaction methods:
- click by visible text or role name
- type by visible label or placeholder
- select by visible label

No direct API shortcuts are used for task execution.

## LLM Backend Modes

- `AGENT_BACKEND=opencode` (default): Uses local OpenCode CLI and your OpenCode auth session. Good when you do not have an OpenAI API key.
- `AGENT_BACKEND=openai`: Uses Python OpenAI SDK with `OPENAI_API_KEY`.

For `opencode` mode, action planning uses current page URL, recent action history, and visible page text. Browser actions are still executed through Playwright like a human (click/type/select/navigate).

## Workflow Notes

- Todo list: generated at task start and streamed to chat UI.
- Tool decisions: model returns one JSON action at a time.
- User-in-the-loop: if planner returns `ask_user`, chat UI prompts for answer and resumes execution.
- Skills: markdown files under `skills/` are loaded into system prompt.
- Connectors: planner can call `connector_call` tools via `agent/connectors.py`.

### MCP Domain Tool Pattern

The runtime now supports domain-separated MCP-style tools for cleaner orchestration:

- mcp_navigation: navigate, click, type, select, wait
- mcp_user: check_user_exists, create_user, reset_password
- mcp_license: assign_license

The protocol still requires start_task first. After that, the model can use domain MCP tools (or browser_action for backward compatibility).

### Skill Packs

TASK-ADMIN now includes separate skill packs for this IT admin domain:

- skills/mcp-navigation.md
- skills/mcp-user-lifecycle.md
- skills/mcp-license-workflow.md
- skills/browser-use-reliability.md

## Environment Variables (additional)

- `SKILLS_ENABLED=all` or comma-separated skill names without extension
- `OPENCODE_MODEL=openai/gpt-5.2` (recommended for ChatGPT OAuth login)
- `AGENT_PLANNER_TIMEOUT_SECONDS=25` (max seconds to wait for one planner response before deterministic fallback mode)

## Tests

```bash
pytest tests -q
```
