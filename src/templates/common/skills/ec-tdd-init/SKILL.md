---
name: ec-tdd-init
description: Initialize or refresh Java changed-line TDD coverage infrastructure before TDD can be enabled.
---

# ec-tdd-init — Java changed-line gate initialization

Communicate in the user's language. This skill owns TDD infrastructure readiness, not historical
test-debt cleanup. It must never bulk-generate tests for existing business code, require
repository-wide coverage, or modify production behavior merely to raise coverage.

## Non-circular ordering

The only legal order is:

```text
TDD off -> initialize infrastructure -> readiness ready -> user explicitly enables TDD
```

Run this skill as a dedicated code task with `type=tdd-init`. The state API always freezes that
task with `tdd_enabled=false`, even when a legacy project/session setting or a suspended task has
TDD enabled. Never offer "enable now and initialize later". Never enable TDD automatically after
initialization.

## Read-only preflight

First run:

```bash
python3 .easy-coding/tools/easy_coding_tdd_readiness.py --cwd . check
```

If it returns `ready`, report the recorded build/CI contract and stop without creating a task.
The user may then use `ec-config` or `easy-coding config` to enable TDD.

If it returns `needs_init`, inspect only the infrastructure needed to form a confirmed plan:

- Maven/Gradle files and the existing JUnit runner;
- JaCoCo XML generation configuration;
- `.gitlab-ci.yml` and its repository-local include chain;
- TEST-stage job, JUnit/JaCoCo artifacts, and invocation of
  `.easy-coding/tools/easy_coding_java_coverage.py` with task-supplied baseline/threshold values.

Do not measure current whole-project coverage. A project with no historical business tests may
still become ready when the test runner, JaCoCo reporting, and parameterized changed-line gate
are functional.

## Initialization task

After the user confirms the exact infrastructure scope, create one task and route it through the
ordinary workflow:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py create-task \
  --task-id <safe-unique-id> --type tdd-init \
  --title "Initialize Java changed-line TDD infrastructure" \
  --agent <agent-id> --session-file <P>
```

ANALYSIS may plan build files, GitLab CI files, common scripts, and the readiness receipt. It must
state `historical coverage required: no` and `coverage scope: changed production lines since each
future task baseline`. IMPLEMENT changes infrastructure only. It must not add tests whose sole
purpose is to cover unchanged production code.

The reusable GitLab job must consume a baseline SHA and threshold supplied for the future task;
do not hardcode the initialization commit or the default 90% threshold. The same Python coverage
tool must be usable locally and remotely. This generated job is remote automation infrastructure,
not a Harness task acceptance dependency: later tasks require local unit-test and coverage
evidence only, and never wait for a pipeline URL, job identity, or remote success status.

## Readiness receipt and verification

At the end of IMPLEMENT, after the infrastructure files are stable, record their fingerprints.
The receipt is part of the implementation and must exist before QUALITY so Review/Verification
fingerprints do not change after review. The recorder automatically includes the harness-managed
`.easy-coding/tools/easy_coding_java_coverage.py` fingerprint:

```bash
python3 .easy-coding/tools/easy_coding_tdd_readiness.py --cwd . record \
  --build-file <pom.xml-or-build.gradle> [--build-file <included-build-file>]... \
  --ci-file .gitlab-ci.yml [--ci-file <repository-local-include>]... \
  --coverage-report <jacoco-xml-pattern> [--coverage-report <pattern>]... \
  --gate-command "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base \$EASY_CODING_TDD_BASE_SHA --threshold \$EASY_CODING_TDD_THRESHOLD" \
  --agent <agent-id>
```

QUALITY Review Gate includes the receipt and its declared infrastructure boundary. Its
Verification Gate runs the
frozen Workflow Mode's applicable build/test/CI syntax checks, then performs only the read-only
readiness check:

```bash
python3 .easy-coding/tools/easy_coding_tdd_readiness.py --cwd . check
```

The `QUALITY -> MEMORY` gate requires the final check to return `ready`. If any recorded
build or CI file changes after the receipt was created, readiness becomes `needs_init`; return to
IMPLEMENT, refresh the receipt, and repeat QUALITY. Rerun this skill when
the same drift occurs after task completion.

After completion, tell the user that TDD remains off and provide the explicit project/session
enable route. Do not treat readiness as consent to enable it.
