"""
call_tool.py — unified entry point routing tool calls to MCP or CLI transports.

Lane B implementation per API_CONTRACT.md. Pure stdlib (Python 3.11+).
Lazy-imports Lane A's MCPClient only when the MCP path actually fires, so
this module loads cleanly even if Lane A hasn't landed yet at import time.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


# Module-level dry-run ledger. Each entry: {"transport","name","args","timeout"}.
DRY_RUN_LEDGER: list[dict] = []


class ToolResolutionError(Exception):
    """name didn't resolve to any known MCP or CLI tool."""

    def __init__(self, name: str, searched_paths: list[str], message: str) -> None:
        super().__init__(message)
        self.name = name
        self.searched_paths = list(searched_paths)
        self.message = message


def _git_root_or_cwd(start: Path) -> Path:
    """Walk up from start looking for .git; fall back to start."""
    cur = start.resolve()
    for candidate in [cur, *cur.parents]:
        if (candidate / ".git").exists():
            return candidate
    return cur


def _project_mcp_configs(start: Path) -> list[Path]:
    """All .mcp.json files from cwd up to git root (closest first)."""
    out: list[Path] = []
    cur = start.resolve()
    stop = _git_root_or_cwd(cur)
    seen: set[str] = set()
    for candidate in [cur, *cur.parents]:
        mcp = candidate / ".mcp.json"
        key = str(mcp)
        if key not in seen and mcp.is_file():
            out.append(mcp)
            seen.add(key)
        if candidate == stop:
            break
    return out


def _default_config_paths() -> list[Path]:
    """
    Search order (closest/most-specific first):
      1. Per-project .mcp.json (cwd-up to git root, closest wins)
      2. ~/.claude/mcp.json (user-global)
      3. ~/.claude/settings.json (mcpServers key — alternative surface)
      4. ~/.cortextos/<instance>/state/<agent>/.mcp.json (CTX_AGENT_NAME-driven)
    """
    paths: list[Path] = []
    paths.extend(_project_mcp_configs(Path.cwd()))

    home = Path.home()
    user_mcp = home / ".claude" / "mcp.json"
    if user_mcp.is_file():
        paths.append(user_mcp)

    user_settings = home / ".claude" / "settings.json"
    if user_settings.is_file():
        paths.append(user_settings)

    agent_name = os.environ.get("CTX_AGENT_NAME")
    instance = os.environ.get("CTX_INSTANCE_ID")
    if agent_name:
        ctx_root = home / ".cortextos"
        candidates: list[Path] = []
        if instance:
            candidates.append(ctx_root / instance / "state" / agent_name / ".mcp.json")
        # Fallback: glob across instances if CTX_INSTANCE_ID isn't set
        if ctx_root.is_dir():
            for inst_dir in ctx_root.iterdir():
                cand = inst_dir / "state" / agent_name / ".mcp.json"
                if cand.is_file() and cand not in candidates:
                    candidates.append(cand)
        for c in candidates:
            if c.is_file():
                paths.append(c)

    return paths


def _load_mcp_servers(path: Path) -> dict:
    """Read either a .mcp.json or settings.json file; return its mcpServers dict."""
    try:
        with path.open("r", encoding="utf-8") as fp:
            data = json.load(fp)
    except (OSError, json.JSONDecodeError):
        return {}
    servers = data.get("mcpServers")
    if isinstance(servers, dict):
        return servers
    return {}


def _find_server_config(
    server_name: str, config_paths: list[Path]
) -> tuple[dict, Path] | None:
    """Return (server_config_dict, source_path) for the first hit, or None."""
    for p in config_paths:
        servers = _load_mcp_servers(p)
        if server_name in servers:
            cfg = servers[server_name]
            if isinstance(cfg, dict):
                return cfg, p
    return None


def _parse_mcp_name(name: str) -> tuple[str, str]:
    """
    Split 'mcp__<server>__<tool>' into (server, tool).
    Server name itself may contain underscores; tool name is everything after
    the SECOND '__' boundary.
    Raises ValueError if the shape doesn't match.
    """
    if not name.startswith("mcp__"):
        raise ValueError(f"not an MCP tool name: {name!r}")
    rest = name[len("mcp__") :]
    sep = rest.find("__")
    if sep < 0:
        raise ValueError(f"MCP name missing __<tool> segment: {name!r}")
    server = rest[:sep]
    tool = rest[sep + 2 :]
    if not server or not tool:
        raise ValueError(f"MCP name has empty server or tool: {name!r}")
    return server, tool


