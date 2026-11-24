"""Session mapping from state.db: scoring, lineage roots, the tool-source skip, read-only access, cache."""

from __future__ import annotations

import hashlib
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support

support.load_api()
sessions = sys.modules["mg_sessions"]


def make_db(path: Path, rows: list[tuple]) -> None:
    conn = sqlite3.connect(path)
    conn.execute("create table sessions (id text primary key, source text, parent_session_id text, started_at real, "
                 "last_activity_at real, ended_at real, title text)")
    conn.execute("create table messages (id integer primary key autoincrement, session_id text, role text, content text, tool_calls text)")
    conn.executemany("insert into sessions values (?,?,?,?,?,?,?)", rows)
    conn.commit()
    conn.close()


def add_message(path: Path, sid: str, content: str = "", calls: str = "") -> None:
    conn = sqlite3.connect(path)
    conn.execute("insert into messages (session_id, role, content, tool_calls) values (?, 'assistant', ?, ?)", (sid, content, calls))
    conn.commit()
    conn.close()


PUSH = '[{"function": {"name": "terminal", "arguments": "git push origin feature/x"}}]'


class TestSessions(unittest.TestCase):
    def setUp(self):
        sessions.reset()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.home = self.root

    def default_db(self) -> Path:
        path = self.root / "state.db"
        make_db(path, [("root1", "desktop", None, 1, 5000, None, "Make the thing\u2026"),
                       ("child1", "kanban", "root1", 2, 6000, None, None),
                       ("tool1", "tool", None, 3, 7000, None, "model call")])
        return path

    def test_author_marker_scores_ten_and_lineage_folds_into_the_root(self):
        db = self.default_db()
        add_message(db, "child1", "", PUSH)
        got = sessions.map_branches(self.home, [], ["feature/x"])
        self.assertEqual(got["feature/x"], {"id": "root1", "profile": "default", "title": "Make the thing", "score": 10})

    def test_mentions_below_the_threshold_map_to_nothing(self):
        db = self.default_db()
        for _ in range(4):
            add_message(db, "root1", "we should look at feature/x")
        self.assertIsNone(sessions.map_branches(self.home, [], ["feature/x"])["feature/x"])
        add_message(db, "root1", "and again feature/x")
        sessions.reset()
        self.assertEqual(sessions.map_branches(self.home, [], ["feature/x"])["feature/x"]["score"], 5)

    def test_tool_source_sessions_are_skipped(self):
        db = self.default_db()
        add_message(db, "tool1", "", PUSH)
        self.assertIsNone(sessions.map_branches(self.home, [], ["feature/x"])["feature/x"])

    def test_profiles_are_searched_and_filtered_and_sanitizer_is_never_opened(self):
        self.default_db()
        for name in ("ops", "sanitizer"):
            (self.root / "profiles" / name).mkdir(parents=True)
            make_db(self.root / "profiles" / name / "state.db", [("s1", "cli", None, 1, 2, None, f"in {name}")])
            add_message(self.root / "profiles" / name / "state.db", "s1", "", PUSH)
        found = sessions.map_branches(self.home, [], ["feature/x"])["feature/x"]
        self.assertEqual((found["profile"], found["id"]), ("ops", "s1"))
        self.assertEqual([p for p, _d in sessions.state_dbs(self.home, [])], ["default", "ops"])
        self.assertEqual([p for p, _d in sessions.state_dbs(self.home, ["default"])], ["default"])
        self.assertEqual(sessions.state_dbs(self.home, ["sanitizer"]), [])

    def test_a_profile_home_finds_its_siblings(self):
        self.default_db()
        profile = self.root / "profiles" / "ops"
        profile.mkdir(parents=True)
        make_db(profile / "state.db", [("s1", "cli", None, 1, 2, None, "x")])
        self.assertEqual([p for p, _d in sessions.state_dbs(profile, [])], ["default", "ops"])

    def test_missing_or_broken_db_is_not_an_error(self):
        self.assertEqual(sessions.map_branches(self.home, [], ["a/b"]), {"a/b": None})
        (self.root / "state.db").write_text("not sqlite")
        sessions.reset()
        self.assertEqual(sessions.map_branches(self.home, [], ["a/b"]), {"a/b": None})

    def test_results_are_cached_per_branch(self):
        db = self.default_db()
        add_message(db, "root1", "", PUSH)
        sessions.map_branches(self.home, [], ["feature/x"])
        with mock.patch.object(sessions, "_scan_db") as scan:
            sessions.map_branches(self.home, [], ["feature/x"])
            scan.assert_not_called()
            scan.return_value = {}
            sessions.map_branches(self.home, [], ["feature/x", "other/y"])
            self.assertEqual(scan.call_args.args[2], ["other/y"])

    def test_state_db_is_opened_read_only_and_never_modified(self):
        db = self.default_db()
        before = hashlib.sha256(db.read_bytes()).hexdigest()
        conn = sessions.open_readonly(db)
        for statement in ("create table x (a)", "insert into sessions (id, source, started_at) values ('z', 'cli', 1)",
                          "delete from messages", "update sessions set title = 'x'"):
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute(statement)
        conn.close()
        sessions.map_branches(self.home, [], ["feature/x"])
        self.assertEqual(hashlib.sha256(db.read_bytes()).hexdigest(), before)

    def test_collector_attaches_the_session_to_the_item(self):
        db = self.default_db()
        add_message(db, "root1", "", PUSH.replace("feature/x", "feature/7"))
        (self.root / "gl_dir").mkdir()
        with support.World(self.root / "gl_dir") as world:
            world.add_project(1, "g/p")
            world.add_mr(1, 7, branch="feature/7")
            world.add_mr(1, 8, branch="feature/8")
            with mock.patch.dict("os.environ", {"HERMES_HOME": str(self.home)}), \
                    mock.patch.object(sys.modules["mg_settings"], "read_entry", return_value={}):
                sys.modules["mg_service"].reset()
                api = support.load_api()
                items = {i["iid"]: i for i in api.mrs(0)["items"]}
        self.assertEqual(items[7]["session"]["id"], "root1")
        self.assertEqual(sorted(items[7]["session"]), ["id", "profile", "score", "title"])
        self.assertIsNone(items[8]["session"])


if __name__ == "__main__":
    unittest.main()
