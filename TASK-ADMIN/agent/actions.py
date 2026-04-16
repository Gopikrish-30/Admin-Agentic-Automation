from __future__ import annotations

import asyncio

from playwright.async_api import Page


class BrowserActions:
    def __init__(self, page: Page):
        self.page = page

    async def navigate(self, url: str) -> None:
        await self.page.goto(url, wait_until="domcontentloaded")

    async def click(self, target: str) -> None:
        candidates = [
            self.page.get_by_role("button", name=target, exact=False).first,
            self.page.get_by_role("link", name=target, exact=False).first,
            self.page.get_by_text(target, exact=False).first,
            self.page.get_by_label(target, exact=False).first,
        ]
        last_error: Exception | None = None
        for locator in candidates:
            try:
                await locator.click(timeout=2500)
                return
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise RuntimeError(f"Could not click target '{target}': {last_error}")

    async def type(self, field: str, value: str) -> None:
        candidates = [
            self.page.get_by_label(field, exact=False).first,
            self.page.get_by_placeholder(field).first,
            self.page.get_by_role("textbox", name=field, exact=False).first,
        ]
        last_error: Exception | None = None
        for locator in candidates:
            try:
                await locator.fill(value, timeout=2500)
                return
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise RuntimeError(f"Could not type into field '{field}': {last_error}")

    async def select(self, field: str, value: str) -> None:
        candidates = [
            self.page.get_by_label(field, exact=False).first,
            self.page.get_by_role("combobox", name=field, exact=False).first,
        ]
        last_error: Exception | None = None
        for locator in candidates:
            try:
                await locator.select_option(label=value, timeout=2500)
                return
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise RuntimeError(f"Could not select '{value}' in field '{field}': {last_error}")

    async def wait(self, seconds: float) -> None:
        await asyncio.sleep(max(0.1, min(seconds, 5.0)))
