"""Optional local CLI transport check. Uses scripted responses; no paid inference."""
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from local_agent.agents import AgentManager
from local_agent.config import APP_ROOT, Settings
from local_agent.store import Store


@pytest.mark.skipif(not (APP_ROOT / ".local/bin/claude").exists(), reason="Run prepare_claude.py first")
async def test_native_cli_can_stream_and_resume_through_adapter(tmp_path):
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_HEAD(self):
            self.send_response(200)
            self.end_headers()

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"data":[]}')

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            if "count_tokens" in self.path:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"input_tokens":10}')
                return
            calls.append(body)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            events = [
                {"type": "message_start", "message": {"id": "msg_local_test", "type": "message", "role": "assistant", "model": "claude-sonnet-4-6", "content": [], "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 0}}},
                {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
                {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Local transport verified."}},
                {"type": "content_block_stop", "index": 0},
                {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 5}},
                {"type": "message_stop"},
            ]
            for event in events:
                self.wfile.write(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n".encode())
            self.wfile.flush()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    settings = Settings(tmp_path / "state")
    settings.values.update(workspace=str(tmp_path), runtime="claude", model="claude-sonnet-4-6", env_file="",
                           claude_cli_path=str(APP_ROOT / ".local/bin/claude"))
    settings.credentials = lambda: (f"http://127.0.0.1:{server.server_port}", "fake-local-test-token")
    store = Store(tmp_path / "test.sqlite3")
    manager = AgentManager(store, settings)
    session = store.create(settings.values)
    try:
        await asyncio.wait_for(manager.run_claude(session, "Say hello. Do not use tools."), 45)
        first_session = session["sdk_id"]
        assert first_session
        assert any(e.get("text") == "Local transport verified." for e in session["events"])
        await asyncio.wait_for(manager.run_claude(session, "Say hello again. Do not use tools."), 45)
        assert session["sdk_id"] == first_session
        assert len(calls) >= 2
    finally:
        server.shutdown()
        server.server_close()
        store.db.close()
