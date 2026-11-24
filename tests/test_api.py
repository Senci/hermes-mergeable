"""Route tests: GET /mrs and the cache, every write route and its error codes, /jobs, /status.md.

The handlers are called as plain functions against the fake glab (support.World); merge waits run on
virtual time. No live paths, no real GitLab.
"""

from __future__ import annotations

import json
import re
import unittest
from unittest import mock

import support
from support import ApiCase

ITEM_KEYS = [
    "age_days", "audit", "audit_state", "author", "can", "created_at", "draft", "files_changed", "full_title",
    "has_conflicts", "iid", "last_note", "merge_method", "merge_status", "owner", "pipeline", "project", "project_id", "ref",
    "renovate", "reviewers", "session", "sha", "source_branch", "target_branch", "title", "trivial", "updated_at",
    "user_notes_count", "web_url",
]
TOP_KEYS = ["batch", "generated_at", "host", "items", "profile", "rules", "schema_ok", "timing", "user", "warnings"]
ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")


class TestMrsRoute(ApiCase):
    def test_payload_and_item_shape(self):
        self.standard()
        out = self.mrs()
        self.assertEqual(sorted(out), TOP_KEYS)
        self.assertEqual((out["host"], out["user"], out["schema_ok"], out["warnings"]), ("gitlab.com", support.USER, True, []))
        self.assertRegex(out["generated_at"], ISO)
        self.assertEqual(len(out["items"]), 5)
        for item in out["items"]:
            self.assertEqual(sorted(item), ITEM_KEYS)
            self.assertRegex(item["created_at"], ISO)
            self.assertRegex(item["updated_at"], ISO)
        self.assertEqual(sorted(out["items"][0]["can"]), ["merge", "reason", "rebase", "rebase_reason", "renovate_rebase"])
        self.assertEqual(sorted(out["items"][0]["trivial"]), ["in_batch", "miss"])
        self.assertNotIn("_description", json.dumps(out))

    def test_owner_title_and_renovate_parse(self):
        self.standard()
        items = {i["ref"]: i for i in self.mrs()["items"]}
        self.assertEqual({r: i["owner"] for r, i in items.items()}, {
            "acme/bravo-infra!1": "self", "acme/bravo-infra!2": "self", "acme/bravo-infra!3": "renovate",
            "acme/echo-deploy!4": "other", "acme/echo-deploy!5": "self"})
        bot = items["acme/bravo-infra!3"]
        self.assertEqual(bot["title"], "traefik v3.7.15 to v3.7.16")
        self.assertTrue(bot["full_title"].startswith("chore(deps): update"))
        self.assertEqual(bot["renovate"], {"package": "docker.io/library/traefik", "from": "v3.7.15", "to": "v3.7.16", "update_type": "patch"})
        self.assertIsNone(items["acme/bravo-infra!1"]["renovate"])
        self.assertEqual(items["acme/echo-deploy!5"]["title"], "wip")
        self.assertEqual(items["acme/echo-deploy!5"]["full_title"], "Draft: wip")
        self.assertTrue(items["acme/echo-deploy!5"]["draft"])
        self.assertEqual(items["acme/bravo-infra!1"]["merge_method"], "ff")
        self.assertEqual(items["acme/echo-deploy!4"]["merge_method"], "merge")
        self.assertEqual(items["acme/bravo-infra!1"]["files_changed"], 3)
        self.assertEqual(items["acme/bravo-infra!1"]["pipeline"]["status"], "success")

    def test_read_routes_never_write(self):
        self.standard()
        self.mrs(refresh=True)
        self.api.jobs()
        self.api.status_md()
        self.assertEqual(self.world.writes(), [])
        for argv in self.world.argvs():
            for flag in ("--method", "--field", "--raw-field", "--input"):
                self.assertNotIn(flag, argv)
        self.assertFalse((self.home / "mergeable" / "actions.log").exists())

    def test_colleague_item_is_read_only(self):
        self.standard()
        item = self.item("acme/echo-deploy!4")
        self.assertFalse(item["can"]["merge"])
        self.assertFalse(item["can"]["rebase"])
        self.assertEqual(item["trivial"]["in_batch"], False)

    def test_sorted_by_urgency_then_age(self):
        self.standard()
        refs = [i["ref"] for i in self.mrs()["items"]]
        self.assertEqual(refs[0], "acme/bravo-infra!1")
        self.assertEqual(refs[-1], "acme/echo-deploy!5")
        self.assertLess(refs.index("acme/bravo-infra!2"), refs.index("acme/echo-deploy!4"))

    def test_batch_summary(self):
        self.standard()
        batch = self.mrs()["batch"]
        self.assertEqual(batch["refs"], ["acme/bravo-infra!1"])
        self.assertEqual(batch["rebases"], 0)

    def test_no_pipeline_project_item(self):
        self.world.add_project(1, "g/nci", has_ci=False)
        self.world.add_mr(1, 1, pipeline=None)
        item = self.item("g/nci!1")
        self.assertIsNone(item["pipeline"])
        self.assertTrue(item["can"]["merge"])
        self.assertTrue(item["trivial"]["in_batch"])

    def test_cold_then_warm_reads_only_changed_details(self):
        self.standard()
        cold = self.mrs(refresh=True)["timing"]
        self.assertTrue(cold["full"])
        self.assertEqual(cold["details_fetched"], 5)
        warm = self.mrs(refresh=True)["timing"]
        self.assertEqual(warm["details_fetched"], 0)
        self.assertLess(warm["glab_calls"], cold["glab_calls"])
        state = self.world.load()
        state["mrs"]["1/1"]["sha"] = "f" * 40
        state["mrs"]["1/1"]["updated_at"] = "2026-10-23T11:00:00.000Z"
        self.world.save()
        moved = self.mrs(refresh=True)
        self.assertEqual(moved["timing"]["details_fetched"], 1)
        self.assertEqual({i["ref"]: i["sha"] for i in moved["items"]}["acme/bravo-infra!1"], "f" * 40)

    def test_unfinished_pipeline_is_re_read_every_time(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, pipeline="running", status="ci_still_running")
        self.mrs(refresh=True)
        self.assertEqual(self.mrs(refresh=True)["timing"]["details_fetched"], 1)

    def test_status_comes_from_the_list_call_even_when_the_detail_is_cached(self):
        self.standard()
        self.mrs(refresh=True)
        state = self.world.load()
        state["mrs"]["1/1"]["detailed_merge_status"] = "need_rebase"
        self.world.save()
        out = self.mrs(refresh=True)
        self.assertEqual(out["timing"]["details_fetched"], 0)
        self.assertEqual({i["ref"]: i["merge_status"] for i in out["items"]}["acme/bravo-infra!1"], "need_rebase")

    def test_unsettled_merge_status_is_re_read_until_gitlab_decides(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, list_status="unchecked", unchecked_reads=2)
        item = self.item("g/p!1")
        self.assertEqual(item["merge_status"], "mergeable")
        self.assertEqual(self.mrs()["warnings"], [])
        reads = [a for a in self.world.argvs() if a[-1].startswith("projects/1/merge_requests/1?")]
        self.assertEqual(len(reads), 3)

    def test_a_status_that_never_settles_is_shown_as_it_is_and_retried_on_the_next_refresh(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, list_status="unchecked", unchecked_reads=100)
        self.assertEqual(self.item("g/p!1")["merge_status"], "unchecked")
        state = self.world.load()
        state["mrs"]["1/1"]["_"]["unchecked_reads"] = 0
        self.world.save()
        self.assertEqual(self.item("g/p!1", refresh=True)["merge_status"], "mergeable")

    def test_conflicts_come_from_the_fresh_detail(self):
        self.world.add_project(1, "g/p")
        self.world.add_mr(1, 1, status="need_rebase", list_status="unchecked")
        state = self.world.load()
        state["mrs"]["1/1"]["has_conflicts"] = True
        self.world.save()
        item = self.item("g/p!1")
        self.assertTrue(item["has_conflicts"])
        self.assertEqual(item["trivial"]["miss"], "conflict")

    def test_plain_get_inside_the_ttl_makes_no_glab_call(self):
        self.standard()
        self.mrs()
        before = len(self.world.calls())
        self.mrs()
        self.assertEqual(len(self.world.calls()), before)

    def test_plain_get_after_the_ttl_relists_only_projects_with_open_mrs(self):
        self.world.add_project(1, "g/p")
        self.world.add_project(2, "g/empty")
        self.world.add_mr(1, 1)
        self.mrs()
        coll = next(iter(self.svc._COLLECTORS.values()))
        coll.snapshot_at -= 1000
        coll.discovered_at = coll.snapshot_at + 900
        out = self.mrs()
        self.assertFalse(out["timing"]["full"])
        self.assertEqual(out["timing"]["projects_scanned"], 1)

    def test_facts_survive_a_restart(self):
        self.standard()
        self.mrs()
        self.assertTrue((self.home / "mergeable" / "facts.json").exists())
        self.svc.reset()
        self.assertEqual(self.mrs(refresh=True)["timing"]["details_fetched"], 0)

    def test_include_groups_and_exclude_projects(self):
        self.standard()
        self.settings = {"include_groups": ["acme"], "exclude_projects": ["acme/echo-deploy"]}
        self.assertEqual({i["project"] for i in self.mrs()["items"]}, {"acme/bravo-infra"})
        self.svc.reset()
        self.settings = {"include_groups": ["other"]}
        self.assertEqual(self.mrs()["items"], [])

    def test_a_failing_project_list_is_a_warning_not_an_error(self):
        self.standard()
        state = self.world.load()
        state["projects"]["2"]["list_http_error"] = 500
        self.world.save()
        out = self.mrs()
        self.assertEqual(len(out["items"]), 3)
        self.assertEqual(len(out["warnings"]), 1)
        self.assertIn("acme/echo-deploy", out["warnings"][0])

    def test_schema_ok_false_when_the_list_misses_keys(self):
        self.standard()
        state = self.world.load()
        state["drop_list_keys"] = ["detailed_merge_status"]
        self.world.save()
        out = self.mrs()
        self.assertFalse(out["schema_ok"])
        self.assertEqual({i["merge_status"] for i in out["items"]} - {"mergeable", "need_rebase"}, set())

    def test_glab_missing_is_502(self):
        with mock.patch.dict("os.environ", {"PATH": "/nonexistent"}):
            exc = self.assert_http(502, self.api.mrs, 0)
        self.assertIn("glab", exc.detail)

    def test_settings_change_applies_without_a_restart(self):
        self.standard()
        self.assertTrue(self.item("acme/bravo-infra!1")["trivial"]["in_batch"])
        self.settings = {"trivial_own": False}
        item = self.item("acme/bravo-infra!1")
        self.assertEqual(item["trivial"]["miss"], "own-MR rule off")
        self.assertFalse(self.mrs()["rules"]["trivial_own"])


