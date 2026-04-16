from __future__ import annotations

import asyncio
import time

from agent.agent import ITSupportAgent
from agent.planners import (
    PlannerError,
    PlannerParseError,
    apply_fallback_action,
    build_clarification_guard_action,
    decide_query_mode_with_model,
    extract_reset_password_task,
    extract_user_existence_task,
    is_actionable_task_text,
    parse_user_identity_text,
    resolve_create_user_request,
    parse_action_json,
)


def test_parse_json_direct() -> None:
    parsed = parse_action_json('{"action":"click","target":"Users"}')
    assert parsed["tool"] == "browser_action"
    assert parsed["input"]["action"] == "click"
    assert parsed["input"]["target"] == "Users"


def test_parse_json_from_markdown() -> None:
    parsed = parse_action_json(
        """Here is the action:\n```json\n{\"action\":\"done\",\"result\":\"ok\"}\n```"""
    )
    assert parsed["tool"] == "complete_task"
    assert parsed["input"]["result_summary"] == "ok"


def test_parse_json_with_extra_text_and_multiple_objects() -> None:
    parsed = parse_action_json(
        """
        analysis: trying next step
        {\"note\":\"ignore\"}
        final tool call:
        {\"tool\":\"browser_action\",\"input\":{\"action\":\"click\",\"target\":\"Users\"}}
        """
    )
    assert parsed["tool"] == "browser_action"
    assert parsed["input"]["action"] == "click"


def test_parse_native_tool_call_passthrough() -> None:
    parsed = parse_action_json(
        '{"tool":"ask-user-question","input":{"question":"Need email"}}'
    )
    assert parsed["tool"] == "ask-user-question"
    assert parsed["input"]["question"] == "Need email"


def test_parse_mcp_user_tool_passthrough() -> None:
    parsed = parse_action_json(
        '{"tool":"mcp.user","input":{"action":"check_user_exists","email":"sarah@company.com"}}'
    )
    assert parsed["tool"] == "mcp_user"
    assert parsed["input"]["action"] == "check_user_exists"
    assert parsed["input"]["email"] == "sarah@company.com"


def test_parse_command_prompt_schema() -> None:
    parsed = parse_action_json(
        '{"command":"prompt","args":{"message":"Please provide the user email."}}'
    )
    assert parsed["tool"] == "ask-user-question"
    assert parsed["input"]["question"] == "Please provide the user email."


def test_parse_command_click_schema() -> None:
    parsed = parse_action_json(
        '{"command":"click","args":{"target":"Users"}}'
    )
    assert parsed["tool"] == "browser_action"
    assert parsed["input"]["action"] == "click"
    assert parsed["input"]["target"] == "Users"


def test_parse_plain_text_question_fallback() -> None:
    parsed = parse_action_json("What IT admin action should I run for 'Gopi'? Please provide the required details.")
    assert parsed["tool"] == "ask-user-question"
    assert "what it admin action" in parsed["input"]["question"].lower()


def test_parse_invalid_payload_raises_parse_error() -> None:
    try:
        parse_action_json("I am not JSON")
    except PlannerParseError as exc:
        assert "json" in str(exc).lower() or "schema" in str(exc).lower()
        return
    raise AssertionError("Expected PlannerParseError for invalid payload")


def test_execute_action_done_branch() -> None:
    agent = ITSupportAgent(task="noop")

    async def _run():
        done, detail = await agent._execute_tool_call(
            None,
            {"tool": "complete_task", "input": {"status": "success", "result_summary": "ok"}},
            task_started=True,
        )
        assert done is True
        assert detail == "done:ok"

    asyncio.run(_run())


def test_mcp_user_routes_to_browser_action(monkeypatch) -> None:
    agent = ITSupportAgent(task="noop")

    async def _fake_execute_browser_action(_actions, payload):
        assert payload["action"] == "check_user_exists"
        assert payload["email"] == "sarah@company.com"
        return False, "check_user_exists:sarah@company.com:not_found"

    monkeypatch.setattr(agent, "_execute_browser_action", _fake_execute_browser_action)

    async def _run():
        done, detail = await agent._execute_tool_call(
            None,
            {
                "tool": "mcp.user",
                "input": {"action": "check_user_exists", "email": "sarah@company.com"},
            },
            task_started=True,
        )
        assert done is False
        assert detail == "check_user_exists:sarah@company.com:not_found"

    asyncio.run(_run())


