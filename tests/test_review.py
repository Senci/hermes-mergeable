"""Round 3 backend: reviewers, last_note and the restart sweep of audit rows (D76, D80).

The notes come from the fake glab (support.World.add_note); every read is a GET. No live GitLab.
"""

from __future__ import annotations

import json
import unittest

import support
from support import BOT, USER, ApiCase

NOTE_PATH = "projects/1/merge_requests/{iid}/notes?sort=desc&order_by=created_at"


class TestHumanNote(unittest.TestCase):
    def setUp(self):
        support.load_api()
        import sys

        self.rules = sys.modules["mg_rules"]

    @staticmethod
    def note(author, created, system=False):
        return {"author": {"username": author}, "created_at": created, "system": system}

    def test_first_person_note_wins_and_the_time_is_utc(self):
        notes = [self.note("anna", "2026-10-23T12:00:00.000+02:00"), self.note("bert", "2026-10-22T08:00:00.000Z")]
        self.assertEqual(self.rules.human_note(notes), {"author": "anna", "at": "2026-10-23T10:00:00Z"})

    def test_system_and_bot_notes_never_count(self):
        notes = [self.note("anna", "2026-10-23T12:00:00Z", system=True), self.note(BOT, "2026-10-23T11:00:00Z"),
                 self.note("project_7_bot_ab12", "2026-10-23T10:00:00Z"), self.note("bert", "2026-10-22T08:00:00Z")]
        self.assertEqual(self.rules.human_note(notes), {"author": "bert", "at": "2026-10-22T08:00:00Z"})

    def test_nothing_countable_is_none(self):
        self.assertIsNone(self.rules.human_note([]))
        self.assertIsNone(self.rules.human_note(None))
        self.assertIsNone(self.rules.human_note([self.note("anna", "2026-10-23T12:00:00Z", system=True)]))
        self.assertIsNone(self.rules.human_note([{"author": None, "created_at": "2026-10-23T12:00:00Z"}]))


class TestReviewersAndLastNote(ApiCase):
    def note_reads(self, iid: int = 1) -> list[list[str]]:
        prefix = NOTE_PATH.format(iid=iid)
        return [a for a in self.world.argvs() if a[-1].startswith(prefix)]

    def test_reviewers_come_from_the_mr_detail(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, reviewers=["anna", "bert"])
        self.world.add_mr(1, 2)
        items = {i["ref"]: i for i in self.mrs()["items"]}
        self.assertEqual(items["g/p!1"]["reviewers"], ["anna", "bert"])
        self.assertEqual(items["g/p!2"]["reviewers"], [])

    def test_no_notes_is_null_with_one_read(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1)
        self.assertIsNone(self.item("g/p!1")["last_note"])
        reads = self.note_reads()
        self.assertEqual(len(reads), 1)
        self.assertEqual(reads[0][-1], NOTE_PATH.format(iid=1) + "&per_page=1")
        self.assertNotIn("--method", reads[0])

    def test_newest_person_note_is_the_last_note(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, notes=2)
        self.world.add_note(1, 1, "bert", 3)
        self.world.add_note(1, 1, "anna", 1)
        note = self.item("g/p!1")["last_note"]
        self.assertEqual(note["author"], "anna")
        self.assertRegex(note["at"], support.ISO_Z)
        self.assertEqual(len(self.note_reads()), 1)

    def test_a_newer_system_or_bot_note_is_skipped_with_one_wider_read(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, notes=1)
        self.world.add_note(1, 1, "bert", 3)
        self.world.add_note(1, 1, "anna", 2, system=True, body="added 1 commit")
        self.world.add_note(1, 1, BOT, 1)
        self.assertEqual(self.item("g/p!1")["last_note"]["author"], "bert")
        reads = self.note_reads()
        self.assertEqual([r[-1].rsplit("&", 1)[1] for r in reads], ["per_page=1", "per_page=20"])

    def test_only_system_notes_is_null(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1)
        self.world.add_note(1, 1, "anna", 1, system=True)
        self.assertIsNone(self.item("g/p!1")["last_note"])

    def test_the_note_is_cached_on_updated_at(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, pipeline="running", status="ci_still_running")
        self.world.add_note(1, 1, "anna", 1)
        self.mrs(refresh=True)
        self.mrs(refresh=True)
        self.assertEqual(self.mrs(refresh=True)["timing"]["details_fetched"], 1)
        self.assertEqual(len(self.note_reads()), 1)

    def test_a_new_note_moves_updated_at_and_is_read_once(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1)
        self.world.add_note(1, 1, "anna", 2)
        self.assertEqual(self.item("g/p!1")["last_note"]["author"], "anna")
        self.world.add_note(1, 1, "bert", 1)
        self.world.touch(1, 1, "2026-10-23T13:00:00.000Z")
        self.assertEqual(self.item("g/p!1", refresh=True)["last_note"]["author"], "bert")
        self.assertEqual(len(self.note_reads()), 2)
        self.assertEqual(self.item("g/p!1", refresh=True)["last_note"]["author"], "bert")
        self.assertEqual(len(self.note_reads()), 2)

    def test_the_note_and_reviewers_survive_a_restart_without_a_read(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, reviewers=["anna"])
        self.world.add_note(1, 1, "bert", 1)
        self.mrs()
        self.svc.reset()
        item = self.item("g/p!1", refresh=True)
        self.assertEqual((item["reviewers"], item["last_note"]["author"]), (["anna"], "bert"))
        self.assertEqual(len(self.note_reads()), 1)

    def test_a_facts_file_from_before_round_3_is_re_read(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, reviewers=["anna"])
        self.world.add_note(1, 1, "bert", 1)
        self.mrs()
        path = self.home / "mergeable" / "facts.json"
        data = json.loads(path.read_text())
        for fact in data["facts"].values():
            for key in ("reviewers", "last_note", "note_for"):
                fact.pop(key)
        path.write_text(json.dumps(data))
        self.svc.reset()
        item = self.item("g/p!1", refresh=True)
        self.assertEqual((item["reviewers"], item["last_note"]["author"]), (["anna"], "bert"))

    def test_an_unreadable_notes_call_keeps_the_item_and_is_retried(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, reviewers=["anna"])
        self.world.add_note(1, 1, "bert", 1)
        state = self.world.load()
        state["notes_http_error"] = 500
        self.world.save()
        item = self.item("g/p!1")
        self.assertEqual((item["reviewers"], item["last_note"]), (["anna"], None))
        self.assertEqual(self.mrs()["warnings"], [])
        state["notes_http_error"] = 0
        self.world.save()
        self.assertEqual(self.item("g/p!1", refresh=True)["last_note"]["author"], "bert")

    def test_colleague_and_renovate_items_carry_both_fields(self):
        self.standard()
        for item in self.mrs()["items"]:
            self.assertIsInstance(item["reviewers"], list)
            self.assertIn("last_note", item)

    def test_own_notes_are_notes_too(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1)
        self.world.add_note(1, 1, USER, 1)
        self.assertEqual(self.item("g/p!1")["last_note"]["author"], USER)

    def test_reads_only_and_clean_argv(self):
        self.standard()
        self.world.add_note(1, 1, "anna", 1)
        self.mrs()
        self.assertEqual(self.world.writes(), [])


