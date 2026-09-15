"""Get the matching official CLI without changing the SDK checkout or global CLI."""
import subprocess
import sys
import zipfile
from pathlib import Path

from claude_agent_sdk import __version__

root = Path(__file__).resolve().parent
cache = root / ".local" / "sdk-wheel"
cache.mkdir(parents=True, exist_ok=True)
wheels = list(cache.glob(f"claude_agent_sdk-{__version__}-*.whl"))
if not wheels:
    subprocess.run([sys.executable, "-m", "pip", "download", f"claude-agent-sdk=={__version__}",
                    "--no-deps", "--only-binary=:all:", "-d", str(cache)], check=True)
    wheels = list(cache.glob(f"claude_agent_sdk-{__version__}-*.whl"))
if len(wheels) != 1:
    raise SystemExit("Expected one wheel for this platform. Clear .local/sdk-wheel and retry.")
target = root / ".local" / "bin" / "claude"
target.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(wheels[0]) as archive:
    target.write_bytes(archive.read("claude_agent_sdk/_bundled/claude"))
target.chmod(0o700)
subprocess.run([str(target), "--version"], check=True)
print(f"App runtime prepared: {target}")
