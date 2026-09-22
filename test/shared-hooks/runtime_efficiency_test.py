"""Behavior and work-count regressions for the runtime hot paths."""

from collections import Counter
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HOOKS = Path(__file__).resolve().parents[2] / "src/templates/shared-hooks"
sys.path.insert(0, str(HOOKS))
import easy_coding_inputs as inputs
import easy_coding_state as state
import easy_coding_store as store


class RuntimeEfficiencyTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        home = patch.object(Path, "home", return_value=self.root / "home")
        home.start()
        self.addCleanup(home.stop)
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "fixture")
        self.write("package.json", '{"scripts":{"test":"vitest run"}}')
        self.write("src/value.ts", "export const value = 1;\n")
        self.write("src/neighbor.ts", "export const neighbor = 1;\n")
        self.write("test/value.test.ts", "test('value', () => {});\n")
        self.write("test/other.test.ts", "test('other', () => {});\n")
        self.write("src/other.test.ts", "test('colocated', () => {});\n")
        self.write("test/helper.ts", "export const expected = 1;\n")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.task = {"status": "IMPLEMENT", "type": "feature", "workflow_mode": "fast",
                     "created_by": "codex", "last_agent": "codex"}
        self.plan = {"type": "plan", "strategy": "single", "units": [{
            "id": "U1", "title": "value", "type": "frontend", "depends_on": [],
            "files": ["src/value.ts", "test/value.test.ts"], "input_files": ["test/helper.ts"],
            "local_baseline": ["src/value.ts"], "contracts": ["same value"],
            "acceptance_criteria": ["assert value"], "risks": [],
        }]}
        self.write(".easy-coding/config.yaml", "version: 6\nbehavior:\n  approval_mode: auto\n")
        self.write("home/.easy-coding/config.yaml", "behavior:\n  workflow_mode: fast\n")
        self.write(".easy-coding/tasks/project-init/task.json", '{"status":"COMPLETE"}')
        self.write(".easy-coding/tasks/test/task.json", json.dumps(self.task))
        self.write(".easy-coding/tasks/test/execution.jsonl", json.dumps(self.plan) + "\n")
        self.session = ".easy-coding/sessions/codex-hot-path.json"
        self.write(self.session, json.dumps({"current_task": "test", "last_seen_task": "test",
                                            "last_seen_stage": "IMPLEMENT"}))
        self.check = {"type": "verify", "unit_id": "U1", "check": "value", "check_type": "test",
                      "command": "npx vitest run test/value.test.ts"}

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], stderr=subprocess.DEVNULL)

    def capture(self, check=None):
        with inputs.evidence_operation():
            return inputs.capture(inputs.input_spec(self.root, self.task, self.plan, check or self.check))

    def test_targeted_test_tracks_helpers_sources_and_config_but_not_unrelated_tests(self):
        before = self.capture()
        for name in ("test/other.test.ts", "src/other.test.ts", "test/new.test.ts"):
            self.write(name, "unrelated assertion\n")
            self.assertEqual(before, self.capture(), name)
        for name in ("test/value.test.ts", "test/helper.ts", "src/value.ts", "src/neighbor.ts", "package.json"):
            original = (self.root / name).read_text()
            self.write(name, original + "\nchanged\n")
            self.assertNotEqual(before, self.capture(), name)
            self.write(name, original)
        (self.root / "test/helper.ts").unlink()
        self.assertNotEqual(before, self.capture())

    def test_unscoped_and_compiling_commands_keep_the_full_test_inputs(self):
        for command in ("npx vitest run", "npm test", "tsc --noEmit",
                        "npx vitest run test/value.test.ts && npx vitest run",
                        "npx vitest run test/value.test.ts test/other.test.ts",
                        "npx vitest run test/value.test.ts test/",
                        "npx vitest run test/value.test.ts --typecheck"):
            with self.subTest(command=command):
                check = {**self.check, "command": command}
                before = self.capture(check)
                self.write("test/other.test.ts", command)
                self.assertNotEqual(before, self.capture(check))
                self.write("test/other.test.ts", "test('other', () => {});\n")
        self.plan["units"][0].pop("input_files")
        before = self.capture()
        self.write("test/other.test.ts", "without a declared closure\n")
        self.assertNotEqual(before, self.capture())

    def test_hook_imports_do_not_load_workflow_or_spec_and_disabled_hook_does_not_load_store(self):
        code = "import easy_coding_status, sys; print('\n'.join(sorted(sys.modules)))".replace("'\n'", "'\\n'")
        modules = subprocess.check_output([sys.executable, "-B", "-c", code],
                                         env={**os.environ, "PYTHONPATH": str(HOOKS)}, text=True).splitlines()
        self.assertNotIn("easy_coding_state", modules)
        self.assertFalse(any(name.startswith("easy_dev_spec") for name in modules))
        code = "import runpy,sys; runpy.run_path(sys.argv[1],run_name='hook')['main'](); assert 'easy_coding_store' not in sys.modules"
        for name in ("session-start.py", "inject-workflow-state.py", "inject-subagent-context.py"):
            subprocess.check_call([sys.executable, "-B", "-c", code, str(HOOKS / name)],
                                  env={**os.environ, "PYTHONPATH": str(HOOKS), "EC_HOOKS": "0"})

    def test_hook_reads_each_configuration_task_and_long_log_once_for_all_modes(self):
        original_read = Path.read_text
        log = self.root / ".easy-coding/tasks/test/execution.jsonl"
        log.write_text(log.read_text() + (json.dumps({"type": "note", "text": "x" * 2000}) + "\n") * 1000)
        for mode in ("none", "ut", "tdd"):
            self.write(".easy-coding/tasks/test/task.json", json.dumps({**self.task, "unit_test_mode": mode}))
            reads = Counter()
            def tracked(path, *args, **kwargs):
                reads[str(path)] += 1
                return original_read(path, *args, **kwargs)
            payload = io.StringIO(json.dumps({"cwd": str(self.root), "session_id": "hot-path"}))
            output = io.StringIO()
            with patch.object(Path, "read_text", tracked), patch.object(sys, "stdin", payload), \
                 patch.object(sys, "argv", [str(self.root / ".codex/hooks/inject-workflow-state.py")]), \
                 patch.object(sys, "stdout", output), patch.dict(os.environ, {"CODEX_THREAD_ID": "hot-path", "EC_HOOKS": "1"}):
                hook = runpy.run_path(str(HOOKS / "inject-workflow-state.py"))
                self.assertEqual(0, hook["main"]())
            context = json.loads(output.getvalue())["hookSpecificOutput"]["additionalContext"]
            self.assertIn("[workflow-state:IMPLEMENT]", context)
            for name in (".easy-coding/config.yaml", "home/.easy-coding/config.yaml",
                         ".easy-coding/tasks/test/task.json", ".easy-coding/tasks/project-init/task.json",
                         ".easy-coding/tasks/test/execution.jsonl", self.session):
                self.assertEqual(1, reads[str(self.root / name)], (mode, name, reads))

    def test_hook_operation_preserves_migrated_pid_session(self):
        (self.root / self.session).unlink()
        legacy = ".easy-coding/sessions/4242.json"
        self.write(legacy, json.dumps({"current_task": "test", "approval_mode": "confirm",
                                      "created_at": store.now_iso()}))
        with inputs.evidence_operation():
            session, path = store.ensure_hook_session(self.root, {"session_id": "hot-path"}, "codex", 4242)
        self.assertEqual("test", session["current_task"])
        self.assertEqual("confirm", session["approval_mode"])
        self.assertEqual(self.root / self.session, path)
        self.assertFalse((self.root / legacy).exists())
        self.assertEqual(session, json.loads(path.read_text()))

    def test_all_explicit_test_selectors_are_included(self):
        self.plan["units"][0]["input_files"].append("test/other.test.ts")
        check = {**self.check, "command": "npx vitest run test/value.test.ts test/other.test.ts"}
        before = self.capture(check)
        self.write("test/other.test.ts", "changed second selector\n")
        self.assertNotEqual(before, self.capture(check))

    def test_acceptance_checks_assume_unchanged_and_skip_worktree_content(self):
        for flag in ("assume-unchanged", "skip-worktree"):
            with self.subTest(flag=flag):
                baseline = state.acceptance_repository_entries(self.root, [self.root])
                previous = {entry["path"]: entry for entry in baseline}
                self.git("update-index", "--" + flag, "src/neighbor.ts")
                self.write("src/neighbor.ts", flag + " changed outside the unit\n")
                self.assertNotIn(b"src/neighbor.ts", self.git("diff-files", "--name-only"))
                current = {entry["path"]: entry for entry in state.acceptance_repository_entries(self.root, [self.root], previous)}
                self.assertNotEqual(previous["src/neighbor.ts"]["sha256"], current["src/neighbor.ts"]["sha256"])
                self.assertEqual((self.root / "src/neighbor.ts").read_bytes(),
                                 state.snapshot_entry_content(self.root, current["src/neighbor.ts"]))
                self.git("update-index", "--no-" + flag, "src/neighbor.ts")
                self.write("src/neighbor.ts", "export const neighbor = 1;\n")

    def test_json_cache_sees_own_writes_and_expires_at_operation_end(self):
        path = self.root / "value.json"
        self.write("value.json", '{"value":1}')
        with inputs.evidence_operation():
            self.assertEqual(1, store.load_json(path)["value"])
            store.write_json(path, {"value": 2})
            self.assertEqual(2, store.load_json(path)["value"])
        self.write("value.json", '{"value":3}')
        with inputs.evidence_operation():
            self.assertEqual(3, store.load_json(path)["value"])

    def test_acceptance_reuses_clean_objects_and_preserves_staging_delete_rename_and_symlink_drift(self):
        baseline = state.acceptance_repository_entries(self.root, [self.root])
        previous = {e["path"]: e for e in baseline}
        original = Path.read_bytes
        reads = []
        def tracked(path):
            reads.append(path.relative_to(self.root).as_posix())
            return original(path)
        # Runtime files are excluded; the local config fixture is untracked and read separately.
        with patch.object(Path, "read_bytes", tracked):
            current = state.acceptance_repository_entries(self.root, [self.root], previous)
        self.assertEqual(baseline, current)
        self.assertFalse(set(reads) & set(self.git("ls-files").decode().splitlines()))
        self.write("src/value.ts", "export const value = 2;\n")
        changed = {e["path"]: e for e in state.acceptance_repository_entries(self.root, [self.root], previous)}
        self.assertNotEqual(previous["src/value.ts"]["sha256"], changed["src/value.ts"]["sha256"])
        self.git("add", "src/value.ts")
        staged = {e["path"]: e for e in state.acceptance_repository_entries(self.root, [self.root], changed)}
        self.assertEqual(changed["src/value.ts"]["sha256"], staged["src/value.ts"]["sha256"])
        (self.root / "src/value.ts").rename(self.root / "src/renamed.ts")
        os.symlink("neighbor.ts", self.root / "src/link.ts")
        renamed = {e["path"]: e for e in state.acceptance_repository_entries(self.root, [self.root], staged)}
        self.assertFalse(renamed["src/value.ts"]["exists"])
        self.assertTrue(renamed["src/renamed.ts"]["exists"])
        self.assertEqual("120000", renamed["src/link.ts"]["mode"])

    def test_automatic_acceptance_consumes_the_single_fresh_drift_result(self):
        self.task["status"] = "QUALITY"
        state.write_task(self.root, "test", self.task)
        baseline = state.build_acceptance_snapshot(self.root, "test", self.task)
        self.task["quality_checkpoint"] = {key: baseline[key] for key in (
            "implementation_fingerprint", "config_fingerprint", "contract_fingerprint")}
        state.write_task(self.root, "test", self.task)
        with patch.object(state, "ensure_verification_checkpoint", return_value=self.task), \
             patch.object(state, "load_acceptance_snapshot", return_value=baseline), \
             patch.object(state, "inspect_acceptance_drift", wraps=state.inspect_acceptance_drift) as drift, \
             patch.object(state, "apply_transition", return_value={"status": "MEMORY"}):
            result = state.auto_transition(self.root, "MEMORY", "codex", "test", self.session)
        self.assertEqual("MEMORY", result["status"])
        self.assertEqual(1, drift.call_count)
        self.assertEqual("acceptance", state.execution_records(self.root, "test")[-1]["type"])


if __name__ == "__main__":
    unittest.main()