class TestAuditRead(ApiCase):
    def test_audit_and_state_come_from_the_store(self):
        self.standard()
        item = self.item("acme/bravo-infra!3")
        self.assertEqual((item["audit"], item["audit_state"]), (None, "none"))
        audit = {"importance": "high", "ease": "trivial", "verdict": "merge", "confidence": "sure"}
        self.store.put_audit(self.home, "acme/bravo-infra!3", item["sha"], audit)
        done = self.item("acme/bravo-infra!3")
        self.assertEqual(done["audit_state"], "done")
        self.assertEqual(done["audit"]["verdict"], "merge")
        self.assertEqual(done["audit"]["sha"], item["sha"])
        self.assertIn("audited_at", done["audit"])
        self.assertTrue(done["trivial"]["in_batch"])

    def test_a_new_head_makes_the_old_audit_stale_and_untrusted(self):
        self.standard()
        sha = self.item("acme/bravo-infra!3")["sha"]
        self.store.put_audit(self.home, "acme/bravo-infra!3", sha, {"importance": "low", "ease": "trivial", "verdict": "merge", "confidence": "sure"})
        state = self.world.load()
        state["mrs"]["1/3"]["sha"] = "e" * 40
        self.world.save()
        item = self.item("acme/bravo-infra!3", refresh=True)
        self.assertEqual(item["audit_state"], "stale")
        self.assertEqual(item["audit"]["sha"], sha)
        self.assertEqual(item["trivial"]["miss"], "no audit yet")

    def test_queued_running_error_states(self):
        self.standard()
        sha = self.item("acme/bravo-infra!3")["sha"]
        for state in ("queued", "running", "error"):
            self.store.set_state(self.home, "acme/bravo-infra!3", sha, state, "boom" if state == "error" else None)
            self.assertEqual(self.item("acme/bravo-infra!3")["audit_state"], state)

    def test_state_keeps_a_finished_audit_visible(self):
        self.standard()
        sha = self.item("acme/bravo-infra!3")["sha"]
        self.store.put_audit(self.home, "acme/bravo-infra!3", sha, {"importance": "low", "ease": "easy", "verdict": "merge", "confidence": "sure"})
        self.store.set_state(self.home, "acme/bravo-infra!3", sha, "queued")
        item = self.item("acme/bravo-infra!3")
        self.assertEqual(item["audit_state"], "queued")
        self.assertEqual(item["audit"]["ease"], "easy")

    def test_only_renovate_items_carry_audits(self):
        self.standard()
        self.store.put_audit(self.home, "acme/bravo-infra!1", self.item("acme/bravo-infra!1")["sha"], {"verdict": "merge"})
        self.assertEqual(self.item("acme/bravo-infra!1")["audit_state"], "none")

    def test_store_is_created_on_the_first_write_only(self):
        self.standard()
        self.mrs()
        self.assertFalse((self.home / "mergeable" / "audits.db").exists())
        self.store.set_state(self.home, "acme/bravo-infra!3", "a" * 40, "queued")
        self.assertTrue((self.home / "mergeable" / "audits.db").exists())

    def test_hook_lists_renovate_items_needing_an_audit(self):
        self.standard()
        self.world.add_renovate(2, 9, package="docker.io/library/postgres", frm="b0f9560", to="eee6c6e", kind="digest")
        got = {i["ref"] for i in self.svc.audit_candidates(self.home, "p")}
        self.assertEqual(got, {"acme/bravo-infra!3", "acme/echo-deploy!9"})
        sha = self.item("acme/bravo-infra!3")["sha"]
        self.store.put_audit(self.home, "acme/bravo-infra!3", sha, {"verdict": "merge"})
        self.assertEqual({i["ref"] for i in self.svc.audit_candidates(self.home, "p")}, {"acme/echo-deploy!9"})
        self.assertEqual({i["ref"] for i in self.svc.audit_candidates(self.home, "p", force=True)}, {"acme/bravo-infra!3", "acme/echo-deploy!9"})
        self.store.set_state(self.home, "acme/echo-deploy!9", self.item("acme/echo-deploy!9")["sha"], "error", "boom")
        self.assertNotIn("acme/echo-deploy!9", {i["ref"] for i in self.svc.audit_candidates(self.home, "p")})
        self.store.set_state(self.home, "acme/echo-deploy!9", self.item("acme/echo-deploy!9")["sha"], "running")
        self.assertNotIn("acme/echo-deploy!9", {i["ref"] for i in self.svc.audit_candidates(self.home, "p", force=True)})

    def test_set_state_refuses_done_and_unknown(self):
        for bad in ("done", "bogus"):
            with self.assertRaises(ValueError):
                self.store.set_state(self.home, "a!1", "a" * 40, bad)
        with self.assertRaises(TypeError):
            self.store.put_audit(self.home, "a!1", "a" * 40, "not a dict")


