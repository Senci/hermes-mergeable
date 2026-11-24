"""Source and package hygiene: no shell, no forbidden glab spellings, read-only state.db, ASCII, settings parity."""

from __future__ import annotations

import ast
import json
import re
import sys
import unittest
from pathlib import Path

import support

support.load_api()
PLUGIN = support.PLUGIN
DASHBOARD = PLUGIN / "dashboard"
SOURCES = sorted(DASHBOARD.glob("*.py")) + [PLUGIN / "__init__.py"]
ALL_PY = SOURCES + sorted(support.TESTS.glob("*.py"))
BANNED = re.compile("[\u2013\u2014\u2026\u2018\u2019\u201c\u201d\u2190-\u21ff]")
FORBIDDEN = ("mr merge", "--rebase", "merge_when_pipeline_succeeds")


def strings(tree: ast.AST):
    """String constants that are not docstrings."""
    docs = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                docs.add(id(first.value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docs:
            yield node


class TestNoShell(unittest.TestCase):
    def test_no_shell_true_anywhere(self):
        for path in ALL_PY:
            text = path.read_text()
            if path.name != "test_hygiene.py":
                self.assertNotIn("shell=True", text, path.name)
            tree = ast.parse(text)
            for node in ast.walk(tree):
                if isinstance(node, ast.keyword) and node.arg == "shell":
                    self.fail(f"{path.name}:{node.lineno} passes shell=")

    def test_no_os_system_popen_or_exec(self):
        for path in SOURCES:
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "os" \
                        and node.attr in {"system", "popen", "execv", "execvp", "spawnv"}:
                    self.fail(f"{path.name}:{node.lineno} uses os.{node.attr}")
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"eval", "exec", "compile"}:
                    self.fail(f"{path.name}:{node.lineno} calls {node.func.id}")

    def test_subprocess_only_in_the_glab_and_audit_clients(self):
        for path in SOURCES:
            uses = "subprocess" in path.read_text()
            self.assertEqual(uses, path.name in {"mg_glab.py", "mg_audit.py"}, path.name)

    def test_runtime_never_builds_the_forbidden_glab_spellings(self):
        for path in SOURCES:
            if path.name == "mg_glab.py":
                continue
            for node in strings(ast.parse(path.read_text())):
                for bad in FORBIDDEN:
                    self.assertNotIn(bad, node.value, f"{path.name}:{node.lineno}")

    def test_the_client_refuses_them_by_construction(self):
        text = (DASHBOARD / "mg_glab.py").read_text()
        for bad in ("--rebase", "merge_when_pipeline_succeeds"):
            self.assertIn(bad, text)
        self.assertNotIn('"merge"', text)

    def test_no_token_env_or_glab_config_is_touched(self):
        for path in SOURCES:
            text = path.read_text().lower()
            for needle in ("private-token", "gitlab_token", "auth.json", ".env\"", "glab-cli", "config.yml", "getpass"):
                self.assertNotIn(needle, text, f"{path.name}: {needle}")


class TestStateDbReadOnly(unittest.TestCase):
    def connects(self):
        for path in SOURCES:
            tree = ast.parse(path.read_text())
            for fn in ast.walk(tree):
                if isinstance(fn, ast.FunctionDef):
                    for node in ast.walk(fn):
                        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "connect" \
                                and isinstance(node.func.value, ast.Name) and node.func.value.id == "sqlite3":
                            yield path.name, fn.name, node

    def test_every_sqlite_connect_is_accounted_for(self):
        found = {(f, fn) for f, fn, _n in self.connects()}
        self.assertEqual(found, {("mg_sessions.py", "open_readonly"), ("mg_store.py", "_read_conn"), ("mg_store.py", "_write_conn")})

    def test_state_db_connect_carries_mode_ro_and_uri(self):
        for fname, fn, node in self.connects():
            if (fname, fn) == ("mg_sessions.py", "open_readonly"):
                text = ast.unparse(node)
                self.assertIn("mode=ro", text)
                self.assertIn("uri=True", text)

    def test_only_the_session_mapper_names_a_state_db(self):
        for path in SOURCES:
            tree = ast.parse(path.read_text())
            mentions = [n.lineno for n in strings(tree) if "state.db" in n.value]
            self.assertEqual(bool(mentions), path.name == "mg_sessions.py", path.name)


class TestPackage(unittest.TestCase):
    def test_routes_are_plain_def(self):
        tree = ast.parse((DASHBOARD / "plugin_api.py").read_text())
        self.assertEqual([n.name for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)], [])

    def test_register_stays_minimal(self):
        text = (PLUGIN / "__init__.py").read_text()
        tree = ast.parse(text)
        funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
        self.assertEqual([f.name for f in funcs], ["register"])
        self.assertLessEqual(len(funcs[0].body), 1)
        self.assertLessEqual(len(text.splitlines()), 12)

    def test_manifest(self):
        data = json.loads((DASHBOARD / "manifest.json").read_text())
        self.assertEqual((data["name"], data["api"], data["tab"]["path"]), ("mergeable", "plugin_api.py", "/mergeable"))
        self.assertTrue(data["tab"]["hidden"])

    def test_no_banned_punctuation(self):
        for path in ALL_PY + [PLUGIN / "plugin.yaml", DASHBOARD / "manifest.json", support.TESTS / "fixtures" / "real_shapes.json"]:
            if path.name == "test_hygiene.py":
                continue
            for number, line in enumerate(path.read_text().splitlines(), 1):
                self.assertIsNone(BANNED.search(line), f"{path.name}:{number}")

    def test_banned_check_catches_a_plant(self):
        self.assertIsNotNone(BANNED.search("a \u2014 b"))
        self.assertIsNotNone(BANNED.search("a \u2192 b"))
        self.assertIsNone(BANNED.search("a - b -> c ... 'x' \"y\""))

    def test_no_python_314_only_syntax(self):
        for path in ALL_PY:
            ast.parse(path.read_text(), feature_version=(3, 11))


