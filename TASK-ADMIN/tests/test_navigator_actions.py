from __future__ import annotations

from agent.navigator_actions import (
    CONTRACT_VERSION,
    build_action_request,
    build_action_result,
    extract_tool_call,
    normalize_tool_call,
)


def test_normalize_tool_call_from_direct_action() -> None:
    normalized = normalize_tool_call({"action": "click", "target": "Users"})
    assert normalized["tool"] == "browser_action"
    assert normalized["input"]["action"] == "click"


def test_build_action_request_contains_contract_fields() -> None:
    envelope = build_action_request(
        step=3,
        tool_call={"tool": "browser_action", "input": {"action": "click", "target": "Users"}},
        task_started=True,
    )
    assert envelope["contractVersion"] == CONTRACT_VERSION
    assert envelope["type"] == "action.request"
    assert envelope["step"] == 3
    assert envelope["toolCall"]["tool"] == "browser_action"
    assert envelope["protocol"]["taskStarted"] is True


def test_extract_tool_call_reads_envelope() -> None:
    envelope = build_action_request(
        step=1,
        tool_call={"tool": "start_task", "input": {"goal": "x", "steps": ["a"]}},
        task_started=False,
    )
    tool_call = extract_tool_call(envelope)
    assert tool_call["tool"] == "start_task"
    assert tool_call["input"]["goal"] == "x"


def test_build_action_result_links_request() -> None:
    request = build_action_request(
        step=2,
        tool_call={"tool": "complete_task", "input": {"status": "success", "result_summary": "ok"}},
        task_started=True,
    )
    result = build_action_result(request_envelope=request, done=True, detail="done:ok")
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["type"] == "action.result"
    assert result["requestId"] == request["requestId"]
    assert result["tool"] == "complete_task"
    assert result["status"] == "ok"
    assert result["done"] is True
