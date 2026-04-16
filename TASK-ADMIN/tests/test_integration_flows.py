from __future__ import annotations

import asyncio
from pathlib import Path

import agent.agent as agent_module
from admin_panel.app import create_app
from agent.agent import ITSupportAgent


def test_users_page_contains_seed_user(tmp_path: Path) -> None:
    db_path = str(tmp_path / "int_admin.db")
    app = create_app({"TESTING": True, "DATABASE_PATH": db_path, "SECRET_KEY": "test"})
    client = app.test_client()
    response = client.get("/users")

    assert response.status_code == 200
    assert b"john@company.com" in response.data
    assert b"Create User" in response.data


def test_native_tool_sequence_end_to_end(monkeypatch) -> None:
    class FakePlanner:
        def __init__(self):
            self.calls = 0

        def generate_todos(self, _task: str):
            return [{"title": "Init", "rationale": "model todo"}]

        def plan_action(self, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                return {
                    "tool": "start_task",
                    "input": {
                        "original_request": "Reset password task",
                        "needs_planning": True,
                        "goal": "Reset password",
                        "steps": ["Open users", "Reset password"],
                        "verification": ["Success message appears"],
                        "skills": ["it-admin-basics"],
                    },
                }
            if self.calls == 2:
                return {
                    "tool": "todowrite",
                    "input": {
                        "todos": [
                            {"id": "1", "title": "Open users", "status": "completed"},
                            {"id": "2", "title": "Reset password", "status": "in_progress"},
                        ]
                    },
                }
            if self.calls == 3:
                return {
                    "tool": "browser_action",
                    "input": {"action": "click", "target": "Users"},
                }
            return {
                "tool": "complete_task",
                "input": {"status": "success", "result_summary": "Completed sequence"},
            }

    class FakeLocator:
        async def inner_text(self, timeout=2500):
            _ = timeout
            return "Mock page body"

    class FakePage:
        def __init__(self):
            self.url = "http://localhost:5000"

        async def screenshot(self, full_page=True, type="png"):
            _ = (full_page, type)
            return b"png"

        def locator(self, _selector):
            return FakeLocator()

    class FakeContext:
        async def new_page(self):
            return FakePage()

    class FakeBrowser:
        async def new_context(self, viewport=None):
            _ = viewport
            return FakeContext()

        async def close(self):
            return None

    class FakeChromium:
        async def launch(self, headless=False):
            _ = headless
            return FakeBrowser()

    class FakePlaywright:
        def __init__(self):
            self.chromium = FakeChromium()

    class FakeAsyncPlaywright:
        async def __aenter__(self):
            return FakePlaywright()

        async def __aexit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

    class FakeActions:
        def __init__(self, page):
            self.page = page

        async def navigate(self, url: str):
            self.page.url = url

        async def click(self, _target: str):
            return None

        async def type(self, _field: str, _value: str):
            return None

        async def select(self, _field: str, _value: str):
            return None

        async def wait(self, _seconds: float):
            return None

    monkeypatch.setattr(agent_module, "create_planner", lambda: FakePlanner())
    monkeypatch.setattr(agent_module, "BrowserActions", FakeActions)
    monkeypatch.setattr(agent_module, "async_playwright", lambda: FakeAsyncPlaywright())

    agent = ITSupportAgent(task="Reset password task")
    result = asyncio.run(agent.run())

    assert result.status == "success"
    assert "done:Completed sequence" == result.summary
    assert any(item.startswith("start_task:") for item in agent.history)
    assert any(item == "todowrite:update" for item in agent.history)
    assert any(item.startswith("click:Users") for item in agent.history)


def test_browser_action_before_start_task_fails_runtime(monkeypatch) -> None:
    class BadOrderPlanner:
        def generate_todos(self, _task: str):
            return [{"title": "Init", "rationale": "model todo"}]

        def plan_action(self, **_kwargs):
            return {
                "tool": "browser_action",
                "input": {"action": "click", "target": "Users"},
            }

    class FakeLocator:
        async def inner_text(self, timeout=2500):
            _ = timeout
            return "Mock page body"

    class FakePage:
        def __init__(self):
            self.url = "http://localhost:5000"

        async def screenshot(self, full_page=True, type="png"):
            _ = (full_page, type)
            return b"png"

        def locator(self, _selector):
            return FakeLocator()

    class FakeContext:
        async def new_page(self):
            return FakePage()

    class FakeBrowser:
        async def new_context(self, viewport=None):
            _ = viewport
            return FakeContext()

        async def close(self):
            return None

    class FakeChromium:
        async def launch(self, headless=False):
            _ = headless
            return FakeBrowser()

    class FakePlaywright:
        def __init__(self):
            self.chromium = FakeChromium()

    class FakeAsyncPlaywright:
        async def __aenter__(self):
            return FakePlaywright()

        async def __aexit__(self, exc_type, exc, tb):
            _ = (exc_type, exc, tb)
            return False

    class FakeActions:
        def __init__(self, page):
            self.page = page

        async def navigate(self, url: str):
            self.page.url = url

        async def click(self, _target: str):
            return None

        async def type(self, _field: str, _value: str):
            return None

        async def select(self, _field: str, _value: str):
            return None

        async def wait(self, _seconds: float):
            return None

    monkeypatch.setenv("AGENT_MAX_STEPS", "2")
    monkeypatch.setattr(agent_module, "create_planner", lambda: BadOrderPlanner())
    monkeypatch.setattr(agent_module, "BrowserActions", FakeActions)
    monkeypatch.setattr(agent_module, "async_playwright", lambda: FakeAsyncPlaywright())

    agent = ITSupportAgent(task="Invalid tool order task")
    result = asyncio.run(agent.run())

    assert result.status == "failed"
    assert result.summary == "Max steps reached without complete_task. The LLM did not finalize the task."
    assert any(
        (
            "Protocol violation: model must call start_task before browser_action." in item
            or "Protocol violation: model must call start_task before mcp_navigation." in item
            or "Protocol violation: model must call start_task before mcp_user." in item
            or "Protocol violation: model must call start_task before mcp_license." in item
        )
        for item in agent.history
    )
