from __future__ import annotations

import chat.chat_app as chat_module
from chat.chat_app import create_chat_app


def test_get_llm_provider_status(monkeypatch) -> None:
    monkeypatch.setattr(chat_module, "_load_settings", lambda: {"provider": "openai-codex", "model": "openai/gpt-5.2-codex"})
    monkeypatch.setattr(chat_module, "_get_openai_oauth_status", lambda: {"connected": True})

    app = create_chat_app()
    client = app.test_client()
    response = client.get("/llm/provider")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["provider"] == "openai-codex"
    assert payload["oauth"]["connected"] is True


def test_set_llm_provider_rejects_non_openai_codex() -> None:
    app = create_chat_app()
    client = app.test_client()
    response = client.post("/llm/provider", json={"provider": "openai", "model": "openai/gpt-5.2-codex"})

    assert response.status_code == 400
    assert "Only openai-codex" in response.get_json()["error"]


def test_authorize_openai_starts_login(monkeypatch) -> None:
    started = {"ok": False}

    def _fake_start() -> None:
        started["ok"] = True

    monkeypatch.setattr(chat_module, "_start_openai_login_terminal", _fake_start)

    app = create_chat_app()
    client = app.test_client()
    response = client.post("/llm/openai/authorize")

    assert response.status_code == 200
    assert started["ok"] is True
    assert response.get_json()["ok"] is True
