from __future__ import annotations

import uuid
from typing import Any

CONTRACT_VERSION = "navigator.action.v1"


def normalize_tool_call(tool_call: dict[str, Any]) -> dict[str, Any]:
    tool = str(tool_call.get("tool", "")).strip().lower()
    tool_input = tool_call.get("input")
    if not isinstance(tool_input, dict):
        tool_input = {}

    if not tool and tool_call.get("action"):
        tool = "browser_action"
        tool_input = tool_call

    return {"tool": tool, "input": tool_input}


def build_action_request(
    *,
    step: int,
    tool_call: dict[str, Any],
    task_started: bool,
) -> dict[str, Any]:
    normalized = normalize_tool_call(tool_call)
    return {
        "contractVersion": CONTRACT_VERSION,
        "type": "action.request",
        "requestId": str(uuid.uuid4()),
        "step": step,
        "protocol": {
            "taskStarted": task_started,
            "requiresStartTask": not task_started,
        },
        "toolCall": normalized,
    }


def extract_tool_call(request_envelope: dict[str, Any]) -> dict[str, Any]:
    tool_call = request_envelope.get("toolCall")
    if not isinstance(tool_call, dict):
        return {"tool": "", "input": {}}
    return normalize_tool_call(tool_call)


def build_action_result(
    *,
    request_envelope: dict[str, Any],
    done: bool,
    detail: str,
    error: str | None = None,
) -> dict[str, Any]:
    tool_call = extract_tool_call(request_envelope)
    return {
        "contractVersion": CONTRACT_VERSION,
        "type": "action.result",
        "requestId": str(request_envelope.get("requestId", "")),
        "step": int(request_envelope.get("step", 0) or 0),
        "tool": tool_call.get("tool", ""),
        "status": "error" if error else "ok",
        "done": bool(done),
        "detail": detail,
        **({"error": error} if error else {}),
    }