class TestRebaseRoute(ApiCase):
    def setUp(self):
        super().setUp()
        self.standard()

    def rebase(self, pid, iid, sha):
        return self.api.rebase(pid, iid, {"expected_sha": sha})

    def test_own_mr_server_rebase(self):
        before = self.item("acme/bravo-infra!2")["sha"]
        started = self.rebase(1, 2, before)
        job = self.finish(started)
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(job["kind"], "rebase")
        self.assertEqual(job["rebases"], 1)
        after = self.world.mr(1, 2)["sha"]
        self.assertNotEqual(after, before)
        puts = [w for w in self.world.writes() if w["path"].endswith("/rebase")]
        self.assertEqual(len(puts), 1)
        self.assertEqual(puts[0]["method"], "PUT")
        self.assertEqual(puts[0]["path"], "projects/1/merge_requests/2/rebase")
        log = self.actions_log()
        self.assertEqual([(line["action"], line["ref"], line["result"]) for line in log], [("rebase", "acme/bravo-infra!2", "ok")])
        self.assertEqual(log[0]["sha_before"], before)
        self.assertEqual(log[0]["job"], started["job_id"])
        self.assertRegex(log[0]["at"], ISO)

    def test_renovate_ticks_the_box_and_waits_for_renovate(self):
        state = self.world.load()
        state["mrs"]["1/3"]["detailed_merge_status"] = "need_rebase"
        state["mrs"]["1/3"]["_"]["renovate_polls"] = 2
        self.world.save()
        before = self.world.mr(1, 3)
        job = self.finish(self.rebase(1, 3, before["sha"]))
        self.assertEqual(job["state"], "done", job)
        writes = self.world.writes()
        self.assertEqual([w["path"] for w in writes], ["projects/1/merge_requests/3"])
        self.assertEqual(writes[0]["method"], "PUT")
        self.assertNotIn("/rebase", writes[0]["path"])
        after = self.world.mr(1, 3)
        self.assertNotEqual(after["sha"], before["sha"])
        old, new = before["description"].splitlines(), after["description"].splitlines()
        self.assertEqual(len(old), len(new))
        self.assertEqual(sum(a != b for a, b in zip(old, new)), 1)
        self.assertIn("[x] <!-- rebase-check -->", after["description"])
        self.assertEqual(self.actions_log()[0]["action"], "renovate_rebase")
        self.assertTrue(self.clock.slept)

    def test_renovate_without_a_checkbox_fails_without_a_write(self):
        state = self.world.load()
        state["mrs"]["1/3"]["detailed_merge_status"] = "need_rebase"
        state["mrs"]["1/3"]["description"] = "no box"
        self.world.save()
        job = self.finish(self.rebase(1, 3, self.world.mr(1, 3)["sha"]))
        self.assertEqual(job["state"], "failed")
        self.assertEqual(self.world.writes(), [])

    def test_renovate_box_already_ticked_is_not_written_again(self):
        state = self.world.load()
        state["mrs"]["1/3"]["detailed_merge_status"] = "need_rebase"
        state["mrs"]["1/3"]["description"] = state["mrs"]["1/3"]["description"].replace("- [ ] <!--", "- [x] <!--")
        state["mrs"]["1/3"]["_"]["renovate_pending"] = 3
        self.world.save()
        job = self.finish(self.rebase(1, 3, self.world.mr(1, 3)["sha"]))
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(self.world.writes(), [])

    def test_server_refuses_the_rebase(self):
        state = self.world.load()
        state["mrs"]["1/2"]["_"]["rebase_http_error"] = 403
        self.world.save()
        job = self.finish(self.rebase(1, 2, self.world.mr(1, 2)["sha"]))
        self.assertEqual(job["state"], "failed")
        self.assertEqual(self.actions_log()[0]["result"][:6], "error:")

    def test_errors(self):
        sha = self.world.mr(1, 2)["sha"]
        self.assert_http(422, self.api.rebase, 1, 2, None)
        self.assert_http(422, self.api.rebase, 1, 2, {})
        self.assert_http(422, self.api.rebase, 1, 2, {"expected_sha": 5})
        self.assert_http(422, self.api.rebase, 1, 2, {"expected_sha": "not hex!"})
        self.assert_http(404, self.api.rebase, 1, 99, {"expected_sha": sha})
        self.assert_http(404, self.api.rebase, 77, 1, {"expected_sha": sha})
        self.assert_http(403, self.api.rebase, 2, 4, {"expected_sha": self.world.mr(2, 4)["sha"]})
        self.assert_http(409, self.api.rebase, 1, 2, {"expected_sha": "0" * 40})
        self.assert_http(409, self.api.rebase, 2, 5, {"expected_sha": self.world.mr(2, 5)["sha"]})
        self.assert_http(409, self.api.rebase, 1, 1, {"expected_sha": self.world.mr(1, 1)["sha"]})
        self.assertEqual(self.world.writes(), [])

    def test_busy_project_is_423(self):
        self.jobs.REGISTRY.busy[1] = "some-job"
        exc = self.assert_http(423, self.api.rebase, 1, 2, {"expected_sha": self.world.mr(1, 2)["sha"]})
        self.assertIn("some-job", exc.detail)
        self.assertEqual(self.world.writes(), [])

    def test_conflicting_own_mr_is_refused(self):
        state = self.world.load()
        state["mrs"]["1/2"]["has_conflicts"] = True
        self.world.save()
        self.assert_http(409, self.api.rebase, 1, 2, {"expected_sha": self.world.mr(1, 2)["sha"]})

    def test_merged_mr_reads_as_unknown(self):
        state = self.world.load()
        state["mrs"]["1/2"]["state"] = "merged"
        self.world.save()
        self.assert_http(404, self.api.rebase, 1, 2, {"expected_sha": self.world.mr(1, 2)["sha"]})


