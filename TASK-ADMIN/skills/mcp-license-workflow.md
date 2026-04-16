# MCP License Workflow Skill

Purpose: assign licenses only after user identity and existence are confirmed.

Preferred tool:
- mcp_license

Action contract:
- assign_license: requires email and product.

Execution sequence guidance:
- Confirm target user exists before assignment.
- If assignment selector fails repeatedly, run user check/create recovery and retry.
- Use explicit product names (for example, GitHub Copilot).

Completion guidance:
- Complete task only after assignment success is confirmed in action feedback.
