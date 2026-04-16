from __future__ import annotations

from pathlib import Path

from admin_panel.app import create_app
from admin_panel.database import get_connection


def _make_test_app(tmp_path: Path):
    db_path = str(tmp_path / "test_admin.db")
    app = create_app({
        "TESTING": True,
        "DATABASE_PATH": db_path,
        "SECRET_KEY": "test",
    })
    return app, db_path


def test_dashboard_route(tmp_path: Path) -> None:
    app, _db_path = _make_test_app(tmp_path)
    client = app.test_client()
    response = client.get("/")
    assert response.status_code == 200
    assert b"Mock IT Admin Panel" in response.data


def test_create_user_route(tmp_path: Path) -> None:
    app, db_path = _make_test_app(tmp_path)
    client = app.test_client()

    response = client.post(
        "/users/create",
        data={
            "email": "alice@company.com",
            "full_name": "Alice Kumar",
            "role": "admin",
            "initial_password": "Start#123",
        },
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert b"created successfully" in response.data

    conn = get_connection(db_path)
    row = conn.execute("SELECT email FROM users WHERE email = 'alice@company.com'").fetchone()
    conn.close()
    assert row is not None


def test_reset_password_route(tmp_path: Path) -> None:
    app, db_path = _make_test_app(tmp_path)
    client = app.test_client()

    conn = get_connection(db_path)
    user = conn.execute("SELECT id FROM users WHERE email = 'john@company.com'").fetchone()
    conn.close()
    assert user is not None

    response = client.post(
        f"/users/{user['id']}/reset-password",
        data={"new_password": "New#999"},
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert b"Password reset completed" in response.data

    conn = get_connection(db_path)
    updated = conn.execute(
        "SELECT password_hash FROM users WHERE id = ?", (user["id"],)
    ).fetchone()
    conn.close()
    assert updated["password_hash"] == "New#999"
