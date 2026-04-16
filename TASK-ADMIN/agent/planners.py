from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from openai import OpenAI

from agent.prompts import build_system_prompt, build_user_prompt


class PlannerError(RuntimeError):
    pass


class PlannerParseError(PlannerError):
    pass


class ActionPlanner(ABC):
    @abstractmethod
    def generate_todos(self, task: str) -> list[dict[str, str]]:
        raise NotImplementedError

    @abstractmethod
    def plan_action(
        self,
        task: str,
        panel_url: str,
        current_url: str,
        history_text: str,
        screenshot_b64: str,
        visible_text: str,
        todo_text: str,
    ) -> dict[str, Any]:
        raise NotImplementedError


class OpenAIPlanner(ActionPlanner):
    def __init__(self, model: str, api_key: str):
        self.model = model
        self.client = OpenAI(api_key=api_key)
        self.skills_text = load_skills_text()

    def _chat_text(self, user_prompt: str, system_prompt: str | None = None) -> str:
        messages: list[dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0,
        )
        content = response.choices[0].message.content if response.choices else ""
        return (content or "").strip()

    def generate_todos(self, task: str) -> list[dict[str, str]]:
        if (
            extract_reset_password_task(task)
            or extract_create_user_task(task)
            or extract_conditional_license_task(task)
            or extract_user_existence_task(task)
        ):
            return heuristic_todos(task)
        prompt = (
            "Create a concise execution todo list for this IT support task. "
            "Return only JSON array with items having title and rationale. "
            "Use the provided task details directly when present. Task: "
            + task
        )
        raw = self._chat_text(user_prompt=prompt)
        todos = parse_todos_json(raw)
        if is_generic_helpdesk_todo_list(todos):
            return heuristic_todos(task)
        return todos or heuristic_todos(task)

    def plan_action(
        self,
        task: str,
        panel_url: str,
        current_url: str,
        history_text: str,
        screenshot_b64: str,
        visible_text: str,
        todo_text: str,
    ) -> dict[str, Any]:
        execution_feedback = visible_text
        system_prompt = build_system_prompt(task=task, panel_url=panel_url, skills_text=self.skills_text)
        user_prompt = build_user_prompt(
            current_url=current_url,
            history_text=history_text,
            todo_text=todo_text,
            execution_feedback=execution_feedback,
        )
        if history_text.count("wait:") >= 2:
            user_prompt += (
                "\n\nAnti-stall directive: Do not return a wait action now. "
                "Return either ask-user-question or a concrete browser_action."
            )

        image_note = "[Screenshot captured by runtime; use execution feedback and action history for grounding.]"
        raw = self._chat_text(
            user_prompt=user_prompt + "\n\n" + image_note,
            system_prompt=system_prompt,
        )
        try:
            parsed = parse_action_json(raw)
        except PlannerParseError as exc:
            repair_prompt = (
                "Protocol repair: your previous output was invalid. "
                "Return exactly one valid JSON tool call object now. "
                "If start_task has not been called, you MUST return start_task with full input schema: "
                '{"tool":"start_task","input":{"original_request":"...","needs_planning":true,"goal":"...","steps":["..."],"verification":["..."],"skills":["..."]}}. '
                "No markdown. No prose."
            )
            repaired_raw = self._chat_text(user_prompt=repair_prompt, system_prompt=system_prompt)
            try:
                parsed = parse_action_json(repaired_raw)
            except PlannerParseError as repair_exc:
                raise PlannerError(f"Planner parse failed after repair retry: {repair_exc}") from exc
        if "start_task:" not in history_text and parsed.get("tool") != "start_task":
            repair_prompt = (
                "Protocol correction: first valid tool call MUST be start_task. "
                "Return only JSON object with schema "
                '{"tool":"start_task","input":{"original_request":"...","needs_planning":true,"goal":"...","steps":["..."],"verification":["..."],"skills":["..."]}}. '
                "Do not return browser_action yet."
            )
            repaired = parse_action_json(
                self._chat_text(
                    user_prompt=repair_prompt + "\nTask: " + task,
                    system_prompt=system_prompt,
                )
            )
            if repaired.get("tool") == "start_task":
                return repaired
            raise PlannerError("Protocol repair failed: planner did not return start_task.")

        if "start_task:" in history_text and parsed.get("tool") == "start_task":
            correction_prompt = (
                "Protocol correction: start_task has already completed. "
                "Do NOT return start_task again. "
                "Return exactly one JSON object using one of: todowrite, browser_action, "
                "ask-user-question, connector_call, complete_task."
            )
            corrected = parse_action_json(
                self._chat_text(
                    user_prompt=correction_prompt + "\nTask: " + task + "\nHistory:\n" + history_text,
                    system_prompt=system_prompt,
                )
            )
            if corrected.get("tool") != "start_task":
                return corrected
            raise PlannerError("Protocol correction failed: planner repeated start_task after task start.")
        return parsed


