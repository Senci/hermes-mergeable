"""Pure rules: owner, Renovate parse, can, trivial set and landing order, urgency, rebase checkbox, hold edit."""

from __future__ import annotations

import json
import sys
import unittest

import support

support.load_api()
rules = sys.modules["mg_rules"]
actions = sys.modules["mg_actions"]
SETTINGS = sys.modules["mg_settings"].defaults()


def item(**kw) -> dict:
    base = {
        "ref": "g/p!1", "project": "g/p", "iid": 1, "title": "chore: x", "full_title": "chore: x", "owner": "self",
        "draft": False, "merge_status": "mergeable", "has_conflicts": False, "merge_method": "ff", "files_changed": 2,
        "pipeline": {"status": "success", "url": None}, "target_branch": "main", "sha": "a" * 40, "age_days": 3,
        "audit": None, "audit_state": "none", "_has_ci": True,
    }
    base.update(kw)
    return base


def audited(**kw) -> dict:
    audit = {"importance": "low", "ease": "trivial", "verdict": "merge", "confidence": "sure"}
    audit.update(kw)
    return audit


class TestOwner(unittest.TestCase):
    def test_owner_rules(self):
        owner = rules.owner_of
        self.assertEqual(owner("ripley", "feature/x", "ripley", "renovate/"), "self")
        self.assertEqual(owner("ripley", "renovate/x", "ripley", "renovate/"), "self")
        self.assertEqual(owner("group_12_bot_a1b2", "renovate/traefik", "ripley", "renovate/"), "renovate")
        self.assertEqual(owner("project_5_bot_ff00", "renovate/traefik", "ripley", "renovate/"), "renovate")

    def test_other_bot_or_user_is_other(self):
        owner = rules.owner_of
        self.assertEqual(owner("group_12_bot_a1b2", "feature/x", "ripley", "renovate/"), "other")
        self.assertEqual(owner("someone", "renovate/x", "ripley", "renovate/"), "other")
        self.assertEqual(owner("renovate-bot", "renovate/x", "ripley", "renovate/"), "other")
        self.assertEqual(owner("?", "", None, "renovate/"), "other")

    def test_custom_prefix(self):
        self.assertEqual(rules.owner_of("group_1_bot_x", "deps/a", "me", "deps/"), "renovate")


class TestRenovateParse(unittest.TestCase):
    def test_table_row_version(self):
        body = support.RENOVATE_BODY.format(pkg="docker.io/library/traefik", kind="patch", frm="v3.7.15", to="v3.7.16")
        got = rules.parse_renovate("chore(deps): update docker.io/library/traefik docker tag to v3.7.16", body)
        self.assertEqual(got, {"package": "docker.io/library/traefik", "from": "v3.7.15", "to": "v3.7.16", "update_type": "patch"})
        self.assertEqual(rules.renovate_title(got, "x"), "traefik v3.7.15 to v3.7.16")

    def test_digest_row_and_registry_prefix(self):
        body = support.RENOVATE_BODY.format(pkg="docker.io/onlyoffice/documentserver", kind="major", frm="9.4.0.1", to="10.0.0.1")
        got = rules.parse_renovate("whatever", body)
        self.assertEqual(got["update_type"], "major")
        self.assertEqual(rules.renovate_title(got, "x"), "onlyoffice/documentserver 9.4.0.1 to 10.0.0.1")
        digest = rules.parse_renovate("t", support.RENOVATE_BODY.format(pkg="docker.io/library/postgres", kind="digest", frm="sha256:b0f9560aaaaa", to="sha256:eee6c6eaaaaa"))
        self.assertEqual((digest["from"], digest["to"]), ("b0f9560", "eee6c6e"))

    def test_title_fallback_without_table(self):
        got = rules.parse_renovate("chore(deps): update docker.io/library/postgres:17.11-alpine docker digest to eee6c6e", "")
        self.assertEqual(got["package"], "docker.io/library/postgres")
        self.assertEqual(got["to"], "eee6c6e")
        self.assertIsNone(got["from"])

    def test_unparseable_keeps_the_full_title(self):
        got = rules.parse_renovate("Something else entirely", "no table")
        self.assertEqual(got, {"package": None, "from": None, "to": None, "update_type": None})
        self.assertEqual(rules.renovate_title(got, "Something else entirely"), "Something else entirely")

    def test_strip_draft(self):
        self.assertEqual(rules.strip_draft("Draft: wip"), "wip")
        self.assertEqual(rules.strip_draft("[Draft] wip"), "wip")
        self.assertEqual(rules.strip_draft("draft: Draft: twice"), "twice")
        self.assertEqual(rules.strip_draft("Drafting notes"), "Drafting notes")


