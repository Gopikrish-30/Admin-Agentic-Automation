from __future__ import annotations

import asyncio
import json
import os
import queue
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request

from agent.agent import ITSupportAgent
from agent.planners import decide_query_mode_with_model
from agent.stream import AgentEvent
from chat.navigator_events import from_agent_event, to_navigator_event

load_dotenv()


def _settings_path() -> Path:
    return Path(__file__).resolve().parent / "llm_settings.json"


def _default_settings() -> dict[str, str]:
    return {
        "provider": "openai-codex",
        "model": os.getenv("OPENCODE_MODEL", "openai/gpt-5.3-codex"),
    }


def _load_settings() -> dict[str, str]:
    path = _settings_path()
    if not path.exists():
        return _default_settings()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return _default_settings()
    provider = str(parsed.get("provider", "openai-codex")).strip() or "openai-codex"
    model = str(parsed.get("model", "openai/gpt-5.3-codex")).strip() or "openai/gpt-5.3-codex"
    return {"provider": provider, "model": model}


def _save_settings(settings: dict[str, str]) -> None:
    _settings_path().write_text(json.dumps(settings, indent=2), encoding="utf-8")


def _opencode_auth_json_path() -> Path:
    xdg_data_home = os.getenv("XDG_DATA_HOME")
    if xdg_data_home:
        return Path(xdg_data_home) / "opencode" / "auth.json"
    return Path.home() / ".local" / "share" / "opencode" / "auth.json"


def _get_openai_oauth_status() -> dict[str, Any]:
    path = _opencode_auth_json_path()
    if not path.exists():
        return {"connected": False}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {"connected": False}
    entry = parsed.get("openai")
    if not isinstance(entry, dict):
        return {"connected": False}
    if str(entry.get("type", "")).strip() != "oauth":
        return {"connected": False}
    refresh = str(entry.get("refresh", "")).strip()
    expires = entry.get("expires")
    connected = bool(refresh)
    result: dict[str, Any] = {"connected": connected}
    if isinstance(expires, int):
        result["expires"] = expires
    return result


