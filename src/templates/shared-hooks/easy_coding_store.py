"""Shared session/configuration storage; safe to import from prompt hooks."""

import hashlib
import json
import os
import re
import shlex
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from easy_coding_operation import memo, invalidate_memo


TERMINAL_STATUSES = {"COMPLETE", "CLOSED"}
HELP_SUFFIX = (
    "Use `ec-workflow` to start or resume a task, "
    "`ec-brainstorming` to brainstorm, `ec-task-management` to manage tasks, "
    "or `ec-config` to inspect or change modes"
)
READY_LINE = f"Ready · {HELP_SUFFIX}"
WAITING_INIT_LINE = "Waiting init · Use `ec-init` to initialize"
MANDATORY_DEV_SPEC_HEADERS: list[str] = [
    "## 技术方案",
    "### 项目模式",
    "### 任务类型",
    "### 需求解析",
    "### 现状",
    "### 冲突摘要",
    "### 决策闭环",
    "### 影响面分析",
    "### 改动范围",
    "### 修改方案",
    "### 实施拆解",
    "### 测试策略",
    "### Workflow Mode",
    "### 风险与注意事项",
]
VALID_TRANSITIONS: dict[str, set[str]] = {
    "idle": {"INIT"},
    "INIT": {"ANALYSIS", "CLOSED"},
    "ANALYSIS": {"IMPLEMENT", "CLOSED"},
    "IMPLEMENT": {"QUALITY", "ANALYSIS", "CLOSED"},
    "QUALITY": {"MEMORY", "IMPLEMENT", "ANALYSIS", "CLOSED"},
    "MEMORY": {"COMPLETE", "CLOSED"},
    "COMPLETE": set(),
    "CLOSED": set(),
}
ALWAYS_AUTO_TRANSITIONS = {
    ("INIT", "ANALYSIS"),
    ("MEMORY", "COMPLETE"),
}
TDD_INIT_TASK_TYPE = "tdd-init"
APPROVAL_MODES = {"approve", "guard", "confirm", "auto"}
CONFIGURED_WORKFLOW_MODES = {"adaptive", "fast", "standard", "strict"}
DEFAULT_APPROVAL_MODE = "guard"
DEFAULT_WORKFLOW_MODE = "adaptive"
DEFAULT_UNIT_TEST_MODE = "none"
DEFAULT_UT_COVERAGE_THRESHOLD = 90
TDD_READINESS_SCHEMA = "easy-coding/tdd-readiness-v1"
TDD_READINESS_SCOPE = "changed-production-lines"
TDD_READINESS_PATH = Path(".easy-coding/tdd/readiness.json")
TDD_BASE_VARIABLE = "EASY_CODING_TDD_BASE_SHA"
TDD_THRESHOLD_VARIABLE = "EASY_CODING_TDD_THRESHOLD"
COVERAGE_TOOL_PATH = ".easy-coding/tools/easy_coding_java_coverage.py"
JAVA_BUILD_FILE_NAMES = {"pom.xml", "build.gradle", "build.gradle.kts"}
GITLAB_CI_ENTRY_FILES = {".gitlab-ci.yml", ".gitlab-ci.yaml"}
CRITICAL_CONFIRM_TRANSITIONS = {
    ("ANALYSIS", "IMPLEMENT"),
    ("QUALITY", "MEMORY"),
}
ANALYSIS_CONFIRM_TRANSITION = ("ANALYSIS", "IMPLEMENT")
LEGACY_STAGE_MAP = {
    "WAITING_CONFIRM": "ANALYSIS",
    "REVIEW": "QUALITY",
    "VERIFICATION": "QUALITY",
    "MEMORY_SHORT": "MEMORY",
    "MEMORY_LONG": "MEMORY",
}
SESSION_IDLE_RETENTION_HOURS = 7 * 24
SESSION_ATTACHED_RETENTION_HOURS = 30 * 24
MAX_SESSION_FILES = 100
SESSION_COMPONENT_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
WORKFLOW_AGENT_IDENTITIES = {"claude-code", "codex", "qoder"}
# 安装时固化的宿主身份是生产事实源；未渲染源码保留占位符供本仓测试直接加载。
INSTALLED_WORKFLOW_AGENT = "{{workflow_agent_id}}"
SESSION_AGENT_NAMESPACES = {"claude-code", "codex", "qoder", "unknown"}
CODEX_AGENT_PATH_PATTERN = re.compile(r"^/?root(?:/[a-z0-9._-]+)*$")
LEGACY_DISPLAY_AGENT_IDENTITIES = {
    "claude with easy coding": "claude-code",
    "claude-code with easy coding": "claude-code",
    "claude code with easy coding": "claude-code",
    "codex with easy coding": "codex",
    "qoder with easy coding": "qoder",
}
LEGACY_STATE_LOCK_TIMEOUT_SECONDS = 5.0
LEGACY_STATE_LOCK_STALE_SECONDS = 60.0
LEGACY_STATE_LOCK_POLL_SECONDS = 0.02
SESSION_COMMAND_LOCK_TIMEOUT_SECONDS = 5.0
SESSION_COMMAND_LOCK_STALE_SECONDS = 60.0
SESSION_COMMAND_LOCK_POLL_SECONDS = 0.02