class TestMergeRoute(ApiCase):
    def setUp(self):
        super().setUp()
        self.standard()

    def merge(self, pid, iid, sha=None):
        return self.api.merge(pid, iid, {"expected_sha": sha or self.world.mr(pid, iid)["sha"]})

    def test_green_mr_merges_with_sha_and_remove_flag(self):
        sha = self.world.mr(1, 1)["sha"]
        job = self.finish(self.merge(1, 1))
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(self.world.mr(1, 1)["state"], "merged")
        puts = [w for w in self.world.writes() if w["path"].endswith("/merge")]
        self.assertEqual(len(puts), 1)
        argv = puts[0]["argv"]
        self.assertEqual(puts[0]["method"], "PUT")
        self.assertEqual(puts[0]["path"], "projects/1/merge_requests/1/merge")
        self.assertEqual(argv[argv.index("--raw-field") + 1], f"sha={sha}")
        self.assertEqual(argv[argv.index("--field") + 1], "should_remove_source_branch=true")
        self.assertEqual(self.states(job)[-1], ("merge", "done"))
        log = self.actions_log()
        self.assertEqual([(line["action"], line["ref"], line["sha_before"], line["result"]) for line in log],
                         [("merge", "acme/bravo-infra!1", sha, "ok")])
        self.assertTrue(log[0]["sha_after"])
        self.assertEqual(self.clock.slept, [])

    def test_delete_source_branch_setting_is_passed(self):
        self.settings = {"delete_source_branch": False}
        self.finish(self.merge(1, 1))
        argv = next(w for w in self.world.writes() if w["path"].endswith("/merge"))["argv"]
        self.assertEqual(argv[argv.index("--field") + 1], "should_remove_source_branch=false")

    def test_need_rebase_rebases_once_waits_green_then_merges_the_new_head(self):
        state = self.world.load()
        state["mrs"]["1/2"]["_"].update(pipeline_polls=3, rebase_polls=2)
        self.world.save()
        old = self.world.mr(1, 2)["sha"]
        job = self.finish(self.merge(1, 2))
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(job["rebases"], 1)
        steps = self.states(job)
        self.assertIn(("rebase", "done"), steps)
        self.assertIn(("wait-green", "done"), steps)
        self.assertEqual(steps[-1], ("merge", "done"))
        kinds = [w["path"].rsplit("/", 1)[-1] for w in self.world.writes()]
        self.assertEqual(kinds, ["rebase", "merge"])
        merge = self.world.writes()[1]["argv"]
        new = self.world.mr(1, 2)["sha"]
        self.assertNotEqual(new, old)
        self.assertEqual(merge[merge.index("--raw-field") + 1], f"sha={new}")
        self.assertTrue(self.clock.slept)

    def test_second_rebase_fails_the_job_with_one_rebase_and_no_merge(self):
        state = self.world.load()
        state["mrs"]["1/2"]["_"]["sibling_wins"] = 1
        self.world.save()
        job = self.finish(self.merge(1, 2))
        self.assertEqual(job["state"], "failed", job)
        self.assertEqual(job["rebases"], 1)
        self.assertEqual(self.states(job)[-1], ("failed", "failed"))
        self.assertIn("second rebase", job["steps"][-1]["detail"])
        self.assertIn("one rebase per MR", job["steps"][-1]["detail"])
        rebases = [w["argv"] for w in self.world.writes() if w["path"].endswith("/rebase")]
        self.assertEqual(len(rebases), 1, rebases)
        self.assertEqual([w["path"].rsplit("/", 1)[-1] for w in self.world.writes()], ["rebase"])
        self.assertEqual(self.world.mr(1, 2)["state"], "opened")

    def test_red_pipeline_fails_without_a_merge(self):
        state = self.world.load()
        state["mrs"]["1/2"]["_"].update(pipeline_fails=True)
        self.world.save()
        job = self.finish(self.merge(1, 2))
        self.assertEqual(job["state"], "failed", job)
        self.assertIn("pipeline failed", job["steps"][-1]["detail"])
        self.assertEqual([w["path"].rsplit("/", 1)[-1] for w in self.world.writes()], ["rebase"])

    def test_wait_gives_up_after_the_cap(self):
        self.settings = {"merge_wait_minutes": 1}
        state = self.world.load()
        state["mrs"]["1/2"]["_"].update(pipeline_polls=1000)
        self.world.save()
        job = self.finish(self.merge(1, 2))
        self.assertEqual(job["state"], "failed", job)
        self.assertIn("gave up waiting", job["steps"][-1]["detail"])
        self.assertLessEqual(self.clock.t, 60)
        self.assertNotIn("merge", [w["path"].rsplit("/", 1)[-1] for w in self.world.writes()])

    def test_head_moved_during_the_call_stops_the_job(self):
        state = self.world.load()
        state["mrs"]["1/1"]["_"].update(merge_http_error=409, merge_http_message="SHA does not match HEAD of source branch")
        self.world.save()
        job = self.finish(self.merge(1, 1))
        self.assertEqual(job["state"], "stopped", job)
        self.assertEqual(self.actions_log()[0]["result"][:6], "error:")

    def test_server_refusing_the_merge_fails_with_its_message(self):
        state = self.world.load()
        state["mrs"]["1/1"]["_"].update(merge_http_error=405, merge_http_message="Method Not Allowed")
        self.world.save()
        job = self.finish(self.merge(1, 1))
        self.assertEqual(job["state"], "failed", job)
        self.assertIn("Method Not Allowed", job["steps"][-1]["detail"])

    def test_not_mergeable_status_fails_without_a_write(self):
        state = self.world.load()
        state["mrs"]["1/1"]["detailed_merge_status"] = "not_approved"
        self.world.save()
        job = self.finish(self.merge(1, 1))
        self.assertEqual(job["state"], "failed", job)
        self.assertIn("not_approved", job["steps"][-1]["detail"])
        self.assertEqual(self.world.writes(), [])

    def test_project_without_ci_merges_without_waiting(self):
        self.world.add_project(3, "g/nci", has_ci=False)
        self.world.add_mr(3, 1, pipeline=None)
        job = self.finish(self.merge(3, 1))
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(self.clock.slept, [])

    def test_renovate_merge_uses_the_checkbox_rebase(self):
        state = self.world.load()
        state["mrs"]["1/3"]["detailed_merge_status"] = "need_rebase"
        state["mrs"]["1/3"]["_"]["renovate_polls"] = 1
        self.world.save()
        job = self.finish(self.merge(1, 3))
        self.assertEqual(job["state"], "done", job)
        self.assertEqual([w["path"] for w in self.world.writes()],
                         ["projects/1/merge_requests/3", "projects/1/merge_requests/3/merge"])

    def test_errors(self):
        self.assert_http(422, self.api.merge, 1, 1, None)
        self.assert_http(422, self.api.merge, 1, 1, {"expected_sha": ""})
        self.assert_http(404, self.api.merge, 1, 99, {"expected_sha": "a" * 40})
        self.assert_http(403, self.api.merge, 2, 4, {"expected_sha": self.world.mr(2, 4)["sha"]})
        self.assert_http(409, self.api.merge, 1, 1, {"expected_sha": "0" * 40})
        self.assert_http(409, self.api.merge, 2, 5, {"expected_sha": self.world.mr(2, 5)["sha"]})
        state = self.world.load()
        state["mrs"]["1/1"]["has_conflicts"] = True
        self.world.save()
        self.assert_http(409, self.api.merge, 1, 1, {"expected_sha": self.world.mr(1, 1)["sha"]})
        self.assertEqual(self.world.writes(), [])

    def test_busy_project_is_423_and_other_projects_still_run(self):
        self.jobs.REGISTRY.busy[1] = "held"
        self.assert_http(423, self.api.merge, 1, 1, {"expected_sha": self.world.mr(1, 1)["sha"]})
        self.world.add_mr(2, 8, title="chore: other project")
        job = self.finish(self.merge(2, 8))
        self.assertEqual(job["state"], "done", job)

    def test_lock_is_released_after_the_job(self):
        self.finish(self.merge(1, 1))
        self.assertEqual(self.jobs.REGISTRY.busy, {})

    def test_a_finished_write_is_visible_on_the_next_read(self):
        self.assertIn("acme/bravo-infra!1", {i["ref"] for i in self.mrs()["items"]})
        self.finish(self.merge(1, 1))
        self.assertNotIn("acme/bravo-infra!1", {i["ref"] for i in self.mrs()["items"]})

    def test_a_manual_pipeline_fails_instead_of_holding_the_lock(self):
        state = self.world.load()
        state["mrs"]["1/1"]["head_pipeline"]["status"] = "manual"
        self.world.save()
        job = self.finish(self.merge(1, 1))
        self.assertEqual(job["state"], "failed", job)
        self.assertIn("manual", job["steps"][-1]["detail"])
        self.assertEqual(self.world.writes(), [])


