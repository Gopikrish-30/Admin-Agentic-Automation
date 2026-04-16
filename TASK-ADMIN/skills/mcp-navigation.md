# MCP Navigation Skill

Purpose: drive page movement and UI interaction primitives through visible controls only.

When to use:
- Moving to a page or section.
- Clicking visible buttons/links.
- Typing/selecting in labeled form controls.

Preferred tool:
- mcp_navigation

Action contract:
- navigate: use url.
- click: use target visible text.
- type: use field label and value.
- select: use field label and option label.
- wait: use only as short bridge between concrete actions.

Reliability rules:
- Prefer labels and role names over brittle text fragments.
- If the same selector fails twice, stop repeating and switch to check state.
- Do not chain multiple actions in one response.