class StateError(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_agent_identity(agent: str | None, allow_legacy_display: bool = False) -> str | None:
    raw_agent = str(agent or "unknown").strip()
    normalized = raw_agent.lower()
    # Codex 可能把根执行者写成 root 或 /root；两者及其协作子路径都属于同一平台身份。
    if CODEX_AGENT_PATH_PATTERN.fullmatch(normalized):
        return "codex"
    if normalized in WORKFLOW_AGENT_IDENTITIES:
        return normalized
    if allow_legacy_display:
        return LEGACY_DISPLAY_AGENT_IDENTITIES.get(normalized)
    return None


def normalize_agent_identity(agent: str | None) -> str:
    raw_agent = str(agent or "unknown").strip()
    # 旧数据可能误把展示署名写入 owner；只在读取兼容边界将其还原为规范身份。
    canonical = canonical_agent_identity(raw_agent, allow_legacy_display=True)
    if canonical is not None:
        return canonical
    return raw_agent


def normalize_session_agent(agent: str | None) -> str:
    normalized = normalize_agent_identity(agent)
    return normalized if normalized in SESSION_AGENT_NAMESPACES else "unknown"


def agents_equivalent(first: str | None, second: str | None) -> bool:
    return normalize_agent_identity(first) == normalize_agent_identity(second)


def detect_runtime_agent() -> str:
    if INSTALLED_WORKFLOW_AGENT in WORKFLOW_AGENT_IDENTITIES:
        return INSTALLED_WORKFLOW_AGENT
    # 仅供未渲染源码和旧安装兼容；新安装脚本始终走上面的固化身份。
    script_path = Path(sys.argv[0]).as_posix()
    if ".qoder/" in script_path or ".qodercn/" in script_path:
        return "qoder"
    if ".codex/" in script_path:
        return "codex"
    if ".claude/" in script_path:
        return "claude-code"
    # Qoder CLI 会暴露 Claude 兼容环境变量，专属信号必须优先于兼容信号。
    if os.environ.get("QODER_PROJECT_DIR"):
        return "qoder"
    if os.environ.get("CLAUDE_PROJECT_DIR"):
        return "claude-code"
    return "unknown"


def normalize_session_component(value: str) -> str:
    if (
        value not in {".", ".."}
        and len(value) <= 120
        and SESSION_COMPONENT_PATTERN.fullmatch(value)
    ):
        return value
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]
    return f"sha256-{digest}"


def hook_session_identity(
    payload: dict,
    agent: str | None,
    ppid: int | None = None,
) -> dict:
    namespace = normalize_session_agent(agent)
    raw_session_id = payload.get("session_id") or payload.get("sessionId")
    external_session_id = str(raw_session_id).strip() if raw_session_id is not None else ""
    source = "hook-session-id"
    if not external_session_id and namespace == "codex":
        # Codex App 当前会把 thread ID 暴露在进程环境中；标准 hook session_id 仍保持最高优先级。
        raw_thread_id = (
            payload.get("thread_id")
            or payload.get("threadId")
            or os.environ.get("CODEX_THREAD_ID")
        )
        external_session_id = str(raw_thread_id).strip() if raw_thread_id is not None else ""
        source = "codex-thread-id"
    if external_session_id:
        component = normalize_session_component(external_session_id)
    else:
        component = f"ppid-{ppid if ppid is not None else os.getppid()}"
        source = "legacy-ppid"
    return {
        "agent": namespace,
        "external_session_id": external_session_id or None,
        "session_key": f"{namespace}-{component}",
        "session_source": source,
    }


def load_json(path: Path) -> dict | None:
    return memo(("json", str(path)), lambda: _load_json(path))


def _load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def parse_ut_threshold(value: object, source: str) -> int:
    if isinstance(value, bool):
        raise StateError(f"Invalid {source}: expected an integer from 1 to 100.")
    try:
        threshold = int(str(value))
    except (TypeError, ValueError) as error:
        raise StateError(f"Invalid {source}: expected an integer from 1 to 100.") from error
    if threshold < 1 or threshold > 100:
        raise StateError(f"Invalid {source}: expected an integer from 1 to 100.")
    return threshold


def parse_unit_test_mode(value: object, source: str) -> str:
    if not isinstance(value, str) or value not in {"none", "ut", "tdd"}:
        raise StateError(f"Invalid {source}: expected none, ut, or tdd.")
    return str(value)


def read_behavior_file(path: Path) -> tuple[dict, int]:
    return memo(("behavior", str(path)), lambda: _read_behavior_file(path))


def _read_behavior_file(path: Path) -> tuple[dict, int]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return {}, 0

    in_behavior = False
    behavior_indent = 0
    behavior: dict[str, str] = {}
    schema_version = 0
    for raw_line in lines:
        without_comment = raw_line.split("#", 1)[0].rstrip()
        stripped = without_comment.strip()
        if not stripped:
            continue
        indent = len(without_comment) - len(without_comment.lstrip(" "))
        if stripped.startswith("behavior:") and stripped != "behavior:":
            raise StateError("Behavior configuration must use an indented YAML mapping; write it with easy-coding config.")
        if stripped == "behavior:":
            in_behavior = True
            behavior_indent = indent
            continue
        if in_behavior and indent <= behavior_indent:
            in_behavior = False
        if not in_behavior and indent == 0 and stripped.startswith("version:"):
            try:
                schema_version = int(stripped.split(":", 1)[1].strip().strip("'\""))
            except ValueError:
                schema_version = 0
            continue
        if not in_behavior or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        behavior[key] = value.strip().strip("'\"")

    return behavior, schema_version