class TestOtherWrites(ApiCase):
    def setUp(self):
        super().setUp()
        self.standard()

    def test_retry_pipeline(self):
        state = self.world.load()
        state["mrs"]["1/1"]["head_pipeline"]["status"] = "failed"
        state["mrs"]["1/1"]["detailed_merge_status"] = "ci_must_pass"
        self.world.save()
        job = self.finish(self.api.retry_pipeline(1, 1, None))
        self.assertEqual(job["state"], "done", job)
        write = self.world.writes()[0]
        self.assertEqual((write["method"], write["path"]), ("POST", "projects/1/pipelines/1001/retry"))
        self.assertEqual(self.world.mr(1, 1)["head_pipeline"]["status"], "running")
        self.assertEqual(self.actions_log()[0]["action"], "retry_pipeline")

    def test_retry_pipeline_errors(self):
        self.assert_http(409, self.api.retry_pipeline, 1, 1, None)
        self.assert_http(404, self.api.retry_pipeline, 1, 99, None)
        self.assert_http(403, self.api.retry_pipeline, 2, 4, None)
        self.world.add_project(3, "g/nci", has_ci=False)
        self.world.add_mr(3, 1, pipeline=None)
        self.assert_http(409, self.api.retry_pipeline, 3, 1, None)
        self.jobs.REGISTRY.busy[1] = "x"
        state = self.world.load()
        state["mrs"]["1/1"]["head_pipeline"]["status"] = "failed"
        self.world.save()
        self.assert_http(423, self.api.retry_pipeline, 1, 1, None)
        self.assert_http(422, self.api.retry_pipeline, 1, 1, [1])
        self.assertEqual(self.world.writes(), [])

    def test_ready_strips_the_draft_prefix(self):
        job = self.finish(self.api.ready(2, 5, None))
        self.assertEqual(job["state"], "done", job)
        write = self.world.writes()[0]
        self.assertEqual((write["method"], write["path"]), ("PUT", "projects/2/merge_requests/5"))
        self.assertEqual(write["argv"][write["argv"].index("--raw-field") + 1], "title=wip")
        self.assertFalse(self.world.mr(2, 5)["draft"])
        self.assertEqual(self.actions_log()[0]["action"], "ready")

    def test_ready_errors(self):
        self.assert_http(409, self.api.ready, 1, 1, None)
        self.assert_http(422, self.api.ready, 2, 5, "not an object")
        self.assert_http(404, self.api.ready, 2, 99, None)
        self.world.add_mr(2, 6, draft=True, author="colleague.one", title="Draft: theirs")
        self.assert_http(403, self.api.ready, 2, 6, None)
        self.jobs.REGISTRY.busy[2] = "x"
        self.assert_http(423, self.api.ready, 2, 5, None)
        self.assertEqual(self.world.writes(), [])