class OpenCodePlanner(ActionPlanner):
    def __init__(self, model: str):
        self.model = model
        self.skills_text = load_skills_text()
        self.fallback_models = list(
            dict.fromkeys(
                [
                    self.model,
                    "openai/gpt-5.3-codex",
                    "openai/gpt-5.3-codex-spark",
                    "openai/gpt-5.2",
                    "openai/gpt-4.1",
                ]
            )
        )

    def _resolve_opencode_command(self) -> str:
        candidates = ["opencode", "opencode.cmd", "opencode.exe"]
        for candidate in candidates:
            resolved = shutil.which(candidate)
            if resolved:
                return resolved

        appdata = os.getenv("APPDATA")
        if appdata:
            npm_bin = os.path.join(appdata, "npm")
            for candidate in ["opencode.cmd", "opencode.exe", "opencode"]:
                possible = os.path.join(npm_bin, candidate)
                if os.path.exists(possible):
                    return possible

        raise PlannerError(
            "OpenCode CLI not found on PATH. Install and login: `npm i -g opencode-ai` and `opencode auth login`."
        )

    def _run_opencode(self, prompt: str) -> str:
        opencode_cmd = self._resolve_opencode_command()
        last_error = ""

        for model in self.fallback_models:
            cmd = [opencode_cmd, "run", "--format", "json", "--model", model, prompt]
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=90,
                    check=False,
                )
            except FileNotFoundError as exc:
                raise PlannerError("OpenCode CLI not available for planner execution.") from exc
            except subprocess.TimeoutExpired as exc:
                raise PlannerError("OpenCode planning timed out.") from exc

            if result.returncode != 0:
                last_error = (result.stderr or "").strip()[-1000:]
                if "not supported" in last_error.lower() or "bad request" in last_error.lower():
                    continue
                raise PlannerError(
                    "OpenCode planning failed. " + (f"Details: {last_error}" if last_error else "")
                )

            extracted = extract_text_from_opencode_json_stream(result.stdout)
            error_message = extract_opencode_error_message(extracted)
            if error_message:
                last_error = error_message[-1000:]
                lowered = error_message.lower()
                if "not supported" in lowered or "bad request" in lowered or "unsupported" in lowered:
                    continue
                raise PlannerError(
                    "OpenCode planning failed. " + (f"Details: {last_error}" if last_error else "")
                )

            if extracted.strip():
                return extracted

            last_error = "OpenCode returned empty output."
            continue

        raise PlannerError(
            "OpenCode planning failed after trying compatible models. "
            + (f"Last error: {last_error}" if last_error else "")
        )

    def generate_todos(self, task: str) -> list[dict[str, str]]:
        if (
            extract_reset_password_task(task)
            or extract_create_user_task(task)
            or extract_conditional_license_task(task)
            or extract_user_existence_task(task)
        ):
            return heuristic_todos(task)
        prompt = (
            "Create an execution todo list for the IT support task. "
            "Return ONLY JSON array where each item has title and rationale. "
            "Use the task details directly when present and keep steps concrete.\nTask:\n"
            + task
        )
        raw = self._run_opencode(prompt)
        todos = parse_todos_json(raw)
        if is_generic_helpdesk_todo_list(todos):
            return heuristic_todos(task)
        return todos or heuristic_todos(task)

    def plan_action(
        self,
        task: str,
        panel_url: str,
        current_url: str,
        history_text: str,
        screenshot_b64: str,
        visible_text: str,
        todo_text: str,
    ) -> dict[str, Any]:
        del screenshot_b64
        execution_feedback = visible_text

        start_required = "start_task:" not in history_text
        prompt = (
            "You are producing ONE JSON command for an EXTERNAL IT admin automation runtime.\n"
            "Important: this is not your workspace/tool environment.\n"
            "Do not mention files, shell commands, bash, apply_patch, read, or available workspace tools.\n"
            "Always return exactly one JSON object and nothing else.\n"
            "Allowed external tools: start_task, todowrite, ask-user-question, mcp_navigation, mcp_user, mcp_license, browser_action, connector_call, complete_task.\n"
            "Do not ask the user to restate the same task when the task already includes an actionable intent.\n"
            "For example, if task says 'Check if user Gopi exists', proceed with that task directly.\n"
            "Browser-use discipline: use visible controls only, avoid repeating the same failing selector, and switch strategy after repeated failures.\n"
            + (
                "First-call rule: because start_task is not yet in history, your next tool MUST be start_task.\n"
                if start_required
                else "start_task is already present in history; continue with the next best tool.\n"
            )
            + "Task:\n"
            + task
            + "\n\nPanel URL:\n"
            + panel_url
            + "\n\nCurrent URL:\n"
            + current_url
            + "\n\nTodo list:\n"
            + (todo_text if todo_text.strip() else "No todos yet")
            + "\n\nRecent history:\n"
            + history_text
            + "\n\nExecution feedback (structured action results):\n"
            + execution_feedback[:2800]
            + "\n\nJSON schema examples:\n"
            + '{"tool":"start_task","input":{"original_request":"Reset password for john@company.com","needs_planning":true,"goal":"Reset password for john@company.com","steps":["Open users page","Reset password"],"verification":["success flash appears"],"skills":["it-admin-basics"]}}\n'
            + '{"tool":"mcp_navigation","input":{"action":"click","target":"Users"}}\n'
            + '{"tool":"mcp_user","input":{"action":"check_user_exists","email":"sarah@company.com"}}\n'
            + '{"tool":"mcp_license","input":{"action":"assign_license","email":"sarah@company.com","product":"GitHub Copilot"}}\n'
            + '{"tool":"browser_action","input":{"action":"click","target":"Users"}}\n'
            + '{"tool":"ask-user-question","input":{"question":"Please provide the user email."}}\n'
            + "Output only one JSON object."
        )

        raw = self._run_opencode(prompt)
        try:
            parsed = parse_action_json(raw)
        except PlannerParseError as exc:
            repair_prompt = (
                "Protocol repair: your previous output was invalid. "
                "Return exactly one valid JSON tool call object now. "
                "If start_task has not been called, you MUST return start_task with full input schema: "
                '{"tool":"start_task","input":{"original_request":"...","needs_planning":true,"goal":"...","steps":["..."],"verification":["..."],"skills":["..."]}}. '
                "No markdown. No prose.\n"
                + "Task:\n"
                + task
            )
            repaired_raw = self._run_opencode(repair_prompt)
            try:
                parsed = parse_action_json(repaired_raw)
            except PlannerParseError as repair_exc:
                raise PlannerError(f"OpenCode parse failed after repair retry: {repair_exc}") from exc

        if "start_task:" not in history_text and parsed.get("tool") != "start_task":
            repair_prompt = (
                "Protocol correction: first valid tool call MUST be start_task. "
                "Return only JSON object with schema "
                '{"tool":"start_task","input":{"original_request":"...","needs_planning":true,"goal":"...","steps":["..."],"verification":["..."],"skills":["..."]}}. '
                "Do not return browser_action yet.\nTask:\n"
                + task
            )
            repaired_raw = self._run_opencode(repair_prompt)
            repaired = parse_action_json(repaired_raw)
            if repaired.get("tool") == "start_task":
                return repaired
            raise PlannerError("Protocol repair failed: planner did not return start_task.")

        if "start_task:" in history_text and parsed.get("tool") == "start_task":
            correction_prompt = (
                "Protocol correction: start_task has already completed. "
                "Do NOT return start_task again. "
                "Return exactly one JSON object using one of: todowrite, browser_action, "
                "ask-user-question, connector_call, complete_task.\n"
                + "Task:\n"
                + task
                + "\nHistory:\n"
                + history_text
            )
            corrected_raw = self._run_opencode(correction_prompt)
            corrected = parse_action_json(corrected_raw)
            if corrected.get("tool") != "start_task":
                return corrected
            raise PlannerError("Protocol correction failed: planner repeated start_task after task start.")

        return parsed


