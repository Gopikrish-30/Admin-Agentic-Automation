IT Admin Execution Baseline

Scope
- This skill governs practical IT admin actions in the demo panel: reset password, create user, check user existence, assign license.
- Work through visible UI state only. Do not assume hidden backend behavior.

Core Operating Rules
- Use clear, low-risk actions with explicit target verification.
- Treat email as the primary identity key for user operations.
- If user-provided data contains contradictions, ask one concise clarification question before acting.
- Before submit actions, verify required fields are populated and match requested values.
- Prefer idempotent behavior: do not create duplicate users when user already exists.

Task Decomposition Rules
- For password reset requests:
	- Open Users page.
	- Locate exact user row by email.
	- Type requested password into the correct reset input for that user.
	- Click the matching reset action for that same user.
	- Verify success flash text or row confirmation.
- For create-user requests:
	- Open Users page.
	- Check if user exists by email first.
	- If missing, fill email, full name, role, and initial password.
	- Submit create action once.
	- Verify success message and row presence.

Password Handling Rules
- If the user explicitly provides a password in task text or clarification answer, use it exactly.
- Do not overwrite an explicit user password with fallback defaults.
- Use fallback password only when no explicit password was supplied.
- Do not mask or transform password value before typing unless UI validation requires a change.

Navigation and Recovery
- If expected user row is missing, refresh context by reopening Users page once.
- If a step appears successful but UI confirmation is absent, retry verification before retrying write actions.
- If the page changed unexpectedly, navigate back to Users and continue from latest completed checkpoint.

Completion Criteria
- Consider task complete only when confirmation is visible in UI (flash message or resulting row state).
- Include concise completion summary with identity and outcome (example: "User alice@company.com created successfully").

Examples
- "Reset password for john@company.com to Welcome@2032"
- "Create user email=alice@company.com name=Alice role=viewer password=Temp#7821"
- "If harry@company.com does not exist, create with role admin and password Admin@2040"
