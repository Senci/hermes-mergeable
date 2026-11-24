"""glab client: argv shape, refused spellings, error parsing, and the fake's agreement with the real shapes."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from unittest import mock

import support
from support import ApiCase

support.load_api()
mg_glab = sys.modules["mg_glab"]


class TestArgv(unittest.TestCase):
    def setUp(self):
        self.glab = mg_glab.Glab("git.example")

    def test_get_has_no_method_flag(self):
        self.assertEqual(self.glab._argv("GET", "user", None, None, False),
                         ["glab", "api", "--hostname", "git.example", "user"])

    def test_put_with_fields(self):
        argv = self.glab._argv("PUT", "projects/1/merge_requests/2/merge", {"should_remove_source_branch": "true"}, {"sha": "abc"}, False)
        self.assertEqual(argv, ["glab", "api", "--hostname", "git.example", "--method", "PUT", "projects/1/merge_requests/2/merge",
                                "--field", "should_remove_source_branch=true", "--raw-field", "sha=abc"])

    def test_body_goes_through_stdin(self):
        argv = self.glab._argv("POST", "projects/1/repository/commits", None, None, True)
        self.assertEqual(argv[-4:], ["--input", "-", "--header", "Content-Type: application/json"])

    def test_refused_spellings(self):
        for bad in ({"x": "--rebase"}, {"merge_when_pipeline_succeeds": "true"}):
            with self.assertRaises(ValueError):
                self.glab._argv("PUT", "p", bad, None, False)
            with self.assertRaises(ValueError):
                self.glab._argv("PUT", "p", None, bad, False)
        with self.assertRaises(ValueError):
            self.glab._argv("PUT", "projects/1/merge_requests/2/merge?merge_when_pipeline_succeeds=true", None, None, False)

    def test_path_quoting(self):
        self.assertEqual(mg_glab.quote(".gitlab-ci.yml"), ".gitlab-ci.yml")
        self.assertEqual(mg_glab.quote("a/b c"), "a%2Fb%20c")

    def test_runs_without_a_shell_and_stdin_closed(self):
        with mock.patch.object(subprocess, "run") as run:
            run.return_value = subprocess.CompletedProcess([], 0, stdout='{"a": 1}', stderr="")
            self.assertEqual(self.glab.get("user"), {"a": 1})
        _args, kwargs = run.call_args
        self.assertNotIn("shell", kwargs)
        self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
        self.assertIsInstance(_args[0], list)

    def test_empty_body_is_none(self):
        with mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout="", stderr="")):
            self.assertIsNone(self.glab.put("x"))


class TestErrors(unittest.TestCase):
    def fail(self, stderr, stdout="", rc=1):
        glab = mg_glab.Glab("h")
        done = subprocess.CompletedProcess([], rc, stdout=stdout, stderr=stderr)
        with mock.patch.object(subprocess, "run", return_value=done):
            with self.assertRaises(mg_glab.GlabError) as ctx:
                glab.get("x")
        return ctx.exception

    def test_http_status_is_read_from_the_real_stderr_shape(self):
        shape = json.loads((support.TESTS / "fixtures" / "real_shapes.json").read_text())["error"]
        exc = self.fail(shape["stderr"], shape["stdout"], shape["rc"])
        self.assertEqual(exc.status, 404)
        self.assertIn("Project Not Found", exc.message)

    def test_other_statuses_and_none(self):
        self.assertEqual(self.fail("glab: SHA does not match HEAD of source branch (HTTP 409)").status, 409)
        self.assertIsNone(self.fail("glab: could not resolve host").status)
        self.assertIsNone(self.fail("").status)

    def test_timeout_and_missing_binary(self):
        glab = mg_glab.Glab("h", timeout=1)
        with mock.patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired("glab", 1)):
            with self.assertRaises(mg_glab.GlabError) as ctx:
                glab.get("x")
        self.assertIn("timed out", ctx.exception.message)
        with mock.patch.object(subprocess, "run", side_effect=FileNotFoundError()):
            with self.assertRaises(mg_glab.GlabError) as ctx:
                glab.get("x")
        self.assertIn("not installed", ctx.exception.message)


class TestAgainstTheFake(ApiCase):
    def setUp(self):
        super().setUp()
        self.standard()
        self.glab = mg_glab.Glab("git.example")

    def test_hostname_comes_from_the_settings(self):
        self.settings = {"gitlab_host": "git.example"}
        self.mrs()
        self.assertTrue(all(argv[argv.index("--hostname") + 1] == "git.example" for argv in self.world.argvs()))
        self.assertEqual(self.mrs()["host"], "git.example")

    def test_paged_walks_pages(self):
        for iid in range(10, 17):
            self.world.add_mr(1, iid)
        got = self.glab.paged("projects/1/merge_requests?state=opened", per_page=3)
        self.assertEqual(len(got), 10)
        self.assertEqual(len({m["iid"] for m in got}), 10)

    def test_error_from_the_fake_has_the_real_binary_shape(self):
        with self.assertRaises(mg_glab.GlabError) as ctx:
            self.glab.get("projects/999")
        self.assertEqual(ctx.exception.status, 404)

    def test_fake_payloads_carry_every_recorded_real_key(self):
        listing = self.glab.get("projects/1/merge_requests?state=opened")[0]
        detail = self.glab.get("projects/1/merge_requests/1")
        missing_list = set(support.SHAPES["list_keys"]) - set(listing)
        missing_detail = set(support.SHAPES["detail_keys"]) - set(detail)
        missing_head = set(support.SHAPES["head_pipeline_keys"]) - set(detail["head_pipeline"])
        self.assertEqual((missing_list, missing_detail, missing_head), (set(), set(), set()))
        self.assertNotIn("head_pipeline", listing)

    def test_every_call_is_recorded_without_a_shell_form(self):
        self.glab.get("user")
        self.assertEqual(self.world.argvs()[-1], ["api", "--hostname", "git.example", "user"])


if __name__ == "__main__":
    unittest.main()
