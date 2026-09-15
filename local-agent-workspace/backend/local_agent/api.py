import asyncio
import secrets
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .agents import AgentManager, public_session
from .config import APP_ROOT, Settings
from .store import Store
from .tools import WorkspaceTools, file_error
from .permissions import PermissionMode


class Prompt(BaseModel):
    text: str = Field(min_length=1, max_length=50000)


class Decision(BaseModel):
    allowed: bool


class SessionPermissions(BaseModel):
    permission_mode: PermissionMode = "manual"


class FolderAccess(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


class FileEdit(BaseModel):
    path: str
    content: str = Field(max_length=80000)
    original: str
    session_id: str | None = None


class SettingsEdit(BaseModel):
    workspace: str
    runtime: str
    model: str
    env_file: str
    claude_cli_path: str = ""
    claude_mcp_config: str = ""
    claude_skills: bool = False


def create_app(settings=None):
    settings = settings or Settings()
    store = Store(settings.state_dir / "conversations.sqlite3")
    manager = AgentManager(store, settings)
    local_token = secrets.token_urlsafe(32)

    @asynccontextmanager
    async def lifespan(app):
        yield
        await asyncio.gather(*(manager.stop(sid) for sid in list(manager.tasks)))
        store.db.close()

    app = FastAPI(title="Local workspace", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"])
    app.state.manager, app.state.settings = manager, settings

    def origin_allowed(origin):
        if not origin:
            return True  # API clients still need the unguessable local token.
        parsed = urlsplit(origin)
        return parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")

    @app.middleware("http")
    async def local_access(request: Request, call_next):
        if not origin_allowed(request.headers.get("origin")):
            return JSONResponse({"detail": "Cross-origin access is not allowed."}, status_code=403)
        if request.url.path.startswith("/api/") and request.url.path != "/api/bootstrap":
            if not secrets.compare_digest(request.headers.get("x-local-token", ""), local_token):
                return JSONResponse({"detail": "Refresh the app to reconnect.", "code": "reconnect_required"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ValueError)
    async def value_error(request, error):
        return JSONResponse({"detail": settings.redact(str(error))}, status_code=400)

    @app.exception_handler(OSError)
    async def os_error(request, error):
        return JSONResponse({"detail": settings.redact(file_error(error))}, status_code=400)

    def session_or_404(session_id):
        session = manager.get(session_id)
        if not session:
            raise HTTPException(404, "Conversation not found.")
        return session

    def workspace_tools(session_id=None):
        session = session_or_404(session_id) if session_id else {}
        workspace = session.get("workspace", settings.values["workspace"])
        return WorkspaceTools(workspace, settings.values["env_file"], session.get("allowed_directories", []),
                              session.get("permission_mode") == "bypassPermissions")

    @app.get("/api/bootstrap")
    async def bootstrap():
        return {"token": local_token, "settings": settings.public()}

    def check_folder(path, workspace):
        folder = WorkspaceTools(workspace, settings.values["env_file"]).resolve(path)
        if not folder.is_dir():
            raise ValueError("Choose an existing folder.")
        # Probe directory access without reading any file contents or returning names.
        next(folder.iterdir(), None)
        return folder

    @app.post("/api/folder-access/check")
    async def folder_access_check(body: FolderAccess):
        try:
            folder = check_folder(body.path, settings.values["workspace"])
            return {"accessible": True, "path": str(folder), "error": None}
        except (ValueError, OSError) as exc:
            return {"accessible": False, "path": body.path, "error": settings.redact(file_error(exc)),
                    "python_executable": str(Path(sys.executable).resolve())}

    @app.get("/api/connection")
    async def connection():
        try:
            host, token = settings.credentials()
            path = "/ai-gateway/anthropic/v1/models" if settings.values["runtime"] == "claude" else "/api/2.0/serving-endpoints"
            async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
                response = await client.get(host + path, headers={"Authorization": f"Bearer {token}"})
            if response.status_code != 200:
                return {"connected": False, "models": [], "error": f"Databricks returned HTTP {response.status_code}. Check your credentials and access."}
            data = response.json()
            models = [item.get("name", item.get("id", "")) for item in data.get("endpoints", data.get("data", []))]
            models = [name for name in models if name and not any(term in name for term in ("embedding", "gte-", "bge-"))]
            return {"connected": True, "models": models, "error": None}
        except (ValueError, httpx.HTTPError) as exc:
            return {"connected": False, "models": [], "error": settings.redact(str(exc))}

    @app.put("/api/settings")
    async def update_settings(body: SettingsEdit):
        return settings.update(body.model_dump())

    @app.get("/api/sessions")
    async def list_sessions():
        return [{**s, "status": manager.statuses.get(s["id"], "idle")} for s in store.list()]

    @app.post("/api/sessions")
    async def create_session(body: SessionPermissions | None = None):
        session = store.create(settings.values)
        session["permission_mode"] = body.permission_mode if body else "manual"
        store.save(session)
        return public_session(session)

    @app.put("/api/sessions/{session_id}/permissions")
    async def permissions(session_id: str, body: SessionPermissions):
        session = session_or_404(session_id)
        if manager.statuses.get(session_id, "idle") != "idle":
            raise HTTPException(409, "Stop the current response before changing permissions.")
        session["permission_mode"] = body.permission_mode
        store.save(session)
        result = public_session(session)
        await manager.broadcast(session_id, {"type": "snapshot", "session": result})
        return result

    @app.post("/api/sessions/{session_id}/folders")
    async def allow_folder(session_id: str, body: FolderAccess):
        session = session_or_404(session_id)
        if manager.statuses.get(session_id, "idle") != "idle":
            raise HTTPException(409, "Stop the current response before changing folder access.")
        folder = str(check_folder(body.path, session["workspace"]))
        allowed = session.setdefault("allowed_directories", [])
        if folder not in allowed and folder != session["workspace"]:
            allowed.append(folder)
        store.save(session)
        result = public_session(session)
        await manager.broadcast(session_id, {"type": "snapshot", "session": result})
        return result

    @app.delete("/api/sessions/{session_id}/folders")
    async def remove_folder(session_id: str, body: FolderAccess):
        session = session_or_404(session_id)
        if manager.statuses.get(session_id, "idle") != "idle":
            raise HTTPException(409, "Stop the current response before changing folder access.")
        folder = str(Path(body.path).expanduser().resolve())
        session["allowed_directories"] = [p for p in session.get("allowed_directories", []) if p != folder]
        store.save(session)
        result = public_session(session)
        await manager.broadcast(session_id, {"type": "snapshot", "session": result})
        return result

    @app.get("/api/sessions/{session_id}")
    async def get_session(session_id: str):
        return public_session(session_or_404(session_id), manager.statuses.get(session_id, "idle"))

    @app.delete("/api/sessions/{session_id}")
    async def delete_session(session_id: str):
        session_or_404(session_id)
        await manager.stop(session_id)
        store.delete(session_id)
        manager.live.pop(session_id, None)
        manager.statuses.pop(session_id, None)
        return {"ok": True}

    @app.post("/api/sessions/{session_id}/messages")
    async def message(session_id: str, body: Prompt):
        session_or_404(session_id)
        if not body.text.strip():
            raise ValueError("Enter a message.")
        manager.start(session_id, body.text.strip())
        return {"ok": True}

    @app.post("/api/sessions/{session_id}/stop")
    async def stop(session_id: str):
        session_or_404(session_id)
        await manager.stop(session_id)
        return {"ok": True}

    @app.post("/api/sessions/{session_id}/approvals/{event_id}")
    async def approval(session_id: str, event_id: str, body: Decision):
        session_or_404(session_id)
        manager.decide(session_id, event_id, body.allowed)
        return {"ok": True}

    @app.websocket("/api/sessions/{session_id}/stream")
    async def stream(socket: WebSocket, session_id: str):
        protocols = [p.strip() for p in socket.headers.get("sec-websocket-protocol", "").split(",")]
        if len(protocols) != 2 or protocols[0] != "local-workspace" or not secrets.compare_digest(protocols[1], local_token) or not origin_allowed(socket.headers.get("origin")):
            await socket.close(code=1008)
            return
        session = manager.get(session_id)
        if not session:
            await socket.close(code=1008)
            return
        await socket.accept(subprotocol="local-workspace")
        manager.listeners.setdefault(session_id, set()).add(socket)
        try:
            await socket.send_json({"type": "snapshot", "session": public_session(session, manager.statuses.get(session_id, "idle"))})
            while True:
                await socket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            manager.listeners.get(session_id, set()).discard(socket)

    @app.get("/api/files")
    async def files(path: str = ".", session_id: str | None = None):
        return workspace_tools(session_id).list_files(path)

    @app.get("/api/file")
    async def file(path: str, session_id: str | None = None):
        return {"path": path, "content": workspace_tools(session_id).read_file(path)}

    @app.put("/api/file")
    async def save_file(body: FileEdit):
        tools = workspace_tools(body.session_id)
        if tools.read_file(body.path) != body.original:
            raise HTTPException(409, "This file changed on disk. Reopen it before saving.")
        tools.change("write_file", {"path": body.path, "content": body.content}, apply=True)
        return {"ok": True}

    @app.get("/api/git")
    async def git_changes(session_id: str | None = None):
        tools = workspace_tools(session_id)
        result = await tools.run_command("git status --short --untracked-files=normal && git diff --no-ext-diff --no-textconv -- . ':!*.env' ':!.env*' ':!env_vars.txt'")
        return result

    @app.post("/api/command")
    async def command(body: Prompt, session_id: str | None = None):
        # Clicking Run in the terminal panel is explicit user authorization.
        try:
            return await workspace_tools(session_id).run_command(body.text)
        except TimeoutError:
            raise HTTPException(408, "Command stopped after 60 seconds.")

    dist = APP_ROOT / "frontend" / "dist"
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/")
    async def index():
        if (dist / "index.html").exists():
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
        return JSONResponse({"message": "Build the frontend first. See README.md."}, status_code=503)

    return app
