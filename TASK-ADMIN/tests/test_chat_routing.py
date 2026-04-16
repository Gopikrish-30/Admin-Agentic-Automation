from __future__ import annotations

import json
import time

import chat.chat_app as chat_module
from agent.agent import AgentResult
from agent.stream import AgentEvent
from chat.chat_app import create_chat_app


def _wait_status(client, task_id: str, timeout_seconds: float = 2.0):
    start = time.time()
    while time.time() - start < timeout_seconds:
        response = client.get(f"/task-status/{task_id}")
        payload = response.get_json()
        if payload["status"] not in {"pending", "running", "waiting_input"}:
            return payload
        time.sleep(0.05)
    return payload


def test_chat_route_returns_text_without_agent(monkeypatch) -> None:
    monkeypatch.setattr(chat_module, "_get_openai_oauth_status", lambda: {"connected": True})
    monkeypatch.setattr(chat_module, "_load_settings", lambda: {"provider": "openai-codex", "model": "openai/gpt-5.2-codex"})
    monkeypatch.setattr(
        chat_module,
        "decide_query_mode_with_model",
        lambda _task: {"mode": "chat", "message": "Hello! Tell me the exact IT action to automate."},
    )

    class ShouldNotRunAgent:
        def __init__(self, *args, **kwargs):
            raise AssertionError("Agent should not run for chat mode")

    monkeypatch.setattr(chat_module, "ITSupportAgent", ShouldNotRunAgent)

    app = create_chat_app()
    client = app.test_client()

    run_response = client.post("/run-task", json={"task": "hello buddy"})
    assert run_response.status_code == 200
    task_id = run_response.get_json()["taskId"]

    status = _wait_status(client, task_id)
    assert status["status"] == "success"
    assert "Hello!" in status["result"]["summary"]


def test_automation_route_runs_agent(monkeypatch) -> None:
    monkeypatch.setattr(chat_module, "_get_openai_oauth_status", lambda: {"connected": True})
    monkeypatch.setattr(chat_module, "_load_settings", lambda: {"provider": "openai-codex", "model": "openai/gpt-5.2-codex"})
    monkeypatch.setattr(
        chat_module,
        "decide_query_mode_with_model",
        lambda _task: {"mode": "automation", "message": "Reset password task detected."},
    )

    class FakeAgent:
        def __init__(self, task: str, callback=None, question_handler=None):
            self.task = task
            self.callback = callback
            self.question_handler = question_handler

        async def run(self):
            return AgentResult(status="success", summary="done:test", steps=1)

    monkeypatch.setattr(chat_module, "ITSupportAgent", FakeAgent)

    app = create_chat_app()
    client = app.test_client()

    run_response = client.post("/run-task", json={"task": "Reset password for john@company.com to Welcome@2026"})
    assert run_response.status_code == 200
    task_id = run_response.get_json()["taskId"]

    status = _wait_status(client, task_id)
    assert status["status"] == "success"
    assert status["result"]["summary"] == "done:test"


def test_task_status_includes_execution_journal(monkeypatch) -> None:
    monkeypatch.setattr(chat_module, "_get_openai_oauth_status", lambda: {"connected": True})
    monkeypatch.setattr(chat_module, "_load_settings", lambda: {"provider": "openai-codex", "model": "openai/gpt-5.2-codex"})
    monkeypatch.setattr(
        chat_module,
        "decide_query_mode_with_model",
        lambda _task: {"mode": "automation", "message": "Run automation."},
    )

    class FakeAgent:
        def __init__(self, task: str, callback=None, question_handler=None):
            self.task = task
            self.callback = callback
            self.question_handler = question_handler

        async def run(self):
            if self.callback:
                self.callback(
                    AgentEvent(
                        level="thought",
                        message='navigator.action.request {"requestId":"r1","type":"action.request"}',
                        timestamp="t1",
                    )
                )
                self.callback(
                    AgentEvent(
                        level="action",
                        message='navigator.action.result {"requestId":"r1","type":"action.result","status":"ok"}',
                        timestamp="t2",
                    )
                )
            return AgentResult(status="success", summary="done:test", steps=1)

    monkeypatch.setattr(chat_module, "ITSupportAgent", FakeAgent)

    app = create_chat_app()
    client = app.test_client()

    run_response = client.post("/run-task", json={"task": "Reset password for john@company.com to Welcome@2026"})
    assert run_response.status_code == 200
    task_id = run_response.get_json()["taskId"]

    status = _wait_status(client, task_id)
    assert status["status"] == "success"
    assert isinstance(status.get("journal"), list)
    assert status["journal"]
    assert status["journal"][0]["request"]["requestId"] == "r1"
    assert status["journal"][0]["result"]["requestId"] == "r1"
