import ast
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

APP_ROOT = Path(__file__).resolve().parents[2]


def read_env(path: Path) -> dict[str, str]:
    """Read assignments as data; never source or execute a credential file."""
    result = {}
    if not path.is_file():
        return result
    for line in path.read_text().splitlines():
        match = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*[:=]\s*(.*?)\s*$", line)
        if not match:
            continue
        key, value = match.groups()
        if value[:1] in ("'", '"'):
            try:
                value = ast.literal_eval(value)
            except (ValueError, SyntaxError):
                continue
        else:
            value = value.split(" #", 1)[0].strip()
        if isinstance(value, str):
            result[key] = value
    return result


class Settings:
    def __init__(self, state_dir: Path | None = None):
        self.env = {**read_env(APP_ROOT / ".env"), **os.environ}
        self.state_dir = state_dir or Path(self.env.get("LOCAL_AGENT_STATE_DIR", str(APP_ROOT / ".local")))
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.state_dir / "settings.json"
        self.values = {
            "workspace": self.env.get("LOCAL_AGENT_WORKSPACE", str(APP_ROOT.parent)),
            "runtime": self.env.get("LOCAL_AGENT_RUNTIME", "databricks"),
            "model": self.env.get("LOCAL_AGENT_MODEL", "databricks-gpt-oss-120b"),
            "env_file": self.env.get("LOCAL_AGENT_ENV_FILE", ""),
            "claude_cli_path": self.env.get("CLAUDE_CLI_PATH", str(APP_ROOT / ".local" / "bin" / "claude") if (APP_ROOT / ".local" / "bin" / "claude").exists() else ""),
            "claude_mcp_config": self.env.get("CLAUDE_MCP_CONFIG", ""),
            "claude_skills": self.env.get("LOCAL_AGENT_CLAUDE_SKILLS", "0") == "1",
        }
        if self.path.exists():
            self.values.update(json.loads(self.path.read_text()))

    def credentials(self) -> tuple[str, str]:
        external = read_env(Path(self.values["env_file"]).expanduser()) if self.values["env_file"] else {}
        env = {**external, **self.env}
        url = env.get("DBRICKS_URL", env.get("DATABRICKS_HOST", "")).rstrip("/")
        token = env.get("DBRICKS_TOKEN", env.get("DATABRICKS_TOKEN", ""))
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
            raise ValueError("Set a valid HTTPS Databricks workspace URL in your credential file.")
        if not token:
            raise ValueError("Databricks token is missing from your credential file.")
        return url, token

    def public(self):
        try:
            host, _ = self.credentials()
            configured = True
        except ValueError:
            host, configured = "", False
        return {**self.values, "host": host, "configured": configured}

    def update(self, values: dict):
        candidate = {**self.values, **{k: v for k, v in values.items() if k in self.values}}
        workspace = Path(candidate["workspace"]).expanduser().resolve()
        if not workspace.is_dir():
            raise ValueError("Choose an existing project directory.")
        if candidate["runtime"] not in ("databricks", "claude"):
            raise ValueError("Unknown runtime.")
        if not candidate["model"].strip():
            raise ValueError("Enter a model or model-service ID.")
        candidate["workspace"] = str(workspace)
        self.values = candidate
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(candidate, indent=2))
        temp.chmod(0o600)
        temp.replace(self.path)
        return self.public()

    def redact(self, text: str) -> str:
        try:
            _, token = self.credentials()
            return text.replace(token, "[REDACTED]")
        except ValueError:
            return text
