from __future__ import annotations

import pytest

from agent.completion_enforcer import CompletionEnforcer
from agent.start_task_contract import StartTaskContractError, validate_start_task_input
from agent.tool_policy import (
    is_complete_task_tool,
    is_exempt_pre_start_tool,
    is_non_task_continuation_tool,
    is_start_task_tool,
    is_todowrite_tool,
)


def test_tool_policy_suffix_aware_classification() -> None:
    assert is_start_task_tool('start_task')
    assert is_start_task_tool('mcp_start_task')
    assert is_todowrite_tool('todowrite')
    assert is_todowrite_tool('x_todowrite')
    assert is_complete_task_tool('complete_task')
    assert is_complete_task_tool('mcp_complete_task')
    assert is_non_task_continuation_tool('ask-user-question')
    assert is_exempt_pre_start_tool('ask_user')


def test_completion_enforcer_marks_completion_state() -> None:
    enforcer = CompletionEnforcer(max_continuations=2)
    enforcer.mark_tool_call('browser_action')
    assert enforcer.requires_completion_but_missing() is True

    enforcer.mark_tool_call('complete_task')
    assert enforcer.requires_completion_but_missing() is False

    enforcer.record_continuation()
    enforcer.record_continuation()
    assert enforcer.should_force_completion() is True


def test_start_task_contract_requires_full_schema_when_planning() -> None:
    valid = {
        'original_request': 'Reset password for john@company.com',
        'needs_planning': True,
        'goal': 'Reset password',
        'steps': ['Open users', 'Reset'],
        'verification': ['success flash'],
        'skills': ['it-admin-basics'],
    }
    parsed = validate_start_task_input(valid)
    assert parsed['original_request'].startswith('Reset')

    with pytest.raises(StartTaskContractError):
        validate_start_task_input({'needs_planning': True, 'skills': []})


def test_start_task_contract_rejects_protocol_repair_content_for_real_task() -> None:
    protocol_repair_payload = {
        'original_request': (
            'Protocol repair: your previous output was invalid. '
            'Return exactly one valid JSON tool call object now.'
        ),
        'needs_planning': True,
        'goal': 'Return one valid JSON object in start_task schema',
        'steps': ['Construct JSON object', 'Validate schema'],
        'verification': ['JSON is valid'],
        'skills': ['json-formatting'],
    }

    with pytest.raises(StartTaskContractError):
        validate_start_task_input(
            protocol_repair_payload,
            expected_request='Check if sarah@company.com exists and assign GitHub Copilot license.',
        )