def test_domain_tool_call_maps_assign_license_to_mcp_license() -> None:
    agent = ITSupportAgent(task="noop")
    call = agent._build_domain_tool_call_from_action(
        {"action": "assign_license", "email": "sarah@company.com", "product": "GitHub Copilot"}
    )
    assert call["tool"] == "mcp_license"
    assert call["input"]["action"] == "assign_license"


def test_normalize_planned_tool_call_promotes_browser_action_to_mcp_domain() -> None:
    agent = ITSupportAgent(task="noop")
    normalized = agent._normalize_planned_tool_call(
        {
            "tool": "browser_action",
            "input": {"action": "check_user_exists", "email": "sarah@company.com"},
        }
    )
    assert normalized["tool"] == "mcp_user"
    assert normalized["input"]["action"] == "check_user_exists"


def test_normalize_planned_tool_call_promotes_raw_action_to_mcp_navigation() -> None:
    agent = ITSupportAgent(task="noop")
    normalized = agent._normalize_planned_tool_call({"action": "click", "target": "Users"})
    assert normalized["tool"] == "mcp_navigation"
    assert normalized["input"]["action"] == "click"


def test_ask_model_with_timeout_sets_degraded_mode() -> None:
    agent = ITSupportAgent(task="noop")
    agent.planner_timeout_seconds = 0.1

    def _slow_ask_model(**_kwargs):
        time.sleep(0.4)
        return {"tool": "start_task", "input": {}}

    agent._ask_model = _slow_ask_model  # type: ignore[assignment]

    async def _run():
        try:
            await agent._ask_model_with_timeout(
                screenshot_b64="",
                visible_text="",
                current_url="http://localhost:5000/users",
                history_text="",
            )
        except PlannerError as exc:
            assert "switching to deterministic fallback mode" in str(exc).lower()
            return
        raise AssertionError("Expected PlannerError from timed out planner call")

    asyncio.run(_run())
    assert agent.planner_degraded is True


def test_browser_action_requires_start_task() -> None:
    agent = ITSupportAgent(task="noop")

    async def _run():
        try:
            await agent._execute_tool_call(
                None,
                {"tool": "browser_action", "input": {"action": "click", "target": "Users"}},
                task_started=False,
            )
        except RuntimeError as exc:
            assert "must call start_task" in str(exc)
            return
        raise AssertionError("Expected RuntimeError for browser_action before start_task")

    asyncio.run(_run())


def test_start_task_runtime_rejects_protocol_repair_intent_mismatch() -> None:
    agent = ITSupportAgent(
        task="Check if sarah@company.com exists. If not, create her with role viewer.",
    )

    async def _run():
        try:
            await agent._execute_tool_call(
                None,
                {
                    "tool": "start_task",
                    "input": {
                        "original_request": "Protocol repair: return one valid JSON object.",
                        "needs_planning": True,
                        "goal": "Return valid start_task schema JSON",
                        "steps": ["Construct one JSON object"],
                        "verification": ["Output is valid JSON"],
                        "skills": ["json-formatting"],
                    },
                },
                task_started=False,
            )
        except RuntimeError as exc:
            assert "start_task contract violation" in str(exc)
            return
        raise AssertionError("Expected runtime start_task contract violation for intent mismatch")

    asyncio.run(_run())


def test_todowrite_allows_only_one_in_progress() -> None:
    agent = ITSupportAgent(task="noop")

    async def _run():
        try:
            await agent._execute_tool_call(
                None,
                {
                    "tool": "todowrite",
                    "input": {
                        "todos": [
                            {"id": "1", "title": "A", "status": "in_progress"},
                            {"id": "2", "title": "B", "status": "in_progress"},
                        ]
                    },
                },
                task_started=True,
            )
        except RuntimeError as exc:
            assert "only one todo can be in_progress" in str(exc)
            return
        raise AssertionError("Expected RuntimeError for multiple in_progress todos")

    asyncio.run(_run())


