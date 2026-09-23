import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src/templates/shared-hooks"))
import easy_coding_inputs as inputs
import easy_coding_state as state
import easy_coding_store as store


class ScopedEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        home_patch = patch.object(Path, "home", return_value=self.home)
        home_patch.start()
        self.addCleanup(home_patch.stop)
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "fixture")
        self.write("pom.xml", "<project><artifactId>root</artifactId><modules><module>a</module><module>b</module></modules></project>")
        for module in ("a", "b"):
            self.write(f"{module}/pom.xml", f"<project><artifactId>{module}</artifactId></project>")
            self.write(f"{module}/src/main/java/Value.java", "class Value {}")
            self.write(f"{module}/src/test/java/FirstTest.java", "class FirstTest {}")
            self.write(f"{module}/src/test/java/SecondTest.java", "class SecondTest {}")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        self.plan = {"type": "plan", "strategy": "sequential", "units": [
            {"id": m, "title": m, "type": "backend", "depends_on": [],
             "files": [f"{m}/src/main/java/Value.java", f"{m}/src/test/java/FirstTest.java", f"{m}/src/test/java/SecondTest.java"],
             "local_baseline": ["existing implementation"], "contracts": ["same result"],
             "acceptance_criteria": ["correct value"], "risks": []} for m in ("a", "b")
        ]}
        self.task = {"type": "feature", "title": "fixture", "status": "IMPLEMENT", "workflow_mode": "strict",
                     "stage_history": [], "created_by": "codex", "last_agent": "codex"}
        self.write(".easy-coding/tasks/test/task.json", json.dumps(self.task))
        self.write(".easy-coding/tasks/test/execution.jsonl", json.dumps(self.plan)+"\n")
        self.write(".easy-coding/sessions/test.json", json.dumps({"current_task": "test"}))
        self.check = {"type": "verify", "unit_id": "a", "check": "first", "check_type": "test",
                      "command": "mvn -pl a -Dtest=FirstTest test"}

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], stderr=subprocess.DEVNULL)

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def snapshot(self, check=None):
        with inputs.evidence_operation():
            return inputs.capture(inputs.input_spec(self.root, self.task, self.plan, check or self.check))

    def quality_repair(self, approval="guard", cooperate="default"):
        self.task.update(status="QUALITY", workflow_mode="fast")
        self.write(".easy-coding/tasks/test/task.json", json.dumps(self.task))
        self.write(".easy-coding/sessions/test.json", json.dumps({
            "current_task": "test", "approval_mode": approval, "cooperate_mode": cooperate}))
        return state.begin_correction(self.root, "test", self.task,
                                      ["a/src/main/java/Value.java"], "Restore the accepted result", [], "codex")["quality_repair"]

    def test_behavior_layers_override_each_field_without_creating_local_file(self):
        self.write(".easy-coding/config.yaml", "version: 6\nbehavior:\n  approval_mode: approve\n  cooperate_mode: dispatch\n  unit_test_mode: tdd\n  ut_coverage_threshold: 92\n")
        self.assertEqual("project", state.behavior_layers(self.root, {})["cooperate_mode"]["source"])
        self.assertFalse(self.home.exists())
        self.write("home/.easy-coding/config.yaml", "behavior:\n  approval_mode: auto\n  unit_test_mode: ut\n  ut_coverage_threshold: 95\n")
        session = {"cooperate_mode": "default", "unit_test_mode": "none"}
        self.assertEqual({
            "approval_mode": {"value": "auto", "source": "local"},
            "cooperate_mode": {"value": "default", "source": "session"},
            "unit_test_mode": {"value": "none", "source": "session"},
            "ut_coverage_threshold": {"value": 95, "source": "local"},
        }, state.behavior_layers(self.root, session))
        behavior = state.resolve_behavior(self.root, session)
        self.assertEqual(("auto", "none", 95), (behavior[2], behavior[8], behavior[11]))

    def test_unsupported_local_yaml_is_explicit_instead_of_silently_ignored(self):
        self.write("home/.easy-coding/config.yaml", "behavior: { cooperate_mode: dispatch }\n")
        with self.assertRaisesRegex(state.StateError, "indented YAML mapping"):
            state.behavior_layers(self.root, {})

    def test_incomplete_canonical_repair_bundle_is_rejected_before_authorization(self):
        repair = self.quality_repair()
        task = state.load_task(self.root, "test")
        task["spec_source"] = {"spec_id": "fixture"}
        self.write(".easy-coding/tasks/test/task.json", json.dumps(task))
        with patch.object(state, "require_spec_context"), patch.object(state, "implementation_fingerprint", return_value=repair["implementation_fingerprint"]), patch.object(state, "latest_execution_plan", return_value=self.plan), patch.object(state, "prepare_canonical_repair_transition", return_value=(task, {"R1-T1", "R2-T1"})):
            with self.assertRaisesRegex(state.StateError, "cover all failed Canonical source tasks"):
                state.start_quality_repair(self.root, repair["repair_id"], "current", True, "codex", "test", ".easy-coding/sessions/test.json")
        self.assertNotIn("approved_at", state.load_task(self.root, "test")["quality_repair"])
        self.assertEqual("QUALITY", state.load_task(self.root, "test")["status"])

    def test_dispatch_repair_confirms_once_and_returns_to_coordinator_in_quality(self):
        for approval in ("approve", "guard", "confirm", "auto"):
            with self.subTest(approval=approval):
                repair = self.quality_repair(approval, "dispatch")
                args = (self.root, repair["repair_id"], "other", False, "codex", "test", ".easy-coding/sessions/test.json")
                with self.assertRaisesRegex(state.StateError, "scope and executor once"):
                    state.start_quality_repair(*args)
                dispatched = state.start_quality_repair(*args[:3], True, *args[4:])
                self.assertEqual("repair", dispatched["handoff"]["next_action"])
                self.assertEqual("QUALITY", dispatched["handoff"]["stage"])
                self.assertEqual(
                    f'Use ec-workflow in project "{self.root.resolve()}" to claim task "test" '
                    "and continue from the existing handoff.",
                    dispatched["handoff_prompt"],
                )
                # 已授权接力不因接手方的默认模式不同而再次审批。
                claimed = state.claim_task(self.root, "test", "qoder", ".easy-coding/sessions/worker.json")
                self.assertEqual("repair", claimed["continuation"]["next_action"])
                count = len(state.execution_records(self.root, "test"))
                state.start_quality_repair(self.root, repair["repair_id"], "other", False, "qoder",
                                           "test", ".easy-coding/sessions/worker.json")
                self.assertFalse(state.claim_task(self.root, "test", "qoder", ".easy-coding/sessions/worker.json")["claim_recorded"])
                self.assertEqual(count, len(state.execution_records(self.root, "test")))
                self.write("a/src/main/java/Value.java", f"class Value {{ int repair{approval}; }}")
                task = state.load_task(self.root, "test")
                prepared = state.prepare_check(self.root, "test", task, self.check, "qoder")
                state.record_check(self.root, "test", task, prepared["prepared_id"], {"passed": True, "exit_code": 0}, "qoder")
                completed = state.complete_quality_repair(self.root, repair["repair_id"], "qoder", "test", ".easy-coding/sessions/worker.json")
                self.assertEqual("quality", completed["handoff"]["next_action"])
                self.assertEqual(
                    f'Use ec-workflow in project "{self.root.resolve()}" to resume task "test" '
                    "and continue review and verification.",
                    completed["handoff_prompt"],
                )
                returned = state.claim_task(self.root, "test", "codex", ".easy-coding/sessions/test.json")
                self.assertEqual("QUALITY", returned["status"])
                self.assertEqual([], returned["task"]["stage_history"])
                self.assertTrue(state.prepare_check(self.root, "test", returned["task"], self.check, "codex")["reusable"])

    def test_default_direct_repair_reuses_unaffected_evidence_and_rejects_scope_expansion(self):
        other = {**self.check, "unit_id": "b", "command": "mvn -pl b test"}
        prepared = state.prepare_check(self.root, "test", self.task, other, "codex")
        state.record_check(self.root, "test", self.task, prepared["prepared_id"], {"passed": True, "exit_code": 0}, "codex")
        repair = self.quality_repair()
        with self.assertRaisesRegex(state.StateError, "requires cooperate_mode dispatch"):
            state.start_quality_repair(self.root, repair["repair_id"], "other", True, "codex", "test", ".easy-coding/sessions/test.json")
        state.start_quality_repair(self.root, repair["repair_id"], "current", False, "codex", "test", ".easy-coding/sessions/test.json")
        self.write("b/src/main/java/Value.java", "class Value { int outOfScope; }")
        with self.assertRaisesRegex(state.StateError, "outside the approved bundle"):
            state.complete_quality_repair(self.root, repair["repair_id"], "codex", "test", ".easy-coding/sessions/test.json")
        self.write("b/src/main/java/Value.java", "class Value {}")
        self.write("a/src/main/java/Value.java", "class Value { int fixed; }")
        completed = state.complete_quality_repair(self.root, repair["repair_id"], "codex", "test", ".easy-coding/sessions/test.json")
        self.assertEqual("QUALITY", completed["status"])
        self.assertTrue(state.prepare_check(self.root, "test", completed["task"], other, "codex")["reusable"])
        context = state.ensure_quality_attempt_context(self.root, "test", completed["task"], "codex", persist=True)
        self.assertGreater(context["attempt"], 0)
        self.assertNotIn("continuation", state.load_task(self.root, "test"))

    def test_renaming_or_argv_formatting_reuses_pass_but_command_changes_do_not(self):
        prepared = state.prepare_check(self.root, "test", self.task, self.check, "codex")
        state.record_check(self.root, "test", self.task, prepared["prepared_id"], {"passed": True, "exit_code": 0}, "codex")
        renamed = {**self.check, "check": "more descriptive label", "command": 'mvn  -pl "a" -Dtest=FirstTest test'}
        self.assertTrue(state.prepare_check(self.root, "test", self.task, renamed, "codex")["reusable"])
        changed = {**renamed, "command": "mvn -pl a -DskipTests test"}
        self.assertFalse(state.prepare_check(self.root, "test", self.task, changed, "codex")["reusable"])
        self.assertNotEqual(inputs.command_identity('echo "$VALUE"'), inputs.command_identity("echo '$VALUE'"))
        state.record_check(self.root, "test", self.task, prepared["prepared_id"], {"passed": False, "exit_code": 1}, "codex")
        self.assertFalse(state.prepare_check(self.root, "test", self.task, renamed, "codex")["reusable"])

    def test_renamed_successful_retry_clears_the_same_commands_failed_gate(self):
        self.task.update(status="QUALITY", workflow_mode="fast")
        self.write(".easy-coding/tasks/test/task.json", json.dumps(self.task))
        descriptors = [
            ({"type": "review", "dimension": "correctness"}, {"passed": True, "reviewer": "codex", "findings": []}),
            ({"type": "verify", "check": "old label", "check_type": "test", "command": "mvn test"},
             {"passed": False, "exit_code": 1, "failure_classes": ["environment"]}),
            ({"type": "verify", "check": "new label", "check_type": "test", "command": "mvn  test"},
             {"passed": True, "exit_code": 0}),
        ]
        for descriptor, result in descriptors:
            task = state.load_task(self.root, "test")
            prepared = state.prepare_check(self.root, "test", task, descriptor, "codex")
            state.record_check(self.root, "test", task, prepared["prepared_id"], result, "codex")
        task = state.load_task(self.root, "test")
        state.validate_verification_readiness(self.root, "test", task)
        self.assertEqual("passed", state.finalize_quality_attempt(self.root, "test", task, "passed", "codex")["outcome"])

    def test_operation_shares_log_plan_and_snapshot_and_sees_appends(self):
        with inputs.evidence_operation(), patch.object(store, "_execution_records", wraps=store._execution_records) as reads, patch.object(state, "_latest_execution_plan", wraps=state._latest_execution_plan) as plans:
            state.latest_execution_plan(self.root, "test")
            state.latest_execution_plan(self.root, "test")
            state.latest_handoff_record(self.root, "test")
            state.pending_handoff_record(self.root, "test")
            state.append_execution_record(self.root, "test", {"type": "handoff", "summary": "reuse"})
            self.assertEqual("reuse", state.latest_handoff_record(self.root, "test")["summary"])
            self.assertEqual(1, reads.call_count)
            self.assertEqual(1, plans.call_count)
            state.append_execution_record(self.root, "test", self.plan)
            state.latest_execution_plan(self.root, "test")
            self.assertEqual(2, plans.call_count)
        snapshot = state.snapshot_state(self.root, ".easy-coding/sessions/test.json")
        with patch.object(state, "snapshot_state", side_effect=AssertionError("duplicate snapshot")):
            state.attach_status_context(self.root, snapshot, "codex", ".easy-coding/sessions/test.json")

    def test_cli_batches_checks_and_reuses_existing_evidence(self):
        def cli(command, option, payload):
            result = subprocess.check_output([sys.executable, "-B", str(Path(state.__file__)), command,
                option, json.dumps(payload), "--cwd", str(self.root), "--agent", "codex",
                "--session-file", ".easy-coding/sessions/test.json"],
                env={**os.environ, "HOME": str(self.home)}, text=True)
            return json.loads(result)
        descriptors = [self.check, {**self.check, "unit_id": "b", "command": "mvn -pl b test"},
                       {"type": "review", "unit_id": "a", "dimension": "correctness"},
                       {"type": "review", "unit_id": "b", "dimension": "correctness"}]
        prepared = cli("prepare-check", "--record", descriptors)
        self.assertEqual(4, len(prepared))
        self.assertTrue(all(item["stage"] == "IMPLEMENT" and item["next_action"] == "run-check" for item in prepared))
        recorded = cli("record-check", "--result", [{"prepared_id": item["prepared_id"],
            "result": {"passed": True, "exit_code": 0, "reviewer": "codex", "findings": []}} for item in prepared])
        self.assertTrue(all(item["recorded"] for item in recorded))
        self.assertTrue(all(item["reusable"] for item in cli("prepare-check", "--record", descriptors)))

    def test_test_change_invalidates_compiling_module_but_preserves_production_review(self):
        test = self.snapshot()
        review = {"type": "review", "unit_id": "a", "dimension": "correctness", "review_scope": "production"}
        production = self.snapshot(review)
        self.write("a/src/test/java/SecondTest.java", "class SecondTest { int assertion = 2; }")
        self.assertNotEqual(test, self.snapshot())
        self.assertEqual(production, self.snapshot(review))
        self.write("a/src/test/java/FirstTest.java", "class FirstTest { int assertion = 2; }")
        self.assertNotEqual(test, self.snapshot())
        self.assertEqual(production, self.snapshot(review))

    def test_explicit_review_inputs_stay_local_but_maven_includes_compile_dependencies(self):
        self.plan["units"][0]["input_files"] = []
        review = {"type": "review", "unit_id": "a", "dimension": "correctness"}
        before = self.snapshot(review)
        verification = self.snapshot()
        self.write("a/src/main/java/Neighbor.java", "class Neighbor {}")
        self.assertEqual(before, self.snapshot(review))
        self.assertNotEqual(verification, self.snapshot())

    def test_environment_prefixed_maven_still_tracks_compilation_inputs(self):
        self.plan["units"][0]["input_files"] = []
        for prefix in ("JAVA_HOME=/example ", "env JAVA_HOME=/example "):
            with self.subTest(prefix=prefix):
                check = {**self.check, "command": prefix + self.check["command"]}
                before = self.snapshot(check)
                self.write("a/src/main/java/Neighbor.java", prefix)
                self.assertNotEqual(before, self.snapshot(check))
                (self.root / "a/src/main/java/Neighbor.java").unlink()

    def test_reactor_command_includes_other_modules(self):
        check = {**self.check, "command": "mvn test"}
        before = self.snapshot(check)
        self.write("b/src/main/java/Value.java", "class Value { int changed; }")
        self.assertNotEqual(before, self.snapshot(check))

    def test_shared_source_and_build_configuration_invalidate_only_consumers(self):
        first = self.snapshot()
        self.write("b/src/main/java/Value.java", "class Value { int changed; }")
        self.assertEqual(first, self.snapshot())
        self.write("a/pom.xml", "<project><artifactId>a</artifactId><dependencies><dependency><artifactId>b</artifactId></dependency></dependencies></project>")
        dependency = self.snapshot()
        self.write("b/src/main/java/Value.java", "class Value { int changedAgain; }")
        self.assertNotEqual(dependency, self.snapshot())

    def test_new_deleted_and_staged_inputs_are_detected_without_staging_invalidation(self):
        before = self.snapshot()
        self.write("a/src/main/java/New.java", "class New {}")
        changed = self.snapshot()
        self.assertNotEqual(before, changed)
        self.git("add", "a/src/main/java/New.java")
        self.assertEqual(changed, self.snapshot())
        (self.root / "a/src/main/java/New.java").unlink()
        self.assertNotEqual(changed, self.snapshot())

    def test_operation_reads_git_metadata_once_and_hashes_changed_inputs_once(self):
        self.write("a/src/main/java/Value.java", "class Value { int changed; }")
        with patch.object(inputs, "git", wraps=inputs.git) as calls, inputs.evidence_operation():
            inputs.capture(inputs.input_spec(self.root, self.task, self.plan, self.check))
            inputs.capture(inputs.input_spec(self.root, self.task, self.plan, self.check))
        self.assertEqual(1, sum(c.args[1:3] == ("ls-files", "--stage") for c in calls.call_args_list))
        self.assertEqual(1, sum(c.args[1] == "hash-object" for c in calls.call_args_list))

    def test_prepare_reuses_success_and_record_rejects_changes_during_execution(self):
        prepared = state.prepare_check(self.root, "test", self.task, self.check, "codex")
        state.record_check(self.root, "test", self.task, prepared["prepared_id"], {"passed": True, "exit_code": 0}, "codex")
        self.assertTrue(state.prepare_check(self.root, "test", self.task, self.check, "codex")["reusable"])
        self.write("a/src/main/java/Value.java", "class Value { int changed; }")
        with self.assertRaisesRegex(state.StateError, "inputs changed"):
            state.record_check(self.root, "test", self.task, prepared["prepared_id"], {"passed": True, "exit_code": 0}, "codex")

    def test_failed_latest_result_cannot_be_hidden_by_old_pass(self):
        prepared = state.prepare_check(self.root, "test", self.task, self.check, "codex")
        for passed in (True, False):
            state.record_check(self.root, "test", self.task, prepared["prepared_id"], {"passed": passed, "exit_code": 0 if passed else 1}, "codex")
        self.assertFalse(state.prepare_check(self.root, "test", self.task, self.check, "codex")["reusable"])

    def test_phase_plan_description_and_approval_do_not_invalidate_inputs(self):
        original = self.snapshot()
        self.task.update(status="QUALITY", workflow_mode="fast", spec_source={"revision": 900})
        self.plan["units"][0]["title"] = "reworded"
        self.write(".easy-coding/config.yaml", "behavior:\n  approval_mode: auto\n")
        self.assertEqual(original, self.snapshot())
        self.plan["units"][0]["contracts"] = ["changed contract"]
        self.assertEqual(original, self.snapshot())

    def test_review_contract_changes_invalidate_review_but_not_test_results(self):
        review = {"type": "review", "unit_id": "a", "dimension": "correctness"}
        before = self.snapshot(review)
        self.plan["units"][0]["acceptance_criteria"] = ["new expected value"]
        self.assertNotEqual(before, self.snapshot(review))

    def test_relative_repository_binding_resolves_from_project_not_process_directory(self):
        before = self.snapshot()
        self.task["repo_paths"] = {"current": "."}
        self.assertEqual(before, self.snapshot())

    def test_environment_changes_invalidate_verification(self):
        before = self.snapshot()
        with patch.dict(os.environ, {"JAVA_HOME": "/changed-jdk"}):
            self.assertNotEqual(before, self.snapshot())

    def test_grouped_maven_command_covers_selectors_but_not_different_flags(self):
        self.assertTrue(inputs.command_covers("mvn -Dtest=FirstTest,SecondTest test", "mvn -Dtest=FirstTest test"))
        self.assertFalse(inputs.command_covers("mvn -DskipTests -Dtest=FirstTest test", "mvn -Dtest=FirstTest test"))

    def test_mechanical_minimum_overrides_old_strict_and_correction_preserves_plan(self):
        proposal = state.validate_workflow_mode_proposal(self.root, {}, {"selected_mode": "strict"}, "test")
        self.assertEqual("fast", proposal["selected_mode"])
        before = (self.root / ".easy-coding/tasks/test/execution.jsonl").read_text()
        result = state.begin_correction(self.root, "test", self.task, ["a/src/main/java/Value.java"], "restore existing behavior", [], "codex")
        self.assertEqual("fast", result["workflow_mode"])
        self.assertEqual(["a"], result["correction"]["unit_ids"])
        self.assertTrue((self.root / ".easy-coding/tasks/test/execution.jsonl").read_text().startswith(before))

    def test_status_does_not_calculate_content_signatures(self):
        with patch.object(state, "implementation_fingerprint", side_effect=AssertionError("content hashing on status")):
            snapshot = state.snapshot_state(self.root, ".easy-coding/sessions/test.json")
        self.assertEqual("test", snapshot["current_task"])

    def test_unit_test_migration_preserves_frozen_settings_and_existing_fingerprints(self):
        for enabled in (False, True):
            with self.subTest(enabled=enabled):
                contract = {"tdd_enabled": enabled, "tdd_coverage_threshold": 93,
                            "tdd_baselines": {"project": self.git("rev-parse", "HEAD").decode().strip()}}
                task = {**self.task, **contract, "quality_checkpoint": {"accepted": True}}
                expected = state.digest(contract)
                self.assertTrue(state.migrate_unit_test_settings(task))
                self.assertEqual("tdd" if enabled else "none", task["unit_test_mode"])
                self.assertEqual(93, task["ut_coverage_threshold"])
                self.assertEqual(expected, state.behavior_config_fingerprint(self.root, task))
                self.assertEqual({"accepted": True}, task["quality_checkpoint"])
                self.assertFalse(state.migrate_unit_test_settings(task))
        inherited = {"current_task": "test"}
        self.assertFalse(state.migrate_unit_test_settings(inherited))
        self.assertNotIn("unit_test_mode", inherited)

    def test_ut_compact_analysis_freezes_baseline_without_tdd_process_artifacts(self):
        self.task.update(status="ANALYSIS", workflow_mode="fast")
        self.write(".easy-coding/tasks/test/task.json", json.dumps(self.task))
        self.write(".easy-coding/tasks/test/dev-spec.md", "<!-- easy-coding:compact -->\ndecision_status: closed\n")
        session = {"unit_test_mode": "ut", "ut_coverage_threshold": 93}
        with patch.object(state, "require_tdd_readiness"):
            state.validate_analysis_readiness(self.root, "test", session)
            state.freeze_unit_test_mode(self.root, session, "test", self.task, "codex")
        self.assertEqual("ut", self.task["unit_test_mode"])
        self.assertEqual(93, self.task["ut_coverage_threshold"])
        self.assertEqual({"project": self.git("rev-parse", "HEAD").decode().strip()}, self.task["tdd_baselines"])
        self.assertEqual("fast", state.calculate_workflow_floor(self.root, "test")[0])
        self.assertFalse((self.root / ".easy-coding/tasks/test/test-strategy.md").exists())

    def test_unit_failure_is_not_hidden_by_another_units_pass(self):
        fingerprints = state.evidence_fingerprints(self.root, "test")
        common = {**fingerprints, "quality_attempt": 1, "timestamp": state.now_iso(),
                  "reviewer": "codex", "findings": []}
        reviews = [{**common, "type": "review", "unit_id": unit,
                    "dimension": "correctness", "passed": unit == "b"} for unit in ("a", "b")]
        checks = [{**common, "type": "verify", "unit_id": unit, "check": "tests",
                   "check_type": "test", "command": "mvn test", "passed": unit == "b"}
                  for unit in ("a", "b")]
        self.task["workflow_mode"] = "fast"
        for record in [*reviews, *checks]:
            state.append_execution_record(self.root, "test", record)
        with self.assertRaisesRegex(state.StateError, "not passed"):
            state.validate_review_readiness(self.root, "test", self.task, reviews)
        with self.assertRaisesRegex(state.StateError, "contains failures"):
            state.validate_verification_readiness(self.root, "test", self.task, False, checks)
        failures = state.quality_repair_failures_for_window(self.root, "test", self.task, 0, 5, 1,
                                                          fingerprints["implementation_fingerprint"],
                                                          fingerprints["config_fingerprint"])
        self.assertEqual(["review:correctness:unit=a", "verify:tests:unit=a"], failures["test"])
        with self.assertRaisesRegex(state.StateError, "Unit a"):
            state.validate_review_readiness(self.root, "test", self.task, reviews[1:])

    def test_unit_failure_classification_can_finalize_repair(self):
        self.task.update(status="QUALITY", workflow_mode="fast")
        self.write(".easy-coding/tasks/test/task.json", json.dumps(self.task))
        for unit in ("a", "b"):
            prepared = state.prepare_check(self.root, "test", self.task, {**self.check, "unit_id": unit}, "codex")
            result = {"passed": unit == "b", "exit_code": 0 if unit == "b" else 1}
            if unit == "a":
                result["failure_classes"] = ["code-defect"]
            state.record_check(self.root, "test", self.task, prepared["prepared_id"], result, "codex")
        finalized = state.finalize_quality_attempt(self.root, "test", state.load_task(self.root, "test"),
                                                  "repair", "codex", "cancelled", "failed", ["code-defect"])
        self.assertEqual("repair", finalized["outcome"])

    def test_prepared_implementation_checks_reach_final_quality_gate(self):
        self.task.update(status="QUALITY", workflow_mode="fast")
        self.write(".easy-coding/tasks/test/task.json", json.dumps(self.task))
        for unit in ("a", "b"):
            for descriptor, result in (
                ({"type": "review", "unit_id": unit, "dimension": "correctness"},
                 {"passed": True, "reviewer": "codex", "findings": []}),
                ({**self.check, "unit_id": unit}, {"passed": True, "exit_code": 0}),
            ):
                prepared = state.prepare_check(self.root, "test", self.task, descriptor, "codex")
                state.record_check(self.root, "test", self.task, prepared["prepared_id"], result, "codex")
        task = state.load_task(self.root, "test")
        state.validate_review_readiness(self.root, "test", task)
        state.validate_verification_readiness(self.root, "test", task)
        state.finalize_quality_attempt(self.root, "test", task, "passed", "codex")

    def test_implementation_evidence_carries_to_quality_with_provenance(self):
        prepared = state.prepare_check(self.root, "test", self.task, self.check, "codex")
        state.record_check(self.root, "test", self.task, prepared["prepared_id"], {"passed": True, "exit_code": 0}, "codex")
        self.write("b/src/main/java/Value.java", "class Value { int unrelated; }")
        context = {**state.evidence_fingerprints(self.root, "test"), "attempt": 1}
        state.carry_forward_scoped_evidence(self.root, "test", self.task, context)
        last = state.execution_records(self.root, "test")[-1]
        self.assertEqual(1, last["quality_attempt"])
        self.assertIn("reused_from", last)
        self.assertEqual(prepared["input_signature"], last["inputs"]["signature"])


if __name__ == "__main__":
    unittest.main()