def read_project_behavior(root: Path) -> tuple[str, str, str, int]:
    behavior, schema_version = read_behavior_file(root / ".easy-coding" / "config.yaml")
    legacy = behavior.get("confirm_mode")
    approval_mode = behavior.get("approval_mode")
    workflow_mode = behavior.get("workflow_mode")
    if approval_mode is None:
        if legacy == "lite":
            approval_mode = "guard"
        elif legacy in APPROVAL_MODES:
            approval_mode = legacy
        else:
            approval_mode = DEFAULT_APPROVAL_MODE
    if workflow_mode is None:
        workflow_mode = "fast" if legacy == "lite" else DEFAULT_WORKFLOW_MODE
    if approval_mode not in APPROVAL_MODES:
        raise StateError(
            "Invalid behavior.approval_mode in .easy-coding/config.yaml: "
            "expected approve, guard, confirm, or auto."
        )
    if workflow_mode not in CONFIGURED_WORKFLOW_MODES:
        raise StateError(
            "Invalid behavior.workflow_mode in .easy-coding/config.yaml: "
            "expected adaptive, fast, standard, or strict."
        )
    if schema_version >= 6:
        unit_test_mode = parse_unit_test_mode(
            behavior.get("unit_test_mode", DEFAULT_UNIT_TEST_MODE), "behavior.unit_test_mode"
        )
        threshold = parse_ut_threshold(
            behavior.get("ut_coverage_threshold", DEFAULT_UT_COVERAGE_THRESHOLD),
            "behavior.ut_coverage_threshold",
        )
    else:
        if schema_version >= 4:
            raise StateError("Run easy-coding upgrade to migrate unit-test settings to schema 6.")
        unit_test_mode = DEFAULT_UNIT_TEST_MODE
        threshold = DEFAULT_UT_COVERAGE_THRESHOLD
    return approval_mode, workflow_mode, unit_test_mode, threshold


def behavior_layers(root: Path, session: dict) -> dict:
    project, _ = read_behavior_file(root / ".easy-coding" / "config.yaml")
    local, _ = read_behavior_file(Path.home() / ".easy-coding" / "config.yaml")
    defaults = {"approval_mode": DEFAULT_APPROVAL_MODE, "cooperate_mode": "default",
                "unit_test_mode": DEFAULT_UNIT_TEST_MODE,
                "ut_coverage_threshold": DEFAULT_UT_COVERAGE_THRESHOLD}
    layers = {"project": project, "local": local, "session": session}
    result = {}
    for key, default in defaults.items():
        source = next((name for name in ("session", "local", "project")
                       if layers[name].get(key) is not None), "default")
        value = layers[source][key] if source != "default" else default
        if key == "ut_coverage_threshold":
            value = parse_ut_threshold(value, f"{source} {key}")
        elif key == "unit_test_mode":
            value = parse_unit_test_mode(value, f"{source} {key}")
        elif value not in (APPROVAL_MODES if key == "approval_mode" else {"default", "dispatch"}):
            raise StateError(f"Invalid {source} {key}: {value}")
        result[key] = {"value": value, "source": source}
    return result


def safe_tdd_report_pattern(value: object) -> bool:
    if not is_non_empty_string(value):
        return False
    candidate = Path(str(value))
    return not candidate.is_absolute() and ".." not in candidate.parts


def tdd_gate_uses_task_variables(command: object) -> bool:
    if not is_non_empty_string(command):
        return False
    try:
        tokens = shlex.split(str(command))
    except ValueError:
        return False
    options: dict[str, str] = {}
    for index, token in enumerate(tokens[:-1]):
        if token in {"--base", "--threshold"}:
            options[token] = tokens[index + 1]
    return options.get("--base") in {
        f"${TDD_BASE_VARIABLE}",
        "$" + "{" + TDD_BASE_VARIABLE + "}",
    } and options.get("--threshold") in {
        f"${TDD_THRESHOLD_VARIABLE}",
        "$" + "{" + TDD_THRESHOLD_VARIABLE + "}",
    }


def tdd_ci_contract_reasons(contents: list[str]) -> list[str]:
    combined = "\n".join(
        re.sub(r"\s+#.*$", "", re.sub(r"^\s*#.*$", "", line))
        for line in "\n".join(contents).splitlines()
    )
    lowered = combined.lower()
    reasons: list[str] = []
    for marker in (
        "jacoco",
        "artifacts",
        COVERAGE_TOOL_PATH,
        TDD_BASE_VARIABLE,
        TDD_THRESHOLD_VARIABLE,
    ):
        if marker.lower() not in lowered:
            reasons.append(f"CI files do not contain required marker: {marker}")
    if not tdd_gate_uses_task_variables(combined):
        reasons.append(
            "CI changed-line gate must use the task baseline and threshold variables"
        )
    if re.search(
        r"(?:^|\n)\s*stage\s*:\s*['\"]?test['\"]?\s*(?:#.*)?(?:\n|$)",
        combined,
        re.IGNORECASE,
    ) is None:
        reasons.append("CI files do not declare a TEST-stage job")
    return reasons


