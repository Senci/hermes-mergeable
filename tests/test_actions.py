"""Job-level behaviour of the actions: refusals at job start, one rebase per MR, caps, the write log, locks."""

from __future__ import annotations

import json
import os
import stat
import threading
import unittest
import unittest.mock

import support
from support import ApiCase


class ActorCase(ApiCase):
    def setUp(self):
        super().setUp()
        self.standard()

    def actor(self):
        job = self.jobs.Job("probe", ["probe"])
        coll = self.svc.collector(self.home, "p")
        return self.actions.Actor(self.home, coll.glab, coll.settings, job, support.USER, coll.project_meta), job

    def expect(self, exc, fn, *args):
        with self.assertRaises(exc) as ctx:
            fn(*args)
        return str(ctx.exception)


class TestJobLevelRefusals(ActorCase):
    def test_merge_refuses_a_draft(self):
        actor, _job = self.actor()
        self.assertIn("draft", self.expect(self.actions.Stop, actor.merge_flow, "acme/echo-deploy!5", 2, 5, None))
        self.assertEqual(self.world.writes(), [])

    def test_merge_refuses_a_conflict(self):
        state = self.world.load()
        state["mrs"]["1/1"]["has_conflicts"] = True
        state["mrs"]["1/1"]["detailed_merge_status"] = "conflict"
        self.world.save()
        actor, _job = self.actor()
        self.assertIn("conflicts", self.expect(self.actions.Stop, actor.merge_flow, "acme/bravo-infra!1", 1, 1, None))
        self.assertEqual(self.world.writes(), [])

    def test_merge_refuses_other(self):
        actor, _job = self.actor()
        self.assertIn("read only", self.expect(self.actions.Stop, actor.merge_flow, "acme/echo-deploy!4", 2, 4, None))
        self.assertEqual(self.world.writes(), [])

    def test_merge_refuses_a_head_that_moved_before_the_job_started(self):
        actor, _job = self.actor()
        msg = self.expect(self.actions.Stop, actor.merge_flow, "acme/bravo-infra!1", 1, 1, "0" * 40)
        self.assertIn("head moved", msg)
        self.assertEqual(self.world.writes(), [])

    def test_merge_refuses_a_conflict_that_appears_after_the_rebase(self):
        state = self.world.load()
        state["mrs"]["1/2"]["_"]["conflict_after_rebase"] = True
        self.world.save()
        actor, _job = self.actor()
        self.assertIn("conflicts", self.expect(self.actions.Stop, actor.merge_flow, "acme/bravo-infra!2", 1, 2, None))
        self.assertEqual([w["path"].rsplit("/", 1)[-1] for w in self.world.writes()], ["rebase"])

    def test_a_merged_mr_cannot_be_merged_again(self):
        state = self.world.load()
        state["mrs"]["1/1"]["state"] = "merged"
        self.world.save()
        actor, _job = self.actor()
        self.expect(self.actions.Stop, actor.merge_flow, "acme/bravo-infra!1", 1, 1, None)

    def test_rebase_flow_refusals(self):
        actor, _job = self.actor()
        self.expect(self.actions.Stop, actor.rebase_flow, "acme/echo-deploy!4", 2, 4, None)
        self.expect(self.actions.Stop, actor.rebase_flow, "acme/echo-deploy!5", 2, 5, None)
        self.expect(self.actions.Stop, actor.rebase_flow, "acme/bravo-infra!1", 1, 1, None)
        self.expect(self.actions.Stop, actor.rebase_flow, "acme/bravo-infra!2", 1, 2, "0" * 40)
        self.assertEqual(self.world.writes(), [])

    def test_vanished_mr_fails(self):
        actor, _job = self.actor()
        self.assertIn("no longer exists", self.expect(self.actions.Fail, actor.merge_flow, "acme/bravo-infra!9", 1, 9, None))