class TestCan(unittest.TestCase):
    def test_other_and_draft_disable_everything(self):
        for kw, why in (({"owner": "other"}, "Colleague"), ({"draft": True}, "Draft")):
            can = rules.can_act(item(**kw))
            self.assertFalse(can["merge"])
            self.assertFalse(can["rebase"])
            self.assertIn(why, can["reason"])

    def test_green_mergeable_merges_without_rebase(self):
        can = rules.can_act(item())
        self.assertTrue(can["merge"])
        self.assertFalse(can["rebase"])
        self.assertEqual(can["reason"], "Merge into main")

    def test_need_rebase_allows_both_and_renovate_flag(self):
        own = rules.can_act(item(merge_status="need_rebase"))
        self.assertTrue(own["rebase"] and own["merge"])
        self.assertFalse(own["renovate_rebase"])
        bot = rules.can_act(item(owner="renovate", merge_status="need_rebase"))
        self.assertTrue(bot["renovate_rebase"])

    def test_conflict_blocks_merge_and_own_rebase_but_not_renovate_rebase(self):
        own = rules.can_act(item(has_conflicts=True, merge_status="conflict"))
        self.assertFalse(own["merge"] or own["rebase"])
        bot = rules.can_act(item(owner="renovate", has_conflicts=True, merge_status="conflict"))
        self.assertTrue(bot["rebase"] and bot["renovate_rebase"])
        self.assertFalse(bot["merge"])

    def test_red_pipeline_and_blocked_status(self):
        self.assertFalse(rules.can_act(item(pipeline={"status": "failed"}, merge_status="ci_must_pass"))["merge"])
        self.assertIn("Not mergeable", rules.can_act(item(merge_status="not_approved"))["reason"])
        self.assertTrue(rules.can_act(item(merge_status="ci_still_running", pipeline={"status": "running"}))["merge"])


