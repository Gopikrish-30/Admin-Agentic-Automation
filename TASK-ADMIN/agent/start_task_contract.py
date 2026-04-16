from __future__ import annotations

import re
from typing import Any


class StartTaskContractError(RuntimeError):
    pass


def validate_start_task_input(
    tool_input: dict[str, Any],
    expected_request: str | None = None,
) -> dict[str, Any]:
    original_request = str(tool_input.get("original_request", "")).strip()
    skills = tool_input.get("skills")
    needs_planning = tool_input.get("needs_planning")

    if not original_request:
        raise StartTaskContractError("start_task contract violation: original_request is required.")

    if not isinstance(skills, list):
        raise StartTaskContractError("start_task contract violation: skills must be an array.")

    if not isinstance(needs_planning, bool):
        raise StartTaskContractError("start_task contract violation: needs_planning must be boolean.")

    if needs_planning:
        goal = str(tool_input.get("goal", "")).strip()
        steps = tool_input.get("steps")
        verification = tool_input.get("verification")

        if not goal:
            raise StartTaskContractError("start_task contract violation: goal is required when needs_planning=true.")
        if not isinstance(steps, list) or not steps:
            raise StartTaskContractError("start_task contract violation: steps are required when needs_planning=true.")
        if not isinstance(verification, list) or not verification:
            raise StartTaskContractError(
                "start_task contract violation: verification is required when needs_planning=true."
            )

    if expected_request:
        _validate_intent_alignment(tool_input=tool_input, expected_request=expected_request)

    return tool_input


def _validate_intent_alignment(tool_input: dict[str, Any], expected_request: str) -> None:
    expected = expected_request.strip().lower()
    if not expected:
        return

    goal = str(tool_input.get("goal", "")).strip()
    steps = tool_input.get("steps")
    verification = tool_input.get("verification")
    parts: list[str] = [str(tool_input.get("original_request", "")), goal]
    if isinstance(steps, list):
        parts.extend(str(step) for step in steps)
    if isinstance(verification, list):
        parts.extend(str(item) for item in verification)
    combined = "\n".join(parts).lower()

    expected_emails = set(re.findall(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+", expected))
    combined_emails = set(re.findall(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+", combined))
    if expected_emails and not expected_emails.intersection(combined_emails):
        raise StartTaskContractError(
            "start_task contract violation: start_task content does not reference the task email(s)."
        )

    expected_tokens = _intent_tokens(expected)
    combined_tokens = _intent_tokens(combined)
    overlap = expected_tokens.intersection(combined_tokens)
    min_overlap = 2 if len(expected_tokens) >= 6 else 1

    repair_markers = (
        "protocol repair",
        "valid json",
        "tool call object",
        "no markdown",
        "no prose",
        "schema",
    )
    looks_like_protocol_repair = any(marker in combined for marker in repair_markers)
    expected_mentions_protocol = any(marker in expected for marker in repair_markers)

    if len(overlap) < min_overlap or (looks_like_protocol_repair and not expected_mentions_protocol):
        raise StartTaskContractError(
            "start_task contract violation: start_task content is not aligned with the original user intent."
        )


def _intent_tokens(text: str) -> set[str]:
    stop_words = {
        "the",
        "and",
        "for",
        "with",
        "then",
        "that",
        "this",
        "from",
        "into",
        "must",
        "should",
        "would",
        "your",
        "have",
        "has",
        "been",
        "true",
        "false",
        "json",
        "tool",
        "call",
        "object",
        "input",
        "output",
        "step",
        "steps",
    }
    return {
        token
        for token in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", text)
        if token not in stop_words
    }
