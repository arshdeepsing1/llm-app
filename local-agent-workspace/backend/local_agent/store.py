import json
import sqlite3
import time
import uuid
from pathlib import Path


class Store:
    def __init__(self, path: Path):
        # Requests serialize DB work on the app's event loop. Allow application
        # creation and lifespan teardown on different threads (ASGI test clients).
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, updated REAL, data TEXT)")
        self.db.commit()
        path.chmod(0o600)

    def create(self, settings: dict):
        now = time.time()
        session = {"id": str(uuid.uuid4()), "title": "New conversation", "created": now,
                   "updated": now, "workspace": settings["workspace"],
                   "model": settings["model"], "events": [], "wire": [],
                   "permission_mode": "manual", "allowed_directories": []}
        self.save(session)
        return session

    def save(self, session):
        session["updated"] = time.time()
        self.db.execute("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)",
                        (session["id"], session["updated"], json.dumps(session)))
        self.db.commit()

    def get(self, session_id):
        row = self.db.execute("SELECT data FROM sessions WHERE id=?", (session_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self):
        rows = self.db.execute("SELECT data FROM sessions ORDER BY updated DESC").fetchall()
        return [{k: v for k, v in json.loads(row[0]).items()
                 if k not in ("wire", "events", "context_state", "instruction_directories")} for row in rows]

    def delete(self, session_id):
        self.db.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        self.db.commit()