def create_planner() -> ActionPlanner:
    backend = os.getenv("AGENT_BACKEND", "opencode").strip().lower()
    if backend == "openai":
        model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise PlannerError("OPENAI_API_KEY is required when AGENT_BACKEND=openai.")
        return OpenAIPlanner(model=model, api_key=api_key)

    if backend == "opencode":
        model = os.getenv("OPENCODE_MODEL", "openai/gpt-5.2")
        return OpenCodePlanner(model=model)

    raise PlannerError("AGENT_BACKEND must be one of: opencode, openai")


def decide_query_mode_with_model(task: str) -> dict[str, str]:
    if is_greeting_only(task):
        return {
            "mode": "chat",
            "message": "Hi. Tell me the exact IT admin action you want me to perform.",
        }

    backend = os.getenv("AGENT_BACKEND", "opencode").strip().lower()

    prompt = (
        "Classify the user request for an IT admin assistant. "
        "Return ONLY JSON object: {\"mode\":\"chat|automation\",\"message\":\"...\"}.\n"
        "Rules:\n"
        "- mode=chat for greetings, small talk, vague/general questions, or unsupported requests.\n"
        "- mode=automation only for actionable admin panel tasks.\n"
        "- Supported automation tasks in this demo: reset password, create user, assign/check license, check if user exists.\n"
        "- User deletion is unsupported in this demo: use mode=chat and explain the limitation briefly.\n"
        "- For mode=chat, message should be a concise helpful reply.\n"
        "- For mode=automation, message should be a short summary of intended task.\n\n"
        f"User request:\n{task}"
    )

    try:
        if backend == "openai":
            model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
            api_key = os.getenv("OPENAI_API_KEY", "").strip()
            if not api_key:
                raise PlannerError("OPENAI_API_KEY is required when AGENT_BACKEND=openai.")
            planner = OpenAIPlanner(model=model, api_key=api_key)
            raw = planner._chat_text(user_prompt=prompt)
            return parse_query_mode_json(raw)

        model = os.getenv("OPENCODE_MODEL", "openai/gpt-5.2-codex")
        planner = OpenCodePlanner(model=model)
        raw = planner._run_opencode(prompt)
        return parse_query_mode_json(raw)
    except Exception:  # noqa: BLE001
        # Fail-open to automation so the LLM execution loop remains the primary controller.
        return {
            "mode": "automation",
            "message": "Proceeding with requested IT admin automation task.",
        }


def decide_query_mode_heuristic(task: str) -> dict[str, str] | None:
    text = task.strip()
    if not text:
        return {
            "mode": "chat",
            "message": (
                "Please provide a concrete IT admin request, for example: "
                "reset password for user@company.com to NewPass#2026"
            ),
        }

    lower = text.lower()
    if is_greeting_only(text):
        return {
            "mode": "chat",
            "message": "Hi. Tell me the exact IT admin action you want me to perform.",
        }

    if ("delete" in lower or "remove" in lower) and "user" in lower:
        return {
            "mode": "chat",
            "message": (
                "User deletion is not supported in this demo. I can reset passwords, create users, "
                "or assign/check licenses."
            ),
        }

    if not is_likely_automation_request(text):
        return None

    if extract_reset_password_task(text):
        return {
            "mode": "automation",
            "message": "Password reset task detected.",
        }

    if extract_conditional_license_task(text):
        return {
            "mode": "automation",
            "message": "User-exists and license assignment workflow detected.",
        }

    if "create" in lower and "user" in lower:
        return {
            "mode": "automation",
            "message": "User creation workflow detected.",
        }

    if "license" in lower and ("assign" in lower or "check" in lower):
        return {
            "mode": "automation",
            "message": "License-related admin workflow detected.",
        }

    return {
        "mode": "automation",
        "message": "Proceeding with requested IT admin automation task.",
    }