class TestOneRebase(ActorCase):
    def test_a_second_rebase_of_the_same_mr_fails(self):
        actor, job = self.actor()
        actor.start_clock()
        mr = actor.read(1, 2)
        actor.rebase("acme/bravo-infra!2", 1, 2, mr, "self")
        self.assertEqual(job.rebases, 1)
        state = self.world.load()
        state["mrs"]["1/2"]["detailed_merge_status"] = "need_rebase"
        self.world.save()
        mr = actor.read(1, 2)
        self.assertIn("second rebase", self.expect(self.actions.Fail, actor.rebase, "acme/bravo-infra!2", 1, 2, mr, "self"))
        self.assertEqual(job.rebases, 1)
        self.assertEqual(len([w for w in self.world.writes() if w["path"].endswith("/rebase")]), 1)

    def test_each_mr_gets_its_own_one_rebase(self):
        self.world.add_mr(1, 6, status="need_rebase")
        actor, job = self.actor()
        actor.start_clock()
        for iid in (2, 6):
            actor.rebase(f"acme/bravo-infra!{iid}", 1, iid, actor.read(1, iid), "self")
        self.assertEqual(job.rebases, 2)

    def test_a_rebase_that_changes_nothing_fails_after_a_few_polls(self):
        state = self.world.load()
        state["mrs"]["1/2"]["_"]["rebase_polls"] = 0
        self.world.save()
        actor, _job = self.actor()
        actor.start_clock()
        mr = actor.read(1, 2)
        # a server rebase that finishes without a new head: fake it by pinning the sha
        state = self.world.load()
        state["mrs"]["1/2"]["_"].pop("rebase_polls")
        self.world.save()
        with unittest.mock.patch.object(actor.glab, "put", return_value={"rebase_in_progress": True}):
            msg = self.expect(self.actions.Fail, actor.rebase, "acme/bravo-infra!2", 1, 2, mr, "self")
        self.assertIn("did not change the head", msg)


class TestWaits(ActorCase):
    def test_poll_interval_and_cap(self):
        self.settings = {"merge_wait_minutes": 2}
        state = self.world.load()
        state["mrs"]["1/2"]["_"]["pipeline_polls"] = 1000
        self.world.save()
        actor, _job = self.actor()
        msg = self.expect(self.actions.Fail, actor.merge_flow, "acme/bravo-infra!2", 1, 2, None)
        self.assertIn("gave up waiting", msg)
        self.assertIn("2 minutes", msg)
        self.assertIn(self.actions.POLL_SECONDS, self.clock.slept)
        self.assertLessEqual(self.clock.t, 120)

    def test_a_missing_pipeline_for_the_new_head_is_waited_for(self):
        state = self.world.load()
        state["mrs"]["1/1"]["head_pipeline"]["sha"] = "f" * 40
        self.world.save()
        self.settings = {"merge_wait_minutes": 1}
        actor, _job = self.actor()
        self.assertIn("gave up waiting", self.expect(self.actions.Fail, actor.merge_flow, "acme/bravo-infra!1", 1, 1, None))
        self.assertEqual(self.world.writes(), [])

    def test_a_merge_that_leaves_the_mr_open_is_a_failure(self):
        state = self.world.load()
        state["mrs"]["1/1"]["_"]["merge_noop"] = True
        self.world.save()
        actor, _job = self.actor()
        self.assertIn("not merged", self.expect(self.actions.Fail, actor.merge_flow, "acme/bravo-infra!1", 1, 1, None))
        self.assertEqual(self.world.mr(1, 1)["state"], "opened")