class TestAuditRoutes(ApiCase):
    def setUp(self):
        super().setUp()
        self.standard()
        self.settings = {"auto_audit": False}
        self.calls: list[str] = []

        def audit_mr(home, settings, item):
            self.calls.append(item["ref"])
            if item.get("fail"):
                raise RuntimeError("model said no")
            return {"importance": "low", "ease": "trivial", "verdict": "merge", "confidence": "sure", "model": "fake"}

        module = mock.MagicMock()
        module.audit_mr = audit_mr
        patcher = mock.patch.dict("sys.modules", {"mg_audit": module})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_force_audit_runs_the_module_and_stores_the_result(self):
        job = self.finish(self.api.audit(1, 3, None))
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(self.calls, ["acme/bravo-infra!3"])
        item = self.item("acme/bravo-infra!3")
        self.assertEqual((item["audit_state"], item["audit"]["model"]), ("done", "fake"))
        self.assertEqual(self.world.writes(), [])

    def test_the_module_never_sees_internal_fields(self):
        seen = {}
        sys_module = __import__("sys").modules["mg_audit"]
        sys_module.audit_mr = lambda home, settings, item: seen.update(item) or {"verdict": "merge"}
        self.finish(self.api.audit(1, 3, None))
        self.assertTrue(seen)
        self.assertFalse([k for k in seen if k.startswith("_")])

    def test_audit_all_covers_every_renovate_mr(self):
        self.world.add_renovate(2, 9, package="docker.io/library/postgres", frm="b0f9560", to="eee6c6e", kind="digest")
        job = self.finish(self.api.audit_all(None))
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(sorted(self.calls), ["acme/bravo-infra!3", "acme/echo-deploy!9"])

    def test_a_failing_audit_is_recorded_and_the_batch_goes_on(self):
        self.world.add_renovate(2, 9, package="docker.io/library/postgres", frm="b0f9560", to="eee6c6e", kind="digest")
        original = __import__("sys").modules["mg_audit"].audit_mr

        def flaky(home, settings, item):
            if item["ref"] == "acme/bravo-infra!3":
                raise RuntimeError("model said no")
            return original(home, settings, item)

        __import__("sys").modules["mg_audit"].audit_mr = flaky
        job = self.finish(self.api.audit_all(None))
        self.assertEqual(job["state"], "failed")
        self.assertEqual(self.item("acme/bravo-infra!3")["audit_state"], "error")
        self.assertEqual(self.item("acme/echo-deploy!9")["audit_state"], "done")

    def test_errors(self):
        self.assert_http(404, self.api.audit, 1, 99, None)
        self.assert_http(403, self.api.audit, 2, 4, None)
        self.assert_http(422, self.api.audit, 1, 1, None)
        self.assert_http(422, self.api.audit, 1, 3, [])

    def test_audit_all_without_renovate_mrs_is_422(self):
        state = self.world.load()
        del state["mrs"]["1/3"]
        self.world.save()
        self.assert_http(422, self.api.audit_all, None)

    def test_second_audit_job_is_423(self):
        self.jobs.REGISTRY.busy[self.jobs.AUDIT_LOCK] = "running"
        self.assert_http(423, self.api.audit, 1, 3, None)
        self.assert_http(423, self.api.audit_all, None)

    def test_missing_module_fails_the_job_plainly(self):
        with mock.patch.dict("sys.modules", {"mg_audit": None}):
            job = self.finish(self.api.audit(1, 3, None))
        self.assertEqual(job["state"], "failed")
        self.assertIn("not installed", job["steps"][-1]["detail"])

    def test_auto_audit_starts_on_get_when_the_module_exists(self):
        self.settings = {}
        self.mrs()
        self.jobs.REGISTRY.wait(self.jobs.REGISTRY.recent()[0]["id"])
        self.assertEqual(self.calls, ["acme/bravo-infra!3"])
        self.settings = {"auto_audit": False}
        self.assertEqual(self.item("acme/bravo-infra!3")["audit_state"], "done")

    def test_auto_audit_off_or_no_module_starts_nothing(self):
        self.mrs()
        self.assertEqual(self.jobs.REGISTRY.recent(), [])
        self.settings = {}
        self.svc.reset()
        with mock.patch.dict("sys.modules", {"mg_audit": None}):
            self.mrs()
        self.assertEqual(self.jobs.REGISTRY.recent(), [])

    def test_auto_audit_does_not_retry_an_error_row(self):
        sha = self.item("acme/bravo-infra!3")["sha"]
        self.store.set_state(self.home, "acme/bravo-infra!3", sha, "error", "boom")
        self.settings = {}
        self.svc.reset()
        self.mrs()
        self.assertEqual(self.jobs.REGISTRY.recent(), [])


