from __future__ import annotations

from dataclasses import dataclass

from agent.tool_policy import is_complete_task_tool, is_non_task_continuation_tool


@dataclass
class CompletionState:
    tools_used: bool = False
    complete_task_called: bool = False
    continuation_attempts: int = 0


class CompletionEnforcer:
    def __init__(self, max_continuations: int = 20):
        self.state = CompletionState()
        self.max_continuations = max_continuations

    def reset(self) -> None:
        self.state = CompletionState()

    def mark_tool_call(self, tool_name: str) -> None:
        if not is_non_task_continuation_tool(tool_name):
            self.state.tools_used = True
        if is_complete_task_tool(tool_name):
            self.state.complete_task_called = True

    def record_continuation(self) -> None:
        self.state.continuation_attempts += 1

    def should_force_completion(self) -> bool:
        return self.state.continuation_attempts >= self.max_continuations

    def requires_completion_but_missing(self) -> bool:
        return self.state.tools_used and not self.state.complete_task_called