def tdd_readiness(root: Path, include_ci: bool = False) -> dict[str, object]:
    receipt = root / TDD_READINESS_PATH
    if not receipt.is_file():
        return {"status": "needs_init", "reasons": ["TDD readiness receipt is missing"]}
    try:
        manifest = json.loads(receipt.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {"status": "needs_repair", "reasons": ["TDD readiness receipt is invalid"]}
    if not isinstance(manifest, dict):
        return {
            "status": "needs_repair",
            "reasons": ["TDD readiness receipt must be a JSON object"],
        }

    reasons: list[str] = []
    if manifest.get("schema") != TDD_READINESS_SCHEMA:
        reasons.append("unsupported readiness schema")
    if manifest.get("provider") != "gitlab":
        reasons.append("readiness provider must be gitlab")
    if manifest.get("coverage_scope") != TDD_READINESS_SCOPE:
        reasons.append("coverage scope must be changed-production-lines")
    if manifest.get("historical_coverage_required") is not False:
        reasons.append("historical coverage must remain disabled")
    reports = manifest.get("coverage_report_patterns")
    if not isinstance(reports, list) or not reports or not all(
        safe_tdd_report_pattern(item) for item in reports
    ):
        reasons.append(
            "coverage_report_patterns must contain safe project-relative report patterns"
        )
    gate = manifest.get("changed_line_gate_command")
    if not is_non_empty_string(gate) or COVERAGE_TOOL_PATH not in str(gate):
        reasons.append("changed-line coverage gate command is missing")
    elif not tdd_gate_uses_task_variables(gate):
        reasons.append(
            "changed-line coverage gate must use the task baseline and threshold variables"
        )

    contents: dict[str, list[str]] = {
        "build_files": [],
        "tool_files": [],
    }
    if include_ci:
        contents["ci_files"] = []
    for field in contents:
        records = manifest.get(field)
        if not isinstance(records, list) or not records:
            reasons.append(f"{field} must contain at least one file")
            continue
        for record in records:
            if not isinstance(record, dict):
                reasons.append(f"{field} contains an invalid record")
                continue
            file_name = record.get("path")
            if not is_non_empty_string(file_name):
                reasons.append(f"{field} contains an invalid path")
                continue
            candidate = Path(str(file_name))
            if candidate.is_absolute():
                reasons.append(f"readiness file must be project-relative: {file_name}")
                continue
            resolved = (root / candidate).resolve()
            try:
                resolved.relative_to(root.resolve())
                payload = resolved.read_bytes()
                contents[field].append(payload.decode("utf-8"))
            except (OSError, UnicodeError, ValueError):
                reasons.append(f"readiness file is missing or unreadable: {file_name}")

    manifest_build_files = manifest.get("build_files")
    manifest_ci_files = manifest.get("ci_files")
    manifest_tool_files = manifest.get("tool_files")
    build_paths = {
        Path(str(item.get("path", ""))).name
        for item in manifest_build_files
        if isinstance(item, dict) and is_non_empty_string(item.get("path"))
    } if isinstance(manifest_build_files, list) else set()
    ci_paths = {
        str(item.get("path", "")).replace("\\", "/")
        for item in manifest_ci_files
        if isinstance(item, dict) and is_non_empty_string(item.get("path"))
    } if isinstance(manifest_ci_files, list) else set()
    if not build_paths.intersection(JAVA_BUILD_FILE_NAMES):
        reasons.append("build_files must include a Maven or Gradle Java build file")
    tool_paths = {
        str(item.get("path", "")).replace("\\", "/")
        for item in manifest_tool_files
        if isinstance(item, dict) and is_non_empty_string(item.get("path"))
    } if isinstance(manifest_tool_files, list) else set()
    if COVERAGE_TOOL_PATH not in tool_paths:
        reasons.append(f"tool_files must include {COVERAGE_TOOL_PATH}")
    if include_ci:
        if not ci_paths.intersection(GITLAB_CI_ENTRY_FILES):
            reasons.append("ci_files must include the project-root GitLab CI entry file")
        if not any("jacoco" in content.lower() for content in contents["build_files"]):
            reasons.append("build files do not configure JaCoCo")
        reasons.extend(tdd_ci_contract_reasons(contents["ci_files"]))
    return {
        "status": "ready" if not reasons else "needs_repair",
        "reasons": list(dict.fromkeys(reasons)),
    }


def resolve_behavior(
    root: Path, session: dict
) -> tuple[str, str | None, str, str, str | None, str, str, str | None, str, int, int | None, int]:
    project_approval, project_workflow, project_unit_test, project_threshold = read_project_behavior(root)
    legacy = session.get("confirm_mode")
    session_approval = session.get("approval_mode")
    session_workflow = session.get("workflow_mode")
    session_unit_test = session.get("unit_test_mode")
    session_threshold = session.get("ut_coverage_threshold")
    if session_approval is None:
        if legacy == "lite":
            session_approval = "guard"
        elif legacy in APPROVAL_MODES:
            session_approval = legacy
    if session_workflow is None:
        if legacy == "lite":
            session_workflow = "fast"
        elif legacy in APPROVAL_MODES:
            session_workflow = "adaptive"
    if session_approval is not None and session_approval not in APPROVAL_MODES:
        raise StateError(
            "Invalid session approval_mode: expected approve, guard, confirm, or auto."
        )
    if session_workflow is not None and session_workflow not in CONFIGURED_WORKFLOW_MODES:
        raise StateError(
            "Invalid session workflow_mode: expected adaptive, fast, standard, or strict."
        )
    if session_unit_test is not None:
        session_unit_test = parse_unit_test_mode(session_unit_test, "session unit_test_mode")
    if session_threshold is not None:
        session_threshold = parse_ut_threshold(
            session_threshold, "session ut_coverage_threshold"
        )
    local, _ = read_behavior_file(Path.home() / ".easy-coding" / "config.yaml")
    effective = behavior_layers(root, session)
    return (
        project_approval,
        str(session_approval) if session_approval else None,
        str(session_approval or (effective["approval_mode"]["value"] if "approval_mode" in local else project_approval)),
        project_workflow,
        str(session_workflow) if session_workflow else None,
        str(session_workflow or project_workflow),
        project_unit_test,
        session_unit_test,
        session_unit_test if session_unit_test is not None else (
            effective["unit_test_mode"]["value"] if "unit_test_mode" in local else project_unit_test),
        project_threshold,
        session_threshold,
        session_threshold if session_threshold is not None else (
            effective["ut_coverage_threshold"]["value"] if "ut_coverage_threshold" in local else project_threshold),
    )


def migrate_unit_test_settings(record: dict) -> bool:
    changed = False
    if "tdd_enabled" in record:
        enabled = record.pop("tdd_enabled")
        if "unit_test_mode" not in record and isinstance(enabled, bool):
            record["unit_test_mode"] = "tdd" if enabled else "none"
        changed = True
    if "tdd_coverage_threshold" in record:
        threshold = record.pop("tdd_coverage_threshold")
        record.setdefault("ut_coverage_threshold", threshold)
        changed = True
    return changed


def normalize_legacy_stage(stage: object) -> object:
    return LEGACY_STAGE_MAP.get(str(stage), stage)


def normalize_legacy_task(task: dict) -> bool:
    """Normalize legacy task state without touching artifacts outside task.json."""
    legacy_status = str(task.get("status") or "")
    changed = migrate_unit_test_settings(task)

    for field in ("created_by", "last_agent"):
        normalized_agent = canonical_agent_identity(
            task.get(field), allow_legacy_display=True
        )
        if normalized_agent is not None and normalized_agent != task.get(field):
            task[field] = normalized_agent
            changed = True

    if legacy_status in LEGACY_STAGE_MAP:
        task["status"] = LEGACY_STAGE_MAP[legacy_status]
        changed = True

    pending = task.get("pending_transition")
    if isinstance(pending, dict):
        source = normalize_legacy_stage(pending.get("from"))
        target = normalize_legacy_stage(pending.get("to"))
        if source == target:
            task.pop("pending_transition", None)
            changed = True
        elif source != pending.get("from") or target != pending.get("to"):
            task["pending_transition"] = {**pending, "from": source, "to": target}
            changed = True

    if not isinstance(task.get("quality_checkpoint"), dict) and isinstance(
        task.get("verification_checkpoint"), dict
    ):
        task["quality_checkpoint"] = task["verification_checkpoint"]
        changed = True
    if "verification_checkpoint" in task:
        task.pop("verification_checkpoint")
        changed = True

    history = task.get("stage_history")
    if isinstance(history, list):
        normalized_history: list[dict] = []
        for raw_entry in history:
            if not isinstance(raw_entry, dict):
                continue
            entry = dict(raw_entry)
            mapped_stage = normalize_legacy_stage(entry.get("stage"))
            if mapped_stage != entry.get("stage"):
                entry["stage"] = mapped_stage
                changed = True
            normalized_agent = canonical_agent_identity(
                entry.get("agent"), allow_legacy_display=True
            )
            if normalized_agent is not None and normalized_agent != entry.get("agent"):
                entry["agent"] = normalized_agent
                changed = True
            if normalized_history and normalized_history[-1].get("stage") == entry.get("stage"):
                changed = True
                continue
            normalized_history.append(entry)
        if changed:
            task["stage_history"] = normalized_history

    if legacy_status == "WAITING_CONFIRM" and not task.get("pending_transition"):
        requested_by = canonical_agent_identity(
            task.get("last_agent"), allow_legacy_display=True
        ) or "legacy-migration"
        task["pending_transition"] = {
            "from": "ANALYSIS",
            "to": "IMPLEMENT",
            "requested_at": now_iso(),
            "requested_by": requested_by,
            "reason": "migrated-from-WAITING_CONFIRM",
        }
        changed = True

    if legacy_status == "MEMORY_LONG":
        progress = task.get("memory_progress")
        if not isinstance(progress, dict):
            progress = {}
        if progress.get("short_memory_written") is not True:
            progress["short_memory_written"] = True
            progress["legacy_short_memory_assumed"] = True
            progress["updated_at"] = now_iso()
            task["memory_progress"] = progress
            changed = True
        elif progress.get("legacy_short_memory_assumed") is not True:
            progress["legacy_short_memory_assumed"] = True
            progress["updated_at"] = now_iso()
            task["memory_progress"] = progress
            changed = True

    return changed


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        invalidate_memo(("json", str(path)))
        memo(("json", str(path)), lambda: data)
        try:
            directory_descriptor = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
        except OSError:
            # Some platforms do not allow opening directories; file replacement is still atomic.
            pass
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def session_command_lock_path(root: Path, session_path: Path) -> Path:
    key = hashlib.sha256(str(session_path.resolve()).encode("utf-8")).hexdigest()[:24]
    return root / ".easy-coding" / "sessions" / f".session-{key}.lock"


def acquire_session_command_lock(root: Path, session_path: Path) -> Path:
    lock_path = session_command_lock_path(root, session_path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + SESSION_COMMAND_LOCK_TIMEOUT_SECONDS
    while True:
        try:
            lock_path.mkdir()
            return lock_path
        except FileExistsError:
            try:
                if time.time() - lock_path.stat().st_mtime > SESSION_COMMAND_LOCK_STALE_SECONDS:
                    lock_path.rmdir()
                    continue
            except FileNotFoundError:
                continue
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise StateError("Timed out waiting for the logical session command lock.")
            time.sleep(SESSION_COMMAND_LOCK_POLL_SECONDS)
        except OSError as exc:
            raise StateError("Cannot acquire the logical session command lock.") from exc


def release_session_command_lock(lock_path: Path | None) -> None:
    if lock_path is None:
        return
    try:
        lock_path.rmdir()
    except OSError:
        pass


def acquire_legacy_state_lock(root: Path) -> Path | None:
    state_path = root / ".easy-coding" / "state.json"
    lock_path = root / ".easy-coding" / "sessions" / ".legacy-state-migration.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + LEGACY_STATE_LOCK_TIMEOUT_SECONDS

    while state_path.exists() or lock_path.exists():
        try:
            lock_path.mkdir()
            return lock_path
        except FileExistsError:
            try:
                lock_age = time.time() - lock_path.stat().st_mtime
                if lock_age > LEGACY_STATE_LOCK_STALE_SECONDS:
                    lock_path.rmdir()
                    continue
            except FileNotFoundError:
                continue
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise StateError("Timed out waiting for legacy state migration lock.")
            time.sleep(LEGACY_STATE_LOCK_POLL_SECONDS)
        except OSError as error:
            raise StateError("Cannot acquire legacy state migration lock.") from error
    return None


def release_legacy_state_lock(lock_path: Path | None) -> None:
    if lock_path is None:
        return
    try:
        lock_path.rmdir()
    except OSError:
        pass


def migrate_legacy_state(root: Path, agent: str) -> dict | None:
    """Prepare old state.json data for the canonical session; the caller commits it first."""
    state_path = root / ".easy-coding" / "state.json"
    old_state = load_json(state_path)
    if old_state is None:
        return None

    task_id = old_state.get("current_task")
    if task_id:
        task_path = task_json_path(root, str(task_id))
        task = load_json(task_path)
        if task:
            if "stage_history" not in task or not task["stage_history"]:
                task["stage_history"] = old_state.get("stage_history", [])
            if "last_agent" not in task or not task["last_agent"]:
                task["last_agent"] = (
                    canonical_agent_identity(
                        old_state.get("last_agent"), allow_legacy_display=True
                    )
                    or agent
                )
            if old_state.get("confirmed_by_user"):
                task["confirmed_by_user"] = True
            if old_state.get("test_strategy_confirmed"):
                task["test_strategy_confirmed"] = True
            if old_state.get("repo_paths"):
                task["repo_paths"] = old_state["repo_paths"]
            normalize_legacy_task(task)
            write_json(task_path, task)

    return {"current_task": task_id, "created_at": now_iso()}


def resolve_session_path(root: Path, session_file: str | Path | None = None) -> Path:
    sessions_dir = (root / ".easy-coding" / "sessions").resolve()
    if session_file:
        path = Path(session_file)
        candidate = path if path.is_absolute() else root / path
        resolved = candidate.resolve()
        try:
            resolved.relative_to(sessions_dir)
        except ValueError as error:
            raise StateError(
                "Unsafe session file path: "
                f"{session_file}. Must be under .easy-coding/sessions/."
            ) from error
        if resolved == sessions_dir:
            raise StateError(
                "Unsafe session file path: "
                f"{session_file}. Must be a file under .easy-coding/sessions/."
            )
        return resolved
    identity = hook_session_identity({}, detect_runtime_agent())
    return sessions_dir / f"{identity['session_key']}.json"


def resolve_hook_session_path(
    root: Path,
    payload: dict,
    agent: str | None,
    ppid: int | None = None,
) -> Path:
    identity = hook_session_identity(payload, agent, ppid)
    return resolve_session_path(root, f".easy-coding/sessions/{identity['session_key']}.json")


def display_path(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def default_session() -> dict:
    timestamp = now_iso()
    return {"current_task": None, "created_at": timestamp, "last_active_at": timestamp}


def apply_hook_session_identity(session: dict, identity: dict) -> None:
    timestamp = now_iso()
    if not session.get("created_at"):
        session["created_at"] = timestamp
    session["last_active_at"] = timestamp
    for key in ("agent", "external_session_id", "session_key", "session_source"):
        session[key] = identity.get(key)


def clear_session_pointer(session: dict, agent: str | None = None) -> None:
    session["current_task"] = None
    session["last_seen_task"] = None
    session["last_seen_stage"] = "idle"
    if agent:
        session["last_agent"] = agent


def load_session(root: Path, session_file: str | Path | None = None) -> dict | None:
    session = load_json(resolve_session_path(root, session_file))
    return session if isinstance(session, dict) else None


def write_session(root: Path, session: dict, session_file: str | Path | None = None) -> None:
    write_json(resolve_session_path(root, session_file), session)


def migrate_legacy_pid_session(
    root: Path,
    session_path: Path,
    identity: dict,
    ppid: int,
) -> dict | None:
    sessions_dir = root / ".easy-coding" / "sessions"
    fallback_path = sessions_dir / f"{identity['agent']}-ppid-{ppid}.json"
    legacy_paths = [fallback_path, sessions_dir / f"{ppid}.json"]
    session_path.parent.mkdir(parents=True, exist_ok=True)

    for legacy_path in legacy_paths:
        if legacy_path == session_path or not legacy_path.is_file():
            continue
        try:
            legacy_path.replace(session_path)
            invalidate_memo(("json", str(legacy_path)))
            invalidate_memo(("json", str(session_path)))
        except FileNotFoundError:
            continue
        except OSError:
            if session_path.is_file():
                invalidate_memo(("json", str(session_path)))
                break
            continue
        migrated = load_session(root, session_path)
        if migrated is not None:
            return migrated
    return load_session(root, session_path)


def merge_legacy_session(session: dict, legacy_session: dict) -> dict:
    merged = dict(session)
    if not merged.get("current_task") and legacy_session.get("current_task"):
        merged["current_task"] = legacy_session["current_task"]
    if not merged.get("created_at") and legacy_session.get("created_at"):
        merged["created_at"] = legacy_session["created_at"]
    return merged


def ensure_hook_session(
    root: Path,
    payload: dict,
    agent: str | None,
    ppid: int | None = None,
) -> tuple[dict, Path]:
    session_path = resolve_hook_session_path(root, payload, agent, ppid)
    lock_path = acquire_session_command_lock(root, session_path)
    try:
        return ensure_hook_session_unlocked(root, payload, agent, ppid)
    finally:
        release_session_command_lock(lock_path)


def ensure_hook_session_unlocked(
    root: Path,
    payload: dict,
    agent: str | None,
    ppid: int | None = None,
) -> tuple[dict, Path]:
    identity = hook_session_identity(payload, agent, ppid)
    session_path = resolve_hook_session_path(root, payload, agent, ppid)
    resolved_ppid = ppid if ppid is not None else os.getppid()
    legacy_state_lock = acquire_legacy_state_lock(root)
    try:
        session = load_session(root, session_path)
        legacy_state = (
            migrate_legacy_state(root, str(identity["agent"]))
            if legacy_state_lock is not None
            else None
        )

        if session is None:
            clean_session_runtime(root, reserve_slots=1)
            session = migrate_legacy_pid_session(root, session_path, identity, resolved_ppid)
        if session is None:
            session = load_session(root, session_path)
        if session is None:
            session = default_session()
        if legacy_state is not None:
            session = merge_legacy_session(session, legacy_state)

        apply_hook_session_identity(session, identity)
        write_session(root, session, session_path)
        if legacy_state is not None:
            try:
                (root / ".easy-coding" / "state.json").unlink()
            except OSError:
                pass
        return session, session_path
    finally:
        release_legacy_state_lock(legacy_state_lock)


def clean_stale_sessions(
    root: Path,
    threshold_hours: int | None = None,
    idle_threshold_hours: int = SESSION_IDLE_RETENTION_HOURS,
    attached_threshold_hours: int = SESSION_ATTACHED_RETENTION_HOURS,
    max_sessions: int = MAX_SESSION_FILES,
    reserve_slots: int = 0,
) -> int:
    sessions_dir = root / ".easy-coding" / "sessions"
    if not sessions_dir.is_dir():
        return 0

    now = datetime.now(timezone.utc)
    if threshold_hours is not None:
        idle_threshold_hours = threshold_hours
        attached_threshold_hours = threshold_hours
    candidates: list[tuple[Path, str, dict, datetime]] = []
    for entry in sessions_dir.iterdir():
        if not entry.is_file() or entry.suffix != ".json":
            continue
        try:
            content = entry.read_text(encoding="utf-8")
            try:
                session = json.loads(content)
            except json.JSONDecodeError:
                session = {}
            if not isinstance(session, dict):
                session = {}
            activity_value = session.get("last_active_at") or session.get("created_at")
            try:
                if not isinstance(activity_value, str):
                    raise ValueError
                last_active = datetime.fromisoformat(activity_value)
                if last_active.tzinfo is None:
                    last_active = last_active.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                last_active = datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc)
            candidates.append((entry, content, session, last_active))
        except OSError:
            continue

    removed: set[Path] = set()
    for entry, content, session, last_active in candidates:
        retention_hours = (
            attached_threshold_hours if session.get("current_task") else idle_threshold_hours
        )
        age_hours = (now - last_active).total_seconds() / 3600
        if age_hours <= retention_hours:
            continue
        if unlink_session_if_unchanged(entry, content):
            removed.add(entry)

    allowed_existing = max(0, max_sessions - reserve_slots)
    remaining = sorted(
        (candidate for candidate in candidates if candidate[0] not in removed),
        key=lambda candidate: candidate[3],
    )
    overflow = max(0, len(remaining) - allowed_existing)
    for entry, content, _session, _last_active in remaining[:overflow]:
        if unlink_session_if_unchanged(entry, content):
            removed.add(entry)
    return len(removed)


def unlink_session_if_unchanged(entry: Path, expected_content: str) -> bool:
    try:
        if entry.read_text(encoding="utf-8") != expected_content:
            return False
        entry.unlink()
        invalidate_memo(("json", str(entry)))
        return True
    except OSError:
        # GC 采用尽力清理；锁定、并发移除等失败文件留到后续新会话再次处理。
        return False


def clean_orphan_acceptance_snapshots(root: Path) -> int:
    acceptance_dir = root / ".easy-coding" / "sessions" / "acceptance"
    if not acceptance_dir.is_dir():
        return 0

    cleaned = 0
    for entry in acceptance_dir.iterdir():
        if not entry.is_file() or entry.suffix != ".json":
            continue
        task_path = root / ".easy-coding" / "tasks" / entry.stem / "task.json"
        if task_path.is_file():
            try:
                task = json.loads(task_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(task, dict):
                continue
        else:
            task = None

        checkpoint = None
        if task is not None:
            checkpoint = task.get("quality_checkpoint")
            if not isinstance(checkpoint, dict):
                checkpoint = task.get("verification_checkpoint")
        snapshot_file = checkpoint.get("snapshot_file") if isinstance(checkpoint, dict) else None
        referenced = bool(
            isinstance(snapshot_file, str)
            and (root / snapshot_file).resolve() == entry.resolve()
        )
        terminal = task is not None and task.get("status") in TERMINAL_STATUSES
        if task is not None and referenced and not terminal:
            continue
        try:
            entry.unlink()
            cleaned += 1
        except OSError:
            # 验收快照清理失败不能阻断新逻辑会话启动。
            continue
    return cleaned


def clean_session_runtime(root: Path, reserve_slots: int = 0) -> dict:
    return {
        "sessions_removed": clean_stale_sessions(root, reserve_slots=reserve_slots),
        "acceptance_snapshots_removed": clean_orphan_acceptance_snapshots(root),
    }


def task_json_path(root: Path, task_id: str) -> Path:
    assert_safe_task_id(task_id)
    return root / ".easy-coding" / "tasks" / task_id / "task.json"


def load_task(root: Path, task_id: str | None) -> dict | None:
    if not task_id:
        return None
    return load_json(task_json_path(root, str(task_id)))


def execution_log_path(root: Path, task_id: str) -> Path:
    assert_safe_task_id(task_id)
    return root / ".easy-coding" / "tasks" / task_id / "execution.jsonl"


def is_non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def execution_records(root: Path, task_id: str) -> list[dict]:
    path = execution_log_path(root, task_id)
    return memo(("execution", str(path)), lambda: _execution_records(path))


def _execution_records(path: Path) -> list[dict]:
    if not path.exists():
        return []
    records: list[dict] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            if isinstance(record, dict):
                records.append(record)
    except (OSError, json.JSONDecodeError):
        return []
    return records


def assert_safe_task_id(task_id: str) -> None:
    path = Path(task_id)
    if not task_id or path.is_absolute() or "/" in task_id or "\\" in task_id or ".." in path.parts:
        raise StateError(f"Unsafe task id: {task_id}")


def transition_requires_confirmation(
    previous: str,
    current: str,
    task_type: str,
    approval_mode: str,
) -> bool:
    if (previous, current) in ALWAYS_AUTO_TRANSITIONS:
        return False
    if current == "CLOSED":
        return True
    if approval_mode == "auto":
        return False
    if approval_mode == "guard":
        return (previous, current) in CRITICAL_CONFIRM_TRANSITIONS
    if approval_mode == "confirm":
        return (previous, current) == ANALYSIS_CONFIRM_TRANSITION
    if approval_mode == "approve":
        return True
    raise StateError(f"Unknown approval mode: {approval_mode}")


def is_automatic_transition(
    previous: str,
    current: str,
    task_type: str,
    approval_mode: str,
) -> bool:
    return not transition_requires_confirmation(previous, current, task_type, approval_mode)


def validate_transition(
    previous: str,
    current: str,
    task_type: str = "",
    task: dict | None = None,
) -> str | None:
    if previous == current:
        return None
    allowed = set(VALID_TRANSITIONS.get(previous, set()))
    if previous == "IMPLEMENT":
        allowed.discard("COMPLETE")
    if current in allowed:
        return None
    return (
        f"ILLEGAL TRANSITION: {previous} -> {current}. "
        f"Allowed from {previous}: {sorted(allowed) or 'NONE (terminal state)'}."
    )


def ensure_session(root: Path, session_file: str | Path | None = None) -> dict:
    session = load_session(root, session_file)
    if session is None:
        session = default_session()
    if not session.get("created_at"):
        session["created_at"] = now_iso()
    session["last_active_at"] = now_iso()
    return session
