import asyncio
import copy
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from local_agent.agents import AgentManager, public_session
from local_agent.api import create_app
from local_agent.config import Settings
from local_agent.context import estimate_tokens
from local_agent.store import Store


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    monkeypatch.setattr("local_agent.config.APP_ROOT", tmp_path)
    project = tmp_path / "project"
    project.mkdir()
    settings = Settings(tmp_path / "state")
    settings.values.update(workspace=str(project), env_file="")
    settings.credentials = lambda: ("https://gateway.example", "test-token")
    store = Store(settings.state_dir / "tests.sqlite3")
    manager = AgentManager(store, settings)
    session = store.create(settings.values)
    yield manager, session, project
    store.db.close()


def response(text="Done.", call=None):
    delta = {"tool_calls": [{"index": 0, **call}]} if call else {"content": text}
    chunk = {"choices": [{"delta": delta, "finish_reason": "tool_calls" if call else "stop"}]}
    return httpx.Response(200, text="data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n")


def mock_gateway(monkeypatch, gateway):
    client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client(
        **kwargs, transport=httpx.MockTransport(gateway)))


def long_history(session):
    session["wire"] = [message for i in range(4) for message in (
        {"role": "user", "content": f"Earlier request {i}: " + "x" * 7000},
        {"role": "assistant", "content": f"Completed step {i}."})]
    session["events"] = [{"id": "old", "type": "user", "text": "Full transcript remains available."}]


async def test_compaction_preserves_archive_and_survives_restart(runtime, monkeypatch):
    manager, session, project = runtime
    (project / "AGENTS.md").write_text("Project rule: use focused changes.")
    long_history(session)
    archive = copy.deepcopy(session["wire"])
    events = copy.deepcopy(session["events"])
    requests, updates = [], []

    async def gateway(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert estimate_tokens(payload["messages"], payload.get("tools", ())) <= 32768 - 8192 - 2048
        if not payload["stream"]:
            assert "tools" not in payload
            return httpx.Response(200, json={"choices": [{"message": {"content": "Earlier steps completed; use focused changes."}, "finish_reason": "stop"}]})
        assert "Project rule" in payload["messages"][0]["content"]
        return response()

    async def broadcast(sid, data):
        updates.append(copy.deepcopy(data))

    manager.broadcast = broadcast
    mock_gateway(monkeypatch, gateway)
    await manager.run(session, "Continue with the remaining work.")
    assert session["wire"][:len(archive)] == archive
    assert session["events"][:len(events)] == events
    assert session["context_state"]["compactions"] == 1
    assert session["context_info"]["instruction_files"] == ["AGENTS.md"]
    assert any(update.get("status") == "compacting" for update in updates)
    assert any(update["type"] == "context" for update in updates)
    saved = manager.store.get(session["id"])
    assert saved["context_state"] == session["context_state"]
    assert "context_state" not in public_session(saved)
    assert "context_state" not in manager.store.list()[0]
    prior_summaries = sum(not item["stream"] for item in requests)
    restarted = AgentManager(manager.store, manager.settings)
    await restarted.run_databricks(saved, "What comes next?")
    assert sum(not item["stream"] for item in requests) == prior_summaries
    assert any("Earlier steps completed" in str(message.get("content")) for message in requests[-1]["messages"])


@pytest.mark.parametrize("cancel", [False, True])
async def test_failed_or_cancelled_compaction_does_not_commit(runtime, monkeypatch, cancel):
    manager, session, _ = runtime
    long_history(session)
    archive = copy.deepcopy(session["wire"])
    manager.store.save(session)
    entered = asyncio.Event()

    async def gateway(request):
        assert not json.loads(request.content)["stream"]
        entered.set()
        if cancel:
            await asyncio.Event().wait()
        return httpx.Response(500, text="Gateway failure")

    mock_gateway(monkeypatch, gateway)
    manager.start(session["id"], "Continue.")
    await asyncio.wait_for(entered.wait(), 2)
    if cancel:
        await manager.stop(session["id"])
    else:
        await manager.tasks[session["id"]]
    saved = manager.store.get(session["id"])
    assert saved["wire"][:len(archive)] == archive
    assert "context_state" not in saved
    assert manager.statuses[session["id"]] == "idle"
    assert any(event["type"] == ("notice" if cancel else "error") for event in saved["events"])


async def test_oversize_current_turn_never_reaches_gateway(runtime, monkeypatch):
    manager, session, _ = runtime
    async def gateway(request):
        pytest.fail("An oversized request must not be sent")
    mock_gateway(monkeypatch, gateway)
    await manager.run(session, "x" * 30000)
    assert session["events"][-1]["type"] == "error"
    assert session["wire"][-1]["content"] == "x" * 30000


async def test_nested_write_defers_until_guidance_is_sent(runtime, monkeypatch):
    manager, session, project = runtime
    (project / "nested").mkdir()
    (project / "AGENTS.md").write_text("Root guidance.")
    (project / "nested" / "AGENTS.md").write_text("Nested guidance: use plain text.")
    session["permission_mode"] = "acceptEdits"
    requests = []

    async def gateway(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if len(requests) == 2:
            assert not (project / "nested" / "file.txt").exists()
            assert "Nested guidance" in payload["messages"][0]["content"]
            assert payload["messages"][-1]["role"] == "tool"
            assert "No file was changed" in payload["messages"][-1]["content"]
        if len(requests) <= 2:
            return response(call={"id": f"write-{len(requests)}", "type": "function", "function": {
                "name": "write_file", "arguments": json.dumps({"path": "nested/file.txt", "content": "Written after guidance."})}})
        return response()

    mock_gateway(monkeypatch, gateway)
    await manager.run(session, "Write nested/file.txt")
    assert (project / "nested" / "file.txt").read_text() == "Written after guidance."
    writes = [event for event in session["events"] if event.get("name") == "write_file"]
    assert [event["state"] for event in writes] == ["rejected", "completed"]
    assert not manager.pending
    assert session["context_info"]["instruction_files"] == ["AGENTS.md", "nested/AGENTS.md"]
    saved = manager.store.get(session["id"])
    (project / "nested" / "AGENTS.md").write_text("Changed nested guidance.")
    await manager.run_databricks(saved, "Continue.")
    assert "Changed nested guidance" in requests[-1]["messages"][0]["content"]


async def test_instruction_warnings_are_visible(runtime, monkeypatch):
    manager, session, project = runtime
    (project / "AGENTS.md").write_text("x" * 17000)
    async def gateway(request):
        assert "Omitted whole file" in json.loads(request.content)["messages"][0]["content"]
        return response()
    mock_gateway(monkeypatch, gateway)
    await manager.run_databricks(session, "Hello")
    assert session["context_info"]["instruction_files"] == []
    assert "AGENTS.md" in session["context_info"]["warnings"][0]


def test_context_setting_validation_and_legacy_client(runtime):
    manager, _, project = runtime
    settings = manager.settings
    editable = {"workspace": str(project), "model": "test-model", "env_file": ""}
    with TestClient(create_app(settings)) as client:
        headers = {"X-Local-Token": client.get("/api/bootstrap").json()["token"]}
        assert client.put("/api/settings", headers=headers, json={**editable, "context_window": 65536}).status_code == 200
        assert client.put("/api/settings", headers=headers, json=editable).json()["context_window"] == 65536
        for invalid in (True, 0, 10000000, 16384.5, "32768"):
            assert client.put("/api/settings", headers=headers, json={**editable, "context_window": invalid}).status_code == 422
        assert Settings(settings.state_dir).values["context_window"] == 65536