def test_mark_all_todos_completed() -> None:
    agent = ITSupportAgent(task="noop")
    agent.todos = [
        {"id": "1", "title": "A", "rationale": "", "status": "pending"},
        {"id": "2", "title": "B", "rationale": "", "status": "in_progress"},
    ]

    agent._mark_all_todos_completed()

    assert all(todo["status"] == "completed" for todo in agent.todos)


def test_extract_license_target_from_select_payload() -> None:
    agent = ITSupportAgent(task="noop")
    target = agent._extract_license_target_from_payload(
        {
            "action": "select",
            "field": "License for sarah@company.com",
            "value": "GitHub Copilot",
        }
    )
    assert target == ("sarah@company.com", "GitHub Copilot")


def test_latest_check_user_outcome_reads_history() -> None:
    agent = ITSupportAgent(task="noop")
    agent.history = [
        "check_user_exists:sarah@company.com:not_found",
        "create_user:sarah@company.com",
        "check_user_exists:sarah@company.com:found",
    ]
    assert agent._latest_check_user_outcome("sarah@company.com") == "found"


def test_build_recovery_create_user_input_defaults_viewer() -> None:
    agent = ITSupportAgent(task="Check if sarah@company.com exists. If not, create her with role viewer.")
    payload = agent._build_recovery_create_user_input("sarah@company.com")
    assert payload["action"] == "create_user"
    assert payload["email"] == "sarah@company.com"
    assert payload["role"] == "viewer"
    assert payload["name"]


def test_build_degraded_start_task_call_has_required_schema() -> None:
    agent = ITSupportAgent(task="Check if sarah@company.com exists.")
    agent.todos = [
        {"id": "1", "title": "Open users page", "rationale": "", "status": "pending"},
        {"id": "2", "title": "Check user record", "rationale": "", "status": "pending"},
    ]

    call = agent._build_degraded_start_task_call()
    assert call["tool"] == "start_task"
    data = call["input"]
    assert data["original_request"] == "Check if sarah@company.com exists."
    assert data["needs_planning"] is True
    assert isinstance(data["steps"], list) and data["steps"]
    assert isinstance(data["verification"], list) and data["verification"]
    assert isinstance(data["skills"], list) and data["skills"]


def test_degraded_start_task_call_passes_runtime_contract() -> None:
    agent = ITSupportAgent(task="Check if sarah@company.com exists.")

    async def _run():
        done, detail = await agent._execute_tool_call(
            None,
            agent._build_degraded_start_task_call(),
            task_started=False,
        )
        assert done is False
        assert detail.startswith("start_task:")

    asyncio.run(_run())


def test_ask_user_updates_task_context_and_todos() -> None:
    class FakePlanner:
        def generate_todos(self, task: str):
            return [{"title": f"Do: {task}", "rationale": "updated from user answer"}]

    agent = ITSupportAgent(task="hiii", question_handler=lambda _q: "Reset password for john@company.com to Welcome@2031")
    agent.planner = FakePlanner()

    async def _run():
        done, detail = await agent._execute_tool_call(
            None,
            {"tool": "ask-user-question", "input": {"question": "clarify"}},
            task_started=True,
        )
        assert done is False
        assert detail.startswith("ask_user:")

    asyncio.run(_run())
    assert "reset password" in agent.task.lower()
    assert agent.todos
    assert "Do: Reset password" in agent.todos[0]["title"]


def test_ask_user_details_only_keeps_original_intent() -> None:
    class FakePlanner:
        def generate_todos(self, task: str):
            return [{"title": f"Do: {task}", "rationale": "updated from user answer"}]

    agent = ITSupportAgent(
        task="Change password for user Harry, if not exist create new",
        question_handler=lambda _q: "email is harry123@gmail.com, name is Harry and role is Admin",
    )
    agent.planner = FakePlanner()

    async def _run():
        done, detail = await agent._execute_tool_call(
            None,
            {"tool": "ask-user-question", "input": {"question": "clarify"}},
            task_started=True,
        )
        assert done is False
        assert detail.startswith("ask_user:")

    asyncio.run(_run())
    assert "change password" in agent.task.lower()
    assert "user details:" in agent.task.lower()
    assert "harry123@gmail.com" in agent.task.lower()