class TestRunGuarded(unittest.TestCase):
    def setUp(self):
        support.load_api()
        import sys

        self.actions = sys.modules["mg_actions"]
        self.job = sys.modules["mg_jobs"].Job("probe", ["r"])

    def test_outcomes(self):
        def raises(exc):
            def fn():
                raise exc
            return fn

        self.assertEqual(self.actions.run_guarded(self.job, "r", lambda: None), "done")
        self.assertEqual(self.actions.run_guarded(self.job, "r", raises(self.actions.Stop("because"))), "stopped")
        self.assertEqual(self.actions.run_guarded(self.job, "r", raises(self.actions.Fail("broke"))), "failed")
        self.assertEqual([(s["step"], s["state"], s["detail"]) for s in self.job.steps], [("stopped", "failed", "because"), ("failed", "failed", "broke")])


class TestActionsLog(ActorCase):
    def test_line_shape_mode_and_one_line_per_write(self):
        actor, job = self.actor()
        actor.log_write("merge", "acme/bravo-infra!1", "a" * 40, "b" * 40, "ok")
        actor.log_write("rebase", "acme/bravo-infra!2", "c" * 40, None, "error: nope")
        path = self.home / "mergeable" / "actions.log"
        lines = path.read_text().splitlines()
        self.assertEqual(len(lines), 2)
        first = json.loads(lines[0])
        self.assertEqual(sorted(first), ["action", "at", "job", "ref", "result", "sha_after", "sha_before"])
        self.assertEqual((first["job"], first["action"], first["sha_before"], first["sha_after"]), (job.id, "merge", "a" * 40, "b" * 40))
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.assertTrue(path.read_text().isascii())

    def test_every_write_of_a_full_flow_has_a_line_and_reads_do_not(self):
        started = self.api.merge(1, 2, {"expected_sha": self.world.mr(1, 2)["sha"]})
        self.finish(started)
        self.assertEqual(len(self.actions_log()), len(self.world.writes()))
        self.assertEqual([line["action"] for line in self.actions_log()], ["rebase", "merge"])

    def test_log_is_not_created_by_reads(self):
        self.mrs()
        self.assertFalse((self.home / "mergeable" / "actions.log").exists())


class TestRegistry(ApiCase):
    def test_second_job_on_a_busy_project_is_refused_and_released_after(self):
        gate, started = threading.Event(), threading.Event()

        def hold(job):
            started.set()
            gate.wait(10)
            return "done"

        registry = self.jobs.REGISTRY
        first = registry.start("probe", [1], ["a"], hold)
        self.assertTrue(started.wait(5))
        with self.assertRaises(self.jobs.Busy) as ctx:
            registry.start("probe", [1], ["b"], lambda job: "done")
        self.assertEqual(ctx.exception.job_id, first.id)
        other = registry.start("probe", [2], ["c"], lambda job: "done")
        self.assertEqual(registry.wait(other.id)["state"], "done")
        self.assertEqual(registry.get(first.id).state, "running")
        gate.set()
        self.assertEqual(registry.wait(first.id)["state"], "done")
        again = registry.start("probe", [1], ["d"], lambda job: "done")
        self.assertEqual(registry.wait(again.id)["state"], "done")

    def test_claims_are_all_or_nothing(self):
        registry = self.jobs.REGISTRY
        registry.busy[3] = "held"
        with self.assertRaises(self.jobs.Busy):
            registry.start("probe", [1, 2, 3], ["x"], lambda job: "done")
        self.assertEqual(registry.busy, {3: "held"})
        self.assertEqual(registry.recent(), [])

    def test_the_route_returns_423_while_a_real_job_runs(self):
        self.standard()
        gate, started = threading.Event(), threading.Event()
        registry = self.jobs.REGISTRY

        def hold(job):
            started.set()
            gate.wait(10)
            return "done"

        first = registry.start("probe", [1], ["x"], hold)
        self.assertTrue(started.wait(5))
        self.assert_http(423, self.api.merge, 1, 1, {"expected_sha": self.world.mr(1, 1)["sha"]})
        gate.set()
        registry.wait(first.id)
        self.finish(self.api.merge(1, 1, {"expected_sha": self.world.mr(1, 1)["sha"]}))


if __name__ == "__main__":
    import unittest.mock  # noqa: F401

    unittest.main()
