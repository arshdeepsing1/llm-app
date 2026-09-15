import asyncio
import difflib
import fnmatch
import os
import signal
import sys
from pathlib import Path

IGNORED = {".git", "node_modules", ".venv", ".codex_venv", "__pycache__", ".local", ".pytest_cache", "dist"}
SECRET_NAMES = {".env", "env_vars.txt", ".netrc", ".npmrc", "credentials", "credentials.json", "id_rsa", "id_ed25519"}
LIMIT = 80_000


def file_error(error: Exception) -> str:
    if isinstance(error, PermissionError) and sys.platform == "darwin":
        return (f"macOS denied access to {error.filename or 'this path'}. "
                "This is an operating-system permission, separate from the chat permission mode. "
                "In System Settings → Privacy & Security → Files and Folders, enable access to this folder "
                "for the application that launches the local server (for example, Terminal or Codex), "
                "then restart the server. Choosing Bypass permissions in chat cannot override macOS privacy settings.")
    return str(error)


class WorkspaceTools:
    def __init__(self, workspace: str, credential_file: str = "", allowed_directories=(), unrestricted=False):
        self.root = Path(workspace).expanduser().resolve()
        self.credential_file = Path(credential_file).expanduser().resolve() if credential_file else None
        self.allowed_directories = [Path(p).expanduser().resolve() for p in allowed_directories]
        self.unrestricted = unrestricted

    def resolve(self, value: str = ".") -> Path:
        path = (self.root / Path(value).expanduser()).resolve()
        relative = path.relative_to(self.root) if path.is_relative_to(self.root) else path
        if path == self.credential_file or any(p in SECRET_NAMES or p.startswith(".env.") and p != ".env.example" for p in relative.parts):
            raise ValueError("Credential files are excluded from file tools.")
        if any(p in IGNORED for p in relative.parts):
            raise ValueError("This internal or generated directory is excluded.")
        return path

    def permitted(self, path: Path) -> bool:
        return self.unrestricted or any(path.is_relative_to(root) for root in [self.root, *self.allowed_directories])

    def path(self, value: str = ".") -> Path:
        path = self.resolve(value)
        if not self.permitted(path):
            raise ValueError("This folder needs access approval in this conversation. Ask the agent to inspect its absolute path.")
        return path

    def display_path(self, path: Path) -> str:
        return str(path.relative_to(self.root)) if path.is_relative_to(self.root) else str(path)

    def list_files(self, path: str = ".", depth: int = 1, glob: str = "*"):
        base = self.path(path)
        if not base.is_dir():
            raise ValueError("Not a directory.")
        result = []

        def visit(folder, level):
            for child in sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
                if len(result) >= 300:
                    break
                try:
                    safe = self.path(str(child))
                except ValueError:
                    continue
                entry = {"path": self.display_path(child), "name": child.name,
                         "directory": safe.is_dir()}
                if fnmatch.fnmatch(child.name.lower(), glob.lower()):
                    result.append(entry)
                if level > 1 and safe.is_dir() and not child.is_symlink():
                    visit(child, level - 1)
        visit(base, min(max(depth, 1), 3))
        return result

    def read_file(self, path: str):
        target = self.path(path)
        if target.stat().st_size > LIMIT:
            raise ValueError("File is too large for the text editor (80 KB limit).")
        text = target.read_text(encoding="utf-8")
        if "\x00" in text:
            raise ValueError("Binary files cannot be opened in the text editor.")
        return text

    def change(self, name: str, arguments: dict, apply=False):
        target = self.path(arguments["path"])
        old = self.read_file(arguments["path"]) if target.exists() else ""
        if name == "edit_file":
            needle = arguments["old_text"]
            if not needle or old.count(needle) != 1:
                raise ValueError("old_text must match exactly once; include more surrounding context.")
            new = old.replace(needle, arguments["new_text"], 1)
        else:
            new = arguments["content"]
        if len(new.encode()) > LIMIT:
            raise ValueError("File content exceeds 80 KB.")
        diff = "".join(difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                                           fromfile=arguments["path"], tofile=arguments["path"]))
        if apply:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(new)
        return diff or "No changes."

    def search_files(self, query: str, glob: str = "*", path: str = "."):
        if not query:
            raise ValueError("Search text cannot be empty.")
        result = []
        search_root = self.path(path)
        if not search_root.is_dir():
            raise ValueError("Not a directory.")
        def unreadable(error):
            raise error

        for base, dirs, files in os.walk(search_root, followlinks=False, onerror=unreadable):
            dirs[:] = [d for d in dirs if d not in IGNORED and not (Path(base) / d).is_symlink()]
            for filename in files:
                relative = self.display_path(Path(base) / filename)
                if not fnmatch.fnmatch(str((Path(base) / filename).relative_to(search_root)), glob):
                    continue
                try:
                    content = self.read_file(relative)
                except (OSError, ValueError, UnicodeError):
                    continue
                for number, line in enumerate(content.splitlines(), 1):
                    if query.lower() in line.lower():
                        result.append(f"{relative}:{number}: {line[:350]}")
                        if len(result) >= 100:
                            return "\n".join(result) + "\n[100 matches; refine your query]"
        return "\n".join(result) or "No matches."

    async def run_command(self, command: str):
        # A working directory is not a shell sandbox. The manager enforces the
        # selected approval mode; remove gateway credentials from the environment.
        keep = {"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "SHELL", "USER", "LOGNAME", "VIRTUAL_ENV"}
        env = {k: v for k, v in os.environ.items() if k in keep}
        process = await asyncio.create_subprocess_exec(
            "/bin/zsh", "-f", "-c", command, cwd=self.root, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, start_new_session=True)
        output = bytearray()

        async def drain():
            while chunk := await process.stdout.read(4096):
                if len(output) < LIMIT:
                    output.extend(chunk[:LIMIT - len(output)])
            await process.wait()

        try:
            await asyncio.wait_for(drain(), timeout=60)
        except (TimeoutError, asyncio.CancelledError):
            if process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            await process.wait()
            raise
        text = output.decode(errors="replace")
        if len(output) >= LIMIT:
            text += "\n[Output truncated at 80 KB]"
        return {"exit_code": process.returncode, "output": text}

    async def execute(self, name: str, arguments: dict):
        if name == "run_command":
            return await self.run_command(arguments["command"])
        if name in ("write_file", "edit_file"):
            return self.change(name, arguments, apply=True)
        if name == "list_files":
            return self.list_files(arguments.get("path", "."), arguments.get("depth", 1), arguments.get("glob", "*"))
        if name == "read_file":
            return self.read_file(arguments["path"])
        if name == "search_files":
            return await asyncio.to_thread(self.search_files, arguments["query"], arguments.get("glob", "*"), arguments.get("path", "."))
        raise ValueError(f"Unknown tool: {name}")


def definition(name, description, properties, required):
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required}}}


STRING = {"type": "string"}
TOOL_DEFINITIONS = [
    definition("list_files", "List local files using an absolute, home-relative or workspace-relative path. The app requests access for external folders. Optional glob filters names (e.g. *.csv). Maximum 300 entries; refine the glob if the limit is reached. Excludes secrets and generated folders.",
               {"path": STRING, "depth": {"type": "integer"}, "glob": STRING}, []),
    definition("read_file", "Read a local UTF-8 file (maximum 80 KB). External paths trigger folder access approval.", {"path": STRING}, ["path"]),
    definition("search_files", "Search local file contents for literal text under path (defaults to workspace). External paths trigger folder access approval.",
               {"query": STRING, "glob": STRING, "path": STRING}, ["query"]),
    definition("write_file", "Create or replace a file subject to the selected permission mode; read existing files first.",
               {"path": STRING, "content": STRING}, ["path", "content"]),
    definition("edit_file", "Replace one exact text occurrence in a file, subject to the selected permission mode.",
               {"path": STRING, "old_text": STRING, "new_text": STRING}, ["path", "old_text", "new_text"]),
    definition("run_command", "Run a shell command in the workspace subject to the selected permission mode. 60 second timeout. No interactive commands.",
               {"command": STRING}, ["command"]),
]
