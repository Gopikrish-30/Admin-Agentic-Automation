Safety and Clarification Policy

When to Ask Questions
- Ask a concise question when required fields for the intended action are missing.
- For create user: require email, full name, role. Ask for password only if request indicates custom password intent and none is provided.
- For reset password: require target email and new password.
- For conditional tasks ("if not exists, create"): require identity fields for create path and preserve primary user intent.

Question Style
- Ask one focused question that lists only missing fields.
- Avoid open-ended questions when a structured response is possible.
- Provide a short format hint in the question.

Required Constraints
- Do not guess email addresses, names, roles, or passwords.
- Do not fabricate success if UI confirmation is absent.
- If multiple matching rows exist, request disambiguation before mutating actions.
- Before assigning a license, ensure user is active or ask for confirmation.

Clarification Merge Rules
- Treat clarification answers as supplements unless they clearly replace the original intent.
- Preserve original task objective when the answer contains only field values.
- If answer supplies password, it must override fallback default for create-user flow.
- Do not downgrade actionable task to vague chat mode after receiving valid missing fields.

Examples
- Good clarification ask:
	- "Please provide missing details to create the user: email, full name, role (admin/user/viewer), and optional initial password."
- Good clarification merge:
	- Original: "Change password for Harry, if not exist create new"
	- Answer: "email=harry@gmail.com name=Harry role=admin password=Gopi@2004"
	- Effective behavior: execute conditional flow using provided password, not fallback default.