class TestTrivial(unittest.TestCase):
    def miss(self, it, **settings) -> str:
        return rules.trivial_miss(it, dict(SETTINGS, **settings))

    def test_own_chore_in_batch(self):
        self.assertEqual(self.miss(item()), "")

    def test_default_exclusions(self):
        self.assertEqual(self.miss(item(draft=True)), "draft")
        self.assertIn("colleague", self.miss(item(owner="other")))
        self.assertEqual(self.miss(item(pipeline={"status": "failed"})), "pipeline failed")
        self.assertEqual(self.miss(item(pipeline=None)), "pipeline missing")
        self.assertEqual(self.miss(item(has_conflicts=True)), "conflict")
        self.assertEqual(self.miss(item(merge_status="not_approved")), "state not_approved")
        self.assertEqual(self.miss(item(full_title="feat: new thing", title="feat: new thing")), "title prefix not in the list")
        self.assertEqual(self.miss(item(files_changed=11)), "11 files (max 10)")

    def test_no_ci_project_needs_no_pipeline(self):
        self.assertEqual(self.miss(item(pipeline=None, _has_ci=False)), "")

    def test_rebase_allowance_and_never_list(self):
        behind = item(merge_status="need_rebase")
        self.assertEqual(self.miss(behind), "")
        self.assertEqual(self.miss(behind, trivial_allow_rebase=False), "state need_rebase")
        self.assertIn("never-batch", self.miss(item(), trivial_never_projects=["g/p"]))

    def test_prefix_needs_colon_or_paren(self):
        self.assertEqual(self.miss(item(full_title="docs(readme): x")), "")
        self.assertEqual(self.miss(item(full_title="chores: x")), "title prefix not in the list")

    def test_renovate_needs_a_done_trivial_sure_merge_audit(self):
        base = item(owner="renovate", full_title="chore(deps): x")
        self.assertEqual(self.miss(base), "no audit yet")
        self.assertEqual(self.miss(dict(base, audit=audited(), audit_state="stale")), "no audit yet")
        ok = dict(base, audit=audited(), audit_state="done")
        self.assertEqual(self.miss(ok), "")
        self.assertEqual(self.miss(dict(ok, audit=audited(verdict="hold"))), "audit verdict hold")
        self.assertEqual(self.miss(dict(ok, audit=audited(ease="easy"))), "audit ease easy")
        self.assertEqual(self.miss(dict(ok, audit=audited(confidence="not_sure"))), "audit not sure")
        self.assertEqual(self.miss(dict(ok, audit=audited(confidence="not_sure")), trivial_require_sure=False), "")
        self.assertEqual(self.miss(ok, trivial_renovate=False), "Renovate rule off")

    def test_own_rule_off(self):
        self.assertEqual(self.miss(item(), trivial_own=False), "own-MR rule off")

    def test_batch_plan_order_and_cost(self):
        def mark(i):
            i["trivial"] = {"in_batch": True, "miss": ""}
            return i

        items = [
            mark(item(ref="b/p!7", project="b/p", iid=7, merge_status="need_rebase", sha="7" * 40)),
            mark(item(ref="a/p!9", project="a/p", iid=9, sha="9" * 40)),
            mark(item(ref="a/p!3", project="a/p", iid=3, sha="3" * 40)),
            mark(item(ref="a/p!4", project="a/p", iid=4, merge_status="need_rebase", sha="4" * 40)),
            item(ref="a/p!5", project="a/p", iid=5, trivial={"in_batch": False, "miss": "x"}),
        ]
        plan = rules.batch_plan(items)
        self.assertEqual(plan["refs"], ["a/p!3", "a/p!9", "a/p!4", "b/p!7"])
        self.assertEqual(plan["shas"], ["3" * 40, "9" * 40, "4" * 40, "7" * 40])
        # a/p is ff: !9 follows !3 (rebase), !4 needs one; b/p!7 needs one
        self.assertEqual((plan["rebases"], plan["pipelines"]), (3, 3))

    def test_batch_plan_merge_method_projects_need_no_sibling_rebase(self):
        a = item(ref="a/p!1", project="a/p", iid=1, merge_method="merge")
        b = item(ref="a/p!2", project="a/p", iid=2, merge_method="merge")
        for i in (a, b):
            i["trivial"] = {"in_batch": True, "miss": ""}
        self.assertEqual(rules.batch_plan([a, b])["rebases"], 0)


class TestUrgency(unittest.TestCase):
    def test_prototype_order(self):
        ready = item(ref="g/p!1", iid=1)
        behind = item(ref="g/p!2", iid=2, merge_status="need_rebase")
        critical = item(ref="g/p!3", iid=3, merge_status="need_rebase", audit=audited(importance="critical"))
        draft = item(ref="g/p!4", iid=4, draft=True)
        other = item(ref="g/p!5", iid=5, owner="other")
        order = [i["iid"] for i in rules.sort_items([other, draft, behind, ready, critical])]
        self.assertEqual(order, [3, 1, 2, 5, 4])

    def test_older_first_on_a_tie(self):
        old = item(iid=1, age_days=80)
        new = item(iid=2, age_days=2)
        self.assertEqual([i["iid"] for i in rules.sort_items([new, old])], [1, 2])


