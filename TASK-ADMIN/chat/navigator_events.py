from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from agent.stream import AgentEvent

EVENT_VERSION = "navigator.v1"

_LEVEL_TO_EVENT_TYPE: dict[str, str] = {
    "status": "run.status",
    "thought": "agent.thought",
    "action": "agent.action",
    "todo": "agent.todo",
    "question": "agent.question",
    "answer": "user.answer",
    "assistant": "assistant.message",
    "error": "run.error",
    "final": "run.final",
}

_EVENT_SOURCE: dict[str, str] = {
    "status": "system",
    "thought": "agent",
    "action": "agent",
    "todo": "agent",
    "question": "agent",
    "answer": "user",
    "assistant": "assistant",
    "error": "system",
    "final": "system",
}


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def to_navigator_event(
    *,
    level: str,
    message: str,
    timestamp: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_level = level.strip().lower() if level else "status"
    event_type = _LEVEL_TO_EVENT_TYPE.get(normalized_level, "agent.event")
    source = _EVENT_SOURCE.get(normalized_level, "agent")

    event_payload: dict[str, Any] = {
        "version": EVENT_VERSION,
        "eventType": event_type,
        "source": source,
        "timestamp": timestamp or _utc_now_iso(),
        "message": message,
        # Backward-compatible fields consumed by existing UI/tests.
        "level": normalized_level,
    }

    if payload:
        event_payload["payload"] = payload

    return event_payload


def from_agent_event(event: AgentEvent) -> dict[str, Any]:
    return to_navigator_event(
        level=event.level,
        message=event.message,
        timestamp=event.timestamp,
    )
