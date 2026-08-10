"""Dependency-free Cockroach Browser daemon client."""

from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


class BrowserError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"Cockroach Browser returned HTTP {status}: {body}")
        self.status = status
        self.body = body


class BrowserClient:
    def __init__(self, token: str, base_url: str = "http://127.0.0.1:43110", timeout: float = 60.0):
        if not token:
            raise ValueError("token is required")
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def request(self, method: str, path: str, body: Any | None = None) -> Any:
        if not path.startswith("/"):
            raise ValueError("path must start with /")
        encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        request = Request(
            self.base_url + path,
            data=encoded,
            method=method,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.token}",
                **({"Content-Type": "application/json"} if encoded is not None else {}),
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                data = response.read()
                return json.loads(data) if data else None
        except HTTPError as error:
            raise BrowserError(error.code, error.read().decode("utf-8", errors="replace")) from error

    def health(self) -> dict[str, Any]:
        return self.request("GET", "/v1/health")

    def capabilities(self) -> list[dict[str, Any]]:
        return self.request("GET", "/v1/capabilities")["capabilities"]

    def create_session(self, session: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/v1/sessions", session)

    def sessions(self) -> list[dict[str, Any]]:
        return self.request("GET", "/v1/sessions")["sessions"]

    def session(self, session_id: str) -> dict[str, Any]:
        return self.request("GET", f"/v1/sessions/{quote(session_id, safe='')}")

    def close_session(self, session_id: str) -> Any:
        return self.request("DELETE", f"/v1/sessions/{quote(session_id, safe='')}")

    def act(self, session_id: str, action: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/v1/sessions/{quote(session_id, safe='')}/actions", action)

    def act_batch(self, session_id: str, batch: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/v1/sessions/{quote(session_id, safe='')}/actions/batch", batch)

    def snapshot(self, session_id: str, tab_id: str | None = None) -> dict[str, Any]:
        return self.request("POST", f"/v1/sessions/{quote(session_id, safe='')}/snapshot", {"tabId": tab_id})