def is_likely_automation_request(task: str) -> bool:
    lower = task.lower()
    has_email = re.search(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+", task) is not None

    if "reset" in lower and "password" in lower:
        return True
    if "create" in lower and "user" in lower:
        return True
    if "assign" in lower and "license" in lower:
        return True
    if "check if" in lower and "exists" in lower and ("user" in lower or has_email):
        return True
    if "license" in lower and has_email:
        return True

    return False


def parse_query_mode_json(content: str) -> dict[str, str]:
    parsed = _extract_first_json_object(content)

    if not isinstance(parsed, dict):
        raise PlannerParseError("Routing output is not a JSON object.")

    mode = str(parsed.get("mode", "")).strip().lower()
    message = str(parsed.get("message", "")).strip()
    if mode not in {"chat", "automation"}:
        raise PlannerParseError(f"Invalid routing mode: {mode}")

    if not message:
        message = (
            "Please provide a concrete IT admin request, for example: "
            "reset password for user@company.com to NewPass#2026"
            if mode == "chat"
            else "Proceeding with automation task."
        )

    return {"mode": mode, "message": message}


def load_skills_text() -> str:
    root = Path(__file__).resolve().parent.parent
    skills_dir = root / "skills"
    if not skills_dir.exists():
        return ""

    enabled = os.getenv("SKILLS_ENABLED", "all").strip().lower()
    allowed = None if enabled == "all" else {name.strip().lower() for name in enabled.split(",") if name.strip()}

    chunks: list[str] = []
    for path in sorted(skills_dir.glob("*.md")):
        skill_name = path.stem.lower()
        if allowed is not None and skill_name not in allowed:
            continue
        chunks.append(f"## Skill: {path.stem}\n{path.read_text(encoding='utf-8')[:4000]}")
    return "\n\n".join(chunks)


def extract_text_from_opencode_json_stream(stdout: str) -> str:
    text_parts: list[str] = []
    for line in (stdout or "").splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue

        msg_type = message.get("type")
        if msg_type == "text":
            part = message.get("part") or {}
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                text_parts.append(text)
        elif msg_type == "error":
            return json.dumps(message)

    if text_parts:
        return "\n".join(text_parts).strip()

    return (stdout or "").strip()


def extract_opencode_error_message(text: str) -> str | None:
    candidate = (text or "").strip()
    if not candidate:
        return None

    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None
    if parsed.get("type") != "error":
        return None

    error = parsed.get("error")
    if isinstance(error, dict):
        data = error.get("data")
        if isinstance(data, dict):
            message = str(data.get("message", "")).strip()
            if message:
                return message
        message = str(error.get("message", "")).strip()
        if message:
            return message

    return str(parsed).strip() or "OpenCode error"


def parse_action_json(content: str) -> dict[str, Any]:
    if not content:
        raise PlannerParseError("Planner returned empty action output.")

    candidates = _extract_json_object_candidates(content)
    if not candidates:
        inferred_question = _infer_question_from_text(content)
        if inferred_question:
            return {
                "tool": "ask-user-question",
                "input": {"question": inferred_question},
            }
        raise PlannerParseError("Planner action output is not a JSON object.")

    for parsed in candidates:
        if parsed.get("type") == "error":
            continue

        command = str(parsed.get("command", "")).strip().lower()
        if command:
            normalized_command = command.replace("-", "_")
            command_alias = normalized_command.replace(".", "_")
            args = parsed.get("args")
            if not isinstance(args, dict):
                args = {}

            if command_alias in {"prompt", "ask", "ask_user", "ask_user_question"}:
                question = str(
                    args.get("message")
                    or args.get("question")
                    or parsed.get("message")
                    or parsed.get("question")
                    or "Need clarification"
                ).strip()
                return {
                    "tool": "ask-user-question",
                    "input": {"question": question},
                }

            if command_alias in {"navigate", "click", "type", "select", "wait"}:
                browser_payload = {"action": command_alias, **args}
                return {"tool": "browser_action", "input": browser_payload}

            if command_alias in {
                "check_user_exists",
                "check_user",
                "create_user",
                "reset_password",
                "assign_license",
            }:
                return {
                    "tool": "browser_action",
                    "input": {
                        "action": command_alias,
                        "commandPayload": parsed,
                    },
                }

            if command_alias == "done":
                result_summary = str(
                    args.get("result")
                    or args.get("summary")
                    or parsed.get("result")
                    or "Task completed."
                ).strip()
                return {
                    "tool": "complete_task",
                    "input": {"status": "success", "result_summary": result_summary},
                }

            if command_alias == "complete":
                result_summary = str(
                    args.get("result_summary")
                    or args.get("summary")
                    or parsed.get("result_summary")
                    or "Task completed."
                ).strip()
                status = str(
                    args.get("status")
                    or parsed.get("status")
                    or "success"
                ).strip()
                return {
                    "tool": "complete_task",
                    "input": {"status": status, "result_summary": result_summary},
                }

            if command_alias in {
                "start_task",
                "todowrite",
                "browser_action",
                "connector_call",
                "complete_task",
                "mcp_navigation",
                "mcp_user",
                "mcp_license",
            }:
                normalized_tool = "complete_task" if command_alias == "complete_task" else command_alias
                return {"tool": normalized_tool, "input": args}

        tool = str(parsed.get("tool", "")).strip().lower()
        tool_alias = tool.replace("-", "_").replace(".", "_")
        if tool_alias in {
            "start_task",
            "todowrite",
            "ask_user_question",
            "complete_task",
            "connector_call",
            "browser_action",
            "mcp_navigation",
            "mcp_user",
            "mcp_license",
        }:
            normalized_input = parsed.get("input")
            if not isinstance(normalized_input, dict):
                normalized_input = {}
            normalized_tool = "ask-user-question" if tool_alias == "ask_user_question" else tool_alias
            return {"tool": normalized_tool, "input": normalized_input}

        action = str(parsed.get("action", "")).strip().lower()
        if action == "ask":
            question = str(parsed.get("target") or parsed.get("question") or "Need clarification")
            return {"tool": "ask-user-question", "input": {"question": question}}

        if action in {"navigate", "click", "type", "select", "wait", "done", "ask_user", "connector_call"}:
            if action == "ask_user":
                question = str(parsed.get("question", "Need clarification from user")).strip()
                return {"tool": "ask-user-question", "input": {"question": question}}
            if action == "done":
                result = str(parsed.get("result", "Task completed.")).strip()
                return {
                    "tool": "complete_task",
                    "input": {"status": "success", "result_summary": result},
                }
            if action == "connector_call":
                return {
                    "tool": "connector_call",
                    "input": {
                        "name": str(parsed.get("name", "")).strip(),
                        "args": parsed.get("args") if isinstance(parsed.get("args"), dict) else {},
                    },
                }
            return {"tool": "browser_action", "input": parsed}

    raise PlannerParseError(f"Planner output did not match supported action schema: {candidates[0]}")


def _infer_question_from_text(content: str) -> str | None:
    text = re.sub(r"\s+", " ", (content or "").strip())
    if not text:
        return None

    lower = text.lower()
    question_markers = (
        "please provide",
        "what",
        "which",
        "who",
        "can you",
        "could you",
        "need",
    )
    if not any(marker in lower for marker in question_markers):
        return None

    if "?" in text:
        head = text.split("?", 1)[0].strip()
        if head:
            return f"{head}?"

    if len(text) <= 320:
        return text

    return None


def parse_todos_json(content: str) -> list[dict[str, str]]:
    data = _extract_first_json_array(content)
    if data is None:
        return []

    if not isinstance(data, list):
        return []

    todos: list[dict[str, str]] = []
    for idx, item in enumerate(data, start=1):
        if isinstance(item, dict):
            title = str(item.get("title") or f"Step {idx}").strip()
            rationale = str(item.get("rationale") or "").strip()
        else:
            title = str(item).strip()
            rationale = ""
        if title:
            todos.append({"title": title, "rationale": rationale})
    return todos


def heuristic_todos(task: str) -> list[dict[str, str]]:
    lower = task.lower()
    todos: list[dict[str, str]] = []
    if "reset password" in lower:
        todos.extend(
            [
                {"title": "Open users page", "rationale": "Password actions are in user management."},
                {"title": "Locate target user", "rationale": "Find exact row by email."},
                {"title": "Reset password", "rationale": "Fill new password and submit."},
                {"title": "Verify success", "rationale": "Confirm success flash appears."},
            ]
        )
    elif "create" in lower and "user" in lower:
        todos.extend(
            [
                {"title": "Open users page", "rationale": "Creation form lives there."},
                {"title": "Fill user details", "rationale": "Email, name, role, and initial password."},
                {"title": "Submit create user", "rationale": "Persist new user."},
                {"title": "Verify user exists", "rationale": "Confirm in table/flash."},
            ]
        )
    elif ("check" in lower and "user" in lower and ("exist" in lower or "exists" in lower)):
        todos.extend(
            [
                {"title": "Open users page", "rationale": "User records are listed in user management."},
                {"title": "Locate target user", "rationale": "Search by provided email or name."},
                {"title": "Decide existence outcome", "rationale": "Determine if user exists or not."},
                {"title": "Report result", "rationale": "Return clear existence status to requester."},
            ]
        )
    else:
        todos.extend(
            [
                {"title": "Inspect admin panel state", "rationale": "Understand current page and options."},
                {"title": "Execute requested action", "rationale": "Perform task through visible controls."},
                {"title": "Verify result", "rationale": "Confirm success signal."},
            ]
        )
    return todos


def is_generic_helpdesk_todo_list(todos: list[dict[str, str]]) -> bool:
    if not todos:
        return False
    merged = " ".join((item.get("title", "") + " " + item.get("rationale", "")) for item in todos).lower()
    generic_markers = [
        "confirm scope",
        "collect environment details",
        "known outages",
        "standard diagnostics",
        "escalate with a complete handoff",
    ]
    return any(marker in merged for marker in generic_markers)


def _extract_first_json_object(content: str) -> dict[str, Any] | None:
    text = (content or "").strip()
    if not text:
        return None

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    fenced_matches = re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    for candidate in fenced_matches:
        try:
            parsed = json.loads(candidate.strip())
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue

    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(text):
        brace = text.find("{", idx)
        if brace == -1:
            break
        try:
            parsed, _end = decoder.raw_decode(text[brace:])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
        idx = brace + 1

    return None


def _extract_json_object_candidates(content: str) -> list[dict[str, Any]]:
    text = (content or "").strip()
    if not text:
        return []

    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add_candidate(obj: dict[str, Any]) -> None:
        key = json.dumps(obj, sort_keys=True)
        if key not in seen:
            seen.add(key)
            candidates.append(obj)

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            _add_candidate(parsed)
    except json.JSONDecodeError:
        pass

    fenced_matches = re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    for candidate in fenced_matches:
        try:
            parsed = json.loads(candidate.strip())
            if isinstance(parsed, dict):
                _add_candidate(parsed)
        except json.JSONDecodeError:
            continue

    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(text):
        brace = text.find("{", idx)
        if brace == -1:
            break
        try:
            parsed, _end = decoder.raw_decode(text[brace:])
            if isinstance(parsed, dict):
                _add_candidate(parsed)
        except json.JSONDecodeError:
            pass
        idx = brace + 1

    return candidates


def _extract_first_json_array(content: str) -> list[Any] | None:
    text = (content or "").strip()
    if not text:
        return None

    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass

    fenced_matches = re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    for candidate in fenced_matches:
        try:
            parsed = json.loads(candidate.strip())
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            continue

    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(text):
        bracket = text.find("[", idx)
        if bracket == -1:
            break
        try:
            parsed, _end = decoder.raw_decode(text[bracket:])
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
        idx = bracket + 1

    return None


def extract_user_existence_task(task: str) -> dict[str, str] | None:
    lowered = task.lower()
    if "check" not in lowered or "user" not in lowered or ("exist" not in lowered and "exists" not in lowered):
        return None

    email_match = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)", task)
    if email_match:
        return {"email": email_match.group(1).strip().lower(), "name": ""}

    parsed = parse_user_identity_text(task)
    name = parsed.get("name", "").strip()
    if name:
        return {"email": "", "name": name}

    called_match = re.search(r"user\s+(?:name\s+)?(?:called|named)\s+([A-Za-z0-9._-]{2,60})", task, flags=re.IGNORECASE)
    if called_match:
        return {"email": "", "name": called_match.group(1).strip()}

    direct_match = re.search(r"check\s+if\s+user\s+([A-Za-z0-9._-]{2,60})\s+exists", task, flags=re.IGNORECASE)
    if direct_match:
        return {"email": "", "name": direct_match.group(1).strip()}

    return None


