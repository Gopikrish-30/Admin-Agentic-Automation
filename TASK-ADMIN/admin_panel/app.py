from __future__ import annotations

import os
from contextlib import closing

from flask import Flask, flash, redirect, render_template, request, url_for

from admin_panel.database import LICENSE_PRODUCTS, get_connection, init_db, log_audit


def create_app(config: dict | None = None) -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "change-me")
    app.config["DATABASE_PATH"] = os.getenv("IT_ADMIN_DB_PATH")

    if config:
        app.config.update(config)

    init_db(app.config.get("DATABASE_PATH"))

    @app.get("/")
    def dashboard() -> str:
        with closing(get_connection(app.config.get("DATABASE_PATH"))) as conn:
            total_users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
            active_users = conn.execute(
                "SELECT COUNT(*) AS c FROM users WHERE status = 'active'"
            ).fetchone()["c"]
            assigned_licenses = conn.execute(
                "SELECT COUNT(*) AS c FROM licenses WHERE status = 'active'"
            ).fetchone()["c"]
            recent = conn.execute(
                """
                SELECT timestamp, action, target_email, details
                FROM audit_log
                ORDER BY id DESC
                LIMIT 5
                """
            ).fetchall()

        return render_template(
            "dashboard.html",
            total_users=total_users,
            active_users=active_users,
            assigned_licenses=assigned_licenses,
            recent=recent,
        )

    @app.get("/users")
    def users() -> str:
        with closing(get_connection(app.config.get("DATABASE_PATH"))) as conn:
            rows = conn.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.full_name,
                    u.role,
                    u.status,
                    COALESCE(group_concat(CASE WHEN l.status = 'active' THEN l.product END, ', '), '') AS products
                FROM users u
                LEFT JOIN licenses l ON l.user_id = u.id
                GROUP BY u.id
                ORDER BY u.email ASC
                """
            ).fetchall()

        return render_template(
            "users.html",
            users=rows,
            license_products=LICENSE_PRODUCTS,
        )

    @app.post("/users/create")
    def create_user() -> str:
        email = request.form.get("email", "").strip().lower()
        full_name = request.form.get("full_name", "").strip()
        role = request.form.get("role", "user").strip().lower()
        initial_password = request.form.get("initial_password", "").strip()

        if not email or not full_name or not initial_password:
            flash("Email, full name, and initial password are required.", "error")
            return redirect(url_for("users"))

        try:
            with closing(get_connection(app.config.get("DATABASE_PATH"))) as conn:
                conn.execute(
                    """
                    INSERT INTO users(email, full_name, role, status, password_hash, created_at)
                    VALUES (?, ?, ?, 'active', ?, datetime('now'))
                    """,
                    (email, full_name, role, initial_password),
                )
                conn.commit()
            log_audit("create_user", email, f"Created user with role={role}", db_path=app.config.get("DATABASE_PATH"))
            flash(f"User {email} created successfully.", "success")
        except Exception as exc:
            flash(f"Could not create user: {exc}", "error")

        return redirect(url_for("users"))

    @app.post("/users/<int:user_id>/reset-password")
    def reset_password(user_id: int) -> str:
        password = request.form.get("new_password", "").strip()
        if not password:
            flash("New password is required.", "error")
            return redirect(url_for("users"))

        with closing(get_connection(app.config.get("DATABASE_PATH"))) as conn:
            user = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                flash("User not found.", "error")
                return redirect(url_for("users"))

            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (password, user_id),
            )
            conn.commit()

        email = user["email"]
        log_audit("reset_password", email, "Password reset", db_path=app.config.get("DATABASE_PATH"))
        flash(f"Password reset completed for {email}.", "success")
        return redirect(url_for("users"))

    @app.post("/users/<int:user_id>/toggle-status")
    def toggle_status(user_id: int) -> str:
        with closing(get_connection(app.config.get("DATABASE_PATH"))) as conn:
            user = conn.execute(
                "SELECT email, status FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if not user:
                flash("User not found.", "error")
                return redirect(url_for("users"))

            new_status = "disabled" if user["status"] == "active" else "active"
            conn.execute("UPDATE users SET status = ? WHERE id = ?", (new_status, user_id))
            conn.commit()

        email = user["email"]
        log_audit(
            "toggle_status",
            email,
            f"Changed status to {new_status}",
            db_path=app.config.get("DATABASE_PATH"),
        )
        flash(f"Status changed to {new_status} for {email}.", "success")
        return redirect(url_for("users"))

    @app.post("/users/<int:user_id>/assign-license")
    def assign_license(user_id: int) -> str:
        product = request.form.get("product", "").strip()
        if product not in LICENSE_PRODUCTS:
            flash("Pick a valid license product.", "error")
            return redirect(url_for("users"))

        with closing(get_connection(app.config.get("DATABASE_PATH"))) as conn:
            user = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                flash("User not found.", "error")
                return redirect(url_for("users"))

            conn.execute(
                """
                INSERT INTO licenses(user_id, product, assigned_at, expires_at, status)
                VALUES (?, ?, datetime('now'), NULL, 'active')
                """,
                (user_id, product),
            )
            conn.commit()

        email = user["email"]
        log_audit(
            "assign_license",
            email,
            f"Assigned {product}",
            db_path=app.config.get("DATABASE_PATH"),
        )
        flash(f"Assigned {product} to {email}.", "success")
        return redirect(url_for("users"))

    @app.get("/audit")
    def audit() -> str:
        action_filter = request.args.get("action", "all")
        params: tuple[str, ...] = ()
        query = """
            SELECT id, timestamp, action, target_email, performed_by, details
            FROM audit_log
        """
        if action_filter != "all":
            query += " WHERE action = ?"
            params = (action_filter,)
        query += " ORDER BY id DESC LIMIT 200"

        with closing(get_connection(app.config.get("DATABASE_PATH"))) as conn:
            rows = conn.execute(query, params).fetchall()
            actions = conn.execute(
                "SELECT DISTINCT action FROM audit_log ORDER BY action ASC"
            ).fetchall()

        return render_template(
            "audit.html",
            rows=rows,
            actions=[row["action"] for row in actions],
            action_filter=action_filter,
        )

    return app