DESCRIPTION = support.RENOVATE_BODY.format(pkg="docker.io/library/traefik", kind="patch", frm="v1", to="v2")


class TestCheckbox(unittest.TestCase):
    def test_only_the_rebase_check_line_changes(self):
        new, state = rules.checkbox_edit(DESCRIPTION)
        self.assertEqual(state, "changed")
        old_lines, new_lines = DESCRIPTION.splitlines(keepends=True), new.splitlines(keepends=True)
        self.assertEqual(len(old_lines), len(new_lines))
        diff = [(a, b) for a, b in zip(old_lines, new_lines) if a != b]
        self.assertEqual(len(diff), 1)
        self.assertIn("<!-- rebase-check -->", diff[0][0])
        self.assertEqual(diff[0][1], diff[0][0].replace("[ ]", "[x]", 1))

    def test_other_unticked_boxes_are_left_alone(self):
        text = "- [ ] other box\n - [ ] <!-- rebase-check -->go\n- [ ] third\n"
        new, state = rules.checkbox_edit(text)
        self.assertEqual(new, "- [ ] other box\n - [x] <!-- rebase-check -->go\n- [ ] third\n")
        self.assertEqual(state, "changed")

    def test_ticked_and_missing(self):
        ticked = DESCRIPTION.replace("- [ ] <!--", "- [x] <!--")
        self.assertEqual(rules.checkbox_edit(ticked), (ticked, "ticked"))
        self.assertEqual(rules.checkbox_edit("no box here"), ("no box here", "missing"))
        self.assertEqual(rules.checkbox_edit(""), ("", "missing"))

    def test_crlf_and_trailing_text_survive(self):
        text = "a\r\n - [ ] <!-- rebase-check -->go\r\nlast line without newline"
        new, _ = rules.checkbox_edit(text)
        self.assertEqual(new, text.replace("[ ]", "[x]"))


class TestHoldEdit(unittest.TestCase):
    def test_adds_package_rules_with_minimal_diff(self):
        text = '{\n  "extends": ["local>acme/renovate"],\n  "ignorePaths": ["x/**"]\n}\n'
        out = actions.build_hold(text, "docker.io/library/traefik", "2026-12-31", "2026-10-23")
        data = json.loads(out)
        self.assertEqual(data["extends"], ["local>acme/renovate"])
        rule = data["packageRules"][0]
        self.assertEqual(rule["matchPackageNames"], ["docker.io/library/traefik"])
        self.assertFalse(rule["enabled"])
        self.assertIn("2026-12-31", rule["description"])
        self.assertTrue(out.startswith(text[:-3]))
        self.assertTrue(out.endswith("}\n"))

    def test_appends_to_an_existing_list_and_keeps_the_tab_indent(self):
        text = '{\n\t"packageRules": [\n\t\t{"matchPackageNames": ["a"], "enabled": false}\n\t]\n}'
        out = actions.build_hold(text, "b", "2026-12-31", "2026-10-23")
        rules_ = json.loads(out)["packageRules"]
        self.assertEqual([r["matchPackageNames"] for r in rules_], [["a"], ["b"]])
        self.assertFalse(out.endswith("\n"))
        self.assertIn("\t", out)

    def test_refuses_what_it_cannot_edit_safely(self):
        for bad in ("[]", "not json", '{"packageRules": 5}'):
            with self.assertRaises(ValueError):
                actions.build_hold(bad, "a", "2026-12-31", "2026-10-23")

    def test_snippet_is_valid_json(self):
        snippet = actions.hold_snippet("a", "2026-12-31", "2026-10-23")
        self.assertFalse(json.loads(snippet)["packageRules"][0]["enabled"])


if __name__ == "__main__":
    unittest.main()
