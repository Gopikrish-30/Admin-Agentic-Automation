from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any


class ConnectorManager:
    def __init__(self, db_path: str | None = None):
        if db_path:
            self.db_path = db_path
        else:
            self.db_path = str(Path(__file__).resolve().parent.parent / "admin_panel" / "it_admin.db")

    def call(self, name: str, args: dict[str, Any] | None = None) -> str:
        args = args or {}
        key = name.strip().lower()

        if key == "recent_audit":
            limit = int(args.get("limit", 5))
            return self._recent_audit(limit)

        if key == "get_user":
            email = str(args.get("email", "")).strip().lower()
            if not email:
                return "Missing email argument for get_user connector"
            return self._get_user(email)

        return f"Unknown connector: {name}"

    def _recent_audit(self, limit: int) -> str:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT timestamp, action, target_email, details FROM audit_log ORDER BY id DESC LIMIT ?",
                (max(1, min(limit, 20)),),
            ).fetchall()

        if not rows:
            return "No audit entries found."

        lines = ["Recent audit entries:"]
        for row in rows:
            lines.append(f"- {row['timestamp']} | {row['action']} | {row['target_email']} | {row['details']}")
        return "\n".join(lines)

    def _get_user(self, email: str) -> str:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT email, full_name, role, status FROM users WHERE email = ?",
                (email,),
            ).fetchone()

        if row is None:
            return f"User not found: {email}"
        return (
            f"User {row['email']} | Name={row['full_name']} | "
            f"Role={row['role']} | Status={row['status']}"
        )