def _start_openai_login_terminal() -> None:
    # Open a dedicated terminal window for interactive OpenCode OAuth login.
    root = Path(__file__).resolve().parent.parent
    command = f'cd /d "{root}" && opencode auth login'
    subprocess.Popen(
        ["cmd", "/c", "start", "OpenAI Codex Login", "cmd", "/k", command],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def create_chat_app() -> Flask:
    app = Flask(__name__, template_folder="templates")

    tasks: dict[str, dict[str, Any]] = {}

    @app.get("/llm/provider")
    def get_llm_provider() -> Response:
        settings = _load_settings()
        return jsonify(
            {
                "provider": settings["provider"],
                "model": settings["model"],
                "oauth": _get_openai_oauth_status(),
                "allowedProviders": ["openai-codex"],
                "allowedModels": [
                    "openai/gpt-5.2-codex",
                    "openai/gpt-5.3-codex",
                    "openai/gpt-5.3-codex-spark",
                ],
            }
        )

    @app.post("/llm/provider")
    def set_llm_provider() -> Response:
        payload = request.get_json(silent=True) or {}
        provider = str(payload.get("provider", "")).strip()
        model = str(payload.get("model", "")).strip()

        if provider != "openai-codex":
            return jsonify({"error": "Only openai-codex provider is supported."}), 400

        allowed_models = {
            "openai/gpt-5.2-codex",
            "openai/gpt-5.3-codex",
            "openai/gpt-5.3-codex-spark",
        }
        if model not in allowed_models:
            return jsonify({"error": "Unsupported codex model."}), 400

        settings = {"provider": provider, "model": model}
        _save_settings(settings)
        return jsonify({"ok": True, **settings})

    @app.post("/llm/openai/authorize")
    def authorize_openai() -> Response:
        _start_openai_login_terminal()
        return jsonify(
            {
                "ok": True,
                "message": "Opened login terminal. Complete OpenCode OpenAI login there, then click Refresh Status.",
            }
        )

    @app.get("/")
    def chat_home() -> str:
        return render_template("chat.html")

    @app.post("/run-task")
    def run_task() -> Response:
        payload = request.get_json(silent=True) or {}
        task_text = str(payload.get("task", "")).strip()
        if not task_text:
            return jsonify({"error": "Task text is required."}), 400

        settings = _load_settings()
        oauth_status = _get_openai_oauth_status()
        if settings["provider"] != "openai-codex":
            return jsonify({"error": "Only openai-codex provider is supported."}), 400
        if not oauth_status.get("connected"):
            return jsonify({"error": "OpenAI Codex is not authorized. Click LLM Provider and authorize first."}), 400

        os.environ["AGENT_BACKEND"] = "opencode"
        os.environ["OPENCODE_MODEL"] = settings["model"]

        task_id = str(uuid.uuid4())
        event_queue: queue.Queue[dict[str, Any] | None] = queue.Queue()

        tasks[task_id] = {
            "status": "pending",
            "queue": event_queue,
            "result": None,
            "answer_queue": queue.Queue(),
            "pending_question": None,
            "journal": [],
        }

        def callback(event: AgentEvent) -> None:
            payload = from_agent_event(event)
            message = str(payload.get("message", ""))
            if "navigator.action.request " in message:
                try:
                    obj = json.loads(message.split("navigator.action.request ", 1)[1])
                    tasks[task_id]["journal"].append({"request": obj})
                except Exception:  # noqa: BLE001
                    pass
            elif "navigator.action.result " in message:
                try:
                    obj = json.loads(message.split("navigator.action.result ", 1)[1])
                    journal = tasks[task_id]["journal"]
                    if isinstance(journal, list) and journal:
                        last = journal[-1]
                        if isinstance(last, dict) and last.get("request", {}).get("requestId") == obj.get("requestId"):
                            last["result"] = obj
                        else:
                            journal.append({"result": obj})
                except Exception:  # noqa: BLE001
                    pass
            event_queue.put(payload)

        def ask_user(question: str) -> str:
            tasks[task_id]["status"] = "waiting_input"
            tasks[task_id]["pending_question"] = question
            try:
                answer = tasks[task_id]["answer_queue"].get(timeout=300)
            except queue.Empty as exc:
                raise RuntimeError("Timed out waiting for user answer.") from exc
            finally:
                tasks[task_id]["pending_question"] = None

            tasks[task_id]["status"] = "running"
            return answer

        def worker() -> None:
            tasks[task_id]["status"] = "running"
            try:
                event_queue.put(
                    to_navigator_event(
                        level="status",
                        message="Routing request with OpenAI Codex model",
                        timestamp="routing",
                    )
                )
                route = decide_query_mode_with_model(task_text)
                mode = route.get("mode", "chat")
                route_message = route.get("message", "")

                if mode == "chat":
                    summary = route_message or "Please provide a concrete IT admin task to automate."
                    tasks[task_id]["result"] = {
                        "status": "success",
                        "summary": summary,
                        "steps": 0,
                    }
                    tasks[task_id]["status"] = "success"
                    event_queue.put(
                        to_navigator_event(
                            level="assistant",
                            message=summary,
                            timestamp="done",
                        )
                    )
                    event_queue.put(
                        to_navigator_event(
                            level="final",
                            message=f"success: {summary}",
                            timestamp="done",
                        )
                    )
                    return

                event_queue.put(
                    to_navigator_event(
                        level="thought",
                        message=f"Model routed to automation: {route_message}",
                        timestamp="routing",
                    )
                )

                agent = ITSupportAgent(task=task_text, callback=callback, question_handler=ask_user)
                result = asyncio.run(agent.run())
                tasks[task_id]["result"] = {
                    "status": result.status,
                    "summary": result.summary,
                    "steps": result.steps,
                }
                tasks[task_id]["status"] = result.status
                event_queue.put(
                    to_navigator_event(
                        level="final",
                        message=f"{result.status}: {result.summary}",
                        timestamp="done",
                    )
                )
            except Exception as exc:  # noqa: BLE001
                tasks[task_id]["status"] = "failed"
                tasks[task_id]["result"] = {
                    "status": "failed",
                    "summary": f"Worker error: {exc}",
                    "steps": 0,
                }
                event_queue.put(
                    to_navigator_event(
                        level="final",
                        message=f"failed: Worker error: {exc}",
                        timestamp="done",
                    )
                )
            finally:
                event_queue.put(None)

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()

        return jsonify({"taskId": task_id, "status": "running"})

    @app.post("/task-answer/<task_id>")
    def task_answer(task_id: str) -> Response:
        task = tasks.get(task_id)
        if not task:
            return jsonify({"error": "Task not found"}), 404

        payload = request.get_json(silent=True) or {}
        answer = str(payload.get("answer", "")).strip()
        if not answer:
            return jsonify({"error": "Answer is required"}), 400

        task["answer_queue"].put(answer)
        return jsonify({"ok": True})

    @app.get("/task-stream/<task_id>")
    def task_stream(task_id: str) -> Response:
        task = tasks.get(task_id)
        if not task:
            return Response("event: error\ndata: Task not found\n\n", mimetype="text/event-stream")

        event_queue: queue.Queue[dict[str, Any] | None] = task["queue"]

        def generate():
            while True:
                item = event_queue.get()
                if item is None:
                    yield "event: done\ndata: complete\n\n"
                    break
                yield f"event: message\ndata: {json.dumps(item)}\n\n"

        return Response(generate(), mimetype="text/event-stream")

    @app.get("/task-status/<task_id>")
    def task_status(task_id: str) -> Response:
        task = tasks.get(task_id)
        if not task:
            return jsonify({"error": "Task not found"}), 404
        return jsonify(
            {
                "status": task["status"],
                "result": task["result"],
                "pendingQuestion": task.get("pending_question"),
                "journal": task.get("journal", []),
            }
        )

    return app
