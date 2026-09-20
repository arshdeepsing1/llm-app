import json
import sqlite3

import pytest

from local_agent.store import Store


def prepared(session_id="example"):
    return {"id": session_id, "title": "Example", "created": 10, "updated": 20,
            "workspace": "/project", "model": "model", "events": [], "wire": []}


def test_list_reads_only_small_persisted_metadata(tmp_path):
    store = Store(tmp_path / "sessions.db")
    session = {**prepared(), "events": [{"text": "x" * 2_000_000}], "wire": [{"content": "y" * 2_000_000}],
               "context_state": {"summary": "private context"}, "instruction_directories": ["src"],
               "tool_profile": "read_only", "is_subagent": True, "parent_session_id": "parent",
               "custom_flag": {"preserved": True}}
    store.save(session)

    def authorize(operation, table, column, database, source):
        return sqlite3.SQLITE_DENY if operation == sqlite3.SQLITE_READ and table == "sessions" else sqlite3.SQLITE_OK

    store.db.set_authorizer(authorize)
    assert store.list() == [Store.summary(session)]
    assert len(json.dumps(store.list())) < 1000
    store.db.close()


def test_old_database_is_backfilled_once_and_preserves_summary_contract(tmp_path, monkeypatch):
    path = tmp_path / "sessions.db"
    session = {**prepared(), "events": [{"text": "large history"}], "context_state": {"through": 1},
               "permission_mode": "manual", "terminal_reason": "interrupted"}
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, updated REAL, data TEXT)")
        db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (session["id"], session["updated"], json.dumps(session)))
    store = Store(path)
    assert store.list() == [Store.summary(session)]
    assert store.get(session["id"]) == session
    store.db.close()
    original_loads = json.loads
    loaded = []

    def capture(value):
        loaded.append(value)
        return original_loads(value)

    monkeypatch.setattr("local_agent.store.json.loads", capture)
    reopened = Store(path)
    assert loaded == []
    assert reopened.list() == [Store.summary(session)]
    assert len(loaded) == 1 and "large history" not in loaded[0]
    reopened.db.close()


def test_save_rolls_back_session_and_summary_together(tmp_path):
    store = Store(tmp_path / "sessions.db")
    session = prepared()
    store.save(session)
    previous = store.get(session["id"])
    store.db.execute("CREATE TRIGGER reject_summary BEFORE INSERT ON session_summaries "
                     "BEGIN SELECT RAISE(ABORT, 'summary unavailable'); END")
    session["title"] = "New title"
    with pytest.raises(sqlite3.IntegrityError, match="summary unavailable"):
        store.save(session)
    assert session["updated"] == previous["updated"]
    assert store.get(session["id"]) == previous
    assert store.list() == [Store.summary(previous)]
    assert not store.db.in_transaction
    store.db.close()


def test_delete_rolls_back_both_records_and_success_survives_restart(tmp_path):
    path = tmp_path / "sessions.db"
    store = Store(path)
    session = prepared()
    store.save(session)
    store.db.execute("CREATE TRIGGER reject_delete BEFORE DELETE ON session_summaries "
                     "BEGIN SELECT RAISE(ABORT, 'delete unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError, match="delete unavailable"):
        store.delete(session["id"])
    assert store.get(session["id"]) == session
    assert store.list() == [Store.summary(session)]
    store.db.execute("DROP TRIGGER reject_delete")
    store.delete(session["id"])
    store.db.close()
    reopened = Store(path)
    assert reopened.get(session["id"]) is None and reopened.list() == []
    reopened.db.close()


def test_insert_sessions_is_atomic_and_never_overwrites_existing_ids(tmp_path):
    store = Store(tmp_path / "sessions.db")
    original = prepared("existing")
    store.save(original)
    collision = {**prepared("existing"), "title": "Must not replace"}
    with pytest.raises(sqlite3.IntegrityError):
        store.insert_sessions([prepared("new"), collision])
    assert store.get("new") is None
    assert store.get("existing") == original
    assert store.list() == [Store.summary(original)]
    new = [prepared("first"), {**prepared("second"), "updated": 30, "archive_only": True}]
    store.insert_sessions(new)
    assert store.get("first") == new[0]
    assert store.get("second") == new[1]
    assert len(store.list()) == 3
    assert next(item for item in store.list() if item["id"] == "second")["archive_only"] is True
    store.db.close()


def test_insert_sessions_rolls_back_if_metadata_write_fails(tmp_path):
    store = Store(tmp_path / "sessions.db")
    store.db.execute("CREATE TRIGGER reject_second BEFORE INSERT ON session_summaries WHEN NEW.id='second' "
                     "BEGIN SELECT RAISE(ABORT, 'metadata unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError, match="metadata unavailable"):
        store.insert_sessions([prepared("first"), prepared("second")])
    assert store.get("first") is None and store.get("second") is None
    assert store.list() == []
    store.db.close()