def apply_fallback_action(
    parsed: dict[str, Any],
    task: str,
    current_url: str,
    visible_text: str,
    history_text: str,
) -> dict[str, Any]:
    action = str(parsed.get("action", "")).strip().lower()
    if action not in {"", "wait", "ask", "unknown"}:
        return parsed

    effective_task = resolve_effective_task(task=task, history_text=history_text)
    effective_lower = effective_task.lower()

    if should_require_clarification(effective_task):
        if has_asked_for_clarification(history_text):
            return {
                "tool": "complete_task",
                "input": {
                    "status": "blocked",
                    "result_summary": (
                        "Task is still too vague after clarification. Please provide a concrete IT action, "
                        "for example: reset password for <email> to <new password>, or create user with email/name/role."
                    ),
                },
            }
        return {
            "tool": "ask-user-question",
            "input": {
                "question": (
                    "Please provide a concrete IT task. Example formats: "
                    "'Reset password for john@company.com to Welcome@2030' or "
                    "'Create user email=alice@company.com name=Alice role=viewer'."
                )
            },
        }

    if ("delete" in effective_lower or "remove" in effective_lower) and "user" in effective_lower:
        return {
            "tool": "complete_task",
            "input": {
                "status": "blocked",
                "result_summary": (
                    "User deletion is not supported in this demo admin panel. "
                    "Supported actions include reset password, create user, and license assignment."
                ),
            },
        }

    reset_req = extract_reset_password_task(effective_task)
    if reset_req:
        return fallback_reset_password_action(reset_req, current_url, visible_text, history_text)

    existence_req = extract_user_existence_task(effective_task)
    if existence_req and not ("create" in effective_lower and "user" in effective_lower):
        return fallback_user_existence_action(existence_req, current_url, history_text)

    if "create" in effective_lower and "user" in effective_lower:
        create_req, missing_fields = resolve_create_user_request(effective_task, history_text)
        if missing_fields:
            fields = ", ".join(missing_fields)
            return {
                "action": "ask_user",
                "question": f"I need details to create the user. Please provide: {fields}.",
            }
        return fallback_create_user_action(create_req, current_url, visible_text, history_text)

    conditional_req = extract_conditional_license_task(effective_task)
    if conditional_req:
        return fallback_conditional_license_action(conditional_req, current_url, visible_text, history_text)

    return {"action": "wait", "seconds": 1.0}