def test_ask_user_details_with_role_user_keeps_original_intent() -> None:
    class FakePlanner:
        def generate_todos(self, task: str):
            return [{"title": f"Do: {task}", "rationale": "updated from user answer"}]

    agent = ITSupportAgent(
        task="check if any user named Gopi2004 exists, if not create it",
        question_handler=lambda _q: "Email is hhh@gmail.com and role is user",
    )
    agent.planner = FakePlanner()

    async def _run():
        done, detail = await agent._execute_tool_call(
            None,
            {"tool": "ask-user-question", "input": {"question": "clarify"}},
            task_started=True,
        )
        assert done is False
        assert detail.startswith("ask_user:")

    asyncio.run(_run())
    assert "check if any user named gopi2004 exists" in agent.task.lower()
    assert "user details:" in agent.task.lower()
    assert "hhh@gmail.com" in agent.task.lower()


def test_change_password_is_actionable() -> None:
    assert is_actionable_task_text("Change password for user Harry")


def test_check_user_if_not_create_is_actionable() -> None:
    assert is_actionable_task_text("check is any user named Gopi2004 if not create it")


def test_extract_user_existence_task_by_name() -> None:
    parsed = extract_user_existence_task("Check if user Gopi exists")
    assert parsed is not None
    assert parsed["name"].lower() == "gopi"


def test_parse_user_identity_text_extracts_password() -> None:
    parsed = parse_user_identity_text(
        "email is har@gmail.com, full name is Harry, role is admin and password is Gopi@2004"
    )
    assert parsed["email"] == "har@gmail.com"
    assert parsed["name"].lower().startswith("harry")
    assert parsed["role"] == "admin"
    assert parsed["password"] == "Gopi@2004"


def test_parse_user_identity_from_named_phrase() -> None:
    parsed = parse_user_identity_text("check is any user named Gopi2004 if not create it")
    assert parsed["name"] == "Gopi2004"


def test_parse_user_identity_name_with_semicolon() -> None:
    parsed = parse_user_identity_text("Name ; Harry , email is 123@gmail.com and role is user")
    assert parsed["name"] == "Harry"
    assert parsed["email"] == "123@gmail.com"
    assert parsed["role"] == "user"


def test_resolve_create_user_request_uses_password_from_history() -> None:
    req, missing = resolve_create_user_request(
        task="Create new user",
        history_text="user_answer:email is har@gmail.com, name is Harry, role is admin and password is Gopi@2004",
    )
    assert not missing
    assert req["email"] == "har@gmail.com"
    assert req["password"] == "Gopi@2004"


def test_resolve_create_user_request_accepts_bare_name_answer() -> None:
    req, missing = resolve_create_user_request(
        task="check if user exists then create new user",
        history_text=(
            "user_answer:Email is hhh@gmail.com and role is user\n"
            "user_answer:Harry"
        ),
    )
    assert not missing
    assert req["email"] == "hhh@gmail.com"
    assert req["role"] == "user"
    assert req["name"] == "Harry"


def test_extract_reset_password_task_supports_change_password_phrase() -> None:
    parsed = extract_reset_password_task('change password for this user nina@company.com to "123@213"')
    assert parsed is not None
    assert parsed["email"] == "nina@company.com"
    assert parsed["password"] == "123@213"


def test_fallback_reset_missing_user_asks_for_email_or_create() -> None:
    result = apply_fallback_action(
        parsed={"action": "wait", "seconds": 1.0},
        task="reset password for user@company.com to NewPass#2026",
        current_url="http://localhost:5000/users",
        visible_text="Users table has john@company.com only",
        history_text="start_task:reset password",
    )
    assert result["action"] == "ask_user"
    assert "cannot find user user@company.com" in result["question"].lower()


