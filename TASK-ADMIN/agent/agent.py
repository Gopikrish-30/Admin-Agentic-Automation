from __future__ import annotations

import asyncio
import base64
import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable

from playwright.async_api import async_playwright

from agent.actions import BrowserActions
from agent.completion_enforcer import CompletionEnforcer
from agent.connectors import ConnectorManager
from agent.navigator_actions import (
    build_action_request,
    build_action_result,
    extract_tool_call,
)
from agent.planners import (
    PlannerError,
    apply_fallback_action,
    create_planner,
    extract_reset_password_task,
    is_actionable_task_text,
    resolve_create_user_request,
    resolve_effective_task,
)
from agent.start_task_contract import StartTaskContractError, validate_start_task_input
from agent.stream import StreamEmitter
from agent.tool_policy import (
    is_complete_task_tool,
    is_exempt_pre_start_tool,
    is_start_task_tool,
    is_todowrite_tool,
    normalize_tool_name,
)


@dataclass
class AgentResult:
    status: str
    summary: str
    steps: int


class ITSupportAgent:
    def __init__(
        self,
        task: str,
        callback=None,
        question_handler: Callable[[str], str] | None = None,
    ):
        self.task = task
        self.panel_url = os.getenv("ADMIN_PANEL_URL", "http://localhost:5000")
        self.max_steps = int(os.getenv("AGENT_MAX_STEPS", "20"))
        self.timeout_seconds = int(os.getenv("AGENT_TIMEOUT_SECONDS", "240"))
        planner_timeout_raw = os.getenv("AGENT_PLANNER_TIMEOUT_SECONDS", "25").strip()
        try:
            self.planner_timeout_seconds = float(planner_timeout_raw)
        except ValueError:
            self.planner_timeout_seconds = 25.0
        self.headless = os.getenv("AGENT_HEADLESS", "false").lower() == "true"
        self.question_handler = question_handler
        self.history: list[str] = []
        self.stream = StreamEmitter(callback)
        self.planner = None
        self.todos: list[dict[str, str]] = []
        self.current_todo_index = 0
        self.connectors = ConnectorManager()
        self.completion_enforcer = CompletionEnforcer(
            max_continuations=int(os.getenv("AGENT_MAX_CONTINUATIONS", "20"))
        )
        self.execution_journal: list[dict[str, Any]] = []
        self.planner_degraded = False

    async def run(self) -> AgentResult:
        try:
            self.planner = create_planner()
        except PlannerError as exc:
            return AgentResult(
                status="failed",
                summary=str(exc),
                steps=0,
            )

        self.planner_degraded = False
        self.stream.emit("status", "Launching browser session")
        try:
            return await asyncio.wait_for(self._run_loop(), timeout=self.timeout_seconds)
        except asyncio.TimeoutError:
            summary = "Agent timed out before completing the task."
            self.stream.emit("error", summary)
            return AgentResult(status="timeout", summary=summary, steps=len(self.history))

    async def _run_loop(self) -> AgentResult:
        async with async_playwright() as playwright:
            self.completion_enforcer.reset()
            self.execution_journal = []
            browser = await playwright.chromium.launch(headless=self.headless)
            context = await browser.new_context(viewport={"width": 1280, "height": 900})
            page = await context.new_page()
            actions = BrowserActions(page)
            await actions.navigate(self.panel_url)
            self.history.append(f"navigate:{self.panel_url}")
            self._initialize_todos()

            last_detail = ""
            repeat_count = 0
            task_started = False
            license_select_failures: dict[str, int] = {}
            license_recovery_target: dict[str, str] | None = None

            for step in range(1, self.max_steps + 1):
                self.completion_enforcer.record_continuation()
                self._mark_todo_in_progress()
                self.stream.emit("status", f"Step {step}: taking screenshot")
                try:
                    screenshot_b64 = await self._take_screenshot(page)
                except Exception as exc:  # noqa: BLE001
                    screenshot_b64 = ""
                    self.stream.emit(
                        "error",
                        f"Screenshot capture failed; continuing without image context: {exc}",
                    )
                history_text = "\n".join(self.history[-10:]) or "No prior actions."
                execution_feedback_text = self._execution_feedback_text()
                if license_recovery_target:
                    recovery_email = license_recovery_target["email"]
                    recovery_product = license_recovery_target["product"]
                    outcome = self._latest_check_user_outcome(recovery_email)

                    if outcome is None:
                        planned_action = {
                            "tool": "mcp_user",
                            "input": {
                                "action": "check_user_exists",
                                "email": recovery_email,
                            },
                        }
                    elif outcome == "not_found" and not self._history_contains(f"create_user:{recovery_email}"):
                        planned_action = {
                            "tool": "mcp_user",
                            "input": self._build_recovery_create_user_input(recovery_email),
                        }
                    else:
                        planned_action = {
                            "tool": "mcp_license",
                            "input": {
                                "action": "assign_license",
                                "email": recovery_email,
                                "product": recovery_product,
                            },
                        }
                    self.stream.emit("thought", f"Step {step}: recovery tool call {planned_action}")
                else:
                    try:
                        if self.planner_degraded:
                            raise PlannerError(
                                "Planner is in degraded mode after a previous timeout; using fallback actions."
                            )

                        planned_action = await self._ask_model_with_timeout(
                            screenshot_b64=screenshot_b64,
                            visible_text=execution_feedback_text,
                            current_url=page.url,
                            history_text=history_text,
                        )
                    except PlannerError as exc:
                        detail = f"Planner failed: {exc}"
                        lowered_exc = str(exc).lower()
                        if "timeout" in lowered_exc or "timed out" in lowered_exc:
                            self.planner_degraded = True
                        self.stream.emit("error", detail)
                        self.history.append(f"error:{detail}")

                        if not task_started:
                            planned_action = self._build_degraded_start_task_call()
                            self.stream.emit(
                                "thought",
                                f"Step {step}: deterministic fallback bootstrap {planned_action}",
                            )
                            action_request = build_action_request(
                                step=step,
                                tool_call=planned_action,
                                task_started=task_started,
                            )
                            self.stream.emit(
                                "thought",
                                f"navigator.action.request {json.dumps(action_request)}",
                            )

                            requested_tool = normalize_tool_name(
                                extract_tool_call(action_request).get("tool", "")
                            )
                            self.completion_enforcer.mark_tool_call(requested_tool)
                            tool_payload = extract_tool_call(action_request)

                            try:
                                done, detail = await self._execute_tool_call(
                                    actions=actions,
                                    payload=tool_payload,
                                    task_started=task_started,
                                )
                                if is_start_task_tool(requested_tool):
                                    task_started = True
                            except Exception as inner_exc:  # noqa: BLE001
                                detail = f"Action failed: {inner_exc}"
                                action_result = build_action_result(
                                    request_envelope=action_request,
                                    done=False,
                                    detail=detail,
                                    error=str(inner_exc),
                                )
                                self.execution_journal.append(
                                    {"request": action_request, "result": action_result}
                                )
                                self.stream.emit(
                                    "action",
                                    f"navigator.action.result {json.dumps(action_result)}",
                                )
                                self.stream.emit("error", detail)
                                self.history.append(f"error:{detail}")
                                await actions.wait(1.0)
                                continue

                            action_result = build_action_result(
                                request_envelope=action_request,
                                done=done,
                                detail=detail,
                            )
                            self.execution_journal.append(
                                {"request": action_request, "result": action_result}
                            )
                            self.stream.emit(
                                "action",
                                f"navigator.action.result {json.dumps(action_result)}",
                            )
                            self.history.append(detail)
                            self.stream.emit("action", detail)

                            if done:
                                self._mark_all_todos_completed()
                                await browser.close()
                                return AgentResult(status="success", summary=detail, steps=step)

                            await actions.wait(0.7)
                            continue

                        fallback_raw = apply_fallback_action(
                            parsed={"action": "wait", "seconds": 1.0},
                            task=self.task,
                            current_url=page.url,
                            visible_text=execution_feedback_text,
                            history_text=history_text,
                        )

                        if isinstance(fallback_raw, dict) and fallback_raw.get("tool"):
                            planned_action = fallback_raw
                            self.stream.emit("thought", f"Step {step}: fallback tool call {planned_action}")
                        elif isinstance(fallback_raw, dict) and fallback_raw.get("action") == "ask_user":
                            question = str(fallback_raw.get("question", "Need clarification from user")).strip()
                            planned_action = {
                                "tool": "ask-user-question",
                                "input": {"question": question},
                            }
                            self.stream.emit("thought", f"Step {step}: fallback tool call {planned_action}")
                        elif isinstance(fallback_raw, dict):
                            planned_action = self._build_domain_tool_call_from_action(fallback_raw)
                            self.stream.emit("thought", f"Step {step}: fallback tool call {planned_action}")
                        elif self.question_handler:
                            question = (
                                "I could not parse a valid next action from the model. "
                                "Please provide a precise instruction with required fields."
                            )
                            self.stream.emit("question", question)
                            answer = self.question_handler(question).strip()
                            self.history.append(f"user_answer:{answer}")
                            if answer:
                                if is_actionable_task_text(answer):
                                    self.task = answer
                                else:
                                    self.task = f"{self.task}\nUser details: {answer}".strip()
                                self._refresh_todos_from_current_task()
                            self.stream.emit("action", f"ask_user:{question}=>{answer}")
                            await actions.wait(1.0)
                            continue
                        else:
                            await actions.wait(1.0)
                            continue

                action_request = build_action_request(
                    step=step,
                    tool_call=self._normalize_planned_tool_call(planned_action),
                    task_started=task_started,
                )
                self.stream.emit("thought", f"navigator.action.request {json.dumps(action_request)}")

                requested_tool = normalize_tool_name(extract_tool_call(action_request).get("tool", ""))
                self.completion_enforcer.mark_tool_call(requested_tool)
                tool_payload = extract_tool_call(action_request)

                try:
                    done, detail = await self._execute_tool_call(
                        actions=actions,
                        payload=tool_payload,
                        task_started=task_started,
                    )
                    if is_start_task_tool(requested_tool):
                        task_started = True
                except Exception as exc:  # noqa: BLE001
                    detail = f"Action failed: {exc}"
                    action_result = build_action_result(
                        request_envelope=action_request,
                        done=False,
                        detail=detail,
                        error=str(exc),
                    )
                    self.execution_journal.append({"request": action_request, "result": action_result})
                    self.stream.emit("action", f"navigator.action.result {json.dumps(action_result)}")
                    self.stream.emit("error", detail)
                    self.history.append(f"error:{detail}")

                    license_target = self._extract_license_target_from_payload(tool_payload)
                    if license_target and "select" in str(exc).lower():
                        recovery_email, recovery_product = license_target
                        failure_count = license_select_failures.get(recovery_email, 0) + 1
                        license_select_failures[recovery_email] = failure_count

                        if failure_count >= 2:
                            license_recovery_target = {
                                "email": recovery_email,
                                "product": recovery_product,
                            }
                            self.stream.emit(
                                "status",
                                (
                                    "Recovery triggered after repeated license-selection failures: "
                                    f"checking/creating {recovery_email} before retrying {recovery_product}."
                                ),
                            )

                    await actions.wait(1.0)
                    continue

                action_result = build_action_result(
                    request_envelope=action_request,
                    done=done,
                    detail=detail,
                )
                self.execution_journal.append({"request": action_request, "result": action_result})
                self.stream.emit("action", f"navigator.action.result {json.dumps(action_result)}")

                self.history.append(detail)
                self.stream.emit("action", detail)

                if license_recovery_target:
                    target_email = license_recovery_target["email"]
                    if detail.lower().startswith(f"assign_license:{target_email}:"):
                        license_select_failures[target_email] = 0
                        license_recovery_target = None

                if detail == last_detail:
                    repeat_count += 1
                else:
                    repeat_count = 1
                    last_detail = detail

                if repeat_count >= 5:
                    summary = f"Agent detected repeated action loop: {detail}"
                    self.stream.emit("error", summary)
                    await browser.close()
                    return AgentResult(status="failed", summary=summary, steps=step)

                if done:
                    self._mark_all_todos_completed()
                    await browser.close()
                    return AgentResult(status="success", summary=detail, steps=step)

                await actions.wait(0.7)

            await browser.close()
            if self.completion_enforcer.requires_completion_but_missing():
                summary = "Max steps reached without complete_task. The LLM did not finalize the task."
            else:
                summary = "Max steps reached before completion."
            self.stream.emit("error", summary)
            return AgentResult(status="failed", summary=summary, steps=self.max_steps)

    async def _take_screenshot(self, page) -> str:
        image = await page.screenshot(full_page=True, type="png", timeout=15000)
        return base64.b64encode(image).decode("utf-8")

    def _ask_model(
        self,
        screenshot_b64: str,
        visible_text: str,
        current_url: str,
        history_text: str,
    ) -> dict[str, Any]:
        if self.planner is None:
            raise RuntimeError("Planner not initialized.")

        return self.planner.plan_action(
            task=self.task,
            panel_url=self.panel_url,
            current_url=current_url,
            history_text=history_text,
            screenshot_b64=screenshot_b64,
            visible_text=visible_text,
            todo_text=self._todo_text(),
        )

    async def _ask_model_with_timeout(
        self,
        screenshot_b64: str,
        visible_text: str,
        current_url: str,
        history_text: str,
    ) -> dict[str, Any]:
        timeout = max(0.1, self.planner_timeout_seconds)
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="planner-call")
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(
            executor,
            lambda: self._ask_model(
                screenshot_b64=screenshot_b64,
                visible_text=visible_text,
                current_url=current_url,
                history_text=history_text,
            ),
        )
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError as exc:
            future.cancel()
            self.planner_degraded = True
            raise PlannerError(
                f"Planner call exceeded {timeout:.1f}s; switching to deterministic fallback mode."
            ) from exc
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    async def _execute_tool_call(
        self,
        actions: BrowserActions,
        payload: dict[str, Any],
        task_started: bool,
    ) -> tuple[bool, str]:
        tool = normalize_tool_name(str(payload.get("tool", "")).strip())
        tool_input = payload.get("input")
        if not isinstance(tool_input, dict):
            tool_input = {}

        # Backward compatibility if planner returned direct action schema.
        if not tool and payload.get("action"):
            tool = "browser_action"
            tool_input = payload

        if is_start_task_tool(tool):
            if task_started:
                raise RuntimeError("Protocol violation: start_task already completed; choose the next tool.")

            try:
                validated_input = validate_start_task_input(
                    tool_input,
                    expected_request=self.task,
                )
            except StartTaskContractError as exc:
                raise RuntimeError(str(exc)) from exc

            needs_planning = bool(validated_input.get("needs_planning", False))
            goal = str(validated_input.get("goal", "")).strip()
            steps = validated_input.get("steps")
            if needs_planning and isinstance(steps, list) and steps:
                self.todos = []
                for idx, step in enumerate(steps, start=1):
                    title = str(step).strip() or f"Step {idx}"
                    self.todos.append(
                        {
                            "id": str(idx),
                            "title": title,
                            "rationale": "Model-planned step",
                            "status": "pending",
                        }
                    )
                self.current_todo_index = 0
                self.stream.emit("todo", json.dumps(self.todos))
            return False, f"start_task:{goal or 'task initialized'}"

        if is_todowrite_tool(tool):
            todos = tool_input.get("todos")
            if isinstance(todos, list):
                normalized: list[dict[str, str]] = []
                for idx, item in enumerate(todos, start=1):
                    if not isinstance(item, dict):
                        continue
                    normalized.append(
                        {
                            "id": str(item.get("id", idx)),
                            "title": str(item.get("title") or item.get("content") or f"Step {idx}").strip(),
                            "rationale": str(item.get("rationale", "")).strip(),
                            "status": str(item.get("status", "pending")).strip(),
                        }
                    )
                if normalized:
                    self._validate_todowrite_progression(normalized)
                    self.todos = normalized
                    self.stream.emit("todo", json.dumps(self.todos))
            return False, "todowrite:update"

        if tool in {"ask-user-question", "ask_user", "ask_user_question"}:
            question = str(
                tool_input.get("question")
                or payload.get("question")
                or "Need clarification from user"
            ).strip()
            if not self.question_handler:
                raise RuntimeError(f"Planner asked user question but no handler provided: {question}")
            self.stream.emit("question", question)
            lowered_question = question.lower()
            redundant_restate_request = (
                "specific it admin task" in lowered_question
                or "specific action" in lowered_question
                or "what it admin action" in lowered_question
                or "provide the specific" in lowered_question
            )
            if redundant_restate_request and is_actionable_task_text(self.task):
                answer = self.task.strip()
                self.stream.emit("thought", "Auto-answering redundant clarification with existing actionable task.")
            else:
                answer = self.question_handler(question).strip()
            self.history.append(f"user_answer:{answer}")
            if answer:
                # Keep original task intent when answer is details-only (email/name/role).
                if is_actionable_task_text(answer):
                    self.task = answer
                else:
                    self.task = f"{self.task}\nUser details: {answer}".strip()
                self._refresh_todos_from_current_task()
            return False, f"ask_user:{question}=>{answer}"

        if tool == "connector_call":
            name = str(tool_input.get("name") or payload.get("name") or "").strip()
            args = tool_input.get("args")
            if not isinstance(args, dict):
                args = {}
            output = self.connectors.call(name=name, args=args)
            self.history.append(f"connector_result:{name}:{output}")
            return False, f"connector_call:{name}"

        if is_complete_task_tool(tool):
            status = str(tool_input.get("status", "success")).strip().lower()
            summary = str(tool_input.get("result_summary") or tool_input.get("summary") or "Task completed.")
            if status in {"failed", "blocked"}:
                return True, f"done:{status}:{summary}"
            return True, f"done:{summary}"

        mcp_tool = self._normalize_mcp_tool_name(tool)
        if mcp_tool:
            if not task_started and not is_exempt_pre_start_tool(mcp_tool):
                raise RuntimeError(f"Protocol violation: model must call start_task before {mcp_tool}.")
            mapped_input = self._map_mcp_tool_input(mcp_tool=mcp_tool, tool_input=tool_input)
            return await self._execute_browser_action(actions, mapped_input)

        if tool == "browser_action":
            if not task_started and not is_exempt_pre_start_tool(tool):
                raise RuntimeError("Protocol violation: model must call start_task before browser_action.")
            return await self._execute_browser_action(actions, tool_input)

        # Block unknown tools before start_task to keep protocol strict.
        if not task_started and not is_exempt_pre_start_tool(tool):
            raise RuntimeError(f"Protocol violation: unknown tool before start_task: {tool or 'empty'}")

        await actions.wait(0.8)
        return False, f"unknown-tool:{payload}"

    def _validate_todowrite_progression(self, incoming: list[dict[str, str]]) -> None:
        allowed = {"pending", "in_progress", "completed"}
        ids: set[str] = set()
        in_progress_count = 0

        for todo in incoming:
            todo_id = str(todo.get("id", "")).strip()
            status = str(todo.get("status", "")).strip()
            if not todo_id:
                raise RuntimeError("todowrite validation failed: todo id is required.")
            if todo_id in ids:
                raise RuntimeError(f"todowrite validation failed: duplicate todo id '{todo_id}'.")
            ids.add(todo_id)

            if status not in allowed:
                raise RuntimeError(
                    f"todowrite validation failed: invalid status '{status}' for todo '{todo_id}'."
                )
            if status == "in_progress":
                in_progress_count += 1

        if in_progress_count > 1:
            raise RuntimeError("todowrite validation failed: only one todo can be in_progress.")

        # Progression check: completed count cannot decrease across writes.
        prev_completed = sum(1 for t in self.todos if t.get("status") == "completed")
        new_completed = sum(1 for t in incoming if t.get("status") == "completed")
        if new_completed < prev_completed:
            raise RuntimeError("todowrite validation failed: completed progress cannot move backward.")

        # Per-id check: a completed todo cannot regress to pending/in_progress.
        prev_by_id = {str(t.get("id")): str(t.get("status")) for t in self.todos}
        for todo in incoming:
            todo_id = str(todo.get("id"))
            status = str(todo.get("status"))
            prev_status = prev_by_id.get(todo_id)
            if prev_status == "completed" and status != "completed":
                raise RuntimeError(
                    f"todowrite validation failed: todo '{todo_id}' regressed from completed to {status}."
                )

    async def _execute_browser_action(
        self,
        actions: BrowserActions,
        payload: dict[str, Any],
    ) -> tuple[bool, str]:
        action = (payload.get("action") or "").strip().lower().replace("-", "_")

        if action == "navigate":
            url = payload.get("url", self.panel_url)
            await actions.navigate(url)
            return False, f"navigate:{url}"

        if action == "click":
            target = payload.get("target", "")
            await actions.click(target)
            return False, f"click:{target}"

        if action == "type":
            field = payload.get("field", "")
            value = payload.get("value", "")
            await actions.type(field, value)
            return False, f"type:{field}={value}"

        if action == "select":
            field = payload.get("field", "")
            value = payload.get("value", "")
            await actions.select(field, value)
            return False, f"select:{field}={value}"

        if action == "wait":
            seconds = float(payload.get("seconds", 1.0))
            await actions.wait(seconds)
            return False, f"wait:{seconds}s"

        if action in {"check_user_exists", "check_user"}:
            return await self._execute_check_user_exists(actions, payload)

        if action == "create_user":
            return await self._execute_create_user(actions, payload)

        if action == "reset_password":
            return await self._execute_reset_password(actions, payload)

        if action == "assign_license":
            return await self._execute_assign_license(actions, payload)

        if action == "done":
            result = payload.get("result", "Task completed.")
            return True, f"done:{result}"

        await actions.wait(0.8)
        return False, f"unknown-action:{payload}"

    async def _ensure_users_page(self, actions: BrowserActions) -> None:
        if "/users" not in actions.page.url:
            await actions.navigate(f"{self.panel_url}/users")

    def _extract_domain_fields(self, payload: dict[str, Any]) -> dict[str, str]:
        command_payload = payload.get("commandPayload")
        if not isinstance(command_payload, dict):
            command_payload = {}

        args = command_payload.get("args")
        if not isinstance(args, dict):
            args = {}

        user = command_payload.get("user")
        if not isinstance(user, dict):
            user = {}

        sources: list[dict[str, Any]] = [payload, args, command_payload, user]

        def pick(*keys: str) -> str:
            for source in sources:
                for key in keys:
                    value = source.get(key)
                    if value is None:
                        continue
                    text = str(value).strip()
                    if text:
                        return text
            return ""

        email = pick("email", "user_email", "username", "upn")

        full_name = pick("full_name", "fullName", "name")
        if not full_name:
            first = pick("firstName", "first_name")
            last = pick("lastName", "last_name")
            full_name = " ".join(part for part in [first, last] if part).strip()

        role = pick("role")
        password = pick("new_password", "newPassword", "initial_password", "initialPassword", "password")
        product = pick("product", "license", "license_product", "sku")

        return {
            "email": email.lower(),
            "name": full_name,
            "role": role.lower(),
            "password": password,
            "product": product,
        }

    async def _execute_check_user_exists(
        self,
        actions: BrowserActions,
        payload: dict[str, Any],
    ) -> tuple[bool, str]:
        fields = self._extract_domain_fields(payload)
        email = fields["email"]
        name = fields["name"]

        if not email and not name:
            return False, "check_user_exists:missing_identifier"

        await self._ensure_users_page(actions)
        identifier = email or name

        exists = False
        if email:
            exists = await actions.page.get_by_text(email, exact=False).count() > 0
        if not exists and name:
            exists = await actions.page.get_by_text(name, exact=False).count() > 0

        return False, f"check_user_exists:{identifier}:{'found' if exists else 'not_found'}"

    async def _execute_create_user(
        self,
        actions: BrowserActions,
        payload: dict[str, Any],
    ) -> tuple[bool, str]:
        fields = self._extract_domain_fields(payload)
        email = fields["email"]
        name = fields["name"]
        role = fields["role"] or "user"
        password = fields["password"] or "Temp#123"

        if not email or not name:
            missing = []
            if not email:
                missing.append("email")
            if not name:
                missing.append("name")
            return False, f"create_user:missing_fields:{','.join(missing)}"

        await self._ensure_users_page(actions)
        await actions.type("Email", email)
        await actions.type("Full Name", name)
        await actions.select("Role", role)
        await actions.type("Initial Password", password)
        await actions.click("Create User")
        await actions.wait(0.8)
        return False, f"create_user:{email}"

    async def _execute_reset_password(
        self,
        actions: BrowserActions,
        payload: dict[str, Any],
    ) -> tuple[bool, str]:
        fields = self._extract_domain_fields(payload)
        email = fields["email"]
        password = fields["password"] or "Temp#123"

        if not email:
            return False, "reset_password:missing_email"

        await self._ensure_users_page(actions)
        await actions.type(f"New Password for {email}", password)
        await actions.click(f"Reset Password {email}")
        await actions.wait(0.8)
        return False, f"reset_password:{email}"

    async def _execute_assign_license(
        self,
        actions: BrowserActions,
        payload: dict[str, Any],
    ) -> tuple[bool, str]:
        fields = self._extract_domain_fields(payload)
        email = fields["email"]
        product = fields["product"] or "Google Workspace"

        if not email:
            return False, "assign_license:missing_email"

        await self._ensure_users_page(actions)
        await actions.select(f"License for {email}", product)
        await actions.click(f"Assign License {email}")
        await actions.wait(0.8)
        return False, f"assign_license:{email}:{product}"

    def _extract_license_target_from_payload(self, payload: dict[str, Any]) -> tuple[str, str] | None:
        if isinstance(payload.get("input"), dict):
            payload = payload["input"]

        action = str(payload.get("action", "")).strip().lower().replace("-", "_")

        if action == "select":
            field = str(payload.get("field", "")).strip()
            value = str(payload.get("value", "")).strip() or "Google Workspace"
            prefix = "license for "
            if field.lower().startswith(prefix):
                email = field[len(prefix):].strip().lower()
                if "@" in email:
                    return email, value

        if action == "assign_license":
            fields = self._extract_domain_fields(payload)
            email = fields["email"]
            product = fields["product"] or "Google Workspace"
            if email:
                return email, product

        return None

    def _history_contains(self, marker: str) -> bool:
        target = marker.lower()
        return any(target in item.lower() for item in self.history)

    def _latest_check_user_outcome(self, email: str) -> str | None:
        prefix = f"check_user_exists:{email.lower()}:"
        for item in reversed(self.history):
            lowered = item.lower()
            if not lowered.startswith(prefix):
                continue
            if lowered.endswith(":found"):
                return "found"
            if lowered.endswith(":not_found"):
                return "not_found"
        return None

    def _build_recovery_create_user_input(self, email: str) -> dict[str, Any]:
        req, _missing = resolve_create_user_request(
            task=self.task,
            history_text="\n".join(self.history[-20:]),
        )

        name = str(req.get("name", "")).strip()
        if not name:
            local_part = email.split("@", 1)[0]
            normalized = local_part.replace(".", " ").replace("_", " ").replace("-", " ").strip()
            name = " ".join(part.capitalize() for part in normalized.split()) or email

        role = str(req.get("role", "")).strip().lower() or "viewer"
        password = str(req.get("password", "")).strip() or "Temp#123"

        return {
            "action": "create_user",
            "email": email,
            "name": name,
            "role": role,
            "password": password,
        }

    def _initialize_todos(self) -> None:
        if self.planner is None:
            return
        try:
            generated = self.planner.generate_todos(self.task)
        except Exception as exc:  # noqa: BLE001
            generated = [{"title": "Execute task", "rationale": f"Fallback todo due to planner error: {exc}"}]

        self.todos = []
        for idx, item in enumerate(generated, start=1):
            title = str(item.get("title", f"Step {idx}")).strip()
            rationale = str(item.get("rationale", "")).strip()
            self.todos.append(
                {
                    "id": str(idx),
                    "title": title,
                    "rationale": rationale,
                    "status": "pending",
                }
            )
        self.current_todo_index = 0
        self.stream.emit("todo", json.dumps(self.todos))

    def _refresh_todos_from_current_task(self) -> None:
        if self.planner is None:
            return
        try:
            generated = self.planner.generate_todos(self.task)
        except Exception:  # noqa: BLE001
            return

        refreshed: list[dict[str, str]] = []
        for idx, item in enumerate(generated, start=1):
            title = str(item.get("title", f"Step {idx}")).strip()
            rationale = str(item.get("rationale", "")).strip()
            refreshed.append(
                {
                    "id": str(idx),
                    "title": title,
                    "rationale": rationale,
                    "status": "pending",
                }
            )

        if refreshed:
            self.todos = refreshed
            self.current_todo_index = 0
            self.stream.emit("todo", json.dumps(self.todos))

    def _mark_todo_in_progress(self) -> None:
        if not self.todos:
            return
        idx = min(self.current_todo_index, len(self.todos) - 1)
        if self.todos[idx]["status"] == "pending":
            self.todos[idx]["status"] = "in_progress"
            self.stream.emit("todo", json.dumps(self.todos))

    def _mark_todo_completed(self) -> None:
        if not self.todos:
            return
        idx = min(self.current_todo_index, len(self.todos) - 1)
        self.todos[idx]["status"] = "completed"
        self.current_todo_index = min(self.current_todo_index + 1, len(self.todos) - 1)
        self.stream.emit("todo", json.dumps(self.todos))

    def _mark_all_todos_completed(self) -> None:
        if not self.todos:
            return
        changed = False
        for todo in self.todos:
            if todo.get("status") != "completed":
                todo["status"] = "completed"
                changed = True
        if changed:
            self.stream.emit("todo", json.dumps(self.todos))

    def _todo_text(self) -> str:
        if not self.todos:
            return ""
        lines = []
        for item in self.todos:
            lines.append(f"- [{item['status']}] {item['title']}: {item['rationale']}")
        return "\n".join(lines)

    def _execution_feedback_text(self) -> str:
        if not self.execution_journal:
            return "No execution feedback yet."

        recent = self.execution_journal[-8:]
        lines: list[str] = []
        for item in recent:
            result = item.get("result") if isinstance(item, dict) else None
            if not isinstance(result, dict):
                continue
            lines.append(
                json.dumps(
                    {
                        "step": result.get("step"),
                        "tool": result.get("tool"),
                        "status": result.get("status"),
                        "done": result.get("done"),
                        "detail": result.get("detail"),
                        "error": result.get("error"),
                    }
                )
            )
        return "\n".join(lines) if lines else "No execution feedback yet."

    def get_execution_journal(self) -> list[dict[str, Any]]:
        return list(self.execution_journal)

    def _build_stall_recovery_question(self) -> str:
        history_text = "\n".join(self.history[-20:])
        effective_task = resolve_effective_task(task=self.task, history_text=history_text)

        reset_req = extract_reset_password_task(effective_task)
        if reset_req:
            email = reset_req["email"]
            return (
                f"I am blocked because I cannot complete reset for {email}. "
                "Please confirm the exact existing email and new password, or say to create the user first "
                "with full name, role, and optional initial password."
            )

        lower = effective_task.lower()
        if "create" in lower and "user" in lower:
            _req, missing_fields = resolve_create_user_request(effective_task, history_text)
            if missing_fields:
                missing = ", ".join(missing_fields)
                return f"I need missing details to create the user: {missing}."

        return (
            "I am blocked and need clearer task details to proceed. "
            "Please provide a structured request including action and required fields."
        )

    def _build_degraded_start_task_call(self) -> dict[str, Any]:
        goal = self.task.strip() or "Execute requested IT admin task"

        steps: list[str] = []
        for todo in self.todos[:6]:
            title = str(todo.get("title", "")).strip()
            if title:
                steps.append(title)
        if not steps:
            steps = [
                "Inspect admin panel state",
                "Execute requested action",
                "Verify result",
            ]

        return {
            "tool": "start_task",
            "input": {
                "original_request": self.task,
                "needs_planning": True,
                "goal": goal,
                "steps": steps,
                "verification": [
                    "Action results indicate progress toward the request",
                    "Task completes with explicit summary",
                ],
                "skills": ["deterministic-fallback"],
            },
        }

    def _build_domain_tool_call_from_action(self, action_input: dict[str, Any]) -> dict[str, Any]:
        action = str(action_input.get("action", "")).strip().lower().replace("-", "_")
        if action in {"navigate", "click", "type", "select", "wait"}:
            return {"tool": "mcp_navigation", "input": action_input}
        if action in {"check_user_exists", "check_user", "create_user", "reset_password"}:
            return {"tool": "mcp_user", "input": action_input}
        if action == "assign_license":
            return {"tool": "mcp_license", "input": action_input}
        if action == "done":
            result_summary = str(action_input.get("result", "Task completed.")).strip() or "Task completed."
            return {
                "tool": "complete_task",
                "input": {
                    "status": "success",
                    "result_summary": result_summary,
                },
            }
        return {"tool": "browser_action", "input": action_input}

    def _normalize_planned_tool_call(self, planned_action: dict[str, Any]) -> dict[str, Any]:
        tool = normalize_tool_name(str(planned_action.get("tool", "")))
        tool_alias = tool.replace(".", "_").replace("-", "_")

        if tool_alias in {"mcp_navigation", "mcp_user", "mcp_license", "start_task", "todowrite", "ask_user_question", "connector_call", "complete_task"}:
            if tool_alias == "ask_user_question":
                normalized = dict(planned_action)
                normalized["tool"] = "ask-user-question"
                return normalized
            if tool != tool_alias:
                normalized = dict(planned_action)
                normalized["tool"] = tool_alias
                return normalized
            return planned_action

        tool_input = planned_action.get("input") if isinstance(planned_action.get("input"), dict) else None
        if tool_alias == "browser_action" and tool_input is not None:
            return self._build_domain_tool_call_from_action(tool_input)

        if not tool and isinstance(planned_action.get("action"), str):
            return self._build_domain_tool_call_from_action(planned_action)

        return planned_action

    @staticmethod
    def _normalize_mcp_tool_name(tool_name: str) -> str:
        normalized = (tool_name or "").strip().lower().replace(".", "_")
        if normalized in {"mcp_navigation", "mcp_user", "mcp_license"}:
            return normalized
        return ""

    @staticmethod
    def _map_mcp_tool_input(mcp_tool: str, tool_input: dict[str, Any]) -> dict[str, Any]:
        action = str(tool_input.get("action", "")).strip().lower().replace("-", "_")
        mapped = dict(tool_input)
        mapped["action"] = action

        allowed_actions = {
            "mcp_navigation": {"navigate", "click", "type", "select", "wait"},
            "mcp_user": {"check_user_exists", "check_user", "create_user", "reset_password"},
            "mcp_license": {"assign_license"},
        }

        valid = allowed_actions.get(mcp_tool, set())
        if action not in valid:
            allowed = ", ".join(sorted(valid)) if valid else "none"
            raise RuntimeError(
                f"MCP contract violation: tool {mcp_tool} does not support action '{action}'. Allowed: {allowed}."
            )

        return mapped