def parse_schema_block(text: str) -> dict:
    """The config_schema block of plugin.yaml, which is flat: `  key:` then `    type|default|description`."""
    block, inside = {}, False
    key = None
    for line in text.splitlines():
        if line.startswith("config_schema:"):
            inside = True
            continue
        if inside and line and not line.startswith(" "):
            break
        if not inside:
            continue
        if re.match(r"^  \w+:\s*$", line):
            key = line.strip()[:-1]
            block[key] = {}
        elif key and (match := re.match(r"^    (\w+): (.*)$", line)):
            block[key][match.group(1)] = match.group(2)
    return block


def yaml_value(raw: str, kind: str):
    if kind == "array":
        inner = raw.strip()[1:-1].strip()
        return [part.strip() for part in inner.split(",")] if inner else []
    if kind == "boolean":
        return {"true": True, "false": False}[raw]
    if kind == "integer":
        return int(raw)
    return raw


class TestSettingsParity(unittest.TestCase):
    def test_plugin_yaml_config_schema_matches_the_code_defaults(self):
        schema = parse_schema_block((PLUGIN / "plugin.yaml").read_text())
        code = sys.modules["mg_settings"].SCHEMA
        self.assertEqual(sorted(schema), sorted(code))
        for key, (kind, default) in code.items():
            self.assertEqual(schema[key]["type"], kind, key)
            self.assertEqual(yaml_value(schema[key]["default"], kind), default, key)
            self.assertTrue(schema[key]["description"], key)

    def test_the_spec_settings_list_is_complete(self):
        spec = {"gitlab_host", "include_groups", "exclude_projects", "renovate_branch_prefix", "session_profiles", "auto_audit",
                "trivial_renovate", "trivial_require_sure", "trivial_own", "trivial_title_prefixes", "trivial_max_files",
                "trivial_allow_rebase", "trivial_never_projects", "delete_source_branch", "merge_wait_minutes", "audit_models"}
        self.assertEqual(set(sys.modules["mg_settings"].SCHEMA), spec)

    def test_spec_defaults(self):
        d = sys.modules["mg_settings"].defaults()
        self.assertEqual((d["gitlab_host"], d["renovate_branch_prefix"], d["trivial_max_files"], d["merge_wait_minutes"]),
                         ("gitlab.com", "renovate/", 10, 45))
        self.assertEqual(d["trivial_title_prefixes"], ["chore", "ci", "docs", "build"])
        self.assertEqual(d["audit_models"], ["claude-haiku-5-5", "claude-opus-5-5"])
        self.assertEqual((d["include_groups"], d["exclude_projects"], d["session_profiles"], d["trivial_never_projects"]), ([], [], [], []))
        self.assertTrue(all(d[k] for k in ("auto_audit", "trivial_renovate", "trivial_require_sure", "trivial_own", "trivial_allow_rebase", "delete_source_branch")))

    def test_defaults_are_copies(self):
        a, b = sys.modules["mg_settings"].defaults(), sys.modules["mg_settings"].defaults()
        a["include_groups"].append("x")
        self.assertEqual(b["include_groups"], [])


if __name__ == "__main__":
    unittest.main()