class TestHold(ApiCase):
    RENOVATE = '{\n  "extends": ["local>acme/renovate"]\n}\n'

    def setUp(self):
        super().setUp()
        self.world.add_project(1, "acme/bravo-infra", renovate_json=self.RENOVATE)
        self.world.add_renovate(1, 3)
        self.world.add_mr(1, 1)
        self.body = {"package": "docker.io/library/traefik", "until": "2099-12-31"}

    def test_commits_the_rule_and_opens_a_draft_mr(self):
        job = self.finish(self.api.renovate_hold(1, 3, self.body))
        self.assertEqual(job["state"], "done", job)
        writes = self.world.writes()
        self.assertEqual([(w["method"], w["path"]) for w in writes],
                         [("POST", "projects/1/repository/commits"), ("POST", "projects/1/merge_requests")])
        commit = json.loads(writes[0]["stdin"])
        self.assertEqual(commit["branch"], "mergeable/hold-docker-io-library-traefik")
        self.assertEqual(commit["start_branch"], "main")
        action = commit["actions"][0]
        self.assertEqual((action["action"], action["file_path"]), ("update", "renovate.json"))
        rule = json.loads(action["content"])["packageRules"][0]
        self.assertEqual(rule["matchPackageNames"], ["docker.io/library/traefik"])
        self.assertFalse(rule["enabled"])
        self.assertIn("2099-12-31", rule["description"])
        self.assertIn("--input", writes[0]["argv"])
        made = json.loads(writes[1]["stdin"])
        self.assertTrue(made["title"].startswith("Draft: "))
        self.assertEqual((made["source_branch"], made["target_branch"]), (commit["branch"], "main"))
        self.assertEqual([line["action"] for line in self.actions_log()], ["hold_commit", "hold_mr"])
        self.assertTrue(job["steps"][-1]["detail"].startswith("https://"))

    def test_existing_hold_branch_fails_the_job(self):
        self.finish(self.api.renovate_hold(1, 3, self.body))
        job = self.finish(self.api.renovate_hold(1, 3, self.body))
        self.assertEqual(job["state"], "failed", job)
        self.assertIn("already exists", job["steps"][-1]["detail"])

    def test_a_missing_or_unsafe_config_is_422_with_a_snippet(self):
        for text in (None, "{ // json5\n}", "[]"):
            state = self.world.load()
            state["projects"]["1"]["renovate_json"] = text
            self.world.save()
            exc = self.assert_http(422, self.api.renovate_hold, 1, 3, self.body)
            self.assertIn("packageRules", exc.detail)
            self.assertIn("docker.io/library/traefik", exc.detail)
        self.assertEqual(self.world.writes(), [])

    def test_bad_bodies(self):
        for body in (None, [], {}, {"package": "x"}, {"until": "2099-12-31"}, {"package": "", "until": "2099-12-31"},
                     {"package": "a b", "until": "2099-12-31"}, {"package": "x", "until": "tomorrow"},
                     {"package": "x", "until": "2099-13-45"}, {"package": "x", "until": "2001-01-01"}, {"package": 5, "until": "2099-12-31"}):
            self.assert_http(422, self.api.renovate_hold, 1, 3, body)

    def test_other_errors(self):
        self.assert_http(404, self.api.renovate_hold, 1, 99, self.body)
        self.assert_http(422, self.api.renovate_hold, 1, 1, self.body)
        self.world.add_mr(1, 7, author="colleague.one")
        self.assert_http(403, self.api.renovate_hold, 1, 7, self.body)
        self.jobs.REGISTRY.busy[1] = "x"
        self.assert_http(423, self.api.renovate_hold, 1, 3, self.body)
        self.assertEqual(self.world.writes(), [])


