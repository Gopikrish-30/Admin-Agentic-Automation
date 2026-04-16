from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Callable


@dataclass
class AgentEvent:
    level: str
    message: str
    timestamp: str


class StreamEmitter:
    def __init__(self, callback: Callable[[AgentEvent], None] | None = None):
        self._callback = callback

    def emit(self, level: str, message: str) -> None:
        if self._callback is None:
            return
        self._callback(
            AgentEvent(level=level, message=message, timestamp=datetime.now(UTC).isoformat())
        )
