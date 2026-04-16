from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BASE_DIR / "admin_panel" / "it_admin.db"
LICENSE_PRODUCTS = ["Google Workspace", "Okta", "GitHub Copilot"]


def get_db_path(db_path: str | None = None) -> str:
    if db_path:
        return db_path
    return os.getenv("IT_ADMIN_DB_PATH", str(DEFAULT_DB_PATH))


def get_connection(db_path: str | None = None) -> sqlite3.Connection:
    connection = sqlite3.connect(get_db_path(db_path), check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


def init_db(db_path: str | None = None) -> None:
    path = get_db_path(db_path)
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    with closing(get_connection(path)) as connection:
        cursor = connection.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL,
                status TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS licenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                product TEXT NOT NULL,
                assigned_at TEXT NOT NULL,
                expires_at TEXT,
                status TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                target_email TEXT NOT NULL,
                performed_by TEXT NOT NULL,
                details TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
            """
        )

        connection.commit()

    seed_db(path)


def seed_db(db_path: str | None = None) -> None:
    path = get_db_path(db_path)
    now = datetime.now(UTC).isoformat(timespec="seconds")

    with closing(get_connection(path)) as connection:
        cursor = connection.cursor()
        user_count = cursor.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        if user_count > 0:
            return

        seed_users = [
            ("john@company.com", "John Carter", "admin", "active", "Temp#123", now),
            ("mira@company.com", "Mira Patel", "user", "active", "Temp#123", now),
            ("nina@company.com", "Nina Gomez", "viewer", "active", "Temp#123", now),
            ("alex@company.com", "Alex Lee", "user", "disabled", "Temp#123", now),
            ("sam@company.com", "Sam Wong", "admin", "active", "Temp#123", now),
        ]
        cursor.executemany(
            """
            INSERT INTO users(email, full_name, role, status, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            seed_users,
        )

        # Seed one license assignment so dashboard has meaningful counts.
        john = cursor.execute(
            "SELECT id, email FROM users WHERE email = ?", ("john@company.com",)
        ).fetchone()
        if john:
            cursor.execute(
                """
                INSERT INTO licenses(user_id, product, assigned_at, expires_at, status)
                VALUES (?, ?, ?, ?, ?)
                """,
                (john["id"], "Google Workspace", now, None, "active"),
            )

        cursor.execute(
            """
            INSERT INTO audit_log(action, target_email, performed_by, details, timestamp)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("seed", "system", "system", "Initial dataset created", now),
        )
        connection.commit()


def log_audit(
    action: str,
    target_email: str,
    details: str,
    performed_by: str = "it-agent",
    db_path: str | None = None,
) -> None:
    now = datetime.now(UTC).isoformat(timespec="seconds")
    with closing(get_connection(db_path)) as connection:
        connection.execute(
            """
            INSERT INTO audit_log(action, target_email, performed_by, details, timestamp)
            VALUES (?, ?, ?, ?, ?)
            """,
            (action, target_email, performed_by, details, now),
        )
        connection.commit()
