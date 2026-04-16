from __future__ import annotations

NON_TASK_CONTINUATION_TOOLS = {
    "todowrite",
    "complete_task",
    "ask-user-question",
    "ask_user",
    "ask_user_question",
    "report_checkpoint",
    "report_thought",
    "request_file_permission",
}


EXEMPT_PRE_START_TOOLS = {
    "start_task",
    "todowrite",
    "ask-user-question",
    "ask_user",
    "ask_user_question",
}


def _matches_name_or_suffix(tool_name: str, base_name: str) -> bool:
    return tool_name == base_name or tool_name.endswith(f"_{base_name}")


def normalize_tool_name(tool_name: str) -> str:
    return (tool_name or "").strip().lower()


def is_start_task_tool(tool_name: str) -> bool:
    name = normalize_tool_name(tool_name)
    return _matches_name_or_suffix(name, "start_task")


def is_complete_task_tool(tool_name: str) -> bool:
    name = normalize_tool_name(tool_name)
    return _matches_name_or_suffix(name, "complete_task") or _matches_name_or_suffix(name, "complete-task")


def is_todowrite_tool(tool_name: str) -> bool:
    name = normalize_tool_name(tool_name)
    return _matches_name_or_suffix(name, "todowrite")


def is_non_task_continuation_tool(tool_name: str) -> bool:
    name = normalize_tool_name(tool_name)
    if is_start_task_tool(name):
        return True
    return any(_matches_name_or_suffix(name, base) for base in NON_TASK_CONTINUATION_TOOLS)


def is_exempt_pre_start_tool(tool_name: str) -> bool:
    name = normalize_tool_name(tool_name)
    return any(_matches_name_or_suffix(name, base) for base in EXEMPT_PRE_START_TOOLS)