def _mcp_path(
    name: str,
    args: dict | list | None,
    timeout: float,
    config_paths: list[Path],
    dry_run: bool,
) -> dict:
    server, tool = _parse_mcp_name(name)
    hit = _find_server_config(server, config_paths)
    if hit is None:
        raise ToolResolutionError(
            name=name,
            searched_paths=[str(p) for p in config_paths],
            message=(
                f"MCP server {server!r} not found in any of the searched "
                f"config files. Add it to ~/.claude/mcp.json or your project "
                f".mcp.json, then retry."
            ),
        )
    server_config, _source = hit

    # Normalize args to dict for MCP (kwargs).
    if args is None:
        mcp_args: dict = {}
    elif isinstance(args, dict):
        mcp_args = args
    elif isinstance(args, list):
        # CLI-shape list passed to MCP tool — best we can do is wrap.
        mcp_args = {"args": args}
    else:
        raise TypeError(f"args must be dict|list|None for MCP, got {type(args)!r}")

    if dry_run:
        DRY_RUN_LEDGER.append(
            {
                "transport": "mcp",
                "name": name,
                "server": server,
                "tool": tool,
                "args": mcp_args,
                "timeout": timeout,
                "server_config": server_config,
            }
        )
        return {"dry_run": True, "transport": "mcp", "name": name}

    # Lazy import — Lane A landed mcp_client.py at this path.
    try:
        from community.skills.programmatic_tools.lib.mcp_client import (  # type: ignore
            MCPClient,
        )
    except ImportError:
        # Hyphenated path fallback (importlib) — directory name has hyphens
        # which standard `import` syntax can't express.
        import importlib.util

        here = Path(__file__).resolve().parent
        client_path = here / "mcp_client.py"
        if not client_path.is_file():
            raise ToolResolutionError(
                name=name,
                searched_paths=[str(client_path)],
                message=(
                    f"Lane A's mcp_client.py not present at {client_path}. "
                    f"Wait for Lane A to land before invoking MCP tools."
                ),
            )
        spec = importlib.util.spec_from_file_location(
            "_lane_a_mcp_client", str(client_path)
        )
        if spec is None or spec.loader is None:
            raise ImportError(f"could not load mcp_client.py from {client_path}")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        MCPClient = mod.MCPClient  # type: ignore[attr-defined]

    with MCPClient(server_config) as client:
        result = client.call_tool(tool, mcp_args, timeout=timeout)
    if not isinstance(result, dict):
        return {"result": result}
    return result


def _cli_path(
    name: str,
    args: dict | list | None,
    timeout: float,
    dry_run: bool,
) -> dict:
    resolved = shutil.which(name)
    if resolved is None:
        raise ToolResolutionError(
            name=name,
            searched_paths=os.environ.get("PATH", "").split(os.pathsep),
            message=(
                f"CLI binary {name!r} not found on PATH. Install it or pass "
                f"transport='mcp' if this is an MCP tool name."
            ),
        )

    # Normalize args to list[str] for argv.
    if args is None:
        argv: list[str] = []
    elif isinstance(args, list):
        argv = [str(a) for a in args]
    elif isinstance(args, dict):
        # Dict-shape passed to CLI — expand as --key value pairs.
        argv = []
        for k, v in args.items():
            argv.append(f"--{k}")
            if v is not True and v is not None:
                argv.append(str(v))
    else:
        raise TypeError(f"args must be dict|list|None for CLI, got {type(args)!r}")

    cmd = [resolved, *argv]
    if dry_run:
        DRY_RUN_LEDGER.append(
            {
                "transport": "cli",
                "name": name,
                "cmd": cmd,
                "timeout": timeout,
            }
        )
        return {"dry_run": True, "transport": "cli", "cmd": cmd}

    try:
        proc = subprocess.run(
            cmd,
            shell=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
            "exit": None,
            "timeout": True,
        }

    stdout = proc.stdout or ""
    stderr = proc.stderr or ""
    exit_code = proc.returncode

    # Attempt JSON parse on stdout only if exit was clean — error output
    # often isn't JSON even from JSON-emitting CLIs.
    if exit_code == 0 and stdout.strip():
        try:
            parsed = json.loads(stdout)
            if isinstance(parsed, dict):
                return parsed
            return {"result": parsed}
        except json.JSONDecodeError:
            pass

    return {"stdout": stdout, "stderr": stderr, "exit": exit_code}


def call_tool(
    name: str,
    args: dict | list | None = None,
    *,
    transport: str = "auto",
    config_paths: list[str] | list[Path] | None = None,
    timeout: float = 30.0,
    dry_run: bool = False,
) -> dict:
    """
    Unified entry point. Routes to MCP or CLI based on `transport`.

    transport="auto":
      1. name.startswith("mcp__")  -> MCP
      2. shutil.which(name) resolves -> CLI
      3. else -> ToolResolutionError

    args:
      - dict: kwargs (MCP) OR expanded as --key value (CLI)
      - list: positional argv (CLI) OR wrapped as {"args": [...]} (MCP)
      - None: no args

    Returns a dict in all cases (CLI non-JSON wraps stdout/stderr/exit).
    """
    # Normalize override config_paths.
    if config_paths is not None:
        cfg_paths = [Path(p) for p in config_paths]
    else:
        cfg_paths = _default_config_paths()

    if transport not in ("auto", "mcp", "cli"):
        raise ValueError(
            f"transport must be 'auto'|'mcp'|'cli', got {transport!r}"
        )

    if transport == "auto":
        if name.startswith("mcp__"):
            return _mcp_path(name, args, timeout, cfg_paths, dry_run)
        if shutil.which(name) is not None:
            return _cli_path(name, args, timeout, dry_run)
        searched = [str(p) for p in cfg_paths] + os.environ.get(
            "PATH", ""
        ).split(os.pathsep)
        raise ToolResolutionError(
            name=name,
            searched_paths=searched,
            message=(
                f"{name!r} is neither an mcp__-prefixed MCP tool nor a CLI "
                f"binary on PATH. Prefix MCP tools with 'mcp__<server>__' or "
                f"install the binary."
            ),
        )

    if transport == "mcp":
        return _mcp_path(name, args, timeout, cfg_paths, dry_run)

    return _cli_path(name, args, timeout, dry_run)
