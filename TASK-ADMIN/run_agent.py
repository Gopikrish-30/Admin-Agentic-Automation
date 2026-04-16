from __future__ import annotations

import asyncio
import sys

from dotenv import load_dotenv
from rich.console import Console

from agent.agent import ITSupportAgent
from agent.stream import AgentEvent


def main() -> None:
    load_dotenv()
    if len(sys.argv) < 2:
        print("Usage: python run_agent.py \"reset password for john@company.com\"")
        raise SystemExit(1)

    task = " ".join(sys.argv[1:]).strip()
    console = Console()

    def on_event(event: AgentEvent) -> None:
        color = {
            "status": "cyan",
            "thought": "yellow",
            "action": "green",
            "error": "red",
        }.get(event.level, "white")
        console.print(f"[{color}]{event.timestamp} | {event.level.upper()} | {event.message}[/{color}]")

    def on_question(question: str) -> str:
        console.print(f"[magenta]QUESTION[/magenta] {question}")
        return console.input("Your answer: ").strip()

    agent = ITSupportAgent(task=task, callback=on_event, question_handler=on_question)
    result = asyncio.run(agent.run())
    console.print(f"\n[bold]Final Status:[/bold] {result.status}")
    console.print(f"[bold]Summary:[/bold] {result.summary}")
    console.print(f"[bold]Steps:[/bold] {result.steps}")


if __name__ == "__main__":
    main()
