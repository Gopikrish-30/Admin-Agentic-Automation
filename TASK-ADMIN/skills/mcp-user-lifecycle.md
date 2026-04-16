# MCP User Lifecycle Skill

Purpose: handle user existence checks, user creation, and password reset as structured domain actions.

Preferred tool:
- mcp_user

Action contract:
- check_user_exists: requires email or name.
- create_user: requires email, name, role, optional password.
- reset_password: requires email and password.

Execution sequence guidance:
- For conditional flows, always check existence before create.
- If user exists, skip creation.
- If required fields are missing, ask-user-question after start_task.

Data normalization:
- Normalize emails to lowercase.
- Keep roles in admin/user/viewer vocabulary.