def test_fallback_reset_missing_user_blocks_after_repeat_question() -> None:
    result = apply_fallback_action(
        parsed={"action": "wait", "seconds": 1.0},
        task="reset password for user@company.com to NewPass#2026",
        current_url="http://localhost:5000/users",
        visible_text="Users table has john@company.com only",
        history_text="start_task:reset password\nask_user:I cannot find user user@company.com on the Users page.",
    )
    assert result["tool"] == "complete_task"
    assert result["input"]["status"] == "blocked"


def test_fallback_user_existence_clicks_users_when_not_on_users_page() -> None:
    result = apply_fallback_action(
        parsed={"action": "wait", "seconds": 1.0},
        task="Check if user Gopi exists",
        current_url="http://localhost:5000/",
        visible_text="",
        history_text="start_task:check user existence",
    )
    assert result["action"] == "click"
    assert result["target"] == "Users"


def test_fallback_user_existence_completes_when_found_marker_present() -> None:
    result = apply_fallback_action(
        parsed={"action": "wait", "seconds": 1.0},
        task="Check if user Gopi exists",
        current_url="http://localhost:5000/users",
        visible_text="",
        history_text="start_task:check user existence\ncheck_user_exists:Gopi:found",
    )
    assert result["tool"] == "complete_task"
    assert result["input"]["status"] == "success"
    assert "exists" in result["input"]["result_summary"].lower()


def test_fallback_conditional_license_completes_after_assign_marker() -> None:
    result = apply_fallback_action(
        parsed={"action": "wait", "seconds": 1.0},
        task="Check if sarah@company.com exists. If not, create her with role viewer. Then assign her a GitHub Copilot license.",
        current_url="http://localhost:5000/users",
        visible_text="",
        history_text="start_task:conditional\nassign_license:sarah@company.com:GitHub Copilot",
    )
    assert result["action"] == "done"
    assert "github copilot" in result["result"].lower()


def test_fallback_delete_user_returns_blocked_completion() -> None:
    result = apply_fallback_action(
        parsed={"action": "wait", "seconds": 1.0},
        task="hiii",
        current_url="http://localhost:5000",
        visible_text="Users",
        history_text="user_answer:delete a user called gopi",
    )
    assert result["tool"] == "complete_task"
    assert result["input"]["status"] == "blocked"


def test_clarification_guard_for_greeting_starts_task_first() -> None:
    action = build_clarification_guard_action(task="heyyy", history_text="navigate:http://localhost:5000")
    assert action is not None
    assert action["tool"] == "start_task"


def test_clarification_guard_asks_after_start_task() -> None:
    action = build_clarification_guard_action(task="hiii", history_text="start_task:Collect required task details")
    assert action is not None
    assert action["tool"] == "ask-user-question"


def test_clarification_guard_blocks_after_repeat_clarification() -> None:
    action = build_clarification_guard_action(
        task="hello",
        history_text=(
            "start_task:Collect required task details\n"
            "ask_user:Please provide a concrete IT task=>hi"
        ),
    )
    assert action is not None
    assert action["tool"] == "complete_task"
    assert action["input"]["status"] == "blocked"


def test_routing_fallback_keeps_explicit_reset_as_automation(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_BACKEND", "opencode")

    class BrokenOpenCodePlanner:
        def __init__(self, model: str):
            self.model = model

        def _run_opencode(self, prompt: str) -> str:
            raise RuntimeError("routing model unavailable")

    monkeypatch.setattr("agent.planners.OpenCodePlanner", BrokenOpenCodePlanner)

    route = decide_query_mode_with_model("Reset password for john@company.com to Welcome@2032")
    assert route["mode"] == "automation"


def test_routing_greeting_stays_chat_without_model(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_BACKEND", "opencode")

    class ShouldNotRunOpenCodePlanner:
        def __init__(self, model: str):
            self.model = model

        def _run_opencode(self, prompt: str) -> str:
            raise AssertionError("Heuristic greeting route should not call model")

    monkeypatch.setattr("agent.planners.OpenCodePlanner", ShouldNotRunOpenCodePlanner)

    route = decide_query_mode_with_model("hiii")
    assert route["mode"] == "chat"