class TestBatch(ApiCase):
    def setUp(self):
        super().setUp()
        self.world.add_project(1, "acme/bravo-infra")
        self.world.add_project(2, "acme/echo-deploy", merge_method="merge")
        self.world.add_mr(1, 1, title="chore: one")
        self.world.add_mr(1, 2, title="docs: two")
        self.world.add_mr(2, 3, title="ci: three")
        self.world.add_mr(2, 4, title="feat: not trivial")
        self.world.add_mr(2, 5, author="colleague.one", title="chore: theirs")

    def body(self):
        plan = self.mrs()["batch"]
        return {"refs": plan["refs"], "shas": plan["shas"]}

    def test_set_and_order(self):
        plan = self.mrs()["batch"]
        self.assertEqual(plan["refs"], ["acme/bravo-infra!1", "acme/bravo-infra!2", "acme/echo-deploy!3"])
        self.assertEqual((plan["rebases"], plan["pipelines"]), (1, 1))

    def test_lands_the_set_in_order_and_counts_the_ff_sibling_rebase(self):
        started = self.api.batch_trivial(self.body())
        job = self.finish(started)
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(job["kind"], "batch")
        self.assertEqual(job["rebases"], 1)
        self.assertEqual({r: self.world.mr(*map(int, i.split("/")))["state"] for r, i in
                          (("a1", "1/1"), ("a2", "1/2"), ("f3", "2/3"), ("f4", "2/4"))},
                         {"a1": "merged", "a2": "merged", "f3": "merged", "f4": "opened"})
        merges = [w["path"] for w in self.world.writes() if w["path"].endswith("/merge")]
        self.assertEqual(merges, ["projects/1/merge_requests/1/merge", "projects/1/merge_requests/2/merge", "projects/2/merge_requests/3/merge"])
        self.assertEqual(len([w for w in self.world.writes() if w["path"].endswith("/rebase")]), 1)
        self.assertEqual(sorted({s["ref"] for s in job["steps"]}), ["acme/bravo-infra!1", "acme/bravo-infra!2", "acme/echo-deploy!3"])
        self.assertEqual([line["action"] for line in self.actions_log()], ["merge", "rebase", "merge", "merge"])

    def test_changed_set_is_409_and_writes_nothing(self):
        body = self.body()
        for broken in (
            {"refs": body["refs"][:2], "shas": body["shas"][:2]},
            {"refs": body["refs"], "shas": ["0" * 40] + body["shas"][1:]},
            {"refs": body["refs"] + ["acme/echo-deploy!4"], "shas": body["shas"] + [self.world.mr(2, 4)["sha"]]},
        ):
            exc = self.assert_http(409, self.api.batch_trivial, broken)
            self.assertIn("changed", exc.detail)
        self.assertEqual(self.world.writes(), [])

    def test_set_that_changed_on_the_server_since_the_dialog(self):
        body = self.body()
        state = self.world.load()
        state["mrs"]["2/3"]["head_pipeline"]["status"] = "failed"
        self.world.save()
        self.assert_http(409, self.api.batch_trivial, body)
        self.assertEqual(self.world.writes(), [])

    def test_bad_bodies_are_422(self):
        for body in (None, [], {}, {"refs": [], "shas": []}, {"refs": ["a!1"], "shas": []}, {"refs": "a!1", "shas": ["a" * 40]},
                     {"refs": [1], "shas": ["a" * 40]}, {"refs": ["a!1"], "shas": ["zz"]}):
            self.assert_http(422, self.api.batch_trivial, body)

    def test_stops_at_the_first_failure(self):
        state = self.world.load()
        state["mrs"]["1/2"]["_"].update(merge_http_error=405, merge_http_message="Method Not Allowed")
        self.world.save()
        job = self.finish(self.api.batch_trivial(self.body()))
        self.assertEqual(job["state"], "failed", job)
        self.assertEqual(self.world.mr(1, 1)["state"], "merged")
        self.assertEqual(self.world.mr(1, 2)["state"], "opened")
        self.assertEqual(self.world.mr(2, 3)["state"], "opened")
        self.assertIn(("skipped", "skipped"), self.states(job))
        self.assertEqual([s["ref"] for s in job["steps"] if s["step"] == "skipped"], ["acme/echo-deploy!3"])
        self.assertFalse([w for w in self.world.writes() if w["path"].startswith("projects/2/")])

    def test_second_rebase_fails_the_whole_batch(self):
        state = self.world.load()
        state["mrs"]["1/2"]["_"]["sibling_wins"] = 1
        self.world.save()
        job = self.finish(self.api.batch_trivial(self.body()))
        self.assertEqual(job["state"], "failed", job)
        self.assertEqual(self.world.mr(2, 3)["state"], "opened")

    def test_busy_project_is_423_and_nothing_is_claimed(self):
        self.jobs.REGISTRY.busy[2] = "held"
        self.assert_http(423, self.api.batch_trivial, self.body())
        self.assertNotIn(1, self.jobs.REGISTRY.busy)
        self.assertEqual(self.world.writes(), [])

    def test_renovate_with_a_done_audit_joins_the_batch(self):
        self.world.add_renovate(1, 9, renovate_polls=1)
        sha = self.world.mr(1, 9)["sha"]
        self.store.put_audit(self.home, "acme/bravo-infra!9", sha, {"importance": "low", "ease": "trivial", "verdict": "merge", "confidence": "sure"})
        self.assertIn("acme/bravo-infra!9", self.mrs()["batch"]["refs"])
        job = self.finish(self.api.batch_trivial(self.body()))
        self.assertEqual(job["state"], "done", job)
        self.assertEqual(self.world.mr(1, 9)["state"], "merged")


class TestJobsAndStatus(ApiCase):
    def setUp(self):
        super().setUp()
        self.standard()

    def test_jobs_list_and_detail(self):
        started = self.api.merge(1, 1, {"expected_sha": self.world.mr(1, 1)["sha"]})
        self.finish(started)
        listing = self.api.jobs()
        self.assertEqual([j["id"] for j in listing], [started["job_id"]])
        detail = self.api.job(started["job_id"])
        self.assertEqual(sorted(detail), ["id", "kind", "rebases", "refs", "state", "steps"])
        self.assertEqual(detail["state"], "done")
        for step in detail["steps"]:
            self.assertEqual(sorted(step), ["at", "detail", "ref", "state", "step"])
            self.assertRegex(step["at"], ISO)

    def test_jobs_keeps_the_last_20_newest_first(self):
        for i in range(25):
            job = self.jobs.REGISTRY.start("probe", [f"k{i}"], [f"r{i}"], lambda job: "done")
            self.jobs.REGISTRY.wait(job.id)
        listing = self.api.jobs()
        self.assertEqual(len(listing), 20)
        self.assertEqual(listing[0]["refs"], ["r24"])
        self.assertEqual(listing[-1]["refs"], ["r5"])

    def test_unknown_job_is_404(self):
        self.assert_http(404, self.api.job, "nope")

    def test_a_crashing_runner_fails_the_job_and_frees_the_lock(self):
        def boom(job):
            raise RuntimeError("kaput")

        job = self.jobs.REGISTRY.start("probe", [9], ["r"], boom)
        done = self.jobs.REGISTRY.wait(job.id)
        self.assertEqual(done["state"], "failed")
        self.assertIn("kaput", done["steps"][-1]["detail"])
        self.assertEqual(self.jobs.REGISTRY.busy, {})

    def test_status_markdown(self):
        response = self.api.status_md()
        self.assertEqual(response.media_type, "text/markdown")
        text = response.body.decode()
        self.assertTrue(text.startswith("# Open merge requests"))
        self.assertIn("5 open in 2 projects", text)
        self.assertIn("## acme/bravo-infra (3)", text)
        self.assertIn("## acme/echo-deploy (2)", text)
        self.assertIn("- !3 traefik v3.7.15 to v3.7.16 | renovate |", text)
        self.assertIn("| need_rebase |", text)
        self.assertIn("| draft |", text)
        self.assertIn("Trivial batch: 1 MRs", text)
        self.assertIn("1 mine", text.replace("2 mine", "1 mine")) if False else None
        self.assertNotIn("\u2013", text)

    def test_status_shows_audit_verdict(self):
        sha = self.item("acme/bravo-infra!3")["sha"]
        self.store.put_audit(self.home, "acme/bravo-infra!3", sha, {"importance": "high", "ease": "hard", "verdict": "hold", "confidence": "sure"})
        self.assertIn("audit high/hard/hold", self.api.status_md().body.decode())

    def test_status_502_without_glab(self):
        with mock.patch.dict("os.environ", {"PATH": "/nonexistent"}):
            self.assert_http(502, self.api.status_md)


if __name__ == "__main__":
    unittest.main()