class TestRestartSweep(ApiCase):
    def setUp(self):
        super().setUp()
        self.standard()
        self.sha = self.world.mr(1, 3)["sha"]
        self.ref = "acme/bravo-infra!3"

    def audit_row(self, ref=None, sha=None):
        rows = self.store.read_all(self.home).get(ref or self.ref, [])
        return next(r for r in rows if r["sha"] == (sha or self.sha))

    def test_queued_and_running_rows_become_error_on_the_first_collect(self):
        self.store.set_state(self.home, self.ref, self.sha, "queued")
        self.store.set_state(self.home, "acme/echo-deploy!4", "b" * 40, "running")
        item = self.item(self.ref)
        self.assertEqual(item["audit_state"], "error")
        self.assertEqual(self.audit_row()["error"], "interrupted by a restart")
        self.assertEqual(self.audit_row("acme/echo-deploy!4", "b" * 40)["state"], "error")

    def test_a_finished_audit_and_an_old_error_stay_as_they_are(self):
        self.store.put_audit(self.home, self.ref, self.sha, {"verdict": "merge"})
        self.store.set_state(self.home, "acme/echo-deploy!4", "c" * 40, "error", "boom")
        self.mrs()
        self.assertEqual(self.audit_row()["state"], "done")
        self.assertEqual(self.audit_row("acme/echo-deploy!4", "c" * 40)["error"], "boom")

    def test_an_old_rating_stays_visible_under_the_error(self):
        self.store.put_audit(self.home, self.ref, self.sha, {"importance": "low", "ease": "easy", "verdict": "merge", "confidence": "sure"})
        self.store.set_state(self.home, self.ref, self.sha, "running")
        item = self.item(self.ref)
        self.assertEqual(item["audit_state"], "error")
        self.assertEqual(item["audit"]["ease"], "easy")

    def test_only_the_first_collect_sweeps(self):
        self.mrs()
        self.store.set_state(self.home, self.ref, self.sha, "running")
        self.assertEqual(self.item(self.ref, refresh=True)["audit_state"], "running")

    def test_a_backend_restart_sweeps_again(self):
        self.mrs()
        self.store.set_state(self.home, self.ref, self.sha, "running")
        self.svc.reset()
        self.assertEqual(self.item(self.ref)["audit_state"], "error")

    def test_an_interrupted_audit_is_not_retried_by_auto_audit_but_a_forced_one_is(self):
        self.store.set_state(self.home, self.ref, self.sha, "queued")
        self.mrs()
        self.assertNotIn(self.ref, {i["ref"] for i in self.svc.audit_candidates(self.home, "p")})
        self.assertIn(self.ref, {i["ref"] for i in self.svc.audit_candidates(self.home, "p", force=True)})

    def test_no_store_is_not_created_by_the_sweep(self):
        self.mrs()
        self.assertFalse((self.home / "mergeable" / "audits.db").exists())


if __name__ == "__main__":
    unittest.main()
