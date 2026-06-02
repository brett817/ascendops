"""Pure stdlib JSON-RPC 2.0 client for the Model Context Protocol.

Implements the minimal subset of the MCP wire protocol required to:
  * Spawn a stdio MCP server (newline-delimited JSON-RPC) and complete the
    initialize handshake.
  * POST JSON-RPC envelopes to an HTTP MCP server.
  * List tools and call tools, surfacing JSON-RPC errors as MCPError.

No external dependencies — Python 3.11+ stdlib only (subprocess, json,
threading, urllib.request, uuid, queue, os, time, contextlib).

Reference: https://spec.modelcontextprotocol.io (lifecycle + tools).
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from contextlib import suppress


# MCP protocol version we advertise during initialize. The spec is versioned
# by date — pick the spec-stable date the server should recognise. Servers
# negotiate down if they support an older revision.
_PROTOCOL_VERSION = "2025-06-18"
_CLIENT_NAME = "programmatic-tools"
_CLIENT_VERSION = "0.1.0"


class MCPError(Exception):
    """Wraps a JSON-RPC error response."""

    def __init__(self, code: int, message: str, data: object = None) -> None:
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.data = data


class MCPClient:
    """JSON-RPC 2.0 MCP client supporting stdio + http transports."""

    def __init__(self, server_config: dict, dry_run: bool = False) -> None:
        """server_config follows the .mcp.json entry shape:
            stdio: {"command": "uvx", "args": [...], "env": {...}}
            http:  {"type": "http", "url": "https://...", "headers": {...}}
        The "type" field is optional; absence defaults to stdio.

        dry_run=True suppresses real I/O. call_tool appends intended calls
        to self.dry_run_log instead of executing.
        """
        if not isinstance(server_config, dict):
            raise TypeError("server_config must be a dict")
        self._config = dict(server_config)
        self._transport = (self._config.get("type") or "stdio").lower()
        if self._transport not in ("stdio", "http"):
            raise ValueError(f"Unsupported transport: {self._transport!r}")

        self.dry_run = bool(dry_run)
        self.dry_run_log: list[dict] = []

        # State shared across transports.
        self._connected = False
        self._closed = False
        self._lock = threading.Lock()

        # Stdio state.
        self._proc: subprocess.Popen | None = None
        self._reader_thread: threading.Thread | None = None
        self._pending: dict[str, queue.Queue] = {}
        self._stderr_thread: threading.Thread | None = None
        self._reader_alive = False

        # HTTP state.
        self._http_url: str = self._config.get("url", "")
        self._http_headers: dict = dict(self._config.get("headers", {}))
        self._http_session_id: str | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def connect(self) -> None:
        """Bring up transport + complete MCP initialize handshake. Idempotent."""
        if self.dry_run:
            self._connected = True
            return
        with self._lock:
            if self._connected:
                return
            if self._transport == "stdio":
                self._spawn_stdio()
            else:
                self._validate_http_config()
            try:
                self._handshake()
            except Exception:
                # Subprocess was spawned (or HTTP session opened) BEFORE the
                # handshake. If handshake raises, cleanup so callers using
                # `with MCPClient(...)` don't leak the subprocess — Python
                # skips __exit__ when __enter__ raises.
                if self._transport == "stdio":
                    self._close_stdio()
                raise
            self._connected = True

    def list_tools(self) -> list[dict]:
        """Return the tools array from tools/list. Empty list if absent."""
        if self.dry_run:
            return []
        self._require_connected()
        result = self._request("tools/list", {})
        tools = result.get("tools", []) if isinstance(result, dict) else []
        return list(tools)

    def call_tool(self, name: str, args: dict, timeout: float = 30.0) -> dict:
        """Invoke tools/call. Returns the parsed `result` dict.

        Raises MCPError on JSON-RPC error, TimeoutError on timeout.
        """
        if self.dry_run:
            entry = {"name": name, "arguments": dict(args or {}), "timeout": timeout}
            self.dry_run_log.append(entry)
            return {"dry_run": True, "recorded": entry}
        self._require_connected()
        params = {"name": name, "arguments": dict(args or {})}
        result = self._request("tools/call", params, timeout=timeout)
        return result if isinstance(result, dict) else {"value": result}

    def close(self) -> None:
        """Tear down transport. Idempotent + safe after partial init."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._connected = False
            if self._transport == "stdio":
                self._close_stdio()
            # HTTP needs no persistent connection cleanup.

    # Context-manager sugar -------------------------------------------------

    def __enter__(self) -> "MCPClient":
        self.connect()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Internals — stdio
    # ------------------------------------------------------------------

    def _spawn_stdio(self) -> None:
        command = self._config.get("command")
        if not command:
            raise ValueError("stdio server_config requires 'command'")
        args = list(self._config.get("args", []))
        env_overrides = self._config.get("env") or {}
        env = os.environ.copy()
        env.update(env_overrides)

        self._proc = subprocess.Popen(
            [command, *args],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            bufsize=0,
        )
        self._reader_alive = True
        self._reader_thread = threading.Thread(
            target=self._stdio_reader_loop, name="mcp-stdio-reader", daemon=True
        )
        self._reader_thread.start()
        # Drain stderr in background so it doesn't fill OS pipe buffer.
        self._stderr_thread = threading.Thread(
            target=self._stdio_stderr_drain, name="mcp-stdio-stderr", daemon=True
        )
        self._stderr_thread.start()

    def _stdio_reader_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        try:
            for raw in proc.stdout:
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    # Some servers print log noise; ignore non-JSON lines.
                    continue
                self._dispatch_incoming(msg)
        except Exception:
            # Reader thread should never crash the host; just exit.
            pass
        finally:
            self._reader_alive = False
            # Unblock any waiters so they raise instead of hanging forever.
            for q in list(self._pending.values()):
                with suppress(Exception):
                    q.put_nowait({"__reader_closed__": True})

    def _stdio_stderr_drain(self) -> None:
        proc = self._proc
        if proc is None or proc.stderr is None:
            return
        with suppress(Exception):
            for _ in proc.stderr:
                pass

    def _dispatch_incoming(self, msg: dict) -> None:
        # Only responses (with id) are routed; notifications/requests from
        # the server are ignored for this minimal client.
        msg_id = msg.get("id")
        if msg_id is None:
            return
        key = str(msg_id)
        q = self._pending.get(key)
        if q is not None:
            with suppress(Exception):
                q.put_nowait(msg)

    def _send_stdio(self, frame: dict) -> None:
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise RuntimeError("stdio transport not initialised")
        data = (json.dumps(frame, separators=(",", ":")) + "\n").encode("utf-8")
        try:
            proc.stdin.write(data)
            proc.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise RuntimeError(f"stdio server pipe closed: {exc}") from exc

    def _close_stdio(self) -> None:
        proc = self._proc
        if proc is None:
            return
        with suppress(Exception):
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.close()
        with suppress(Exception):
            proc.terminate()
        # Give it a moment to exit cleanly.
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline and proc.poll() is None:
            time.sleep(0.05)
        if proc.poll() is None:
            with suppress(Exception):
                proc.kill()
        with suppress(Exception):
            if proc.stdout:
                proc.stdout.close()
        with suppress(Exception):
            if proc.stderr:
                proc.stderr.close()
        self._reader_alive = False
        self._proc = None

    # ------------------------------------------------------------------
    # Internals — http
    # ------------------------------------------------------------------

    def _validate_http_config(self) -> None:
        if not self._http_url:
            raise ValueError("http server_config requires 'url'")

    def _send_http(self, frame: dict, timeout: float) -> dict | None:
        body = json.dumps(frame, separators=(",", ":")).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            # Strict Streamable HTTP MCP servers require this header on every
            # POST after the initialize handshake. Without it, compliant
            # servers reject with HTTP 400.
            "MCP-Protocol-Version": _PROTOCOL_VERSION,
        }
        headers.update(self._http_headers)
        if self._http_session_id:
            headers["Mcp-Session-Id"] = self._http_session_id
        req = urllib.request.Request(self._http_url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                # Capture session id if server returns one (Streamable HTTP).
                session_id = resp.headers.get("Mcp-Session-Id")
                if session_id and not self._http_session_id:
                    self._http_session_id = session_id
                # Notifications return 202 with no body.
                if resp.status == 202:
                    return None
                raw = resp.read()
                ctype = resp.headers.get("Content-Type", "")
                text = raw.decode("utf-8", errors="replace").strip()
                if not text:
                    return None
                if "text/event-stream" in ctype:
                    return _parse_sse(text)
                return json.loads(text)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code} from MCP server: {raw[:500]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"HTTP transport error: {exc}") from exc

    # ------------------------------------------------------------------
    # Internals — JSON-RPC dispatch
    # ------------------------------------------------------------------

    def _handshake(self) -> None:
        params = {
            "protocolVersion": _PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": _CLIENT_NAME, "version": _CLIENT_VERSION},
        }
        # initialize is a request — must succeed before notifying.
        self._request("initialize", params, timeout=15.0, _bypass_connected=True)
        # initialized notification — no id, no response expected.
        notice = {"jsonrpc": "2.0", "method": "notifications/initialized"}
        if self._transport == "stdio":
            self._send_stdio(notice)
        else:
            # Some HTTP servers accept the notification, others ignore it.
            with suppress(Exception):
                self._send_http(notice, timeout=5.0)

    def _request(
        self,
        method: str,
        params: dict,
        timeout: float = 30.0,
        _bypass_connected: bool = False,
    ) -> dict:
        if not _bypass_connected:
            self._require_connected()
        req_id = uuid.uuid4().hex
        frame = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}

        if self._transport == "stdio":
            response = self._stdio_request(req_id, frame, timeout)
        else:
            response = self._send_http(frame, timeout)
            if response is None:
                raise RuntimeError(f"empty HTTP response for {method}")

        if not isinstance(response, dict):
            raise RuntimeError(f"unexpected JSON-RPC response type: {type(response).__name__}")
        if "error" in response and response["error"]:
            err = response["error"]
            raise MCPError(
                code=int(err.get("code", -32000)),
                message=str(err.get("message", "unknown error")),
                data=err.get("data"),
            )
        result = response.get("result")
        if result is None:
            return {}
        return result

    def _stdio_request(self, req_id: str, frame: dict, timeout: float) -> dict:
        if not self._reader_alive:
            raise RuntimeError("stdio reader not running; server may have exited")
        q: queue.Queue = queue.Queue(maxsize=1)
        self._pending[req_id] = q
        try:
            self._send_stdio(frame)
            try:
                msg = q.get(timeout=timeout)
            except queue.Empty as exc:
                raise TimeoutError(
                    f"timeout waiting for response to {frame.get('method')!r} after {timeout}s"
                ) from exc
            if msg.get("__reader_closed__"):
                raise RuntimeError("stdio server closed before responding")
            return msg
        finally:
            self._pending.pop(req_id, None)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _require_connected(self) -> None:
        if not self._connected:
            raise RuntimeError("MCPClient.connect() must be called before this operation")


def _parse_sse(text: str) -> dict:
    """Pull the first JSON-RPC envelope out of an SSE response body.

    MCP Streamable HTTP servers may reply with text/event-stream framing
    even for single-shot responses. Format is `data: <json>` lines separated
    by blank lines. We take the first data payload that parses as JSON.
    """
    for block in text.split("\n\n"):
        data_lines = []
        for line in block.splitlines():
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if not data_lines:
            continue
        payload = "\n".join(data_lines).strip()
        if not payload:
            continue
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            continue
    raise RuntimeError("no JSON payload found in SSE response")