def resolve_effective_task(task: str, history_text: str) -> str:
    task_text = task.strip()
    if is_actionable_task_text(task_text):
        return task_text

    answer_lines = [line for line in history_text.splitlines() if line.startswith("user_answer:")]
    for line in reversed(answer_lines):
        answer = line.split("user_answer:", 1)[1].strip()
        if is_actionable_task_text(answer):
            return answer

    if answer_lines:
        return answer_lines[-1].split("user_answer:", 1)[1].strip() or task_text

    return task_text


def is_actionable_task_text(text: str) -> bool:
    lowered = text.lower()
    intent_patterns = [
        r"\b(reset|change)\s+password\b",
        r"\bcreate\s+(?:new\s+)?user\b",
        r"\bassign\b.*\blicense\b",
        r"\bcheck\s+if\b.*\bexists\b",
        r"\bcheck\b.*\buser\b",
        r"\bif\s+not\s+create\b.*\buser\b",
        r"\bif\s+not\s+create\s+it\b",
        r"\bdelete\b.*\buser\b",
        r"\bremove\b.*\buser\b",
    ]
    return any(re.search(pattern, lowered) for pattern in intent_patterns)


def is_greeting_only(text: str) -> bool:
    cleaned = re.sub(r"[^a-zA-Z ]", " ", text.lower()).strip()
    if not cleaned:
        return True
    greeting_tokens = {
        "hi",
        "hii",
        "hiii",
        "hello",
        "hey",
        "heyy",
        "heyyy",
        "yo",
        "sup",
        "hola",
        "namaste",
        "ok",
        "okay",
        "thanks",
        "thank you",
    }
    return cleaned in greeting_tokens


def should_require_clarification(task_text: str) -> bool:
    text = task_text.strip()
    if not text:
        return True
    if is_greeting_only(text):
        return True
    return not is_actionable_task_text(text)


def has_asked_for_clarification(history_text: str) -> bool:
    lowered = history_text.lower()
    markers = [
        "ask_user:",
        "need clarification",
        "please provide a concrete it task",
        "blocked and need clearer task details",
    ]
    return any(marker in lowered for marker in markers)


