"""Settings: defaults, per-profile overrides, type fallback, and Hermes being absent."""

from __future__ import annotations

import sys
import types
import unittest
from unittest import mock

import support

support.load_api()
settings = sys.modules["mg_settings"]


class TestLoad(unittest.TestCase):
    def load(self, raw):
        with mock.patch.object(settings, "read_entry", return_value=raw):
            return settings.load()

    def test_empty_config_gives_the_defaults(self):
        self.assertEqual(self.load({}), settings.defaults())

    def test_overrides_apply(self):
        got = self.load({"gitlab_host": "git.example", "merge_wait_minutes": 5, "trivial_title_prefixes": ["fix"],
                         "auto_audit": False, "trivial_max_files": 3})
        self.assertEqual((got["gitlab_host"], got["merge_wait_minutes"], got["trivial_title_prefixes"], got["auto_audit"], got["trivial_max_files"]),
                         ("git.example", 5, ["fix"], False, 3))
        self.assertEqual(got["renovate_branch_prefix"], "renovate/")

    def test_wrong_types_fall_back_to_the_default(self):
        got = self.load({"gitlab_host": 5, "merge_wait_minutes": "45", "auto_audit": "yes", "include_groups": "acme",
                         "trivial_title_prefixes": [1, 2], "trivial_max_files": True})
        self.assertEqual(got, settings.defaults())

    def test_non_positive_waits_fall_back(self):
        got = self.load({"merge_wait_minutes": 0, "trivial_max_files": -1})
        self.assertEqual((got["merge_wait_minutes"], got["trivial_max_files"]), (45, 10))

    def test_lists_are_stripped_and_blanks_dropped(self):
        self.assertEqual(self.load({"exclude_projects": [" a/b ", "", "  "]})["exclude_projects"], ["a/b"])

    def test_blank_host_falls_back(self):
        self.assertEqual(self.load({"gitlab_host": "   "})["gitlab_host"], "gitlab.com")

    def test_unknown_keys_are_ignored(self):
        self.assertNotIn("bogus", self.load({"bogus": 1}))

    def test_rules_echo_the_batch_and_merge_keys(self):
        rules = settings.rules(settings.defaults())
        self.assertEqual(sorted(rules), sorted([k for k in settings.SCHEMA if k.startswith("trivial_")] + ["delete_source_branch", "merge_wait_minutes"]))


class TestReadEntry(unittest.TestCase):
    def fake_hermes(self, config, name="load_config_readonly"):
        module = types.ModuleType("hermes_cli.config")
        setattr(module, name, lambda: config)
        package = types.ModuleType("hermes_cli")
        package.config = module
        return mock.patch.dict(sys.modules, {"hermes_cli": package, "hermes_cli.config": module})

    def test_hermes_absent_is_empty(self):
        with mock.patch.dict(sys.modules, {"hermes_cli": None, "hermes_cli.config": None}):
            self.assertEqual(settings.read_entry(), {})

    def test_reads_plugins_entries_mergeable_settings(self):
        config = {"plugins": {"entries": {"mergeable": {"settings": {"gitlab_host": "h"}}, "other": {"settings": {"x": 1}}}}}
        with self.fake_hermes(config):
            self.assertEqual(settings.read_entry(), {"gitlab_host": "h"})

    def test_legacy_config_subtree_is_the_fallback(self):
        with self.fake_hermes({"plugins": {"entries": {"mergeable": {"config": {"gitlab_host": "old"}}}}}):
            self.assertEqual(settings.read_entry(), {"gitlab_host": "old"})

    def test_older_hermes_without_the_readonly_loader(self):
        with self.fake_hermes({"plugins": {"entries": {"mergeable": {"settings": {"gitlab_host": "h"}}}}}, name="load_config"):
            self.assertEqual(settings.read_entry(), {"gitlab_host": "h"})

    def test_malformed_config_is_empty(self):
        for config in (None, {"plugins": None}, {"plugins": {"entries": []}}, {"plugins": {"entries": {"mergeable": {"settings": "x"}}}}):
            with self.fake_hermes(config):
                self.assertEqual(settings.read_entry(), {})

    def test_a_loader_that_raises_is_empty(self):
        module = types.ModuleType("hermes_cli.config")

        def boom():
            raise RuntimeError("config broken")

        module.load_config_readonly = boom
        package = types.ModuleType("hermes_cli")
        package.config = module
        with mock.patch.dict(sys.modules, {"hermes_cli": package, "hermes_cli.config": module}):
            self.assertEqual(settings.read_entry(), {})


if __name__ == "__main__":
    unittest.main()
