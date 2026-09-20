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
        self.db.execute("CREATE TABLE IF NOT EXISTS session_summaries (id TEXT PRIMARY KEY, updated REAL, data TEXT)")
        self.db.execute("CREATE INDEX IF NOT EXISTS session_summaries_updated ON session_summaries(updated DESC)")
        # Existing databases are backfilled once. Reopening reads no transcript
        # payloads for sessions whose small summary is already present.
        with self.db:
            rows = self.db.execute("SELECT s.id, s.updated, s.data FROM sessions s "
                                   "LEFT JOIN session_summaries m ON m.id=s.id WHERE m.id IS NULL")
            for session_id, updated, data in rows:
                summary = self.summary(json.loads(data))
                self.db.execute("INSERT INTO session_summaries VALUES (?, ?, ?)",
                                (session_id, updated, json.dumps(summary)))
        path.chmod(0o600)

    @staticmethod
    def summary(session):
        return {k: v for k, v in session.items()
                if k not in ("wire", "events", "context_state", "instruction_directories")}

    def _write(self, session, insert_only=False):
        statement = "INSERT" if insert_only else "INSERT OR REPLACE"
        self.db.execute(f"{statement} INTO sessions VALUES (?, ?, ?)",
                        (session["id"], session["updated"], json.dumps(session)))
        self.db.execute(f"{statement} INTO session_summaries VALUES (?, ?, ?)",
                        (session["id"], session["updated"], json.dumps(self.summary(session))))

    def create(self, settings: dict):
        now = time.time()
        session = {"id": str(uuid.uuid4()), "title": "New conversation", "created": now,
                   "updated": now, "workspace": settings["workspace"],
                   "model": settings["model"], "events": [], "wire": [],
                   "permission_mode": "manual", "allowed_directories": []}
        self.save(session)
        return session

    def save(self, session):
        prepared = {**session, "updated": time.time()}
        with self.db:
            self._write(prepared)
        session["updated"] = prepared["updated"]

    def insert_sessions(self, sessions):
        """Insert validated imports atomically; existing IDs are never replaced."""
        now = time.time()
        prepared = [{"created": now, "updated": now, **session} for session in sessions]
        with self.db:
            for session in prepared:
                self._write(session, insert_only=True)
        for original, saved in zip(sessions, prepared):
            original.update(created=saved["created"], updated=saved["updated"])

    def get(self, session_id):
        row = self.db.execute("SELECT data FROM sessions WHERE id=?", (session_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self):
        rows = self.db.execute("SELECT data FROM session_summaries ORDER BY updated DESC").fetchall()
        return [json.loads(row[0]) for row in rows]

    def delete(self, session_id):
        with self.db:
            self.db.execute("DELETE FROM sessions WHERE id=?", (session_id,))
            self.db.execute("DELETE FROM session_summaries WHERE id=?", (session_id,))