def build_clarification_guard_action(task: str, history_text: str) -> dict[str, Any] | None:
    effective_task = resolve_effective_task(task=task, history_text=history_text)
    if not should_require_clarification(effective_task):
        return None

    if "start_task:" not in history_text:
        return {
            "tool": "start_task",
            "input": {
                "goal": "Collect required task details before browser actions",
                "steps": [
                    "Collect missing task details",
                    "Execute requested action",
                    "Verify result",
                ],
            },
        }

    if has_asked_for_clarification(history_text):
        return {
            "tool": "complete_task",
            "input": {
                "status": "blocked",
                "result_summary": (
                    "Task is still not actionable after clarification. Please submit a concrete IT request."
                ),
            },
        }

    return {
        "tool": "ask-user-question",
        "input": {
            "question": (
                "Please provide a concrete IT task with required fields. Example: "
                "reset password for user@company.com to NewPass#2026"
            )
        },
    }


def extract_reset_password_task(task: str) -> dict[str, str] | None:
    match = re.search(
        r"(?:reset|change)\s+password\s+(?:for\s+)?(?:this\s+user\s+)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)\s+to\s+([^\n\r]+)",
        task,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    email = match.group(1).strip().lower()
    password = match.group(2).strip().strip('"').strip("'")
    if not password:
        return None
    return {"email": email, "password": password}


def extract_create_user_task(task: str) -> dict[str, str] | None:
    parsed = parse_user_identity_text(task)
    if not parsed.get("email") and not parsed.get("name") and not parsed.get("role"):
        return None
    return {
        "email": parsed.get("email", ""),
        "name": parsed.get("name", ""),
        "role": parsed.get("role", ""),
        "password": parsed.get("password", "Start#123"),
    }


def extract_conditional_license_task(task: str) -> dict[str, str] | None:
    pattern = re.search(
        r"check\s+if\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)\s+exists.*?create\s+(?:her|him|them)?\s*with\s+role\s+([a-zA-Z]+).*?assign\s+(?:her|him|them)?\s+a\s+([^\.]+?)\s+license",
        task,
        flags=re.IGNORECASE,
    )
    if not pattern:
        return None

    email = pattern.group(1).strip().lower()
    role = pattern.group(2).strip().lower()
    license_name = pattern.group(3).strip()
    return {
        "email": email,
        "name": email.split("@")[0].replace(".", " ").title(),
        "role": role,
        "license": license_name,
        "password": "Start#123",
    }


def fallback_reset_password_action(
    req: dict[str, str],
    current_url: str,
    visible_text: str,
    history_text: str,
) -> dict[str, Any]:
    email = req["email"]
    password = req["password"]
    visible_lower = visible_text.lower()

    if "password reset completed" in visible_lower and email in visible_lower:
        return {"action": "done", "result": f"Password reset completed for {email}"}

    if "/users" not in current_url:
        return {"action": "click", "target": "Users"}

    if email not in visible_lower:
        already_asked = f"ask_user:I cannot find user {email}" in history_text
        if already_asked:
            return {
                "tool": "complete_task",
                "input": {
                    "status": "blocked",
                    "result_summary": (
                        f"User {email} was not found on the Users page. "
                        "Provide a valid email or ask to create the user first."
                    ),
                },
            }
        return {
            "action": "ask_user",
            "question": (
                f"I cannot find user {email} on the Users page. "
                "Please provide a valid existing email, or say to create this user first "
                "with full name, role, and optional password."
            ),
        }

    if f"new password for {email}" in visible_lower:
        already_typed = f"type:New Password for {email}={password}" in history_text
        if already_typed and f"reset password {email}" in visible_lower:
            return {"action": "click", "target": f"Reset Password {email}"}
        return {"action": "type", "field": f"New Password for {email}", "value": password}

    if f"reset password {email}" in visible_lower:
        return {"action": "click", "target": f"Reset Password {email}"}

    return {"action": "wait", "seconds": 1.0}


def fallback_create_user_action(
    req: dict[str, str],
    current_url: str,
    visible_text: str,
    history_text: str,
) -> dict[str, Any]:
    email = req["email"]
    name = req["name"]
    role = req["role"]
    password = req["password"]
    visible_lower = visible_text.lower()

    if f"user {email} created successfully" in visible_lower:
        return {"action": "done", "result": f"User {email} created successfully"}

    if "/users" not in current_url:
        return {"action": "click", "target": "Users"}

    if email in visible_lower and "click:Create User" in history_text:
        return {"action": "done", "result": f"User {email} created successfully"}

    if f"type:Email={email}" not in history_text:
        return {"action": "type", "field": "Email", "value": email}

    if f"type:Full Name={name}" not in history_text:
        return {"action": "type", "field": "Full Name", "value": name}

    if f"select:Role={role}" not in history_text:
        return {"action": "select", "field": "Role", "value": role}

    if f"type:Initial Password={password}" not in history_text:
        return {"action": "type", "field": "Initial Password", "value": password}

    return {"action": "click", "target": "Create User"}


def fallback_user_existence_action(
    req: dict[str, str],
    current_url: str,
    history_text: str,
) -> dict[str, Any]:
    email = req.get("email", "").strip().lower()
    name = req.get("name", "").strip()
    identifier = email or name

    if not identifier:
        return {
            "action": "ask_user",
            "question": "Please provide the target user email or name to check existence.",
        }

    if "/users" not in current_url:
        return {"action": "click", "target": "Users"}

    matches = re.findall(r"check_user_exists:([^:]+):(found|not_found)", history_text, flags=re.IGNORECASE)
    for seen_identifier, outcome in reversed(matches):
        if seen_identifier.strip().lower() != identifier.lower():
            continue
        if outcome.lower() == "found":
            return {
                "tool": "complete_task",
                "input": {
                    "status": "success",
                    "result_summary": f"User {identifier} exists.",
                },
            }
        return {
            "tool": "complete_task",
            "input": {
                "status": "success",
                "result_summary": f"User {identifier} does not exist.",
            },
        }

    payload: dict[str, Any] = {"action": "check_user_exists"}
    if email:
        payload["email"] = email
    if name:
        payload["name"] = name
    return payload


def extract_create_user_from_history(history_text: str) -> dict[str, str] | None:
    answer_lines = [line for line in history_text.splitlines() if line.startswith("user_answer:")]
    if not answer_lines:
        return None

    merged: dict[str, str] = {}
    for line in answer_lines:
        text = line.split("user_answer:", 1)[1].strip()
        parsed = parse_user_identity_text(text)
        for key, value in parsed.items():
            if value:
                merged[key] = value

        # If user answers with just a probable name (e.g., "Harry") after a full-name question,
        # treat it as name detail instead of re-asking forever.
        if (
            not parsed.get("name")
            and re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,60}", text)
            and "@" not in text
            and "role" not in text.lower()
            and "password" not in text.lower()
        ):
            merged["name"] = text.strip().strip(",")

    if not merged:
        return None

    return {
        "email": merged.get("email", ""),
        "name": merged.get("name", ""),
        "role": merged.get("role", ""),
        "password": merged.get("password", "Start#123"),
    }


