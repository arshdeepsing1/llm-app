import ast
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from .context import DEFAULT_CONTEXT_WINDOW, MIN_CONTEXT_WINDOW, MAX_CONTEXT_WINDOW

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


def credential_assignments(values):
    return {key: values[key] if key in values else values[alias]
            for key, alias in (("DBRICKS_URL", "DATABRICKS_HOST"), ("DBRICKS_TOKEN", "DATABRICKS_TOKEN"))
            if key in values or alias in values}


class Settings:
    def __init__(self, state_dir: Path | None = None):
        self.env = {}
        for source in (read_env(APP_ROOT / ".env"), os.environ):
            self.env.update(source)
            self.env.update(credential_assignments(source))
        self.state_dir = state_dir or Path(self.env.get("LOCAL_AGENT_STATE_DIR", str(APP_ROOT / ".local")))
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.state_dir / "settings.json"
        self.values = {
            "workspace": self.env.get("LOCAL_AGENT_WORKSPACE", str(APP_ROOT.parent)),
            "model": self.env.get("LOCAL_AGENT_MODEL", "databricks-gpt-oss-120b"),
            "env_file": self.env.get("LOCAL_AGENT_ENV_FILE", ""),
            "context_window": DEFAULT_CONTEXT_WINDOW,
        }
        if self.path.exists():
            saved = json.loads(self.path.read_text())
            self.values.update({key: value for key, value in saved.items() if key in self.values})

    def credentials(self) -> tuple[str, str]:
        external = read_env(Path(self.values["env_file"]).expanduser()) if self.values["env_file"] else {}
        env = {**credential_assignments(external), **credential_assignments(self.env)}
        url = env.get("DBRICKS_URL", "").rstrip("/")
        token = env.get("DBRICKS_TOKEN", "")
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
        except (ValueError, OSError):
            host, configured = "", False
        return {**self.values, "host": host, "configured": configured}

    def update(self, values: dict):
        candidate = {**self.values, **{k: v for k, v in values.items() if k in self.values}}
        workspace = Path(candidate["workspace"]).expanduser().resolve()
        if not workspace.is_dir():
            raise ValueError("Choose an existing project directory.")
        if not candidate["model"].strip():
            raise ValueError("Enter a model or model-service ID.")
        budget = candidate["context_window"]
        if type(budget) is not int or not MIN_CONTEXT_WINDOW <= budget <= MAX_CONTEXT_WINDOW:
            raise ValueError(f"Context budget must be an integer from {MIN_CONTEXT_WINDOW:,} to {MAX_CONTEXT_WINDOW:,} tokens.")
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
        except (ValueError, OSError):
            return text
