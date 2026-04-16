from __future__ import annotations

from agent.stream import AgentEvent
from chat.navigator_events import EVENT_VERSION, from_agent_event, to_navigator_event


def test_to_navigator_event_keeps_legacy_fields() -> None:
    event = to_navigator_event(level="status", message="Routing request", timestamp="routing")
    assert event["version"] == EVENT_VERSION
    assert event["eventType"] == "run.status"
    assert event["source"] == "system"
    assert event["timestamp"] == "routing"
    assert event["level"] == "status"
    assert event["message"] == "Routing request"


def test_from_agent_event_maps_thought() -> None:
    legacy = AgentEvent(level="thought", message="Step reasoning", timestamp="t1")
    event = from_agent_event(legacy)
    assert event["eventType"] == "agent.thought"
    assert event["source"] == "agent"
    assert event["timestamp"] == "t1"
    assert event["level"] == "thought"
    assert event["message"] == "Step reasoning"