def resolve_create_user_request(task: str, history_text: str) -> tuple[dict[str, str], list[str]]:
    req = {
        "email": "",
        "name": "",
        "role": "",
        "password": "Start#123",
    }

    from_task = extract_create_user_task(task)
    if from_task:
        req.update({k: from_task.get(k, "") for k in ("email", "name", "role")})
        if from_task.get("password"):
            req["password"] = from_task["password"]

    from_history = extract_create_user_from_history(history_text)
    if from_history:
        for k in ("email", "name", "role"):
            if from_history.get(k):
                req[k] = from_history[k]
        if from_history.get("password"):
            req["password"] = from_history["password"]

    missing_fields: list[str] = []
    if not req["email"]:
        missing_fields.append("email")
    if not req["name"]:
        missing_fields.append("full name")
    if not req["role"]:
        missing_fields.append("role (admin/user/viewer)")

    return req, missing_fields


def parse_user_identity_text(text: str) -> dict[str, str]:
    parsed: dict[str, str] = {}

    email_match = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)", text)
    if email_match:
        parsed["email"] = email_match.group(1).strip().lower()

    name_match = re.search(
        r"(?:full\s*name|name)\b\s*(?:=|:|;|is)?\s*([A-Za-z][A-Za-z .'-]{1,60})",
        text,
        flags=re.IGNORECASE,
    )
    if name_match:
        name = name_match.group(1).strip().strip(",")
        name = re.sub(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+", "", name).strip(" ,")
        name = re.split(r"\band\s+(?:the\s+)?role\b", name, flags=re.IGNORECASE)[0].strip(" ,")
        name = re.split(r"\band\s+role\b", name, flags=re.IGNORECASE)[0].strip(" ,")
        name = re.split(r"\brole\b", name, flags=re.IGNORECASE)[0].strip(" ,")
        # Trim trailing role phrases accidentally captured in casual answers.
        if name:
            parsed["name"] = name

    if not parsed.get("name"):
        named_match = re.search(r"\bnamed\s+([A-Za-z0-9._-]{2,60})", text, flags=re.IGNORECASE)
        if named_match:
            parsed["name"] = named_match.group(1).strip()

    role_match = re.search(r"role\s*(?:=|:|is)?\s*([A-Za-z ]+)", text, flags=re.IGNORECASE)
    role_value = role_match.group(1).strip().lower() if role_match else ""
    role_value = role_value.replace(".", "").replace(",", "").strip()
    if "admin" in role_value:
        parsed["role"] = "admin"
    elif "viewer" in role_value:
        parsed["role"] = "viewer"
    elif "user" in role_value:
        parsed["role"] = "user"
    elif any(word in role_value for word in ["any", "your wish", "ur wish", "whatever"]):
        parsed["role"] = "user"

    password_match = re.search(
        r"(?:initial\s+password|password)\s*(?:=|:|is)?\s*([A-Za-z0-9@#_!$%\^&*()\-+=?.]{4,128})",
        text,
        flags=re.IGNORECASE,
    )
    if password_match:
        parsed["password"] = password_match.group(1).strip().strip(",.")

    return parsed


def fallback_conditional_license_action(
    req: dict[str, str],
    current_url: str,
    visible_text: str,
    history_text: str,
) -> dict[str, Any]:
    email = req["email"]
    role = req["role"]
    license_name = req["license"]
    visible_lower = visible_text.lower()
    history_lower = history_text.lower()

    if f"assigned {license_name.lower()} to {email}" in visible_lower:
        return {"action": "done", "result": f"Assigned {license_name} to {email}"}

    if f"assign_license:{email}:{license_name}".lower() in history_lower:
        return {"action": "done", "result": f"Assigned {license_name} to {email}"}

    if "/users" not in current_url:
        return {"action": "click", "target": "Users"}

    if email not in visible_lower:
        return fallback_create_user_action(
            {
                "email": email,
                "name": req["name"],
                "role": role,
                "password": req["password"],
            },
            current_url,
            visible_text,
            history_text,
        )

    return {
        "action": "assign_license",
        "email": email,
        "product": license_name,
    }
