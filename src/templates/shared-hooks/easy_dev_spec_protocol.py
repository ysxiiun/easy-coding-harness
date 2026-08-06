#!/usr/bin/env python3
"""Canonical Dev Spec v1 parser, validator, and scope selector.

The module intentionally uses only the Python standard library so the skill can
run in a clean repository without installing dependencies.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


SCHEMA = "easy-dev-spec/v1"
MANIFEST_BEGIN = "<!-- EDS:MANIFEST:BEGIN -->"
MANIFEST_END = "<!-- EDS:MANIFEST:END -->"
SECTION_BEGIN_RE = re.compile(r"^<!-- EDS:SECTION:BEGIN id=([a-z0-9][a-z0-9-]*) -->$")
SECTION_END_RE = re.compile(r"^<!-- EDS:SECTION:END id=([a-z0-9][a-z0-9-]*) -->$")
ID_PATTERNS = {
    "repository": re.compile(r"^R[1-9][0-9]*$"),
    "contract": re.compile(r"^C[1-9][0-9]*$"),
    "task": re.compile(r"^(R[1-9][0-9]*)-T[1-9][0-9]*$"),
    "change": re.compile(r"^F[1-9][0-9]*$"),
    "step": re.compile(r"^S[1-9][0-9]*$"),
    "test": re.compile(r"^T[1-9][0-9]*$"),
}
VALID_STATUSES = {"DRAFT", "BLOCKED", "READY"}
VALID_DEPENDENCY_TYPES = {"hard", "contract", "integration"}
VALID_ACTIONS = {"add", "modify", "delete"}
REQUIRED_TASK_HEADINGS = (
    "目标、交付物与非目标",
    "文件与符号级改动",
    "调用链 Diff",
    "新增或修改类型契约",
    "存储、消息与配置闭环",
    "符号级实施步骤",
    "测试映射",
    "风险、回退与完成证据",
)
FORBIDDEN_READY_PATTERNS = {
    "placeholder.todo": re.compile(r"(?i)(?<![A-Za-z])TODO(?![A-Za-z])"),
    "placeholder.tbd": re.compile(r"(?i)(?<![A-Za-z])TBD(?![A-Za-z])"),
    "placeholder.template": re.compile(r"\[\[EDS_TODO:[^\]]+\]\]"),
    "placeholder.weak_value": re.compile(
        r"[：:]\s*(?:`|\*|_)?(?:完成|已完成|同上|见上文)(?:`|\*|_)?\s*(?:$|[。；;，,])",
        re.MULTILINE,
    ),
    "vague.pending": re.compile(r"待补充|待确认|后续确认|视情况|按需"),
    "vague.implementation": re.compile(
        r"实施时检查|复用现有机制|在合适位置|新增相关组件|以目标分支为准|接入所有\s*Ability"
    ),
}


class CanonicalSpecError(ValueError):
    """Raised when a document cannot be parsed as a Canonical Spec."""


@dataclass(frozen=True)
class Section:
    section_id: str
    content: str
    begin_line: int
    end_line: int


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    item_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        value: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.item_id:
            value["item_id"] = self.item_id
        return value


@dataclass
class ValidationReport:
    protocol: str
    status: str | None
    issues: list[ValidationIssue] = field(default_factory=list)
    warnings: list[ValidationIssue] = field(default_factory=list)
    manifest: dict[str, Any] | None = None
    sections: dict[str, Section] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.issues

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol": self.protocol,
            "status": self.status,
            "ok": self.ok,
            "issues": [issue.to_dict() for issue in self.issues],
            "warnings": [warning.to_dict() for warning in self.warnings],
        }


def _read_source(source: str | Path) -> tuple[str, str | None]:
    if isinstance(source, Path):
        return source.read_text(encoding="utf-8"), str(source)
    if "\n" not in source:
        try:
            candidate = Path(source)
            if candidate.is_file():
                return candidate.read_text(encoding="utf-8"), str(candidate)
        except (OSError, ValueError):
            # A document can legitimately be a long single line.  If the
            # operating system cannot even probe it as a path, it is content.
            pass
    return source, None


def parse_manifest(text: str) -> dict[str, Any] | None:
    """Parse the single embedded JSON manifest, or return None for legacy docs."""

    begin_count = text.count(MANIFEST_BEGIN)
    end_count = text.count(MANIFEST_END)
    if begin_count == 0 and end_count == 0:
        return None
    if begin_count != 1 or end_count != 1:
        raise CanonicalSpecError("文档必须且只能包含一组 manifest 边界")
    begin = text.index(MANIFEST_BEGIN) + len(MANIFEST_BEGIN)
    end = text.index(MANIFEST_END)
    if end <= begin:
        raise CanonicalSpecError("manifest 结束标记位于开始标记之前")
    block = text[begin:end].strip()
    fenced = re.fullmatch(r"```json\s*\n([\s\S]*?)\n```", block)
    if not fenced:
        raise CanonicalSpecError("manifest 必须是边界内唯一的 ```json 代码块")
    try:
        manifest = json.loads(fenced.group(1))
    except json.JSONDecodeError as exc:
        raise CanonicalSpecError(
            f"manifest 不是合法 JSON：第 {exc.lineno} 行第 {exc.colno} 列 {exc.msg}"
        ) from exc
    if not isinstance(manifest, dict):
        raise CanonicalSpecError("manifest 顶层必须是 JSON object")
    return manifest


def _parse_section_objects(text: str) -> dict[str, Section]:
    """Parse section objects with line metadata."""

    sections: dict[str, Section] = {}
    current_id: str | None = None
    current_begin = 0
    current_lines: list[str] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        begin_match = SECTION_BEGIN_RE.fullmatch(line.strip())
        end_match = SECTION_END_RE.fullmatch(line.strip())
        if begin_match:
            section_id = begin_match.group(1)
            if current_id is not None:
                raise CanonicalSpecError(
                    f"第 {line_number} 行 section {section_id} 嵌套在 {current_id} 内"
                )
            if section_id in sections:
                raise CanonicalSpecError(f"section id 重复：{section_id}")
            current_id = section_id
            current_begin = line_number
            current_lines = []
            continue
        if end_match:
            section_id = end_match.group(1)
            if current_id is None:
                raise CanonicalSpecError(f"第 {line_number} 行存在无开始标记的 section：{section_id}")
            if section_id != current_id:
                raise CanonicalSpecError(
                    f"第 {line_number} 行结束 {section_id}，但当前 section 是 {current_id}"
                )
            sections[section_id] = Section(
                section_id=section_id,
                content="\n".join(current_lines).strip(),
                begin_line=current_begin,
                end_line=line_number,
            )
            current_id = None
            current_begin = 0
            current_lines = []
            continue
        if current_id is not None:
            current_lines.append(line)
    if current_id is not None:
        raise CanonicalSpecError(f"section 缺少结束标记：{current_id}")
    return sections


def parse_sections(text: str) -> dict[str, str]:
    """Parse non-nested section markers and return section text by ID."""

    return {
        section_id: section.content
        for section_id, section in _parse_section_objects(text).items()
    }


def _normalize_sections(sections: dict[str, Section] | dict[str, str]) -> dict[str, Section]:
    normalized: dict[str, Section] = {}
    for index, (section_id, section) in enumerate(sections.items(), start=1):
        if isinstance(section, Section):
            normalized[section_id] = section
        elif isinstance(section, str):
            normalized[section_id] = Section(section_id, section, index, index)
        else:
            raise CanonicalSpecError(f"section {section_id} 的值必须是字符串或 Section")
    return normalized


def _issue(issues: list[ValidationIssue], code: str, message: str, item_id: str | None = None) -> None:
    issues.append(ValidationIssue(code=code, message=message, item_id=item_id))


def _objects(manifest: dict[str, Any], key: str, issues: list[ValidationIssue]) -> list[dict[str, Any]]:
    value = manifest.get(key)
    if not isinstance(value, list):
        _issue(issues, "manifest.field_type", f"manifest.{key} 必须是数组", key)
        return []
    result: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            _issue(issues, "manifest.item_type", f"manifest.{key}[{index}] 必须是 object", key)
        else:
            result.append(item)
    return result


def _index_objects(
    values: Iterable[dict[str, Any]], id_key: str, kind: str, issues: list[ValidationIssue]
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    pattern = ID_PATTERNS[kind]
    for item in values:
        item_id = item.get(id_key)
        if not isinstance(item_id, str) or not pattern.fullmatch(item_id):
            _issue(issues, "id.invalid", f"{id_key} 格式非法：{item_id!r}", str(item_id))
            continue
        if item_id in result:
            _issue(issues, "id.duplicate", f"{id_key} 重复：{item_id}", item_id)
            continue
        result[item_id] = item
    return result


def _require_string(
    item: dict[str, Any], key: str, issues: list[ValidationIssue], item_id: str
) -> str | None:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        _issue(issues, "field.required", f"{item_id}.{key} 必须是非空字符串", item_id)
        return None
    return value


def _require_string_list(
    item: dict[str, Any], key: str, issues: list[ValidationIssue], item_id: str, nonempty: bool = False
) -> list[str]:
    value = item.get(key)
    if not isinstance(value, list) or any(not isinstance(entry, str) or not entry for entry in value):
        _issue(issues, "field.list", f"{item_id}.{key} 必须是字符串数组", item_id)
        return []
    if nonempty and not value:
        _issue(issues, "field.nonempty", f"{item_id}.{key} 不能为空", item_id)
    if len(value) != len(set(value)):
        _issue(issues, "field.duplicate_ref", f"{item_id}.{key} 包含重复 ID", item_id)
    return value


def _string_list(item: dict[str, Any], key: str) -> list[str]:
    value = item.get(key)
    if not isinstance(value, list):
        return []
    return [entry for entry in value if isinstance(entry, str)]


def _valid_repo_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or value != value.strip():
        return False
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        return False
    if "\\" in value or value.startswith(("/", "~/", "//")):
        return False
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value):
        return False
    raw_parts = value.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and value not in {".", "./"}


def _is_java_path(value: Any) -> bool:
    """Return whether a manifest path identifies a Java source file."""

    return isinstance(value, str) and value.lower().endswith(".java")


def _task_uses_java(
    task_id: str,
    change_by_id: dict[str, dict[str, Any]],
    test_by_id: dict[str, dict[str, Any]],
) -> bool:
    """Identify Java per task from routed implementation and test files."""

    return any(
        change.get("task_id") == task_id and _is_java_path(change.get("path"))
        for change in change_by_id.values()
    ) or any(
        test.get("task_id") == task_id and _is_java_path(test.get("file"))
        for test in test_by_id.values()
    )


def _task_subsections(content: str) -> dict[str, str]:
    """Return fixed task subsection bodies keyed by their protocol heading."""

    bodies: dict[str, list[str]] = {}
    current: str | None = None
    heading_re = re.compile(r"^#{3,6}\s+(?:\d+(?:\.\d+)*\s+)?(.+?)\s*$")
    for line in content.splitlines():
        match = heading_re.match(line.strip())
        if match:
            title = match.group(1)
            current = next((heading for heading in REQUIRED_TASK_HEADINGS if heading in title), None)
            if current is not None:
                bodies.setdefault(current, [])
            continue
        if current is not None:
            bodies[current].append(line)
    return {heading: "\n".join(lines).strip() for heading, lines in bodies.items()}


def _table_values(content: str, marker: str) -> list[str]:
    values: list[str] = []
    lines = content.splitlines()
    for index, line in enumerate(lines):
        if marker not in line or not line.strip().startswith("|"):
            continue
        header_cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        marker_columns = [position for position, cell in enumerate(header_cells) if marker in cell]
        for candidate in lines[index + 1 :]:
            if not candidate.strip().startswith("|"):
                break
            cells = [cell.strip() for cell in candidate.strip().strip("|").split("|")]
            if cells and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                continue
            for position in marker_columns:
                if position < len(cells) and _is_substantive_value(cells[position]):
                    values.append(cells[position])
    return values


def _is_substantive_value(value: str) -> bool:
    normalized = value.strip().strip("`*_ 。；;，,")
    return bool(normalized) and normalized.lower() not in {
        "n/a",
        "na",
        "无",
        "-",
        "完成",
        "已完成",
        "同上",
        "见上文",
        "是",
        "否",
        "开发完成",
        "已处理",
        "依赖已满足",
        "确认完成",
    }


def _labeled_values(content: str, marker: str) -> list[str]:
    values = _table_values(content, marker)
    for line in content.splitlines():
        position = line.find(marker)
        if position < 0 or line.strip().startswith("|"):
            continue
        suffix = line[position + len(marker) :]
        separator = re.search(r"[：:]", suffix)
        if separator:
            value = suffix[separator.end() :]
            if _is_substantive_value(value):
                values.append(value.strip())
    return values


def _has_labeled_value(content: str, marker: str) -> bool:
    return bool(_labeled_values(content, marker))


def _semantic_values(content: str, marker: str) -> list[str]:
    """Read a field from tables or common Chinese prose label forms."""

    values = _labeled_values(content, marker)
    for line in content.splitlines():
        if marker not in line or line.strip().startswith("|"):
            continue
        suffix = line.split(marker, 1)[1]
        match = re.search(r"(?:[：:]|为|是|包括|采用|位于|在|时)\s*(.+)", suffix)
        if match and _is_substantive_value(match.group(1)):
            values.append(match.group(1).strip())
    return values


def _bounded_field_values(content: str, marker: str) -> list[str]:
    """Read one labeled field without leaking into the next semicolon-delimited field."""

    values = _table_values(content, marker)
    for line in content.splitlines():
        if marker not in line or line.strip().startswith("|"):
            continue
        suffix = line.split(marker, 1)[1]
        match = re.search(r"(?:[：:]|为|是|包括|采用|位于|在|时)\s*(.+)", suffix)
        if not match:
            continue
        value = re.split(r"[；;]", match.group(1), maxsplit=1)[0].strip()
        if _is_substantive_value(value):
            values.append(value)
    return values


def _has_semantic_value(content: str, marker: str) -> bool:
    return bool(_semantic_values(content, marker))


def _category_values(content: str, marker: str) -> list[str]:
    """Read a closure category from either prose or the protocol table shape."""

    values = _semantic_values(content, marker)
    for line in content.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not cells or marker not in cells[0] or all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        value = "；".join(cell for cell in cells[1:] if cell)
        if _is_substantive_value(value):
            values.append(value)
    return values


def _entry_context(content: str, object_id: str) -> str:
    """Return the prose line or table header and row that define an object ID."""

    lines = content.splitlines()
    contexts: list[str] = []
    id_pattern = re.compile(
        rf"(?<![A-Za-z0-9-]){re.escape(object_id)}(?![A-Za-z0-9-])"
    )
    for index, line in enumerate(lines):
        if not id_pattern.search(line):
            continue
        if not line.strip().startswith("|"):
            contexts.append(line)
            continue
        block_start = index
        while block_start > 0 and lines[block_start - 1].strip().startswith("|"):
            block_start -= 1
        header = lines[block_start] if block_start < index else ""
        contexts.append("\n".join(part for part in (header, line) if part))
    return "\n".join(contexts)


def _contains_exact_repo_path(content: str, value: Any) -> bool:
    """Match one complete repo-relative path instead of accepting a suffix."""

    if not isinstance(value, str):
        return False
    if f"`{value}`" in content:
        return True
    path_boundary = r"A-Za-z0-9_./-"
    return bool(
        re.search(
            rf"(?<![{path_boundary}]){re.escape(value)}(?![{path_boundary}])",
            content,
        )
    )


def _contains_exact_code_value(content: str, value: Any) -> bool:
    return isinstance(value, str) and f"`{value}`" in content


def _contains_exact_id(content: str, value: Any) -> bool:
    return isinstance(value, str) and bool(
        re.search(
            rf"(?<![A-Za-z0-9-]){re.escape(value)}(?![A-Za-z0-9-])",
            content,
        )
    )


def _is_protocol_id(value: str) -> bool:
    return any(pattern.fullmatch(value) for pattern in ID_PATTERNS.values())


def _contains_exact_action(content: str, value: Any) -> bool:
    return isinstance(value, str) and bool(
        re.search(rf"(?<![A-Za-z]){re.escape(value)}(?![A-Za-z])", content)
    )


def _contains_exact_command(content: str, value: Any) -> bool:
    return isinstance(value, str) and f"`{value}`" in content


def _is_complete_generic_signature(value: str) -> bool:
    """Accept a concrete non-Java type/API/config signature, not a prose label."""

    normalized = value.strip().strip("` 。")
    compact = re.sub(r"\s+", "", normalized)
    if not _is_substantive_value(normalized) or len(compact) < 10:
        return False
    return bool(
        re.search(r"\{[^{}]+\}", normalized)
        or re.search(r"[A-Za-z_$][\w$.-]*\s*\([^)]*\)\s*(?::|->|=>)", normalized)
        or re.search(r"\b(?:GET|POST|PUT|PATCH|DELETE)\s+/\S+", normalized, re.IGNORECASE)
        or re.search(r"[A-Za-z_$][\w$.-]*\s*:\s*[A-Za-z_$][\w$<>,.?\[\] |/-]*", normalized)
    )


def _is_validation_command(value: Any) -> bool:
    if not isinstance(value, str) or not _is_substantive_value(value):
        return False
    if "\n" in value or "\r" in value:
        return False
    return bool(
        re.search(
            r"(?:^|[/_.-])(?:test|verify|check|lint|build|package|compile|e2e)(?:$|[/_. -])|"
            r"\b(?:mvn|mvnw|gradle|gradlew|bazel|pytest|unittest|jest|vitest|phpunit|"
            r"rspec|tox|ctest|playwright|go\s+test|cargo\s+test|dotnet\s+test|"
            r"swift\s+test|mix\s+test|xcodebuild|meson\s+test|ninja\s+test|make(?:\s|$)|"
            r"npm\s+(?:test|run)|pnpm\s+(?:test|run)|yarn\s+(?:test|run)|curl|httpie)\b",
            value,
            re.IGNORECASE,
        )
    )


def _contains_evidence(value: str) -> bool:
    reason = re.search(r"(?:原因|依据)(?:是|为|[：:])?|因为|由于", value)
    if not reason:
        return False
    detail = value[reason.end() :]
    normalized = re.sub(r"[\s`*_。，,；;：:()（）\[\]{}]", "", detail)
    return len(normalized) >= 8 and normalized.lower() not in {
        "现有机制",
        "当前设计",
        "无需处理",
        "没有影响",
    }


def _call_chain_entries(content: str) -> list[tuple[str, str, str, str]]:
    """Extract every prose or table entry from a call-chain Diff subsection."""

    entries: list[tuple[str, str, str, str]] = []
    lines = content.splitlines()

    def inline_value(line: str, marker: str) -> str:
        if marker not in line:
            return ""
        suffix = line.split(marker, 1)[1]
        suffix = re.sub(r"^\s*(?:[：:]|为|是)?\s*", "", suffix)
        return re.split(r"[；;]|改造后", suffix, maxsplit=1)[0].strip()

    for line in lines:
        if line.strip().startswith("|") or "入口" not in line:
            continue
        before = inline_value(line, "改造前")
        after = inline_value(line, "改造后")
        entry_match = re.search(r"入口\s*([^：:；;]+)", line)
        entries.append(
            (
                entry_match.group(1).strip() if entry_match else "",
                before,
                after,
                line,
            )
        )

    for index, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        headers = [cell.strip() for cell in line.strip().strip("|").split("|")]
        positions: dict[str, int] = {}
        for marker in ("入口", "改造前", "改造后"):
            position = next(
                (cell_index for cell_index, cell in enumerate(headers) if marker in cell),
                None,
            )
            if position is not None:
                positions[marker] = position
        if len(positions) != 3:
            continue
        for candidate in lines[index + 1 :]:
            if not candidate.strip().startswith("|"):
                break
            cells = [cell.strip() for cell in candidate.strip().strip("|").split("|")]
            if cells and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                continue
            if max(positions.values()) >= len(cells):
                entries.append(("", "", "", candidate))
                continue
            entries.append(
                (
                    cells[positions["入口"]],
                    cells[positions["改造前"]],
                    cells[positions["改造后"]],
                    candidate,
                )
            )
        break
    return entries


def _is_negative_closure(value: str) -> bool:
    return bool(re.search(r"N/A|不涉及|无相关|不新增|不生产|不消费|不修改|不提供", value, re.IGNORECASE))


def _task_objects(
    task_id: str, objects: dict[str, dict[str, Any]]
) -> list[tuple[str, dict[str, Any]]]:
    return [(object_id, value) for object_id, value in objects.items() if value.get("task_id") == task_id]


def _validate_ready_task_closure(
    task_id: str,
    subsection_bodies: dict[str, str],
    change_by_id: dict[str, dict[str, Any]],
    step_by_id: dict[str, dict[str, Any]],
    test_by_id: dict[str, dict[str, Any]],
    issues: list[ValidationIssue],
) -> None:
    """Require each READY task subsection to close its implementation contract."""

    missing: list[str] = []
    goal_body = subsection_bodies.get("目标、交付物与非目标", "")
    for marker in ("目标", "交付物", "非目标"):
        if not _has_semantic_value(goal_body, marker):
            missing.append(f"目标小节缺少 {marker} 的具体值")

    file_body = subsection_bodies.get("文件与符号级改动", "")
    task_changes = _task_objects(task_id, change_by_id)
    for change_id, change in task_changes:
        change_context = _entry_context(file_body, change_id)
        absent: list[str] = []
        if not _contains_exact_action(change_context, change.get("action")):
            absent.append(f"action={change.get('action')}")
        for symbol in _string_list(change, "symbols"):
            if not _contains_exact_code_value(change_context, symbol):
                absent.append(f"symbol={symbol}")
        for field_name in ("repo_id", "module"):
            value = change.get(field_name)
            if not _contains_exact_code_value(change_context, value):
                absent.append(f"{field_name}={value}")
        if not _contains_exact_repo_path(change_context, change.get("path")):
            absent.append(str(change.get("path")))
        if absent:
            missing.append(f"{change_id} 文件清单缺少 {', '.join(absent)}")

    call_body = subsection_bodies.get("调用链 Diff", "")
    call_entries = _call_chain_entries(call_body)
    if not call_entries:
        missing.append("调用链缺少逐入口的改造前和改造后记录")
    for index, (entry, before, after, entry_text) in enumerate(call_entries, start=1):
        entry_label = entry or f"第 {index} 条入口"
        if not _is_substantive_value(entry):
            missing.append(f"调用链 {entry_label} 缺少具体入口")
        if not _is_substantive_value(before):
            missing.append(f"调用链 {entry_label} 缺少改造前")
        elif "->" not in before and "→" not in before and not re.search(
            r"不存在|无此入口|尚无|未提供", before
        ):
            missing.append(f"调用链 {entry_label} 的改造前缺少节点链路或不存在说明")
        if not _is_substantive_value(after):
            missing.append(f"调用链 {entry_label} 缺少改造后")
        elif "->" not in after and "→" not in after:
            missing.append(f"调用链 {entry_label} 的改造后缺少节点链路")
        if not re.search(
            r"失败|异常|回滚|拒绝|404|Nack|Reject|错误|超时|重试|返回",
            entry_text,
            re.IGNORECASE,
        ):
            missing.append(f"调用链 {entry_label} 缺少行为差异或失败路径")

    contract_body = subsection_bodies.get("新增或修改类型契约", "")
    for marker in ("package", "字段类型", "空值", "异常", "调用方", "实现方"):
        if not _has_labeled_value(contract_body, marker):
            missing.append(f"类型契约缺少 {marker} 的具体值")
    signature_values = [
        value
        for marker in ("完整 Java 签名", "完整签名", "接口签名", "等价签名")
        for value in _labeled_values(contract_body, marker)
    ]
    if not signature_values:
        missing.append("类型契约缺少完整签名")
    elif not _task_uses_java(task_id, change_by_id, test_by_id) and not all(
        _is_complete_generic_signature(value) for value in signature_values
    ):
        missing.append("非 Java 类型契约的完整签名缺少可执行结构")

    closure_body = subsection_bodies.get("存储、消息与配置闭环", "")
    for marker in ("DDL", "DO", "Mapper", "Repo", "消息", "配置"):
        values = _category_values(closure_body, marker)
        if not values:
            missing.append(f"闭环小节缺少 {marker} 的具体值")
        elif any(_is_negative_closure(value) and not _contains_evidence(value) for value in values):
            missing.append(f"{marker} 声明不涉及但缺少事实原因或代码证据")

    storage_values = [
        value
        for marker in ("DDL", "DO", "Mapper", "Repo")
        for value in _category_values(closure_body, marker)
    ]
    if storage_values and not any(_is_negative_closure(value) for value in storage_values):
        storage_text = "\n".join(storage_values)
        if not re.search(r"`[^`]+(?:#[^`]+|/[^`]+)`", storage_text):
            missing.append("存储闭环缺少 DDL/DO/Mapper/Repo 的实现文件或符号")
        if not re.search(r"事务|回滚|幂等|锁|唯一键|transaction|rollback|idempoten", storage_text, re.IGNORECASE):
            missing.append("存储闭环缺少事务、幂等或回退语义")

    message_values = _category_values(closure_body, "消息")
    if message_values and not any(_is_negative_closure(value) for value in message_values):
        message_text = "\n".join(message_values)
        if not re.search(r"生产|发布|发送|消费|订阅|producer|consumer|publish|subscribe", message_text, re.IGNORECASE):
            missing.append("消息闭环缺少生产或消费语义")
        if not re.search(
            r"幂等|去重|唯一键|业务键|insertIfAbsent|putIfAbsent|setnx|dedup|idempoten",
            message_text,
            re.IGNORECASE,
        ):
            missing.append("消息闭环缺少幂等实现")
        if not re.search(r"重试|退避|死信|Nack|Reject|retry|backoff|dead.?letter", message_text, re.IGNORECASE):
            missing.append("消息闭环缺少重试或终止处理")

    config_values = _category_values(closure_body, "配置")
    if config_values and not any(_is_negative_closure(value) for value in config_values):
        config_text = "\n".join(config_values)
        if not re.search(r"`[^`]+`", config_text):
            missing.append("配置闭环缺少可复制的配置 key")
        if not re.search(r"类型|boolean|string|integer|int|long|number|enum", config_text, re.IGNORECASE):
            missing.append("配置闭环缺少字段类型")
        if not re.search(r"默认|环境|灰度|default|environment|env", config_text, re.IGNORECASE):
            missing.append("配置闭环缺少默认值或环境差异")
        if not re.search(r"回退|关闭|恢复|rollback|disable|restore", config_text, re.IGNORECASE):
            missing.append("配置闭环缺少回退值或关闭动作")

    step_body = subsection_bodies.get("符号级实施步骤", "")
    covered_change_ids: set[str] = set()
    covered_test_ids: set[str] = set()
    covered_symbols: set[tuple[str, str]] = set()
    for step_id, step in _task_objects(task_id, step_by_id):
        step_context = _entry_context(step_body, step_id)
        if not step_context:
            missing.append(f"实施步骤缺少 {step_id}")
            continue
        step_change_ids = _string_list(step, "change_ids")
        step_test_ids = _string_list(step, "test_ids")
        for reference in (*step_change_ids, *step_test_ids):
            if not _contains_exact_id(step_context, reference):
                missing.append(f"{step_id} 缺少追踪引用 {reference}")
        covered_change_ids.update(step_change_ids)
        covered_test_ids.update(step_test_ids)
        linked_symbols = [
            (change_id, symbol)
            for change_id in step_change_ids
            for symbol in _string_list(change_by_id.get(change_id, {}), "symbols")
        ]
        step_symbols = {
            (change_id, symbol)
            for change_id, symbol in linked_symbols
            if _contains_exact_code_value(step_context, symbol)
        }
        covered_symbols.update(step_symbols)
        if linked_symbols and not step_symbols:
            missing.append(f"{step_id} 缺少 Class#method 或等价符号插入位置")
        has_relative_location = bool(
            re.search(
                r"插入位置|(?:在|于).{0,120}(?:之前|之后|前|后|首行|末尾|内部)",
                step_context,
            )
        )
        linked_changes = [change_by_id.get(change_id, {}) for change_id in step_change_ids]
        defines_added_symbol = bool(linked_changes) and all(
            change.get("action") == "add" for change in linked_changes
        ) and "新增" in step_context
        if not has_relative_location and not defines_added_symbol:
            missing.append(f"{step_id} 缺少明确插入位置")
        if "输入" not in step_context:
            missing.append(f"{step_id} 缺少输入语义")
        if "输出" not in step_context and "返回" not in step_context:
            missing.append(f"{step_id} 缺少输出语义")
        if not re.search(r"失败|异常|回滚|拒绝|404|Nack|Reject", step_context, re.IGNORECASE):
            missing.append(f"{step_id} 缺少失败处理")
    for change_id, _ in task_changes:
        if change_id not in covered_change_ids:
            missing.append(f"{change_id} 没有被任何实施步骤覆盖")
    for change_id, change in task_changes:
        for symbol in _string_list(change, "symbols"):
            if (change_id, symbol) not in covered_symbols:
                missing.append(f"{change_id} 的符号 {symbol} 没有被任何实施步骤覆盖")

    test_body = subsection_bodies.get("测试映射", "")
    for test_id, test in _task_objects(task_id, test_by_id):
        test_context = _entry_context(test_body, test_id)
        covered_steps = [
            step_id
            for step_id, step in _task_objects(task_id, step_by_id)
            if test_id in _string_list(step, "test_ids")
        ]
        for value, label in (
            (test_id, "Test ID"),
            (test.get("command"), "验证命令"),
        ):
            present = (
                _contains_exact_id(test_context, value)
                if label == "Test ID"
                else _contains_exact_command(test_context, value)
            )
            if isinstance(value, str) and not present:
                missing.append(f"{test_id} 缺少{label} {value}")
        if not _contains_exact_repo_path(test_context, test.get("file")):
            missing.append(f"{test_id} 缺少测试文件 {test.get('file')}")
        if test_id not in covered_test_ids:
            missing.append(f"{test_id} 没有被任何实施步骤覆盖")
        for step_id in covered_steps:
            if not _contains_exact_id(test_context, step_id):
                missing.append(f"{test_id} 缺少覆盖 Step {step_id}")
        for marker in ("场景", "Mock"):
            if not _has_semantic_value(test_context, marker):
                missing.append(f"{test_id} 缺少 {marker}")
        if not any(
            _has_semantic_value(test_context, marker)
            for marker in ("期望证据", "证据", "断言")
        ):
            missing.append(f"{test_id} 缺少期望证据或断言")

    risk_body = subsection_bodies.get("风险、回退与完成证据", "")
    for marker in ("风险", "回退", "完成证据"):
        if not _has_semantic_value(risk_body, marker):
            missing.append(f"风险小节缺少 {marker} 的具体值")

    for detail in missing:
        _issue(issues, "ready.task_closure", f"{task_id} 实施闭环不完整：{detail}", task_id)


def _section_detail(content: str) -> str:
    lines = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("|"):
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            if cells and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                continue
        lines.append(stripped)
    return "\n".join(lines)


def _is_verifiable_dependency_evidence(value: Any) -> bool:
    if not isinstance(value, str) or not _is_substantive_value(value):
        return False
    compact = re.sub(r"[\s`*_。，,；;：:()（）\[\]{}]", "", value)
    if len(compact) < 8:
        return False
    return bool(
        re.search(
            r"测试|命令|文件|路径|版本|revision|commit|sha|签名|契约|冻结|"
            r"接口|响应|状态码|日志|报告|审批|记录|通过|pass(?:es|ed)?|frozen|result",
            value,
            re.IGNORECASE,
        )
        or re.search(r"(?:^|\s)(?:\./|/)?[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+", value)
    )


def _validate_ready_manifest_values(
    manifest: dict[str, Any],
    repositories: Iterable[dict[str, Any]],
    contracts: Iterable[dict[str, Any]],
    tasks: Iterable[dict[str, Any]],
    changes: Iterable[dict[str, Any]],
    tests: Iterable[dict[str, Any]],
    issues: list[ValidationIssue],
) -> None:
    """Reject syntactically present but implementation-empty routing values."""

    scalar_values: list[tuple[str, Any, str]] = [
        ("manifest.spec_id", manifest.get("spec_id"), "manifest"),
        ("manifest.title", manifest.get("title"), "manifest"),
    ]
    for repo in repositories:
        repo_id = str(repo.get("repo_id", "repository"))
        scalar_values.extend(
            (
                (f"{repo_id}.name", repo.get("name"), repo_id),
                (f"{repo_id}.path_hint", repo.get("path_hint"), repo_id),
            )
        )
        baseline = repo.get("baseline")
        if isinstance(baseline, dict):
            scalar_values.append((f"{repo_id}.baseline.ref", baseline.get("ref"), repo_id))
        for index, tech in enumerate(_string_list(repo, "tech_stack")):
            scalar_values.append((f"{repo_id}.tech_stack[{index}]", tech, repo_id))
    for contract in contracts:
        contract_id = str(contract.get("contract_id", "contract"))
        scalar_values.append((f"{contract_id}.name", contract.get("name"), contract_id))
    for task in tasks:
        task_id = str(task.get("task_id", "task"))
        scalar_values.append((f"{task_id}.title", task.get("title"), task_id))
        dependencies = task.get("depends_on")
        if isinstance(dependencies, list):
            for dependency in dependencies:
                if not isinstance(dependency, dict):
                    continue
                evidence = dependency.get("required_evidence")
                if not _is_verifiable_dependency_evidence(evidence):
                    _issue(
                        issues,
                        "ready.dependency_evidence",
                        f"{task_id} 对 {dependency.get('task_id')} 的 required_evidence 不可检查",
                        task_id,
                    )
    for change in changes:
        change_id = str(change.get("change_id", "change"))
        scalar_values.append((f"{change_id}.module", change.get("module"), change_id))
        for index, symbol in enumerate(_string_list(change, "symbols")):
            scalar_values.append((f"{change_id}.symbols[{index}]", symbol, change_id))
    for test in tests:
        test_id = str(test.get("test_id", "test"))
        command = test.get("command")
        scalar_values.append((f"{test_id}.command", command, test_id))
        if isinstance(command, str) and _is_substantive_value(command) and not _is_validation_command(command):
            _issue(
                issues,
                "ready.test_command",
                f"{test_id}.command 不是可识别的测试、构建、检查或接口验证命令",
                test_id,
            )

    for field_name, value, item_id in scalar_values:
        if not isinstance(value, str) or not _is_substantive_value(value):
            _issue(
                issues,
                "ready.manifest_value",
                f"{field_name} 仍是占位值，不能标记 READY",
                item_id,
            )


def _validate_ready_non_task_sections(
    repo_by_id: dict[str, dict[str, Any]],
    contract_by_id: dict[str, dict[str, Any]],
    task_by_id: dict[str, dict[str, Any]],
    section_objects: dict[str, Section],
    issues: list[ValidationIssue],
) -> None:
    """Validate implementation-bearing Canonical regions outside task bodies."""

    def require_tokens(
        section_id: str,
        tokens: Iterable[str],
        label: str,
        any_token: bool = False,
        include_headings: bool = False,
    ) -> None:
        section = section_objects.get(section_id)
        if not section:
            return
        detail = _section_detail(section.content)
        if not _is_substantive_value(detail):
            _issue(
                issues,
                "ready.section_closure",
                f"{section_id} 只有标题或占位结论，缺少 {label}",
                section_id,
            )
            return
        search_content = section.content if include_headings else detail
        token_list = [token for token in tokens if token]
        present = [
            token
            for token in token_list
            if (
                _contains_exact_id(search_content, token)
                if _is_protocol_id(token)
                else token in search_content
            )
        ]
        if (any_token and not present) or (not any_token and len(present) != len(token_list)):
            missing = (
                token_list
                if any_token
                else [token for token in token_list if token not in present]
            )
            _issue(
                issues,
                "ready.section_closure",
                f"{section_id} 缺少 {label}：{', '.join(missing)}",
                section_id,
            )

    def require_markers(section_id: str, markers: Iterable[str], label: str) -> None:
        section = section_objects.get(section_id)
        if not section:
            return
        detail = _section_detail(section.content)
        missing = [marker for marker in markers if not _has_semantic_value(detail, marker)]
        if missing:
            _issue(
                issues,
                "ready.section_closure",
                f"{section_id} 缺少带具体值的 {label}：{', '.join(missing)}",
                section_id,
            )

    def require_field_tokens(
        section_id: str, marker: str, tokens: Iterable[str], label: str
    ) -> None:
        section = section_objects.get(section_id)
        if not section:
            return
        values = _bounded_field_values(_section_detail(section.content), marker)
        field_content = "\n".join(values)
        missing = [
            token
            for token in tokens
            if token
            and not (
                _contains_exact_id(field_content, token)
                if _is_protocol_id(token)
                else token in field_content
            )
        ]
        if missing:
            _issue(
                issues,
                "ready.section_closure",
                f"{section_id} 的 {marker} 缺少 {label}：{', '.join(missing)}",
                section_id,
            )

    require_markers(
        "global-context",
        ("总目标", "成功指标", "输入与证据", "范围", "非目标", "兼容约束", "安全与性能约束", "已关闭架构决策"),
        "全局约束字段",
    )

    for contract_id, contract in contract_by_id.items():
        section_id = str(contract.get("section_id"))
        consumer_task_ids = _string_list(contract, "consumer_task_ids")
        require_tokens(
            section_id,
            (
                str(contract.get("name", "")),
            ),
            "契约名称",
            include_headings=True,
        )
        require_field_tokens(
            section_id,
            "定义方任务",
            (str(contract.get("owner_task_id", "")),),
            "定义方任务 ID",
        )
        require_field_tokens(
            section_id,
            "消费方任务",
            consumer_task_ids,
            "消费方任务 ID",
        )
        require_markers(
            section_id,
            ("定义方任务", "消费方任务", "package", "字段", "类型", "空值", "异常", "调用方", "实现方", "兼容"),
            "共享契约字段",
        )
        section = section_objects.get(section_id)
        detail = _section_detail(section.content) if section else ""
        java_signature_values = _semantic_values(detail, "完整 Java 签名")
        generic_signature_values = _semantic_values(detail, "完整签名")
        if section and not java_signature_values and not generic_signature_values:
            _issue(
                issues,
                "ready.section_closure",
                f"{section_id} 缺少带具体值的完整签名",
                section_id,
            )
        elif java_signature_values and not _complete_java_signatures(detail):
            _issue(
                issues,
                "ready.section_closure",
                f"{section_id} 的完整 Java 签名不合法",
                section_id,
            )
        elif generic_signature_values and not all(
            _is_complete_generic_signature(value) for value in generic_signature_values
        ):
            _issue(
                issues,
                "ready.section_closure",
                f"{section_id} 的完整签名缺少可执行的类型、接口或配置结构",
                section_id,
            )

    for repo_id, repo in repo_by_id.items():
        section_id = str(repo.get("section_id"))
        baseline = repo.get("baseline") if isinstance(repo.get("baseline"), dict) else {}
        repo_task_ids = [
            task_id for task_id, task in task_by_id.items() if task.get("repo_id") == repo_id
        ]
        require_tokens(
            section_id,
            (
                repo_id,
                str(repo.get("name", "")),
            ),
            "仓库 ID 与名称",
            include_headings=True,
        )
        require_tokens(
            section_id,
            (
                str(baseline.get("ref", "")),
                str(baseline.get("commit", "")),
                *repo_task_ids,
            ),
            "仓库基线和任务 ID",
        )
        require_markers(
            section_id,
            ("职责边界", "normalized remote", "基线", "技术栈与本地规范", "当前代码证据", "本仓库任务与波次"),
            "仓库身份、基线、证据和任务波次字段",
        )
        remotes = _string_list(repo, "remote_urls")
        if remotes:
            section = section_objects.get(section_id)
            remote_values = (
                _bounded_field_values(_section_detail(section.content), "normalized remote")
                if section
                else []
            )
            if not any(remote in "\n".join(remote_values) for remote in remotes):
                _issue(
                    issues,
                    "ready.section_closure",
                    f"{section_id} 的 normalized remote 未包含 manifest 中的 remote",
                    section_id,
                )
        require_field_tokens(
            section_id,
            "基线",
            (str(baseline.get("ref", "")), str(baseline.get("commit", ""))),
            "manifest 基线",
        )

    dependency_types = sorted(
        {
            dependency.get("type")
            for task in task_by_id.values()
            for dependency in (
                task.get("depends_on") if isinstance(task.get("depends_on"), list) else []
            )
            if isinstance(dependency, dict) and isinstance(dependency.get("type"), str)
        }
    )
    require_tokens(
        "integration-plan",
        (*task_by_id.keys(), *contract_by_id.keys(), *dependency_types),
        "任务、契约和依赖类型",
    )
    require_markers(
        "integration-plan",
        ("参与任务", "联调入口", "完成证据"),
        "联调字段",
    )
    require_tokens("rollout-plan", repo_by_id.keys(), "仓库发布范围")
    require_markers(
        "rollout-plan", ("发布顺序", "全链路回退触发条件与动作"), "发布与回退字段"
    )
    require_markers(
        "rollout-plan", ("配置 / DDL / 消息切换顺序", "兼容窗口"), "切换与兼容字段"
    )
    require_tokens(
        "rollout-plan", ("配置", "DDL", "消息"), "配置、DDL 或消息切换顺序", any_token=True
    )
    require_tokens(
        "end-to-end-acceptance",
        task_by_id.keys(),
        "验收任务",
    )
    require_markers(
        "end-to-end-acceptance",
        ("覆盖任务", "场景", "前置数据 / Mock 边界", "执行命令或入口", "通过标准"),
        "全链路验收字段",
    )


def _java_packages(content: str) -> set[str]:
    packages: set[str] = set()
    for value in _labeled_values(content, "package"):
        normalized = value.strip().strip("` ;。").removeprefix("package ").removesuffix(";")
        if re.fullmatch(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+", normalized):
            packages.add(normalized)
    return packages


def _complete_java_signatures(content: str) -> list[str]:
    signatures: list[str] = []
    for value in _labeled_values(content, "完整 Java 签名"):
        normalized = value.strip().strip("` 。")
        type_declaration = re.search(
            r"\b(?:class|interface|record|enum)\s+[A-Za-z_$][\w$]*[^{}]*\{[\s\S]*\}\s*;?$",
            normalized,
        )
        method_declaration = re.search(
            r"(?:^|\s)(?:public|protected|private)\s+(?:static\s+)?"
            r"[A-Za-z_$][\w$<>,.?\[\] ]*\s+[A-Za-z_$][\w$]*\s*"
            r"\([^)]*\)(?:\s+throws\s+[A-Za-z_$][\w$., ]*)?\s*;?$",
            normalized,
        )
        if type_declaration or method_declaration:
            signatures.append(normalized)
    return signatures


def _java_package_from_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    parts = PurePosixPath(value).parts
    try:
        java_index = parts.index("java")
    except ValueError:
        return None
    package_parts = parts[java_index + 1 : -1]
    if not package_parts:
        return None
    package_name = ".".join(package_parts)
    if re.fullmatch(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+", package_name):
        return package_name
    return None


def _java_symbol_covered(
    symbol: str, signatures: list[str], task_class_names: set[str]
) -> bool:
    class_name, separator, member_name = symbol.partition("#")
    class_name = class_name.rsplit(".", 1)[-1]
    for signature in signatures:
        declared_types = set(
            re.findall(r"\b(?:class|interface|record|enum)\s+([A-Za-z_$][\w$]*)", signature)
        )
        if declared_types:
            if class_name not in declared_types:
                continue
            if not separator or re.search(rf"\b{re.escape(member_name)}\s*\(", signature):
                return True
            continue
        if len(task_class_names) == 1 and class_name in task_class_names:
            if separator and re.search(rf"\b{re.escape(member_name)}\s*\(", signature):
                return True
    return False


def _is_closed_decision(value: str) -> bool:
    normalized = re.sub(r"^[\s>*_`#\-：:]+", "", value).strip()
    return bool(
        re.match(
            r"^(?:无(?:开放项|待决项|需决策事项)?|不涉及|已关闭|均已关闭|全部已关闭)(?:[，,。；;：:].*)?$",
            normalized,
        )
    )


def _has_open_architecture_decision(text: str) -> bool:
    keywords = ("待用户决策", "开放决策", "未关闭架构决策")
    lines = text.splitlines()
    for index, line in enumerate(lines):
        keyword = next((candidate for candidate in keywords if candidate in line), None)
        if keyword is None:
            continue
        if re.search(
            r"(?:无|没有|不存在)\s*(?:待用户决策|开放决策|未关闭架构决策)", line
        ):
            continue
        suffix = line.split(keyword, 1)[1]
        if suffix.strip(" \t：:。"):
            if not _is_closed_decision(suffix):
                return True
            continue
        next_content = ""
        for candidate in lines[index + 1 :]:
            if candidate.strip():
                next_content = candidate
                break
        if not next_content or not _is_closed_decision(next_content):
            return True
    return False


def _has_unresolved_choice_language(value: str) -> bool:
    pending = re.compile(r"待选择|待决定|待拍板|尚未决定|未决定|二选一|多选一|任选")
    for match in pending.finditer(value):
        prefix = value[max(0, match.start() - 8) : match.start()]
        if not re.search(r"(?:无|没有|不存在|已无)\s*$", prefix):
            return True
    alternatives = re.search(
        r"方案\s*[A-ZＡ-Ｚ]\s*(?:或|/|、)\s*[A-ZＡ-Ｚ]", value, re.IGNORECASE
    )
    if alternatives:
        prefix = value[max(0, alternatives.start() - 8) : alternatives.start()]
        if not re.search(r"(?:不采用|已排除|已拒绝|均不采用)\s*$", prefix):
            return True
    return bool(
        re.search(
            r"(?:由|交由)(?:开发者|研发|实施方|实现方).{0,12}(?:选择|决定|确认|拍板)|"
            r"实现时.{0,8}(?:选择|决定|确认)",
            value,
            re.IGNORECASE,
        )
    )


def _has_developer_owned_choice(text: str) -> bool:
    """Find unresolved implementation choices even when hidden outside the decision field."""

    pending = re.compile(r"待选择|待决定|待拍板|尚未决定|未决定|二选一|多选一|任选")
    for match in pending.finditer(text):
        prefix = text[max(0, match.start() - 8) : match.start()]
        if not re.search(r"(?:无|没有|不存在|已无)\s*$", prefix):
            return True
    return bool(
        re.search(
            r"(?:由|交由)(?:开发者|研发|实施方|实现方).{0,16}(?:选择|决定|确认|拍板)|"
            r"实现时.{0,12}(?:选择|决定|确认)",
            text,
            re.IGNORECASE,
        )
    )


def _check_dag(
    nodes: Iterable[str], edges: dict[str, list[str]], issues: list[ValidationIssue], code: str
) -> None:
    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(node: str) -> None:
        if state.get(node) == 2:
            return
        if state.get(node) == 1:
            start = stack.index(node) if node in stack else 0
            cycle = " -> ".join(stack[start:] + [node])
            _issue(issues, code, f"依赖图存在环：{cycle}", node)
            return
        state[node] = 1
        stack.append(node)
        for dependency in edges.get(node, []):
            if dependency in edges:
                visit(dependency)
        stack.pop()
        state[node] = 2

    for node in nodes:
        visit(node)


def validate_model(
    manifest: dict[str, Any],
    sections: dict[str, Section] | dict[str, str],
    text: str = "",
    require_ready: bool = False,
) -> ValidationReport:
    """Validate manifest structure, traceability, section contracts, and READY gates."""

    issues: list[ValidationIssue] = []
    section_objects = _normalize_sections(sections)
    if manifest.get("schema") != SCHEMA:
        _issue(issues, "schema.unsupported", f"schema 必须是 {SCHEMA}", "schema")
    _require_string(manifest, "spec_id", issues, "manifest")
    _require_string(manifest, "title", issues, "manifest")
    revision = manifest.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        _issue(issues, "revision.invalid", "revision 必须是大于等于 1 的整数", "revision")
    status = manifest.get("status")
    if status not in VALID_STATUSES:
        _issue(issues, "status.invalid", "文档 status 必须是 DRAFT、BLOCKED 或 READY", "status")
    ready_requested = require_ready or status == "READY"

    repositories = _objects(manifest, "repositories", issues)
    contracts = _objects(manifest, "contracts", issues)
    tasks = _objects(manifest, "tasks", issues)
    changes = _objects(manifest, "changes", issues)
    steps = _objects(manifest, "steps", issues)
    tests = _objects(manifest, "tests", issues)
    repo_by_id = _index_objects(repositories, "repo_id", "repository", issues)
    contract_by_id = _index_objects(contracts, "contract_id", "contract", issues)
    task_by_id = _index_objects(tasks, "task_id", "task", issues)
    change_by_id = _index_objects(changes, "change_id", "change", issues)
    step_by_id = _index_objects(steps, "step_id", "step", issues)
    test_by_id = _index_objects(tests, "test_id", "test", issues)

    if not repo_by_id:
        _issue(issues, "repositories.empty", "至少需要一个仓库", "repositories")
    if not task_by_id:
        _issue(issues, "tasks.empty", "至少需要一个实施任务", "tasks")

    required_section_ids = {"global-context", "integration-plan", "rollout-plan", "end-to-end-acceptance"}
    for repo_id, repo in repo_by_id.items():
        _require_string(repo, "name", issues, repo_id)
        remote_urls = _require_string_list(repo, "remote_urls", issues, repo_id, nonempty=True)
        for remote in remote_urls:
            if not re.match(r"^(https?://|ssh://|git://|git@|file://)", remote):
                _issue(issues, "repository.remote", f"{repo_id}.remote_urls 含非法 remote：{remote}", repo_id)
        _require_string(repo, "path_hint", issues, repo_id)
        _require_string_list(repo, "tech_stack", issues, repo_id, nonempty=True)
        baseline = repo.get("baseline")
        if not isinstance(baseline, dict):
            _issue(issues, "repository.baseline", f"{repo_id}.baseline 必须是 object", repo_id)
        else:
            _require_string(baseline, "ref", issues, repo_id)
            commit = baseline.get("commit")
            if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", commit):
                _issue(issues, "repository.commit", f"{repo_id}.baseline.commit 必须是完整 40 位 SHA", repo_id)
        section_id = _require_string(repo, "section_id", issues, repo_id)
        expected = f"repo-{repo_id.lower()}"
        if section_id and section_id != expected:
            _issue(issues, "section.naming", f"{repo_id}.section_id 必须是 {expected}", repo_id)
        if section_id:
            required_section_ids.add(section_id)

    for contract_id, contract in contract_by_id.items():
        _require_string(contract, "name", issues, contract_id)
        owner = _require_string(contract, "owner_task_id", issues, contract_id)
        consumers = _require_string_list(contract, "consumer_task_ids", issues, contract_id, nonempty=True)
        if owner and owner not in task_by_id:
            _issue(issues, "reference.missing", f"{contract_id} 引用不存在的 owner task：{owner}", contract_id)
        for consumer in consumers:
            if consumer not in task_by_id:
                _issue(issues, "reference.missing", f"{contract_id} 引用不存在的 consumer task：{consumer}", contract_id)
        section_id = _require_string(contract, "section_id", issues, contract_id)
        expected = f"contract-{contract_id.lower()}"
        if section_id and section_id != expected:
            _issue(issues, "section.naming", f"{contract_id}.section_id 必须是 {expected}", contract_id)
        if section_id:
            required_section_ids.add(section_id)

    task_edges: dict[str, list[str]] = {}
    for task_id, task in task_by_id.items():
        repo_id = task.get("repo_id")
        match = ID_PATTERNS["task"].fullmatch(task_id)
        if repo_id not in repo_by_id:
            _issue(issues, "reference.missing", f"{task_id}.repo_id 不存在：{repo_id}", task_id)
        if match and repo_id != match.group(1):
            _issue(issues, "task.repo_mismatch", f"{task_id} 必须隶属于仓库 {match.group(1)}", task_id)
        _require_string(task, "title", issues, task_id)
        task_status = task.get("status")
        if task_status not in VALID_STATUSES:
            _issue(issues, "status.invalid", f"{task_id}.status 非法：{task_status}", task_id)
        section_id = _require_string(task, "section_id", issues, task_id)
        expected = f"task-{task_id.lower()}"
        if section_id and section_id != expected:
            _issue(issues, "section.naming", f"{task_id}.section_id 必须是 {expected}", task_id)
        if section_id:
            required_section_ids.add(section_id)
        dependencies = task.get("depends_on")
        if not isinstance(dependencies, list):
            _issue(issues, "dependency.type", f"{task_id}.depends_on 必须是数组", task_id)
            dependencies = []
        dependency_ids: list[str] = []
        seen_dependencies: set[str] = set()
        for dependency in dependencies:
            if not isinstance(dependency, dict):
                _issue(issues, "dependency.item", f"{task_id}.depends_on 元素必须是 object", task_id)
                continue
            dependency_id = dependency.get("task_id")
            dependency_type = dependency.get("type")
            evidence = dependency.get("required_evidence")
            if dependency_id not in task_by_id:
                _issue(issues, "reference.missing", f"{task_id} 依赖不存在的任务：{dependency_id}", task_id)
            if dependency_id == task_id:
                _issue(issues, "dependency.self", f"{task_id} 不能依赖自身", task_id)
            if dependency_id in seen_dependencies:
                _issue(issues, "dependency.duplicate", f"{task_id} 重复依赖 {dependency_id}", task_id)
            if isinstance(dependency_id, str):
                dependency_ids.append(dependency_id)
                seen_dependencies.add(dependency_id)
            if dependency_type not in VALID_DEPENDENCY_TYPES:
                _issue(issues, "dependency.kind", f"{task_id} 依赖类型非法：{dependency_type}", task_id)
            if not isinstance(evidence, str) or not evidence.strip():
                _issue(issues, "dependency.evidence", f"{task_id} 的依赖必须声明 required_evidence", task_id)
        task_edges[task_id] = dependency_ids
        _require_string_list(task, "change_ids", issues, task_id, nonempty=True)
        _require_string_list(task, "step_ids", issues, task_id, nonempty=True)
        _require_string_list(task, "test_ids", issues, task_id, nonempty=True)
    _check_dag(task_by_id, task_edges, issues, "dependency.cycle")

    for change_id, change in change_by_id.items():
        task_id = change.get("task_id")
        repo_id = change.get("repo_id")
        if task_id not in task_by_id:
            _issue(issues, "reference.missing", f"{change_id}.task_id 不存在：{task_id}", change_id)
        if repo_id not in repo_by_id:
            _issue(issues, "reference.missing", f"{change_id}.repo_id 不存在：{repo_id}", change_id)
        if task_id in task_by_id and repo_id != task_by_id[task_id].get("repo_id"):
            _issue(issues, "change.repo_mismatch", f"{change_id} 与所属任务仓库不一致", change_id)
        _require_string(change, "module", issues, change_id)
        path = change.get("path")
        if not _valid_repo_path(path):
            _issue(issues, "path.invalid", f"{change_id}.path 必须是安全的 repo-relative path：{path!r}", change_id)
        if change.get("action") not in VALID_ACTIONS:
            _issue(issues, "change.action", f"{change_id}.action 必须是 add、modify 或 delete", change_id)
        _require_string_list(change, "symbols", issues, change_id, nonempty=True)

    step_edges: dict[str, list[str]] = {}
    for step_id, step in step_by_id.items():
        task_id = step.get("task_id")
        if task_id not in task_by_id:
            _issue(issues, "reference.missing", f"{step_id}.task_id 不存在：{task_id}", step_id)
        change_ids = _require_string_list(step, "change_ids", issues, step_id, nonempty=True)
        test_ids = _require_string_list(step, "test_ids", issues, step_id, nonempty=True)
        dependencies = _require_string_list(step, "depends_on_step_ids", issues, step_id)
        for change_id in change_ids:
            if change_id not in change_by_id:
                _issue(issues, "reference.missing", f"{step_id} 引用不存在的 change：{change_id}", step_id)
            elif change_by_id[change_id].get("task_id") != task_id:
                _issue(issues, "step.cross_task", f"{step_id} 不能引用其他任务的 change：{change_id}", step_id)
        for test_id in test_ids:
            if test_id not in test_by_id:
                _issue(issues, "reference.missing", f"{step_id} 引用不存在的 test：{test_id}", step_id)
            elif test_by_id[test_id].get("task_id") != task_id:
                _issue(issues, "step.cross_task", f"{step_id} 不能引用其他任务的 test：{test_id}", step_id)
        for dependency in dependencies:
            if dependency not in step_by_id:
                _issue(issues, "reference.missing", f"{step_id} 依赖不存在的 step：{dependency}", step_id)
            elif step_by_id[dependency].get("task_id") != task_id:
                _issue(issues, "step.cross_task", f"{step_id} 不能依赖其他任务的 step：{dependency}", step_id)
        step_edges[step_id] = dependencies
    _check_dag(step_by_id, step_edges, issues, "step.cycle")

    for test_id, test in test_by_id.items():
        task_id = test.get("task_id")
        if task_id not in task_by_id:
            _issue(issues, "reference.missing", f"{test_id}.task_id 不存在：{task_id}", test_id)
        if not _valid_repo_path(test.get("file")):
            _issue(issues, "path.invalid", f"{test_id}.file 必须是安全的 repo-relative path", test_id)
        _require_string(test, "command", issues, test_id)

    for task_id, task in task_by_id.items():
        expected_changes = {key for key, value in change_by_id.items() if value.get("task_id") == task_id}
        expected_steps = {key for key, value in step_by_id.items() if value.get("task_id") == task_id}
        expected_tests = {key for key, value in test_by_id.items() if value.get("task_id") == task_id}
        for field_name, expected in (
            ("change_ids", expected_changes),
            ("step_ids", expected_steps),
            ("test_ids", expected_tests),
        ):
            actual = set(task.get(field_name, [])) if isinstance(task.get(field_name), list) else set()
            if actual != expected:
                _issue(
                    issues,
                    "traceability.reverse",
                    f"{task_id}.{field_name} 必须与反向归属完全一致；期望 {sorted(expected)}，实际 {sorted(actual)}",
                    task_id,
                )

    for section_id in sorted(required_section_ids):
        if section_id not in section_objects:
            _issue(issues, "section.missing", f"缺少正文区域：{section_id}", section_id)
    known_section_ids = required_section_ids
    for section_id in section_objects:
        if section_id not in known_section_ids:
            _issue(issues, "section.unreferenced", f"manifest 未引用正文区域：{section_id}", section_id)

    expected_section_order = ["global-context"]
    expected_section_order.extend(
        contract["section_id"]
        for contract in contracts
        if isinstance(contract.get("section_id"), str)
    )
    expected_section_order.extend(
        repo["section_id"] for repo in repositories if isinstance(repo.get("section_id"), str)
    )
    expected_section_order.extend(
        task["section_id"] for task in tasks if isinstance(task.get("section_id"), str)
    )
    expected_section_order.extend(("integration-plan", "rollout-plan", "end-to-end-acceptance"))
    actual_section_order = [
        section_id
        for section_id, _ in sorted(section_objects.items(), key=lambda item: item[1].begin_line)
        if section_id in required_section_ids
    ]
    if all(section_id in section_objects for section_id in expected_section_order) and actual_section_order != expected_section_order:
        _issue(
            issues,
            "section.order",
            f"正文区域顺序不符合协议；期望 {expected_section_order}，实际 {actual_section_order}",
        )

    for task_id, task in task_by_id.items():
        section = section_objects.get(str(task.get("section_id")))
        if not section:
            continue
        subsection_bodies = _task_subsections(section.content)
        for heading in REQUIRED_TASK_HEADINGS:
            if heading not in subsection_bodies:
                _issue(issues, "task.heading", f"{task_id} 缺少实施级小节：{heading}", task_id)
            elif not subsection_bodies[heading]:
                _issue(issues, "task.section_empty", f"{task_id} 的实施级小节没有正文：{heading}", task_id)
        for field_name in ("change_ids", "step_ids", "test_ids"):
            for referenced_id in _string_list(task, field_name):
                if not _contains_exact_id(section.content, referenced_id):
                    _issue(
                        issues,
                        "task.body_traceability",
                        f"{task_id} 正文没有出现 {field_name} 中的 ID：{referenced_id}",
                        task_id,
                    )
        if ready_requested and _task_uses_java(task_id, change_by_id, test_by_id):
            contract_body = subsection_bodies.get("新增或修改类型契约", "")
            packages = _java_packages(contract_body)
            expected_packages = {
                package
                for change in change_by_id.values()
                if change.get("task_id") == task_id and _is_java_path(change.get("path"))
                if (package := _java_package_from_path(change.get("path")))
            }
            for package in sorted(expected_packages - packages):
                _issue(
                    issues,
                    "java.contract",
                    f"{task_id} 的 Java 契约缺少文件路径对应的 package：{package}",
                    task_id,
                )
            signatures = _complete_java_signatures(contract_body)
            if not signatures:
                _issue(issues, "java.contract", f"{task_id} 的 Java 契约缺少完整 Java 签名", task_id)
            java_symbols = [
                symbol
                for change in change_by_id.values()
                if change.get("task_id") == task_id and _is_java_path(change.get("path"))
                for symbol in _string_list(change, "symbols")
            ]
            task_class_names = {
                symbol.partition("#")[0].rsplit(".", 1)[-1] for symbol in java_symbols
            }
            for symbol in java_symbols:
                if not _java_symbol_covered(symbol, signatures, task_class_names):
                    _issue(
                        issues,
                        "java.contract",
                        f"{task_id} 的 Java 契约没有完整覆盖符号：{symbol}",
                        task_id,
                    )
            for marker in ("字段类型", "空值", "异常", "调用方", "实现方"):
                if not _has_labeled_value(contract_body, marker):
                    _issue(issues, "java.contract", f"{task_id} 的 Java 契约缺少带实际值的字段：{marker}", task_id)

    if require_ready and status != "READY":
        _issue(issues, "ready.required", f"要求 READY，但文档状态是 {status!r}", "status")
    if ready_requested:
        ready_text = "\n".join(
            (
                text,
                json.dumps(manifest, ensure_ascii=False, sort_keys=True),
                *(section.content for section in section_objects.values()),
            )
        )
        _validate_ready_manifest_values(
            manifest,
            repositories,
            contracts,
            tasks,
            changes,
            tests,
            issues,
        )
        _validate_ready_non_task_sections(
            repo_by_id,
            contract_by_id,
            task_by_id,
            section_objects,
            issues,
        )
        for task_id, task in task_by_id.items():
            if task.get("status") != "READY":
                _issue(issues, "ready.task_status", f"READY 文档中的任务必须全部为 READY：{task_id}", task_id)
            section = section_objects.get(str(task.get("section_id")))
            if section:
                _validate_ready_task_closure(
                    task_id,
                    _task_subsections(section.content),
                    change_by_id,
                    step_by_id,
                    test_by_id,
                    issues,
        )
        for code, pattern in FORBIDDEN_READY_PATTERNS.items():
            match = pattern.search(ready_text)
            if match:
                snippet = match.group(0)
                _issue(issues, code, f"READY 文档包含未展开表达：{snippet}")
        not_applicable_pattern = re.compile(r"(?:^|[：:；;，,\s])(N/A|不涉及|无相关)(?:$|[：:；;，,。\s])", re.IGNORECASE)
        for task_id, task in task_by_id.items():
            section = section_objects.get(str(task.get("section_id")))
            if not section:
                continue
            for line_number, line in enumerate(section.content.splitlines(), start=section.begin_line + 1):
                if not_applicable_pattern.search(line) and not _contains_evidence(line):
                    _issue(
                        issues,
                        "ready.not_applicable_evidence",
                        f"第 {line_number} 行声明不涉及，但同一行没有原因或代码证据",
                        task_id,
                    )
        global_section = section_objects.get("global-context")
        decision_values = (
            _semantic_values(_section_detail(global_section.content), "已关闭架构决策")
            if global_section
            else []
        )
        if _has_open_architecture_decision(ready_text) or _has_developer_owned_choice(ready_text) or any(
            _has_unresolved_choice_language(value) for value in decision_values
        ):
            _issue(issues, "ready.open_decision", "READY 文档仍包含未关闭的架构决策")
    return ValidationReport(
        protocol="canonical-v1",
        status=manifest.get("status") if isinstance(manifest.get("status"), str) else None,
        manifest=manifest,
        sections=section_objects,
        issues=issues,
    )


def validate_spec(source: str | Path, require_ready: bool = False) -> ValidationReport:
    """Validate a path or document string and return a structured report."""

    text, _ = _read_source(source)
    try:
        manifest = parse_manifest(text)
    except CanonicalSpecError as exc:
        return ValidationReport(
            protocol="canonical-invalid",
            status=None,
            issues=[ValidationIssue("manifest.parse", str(exc))],
        )
    if manifest is None:
        issues: list[ValidationIssue] = []
        if require_ready:
            issues.append(
                ValidationIssue("ready.legacy", "legacy Dev Spec 不具备 Canonical v1 READY 证明")
            )
        return ValidationReport(protocol="legacy", status=None, issues=issues)
    try:
        sections = _parse_section_objects(text)
    except CanonicalSpecError as exc:
        return ValidationReport(
            protocol="canonical-v1",
            status=manifest.get("status") if isinstance(manifest.get("status"), str) else None,
            manifest=manifest,
            issues=[ValidationIssue("section.parse", str(exc))],
        )
    model_report = validate_model(manifest, sections, text=text, require_ready=require_ready)
    issues = model_report.issues
    first_section = text.find("<!-- EDS:SECTION:BEGIN")
    if first_section != -1 and text.find(MANIFEST_BEGIN) > first_section:
        issues.append(
            ValidationIssue("manifest.position", "manifest 必须位于所有 EDS 正文区域之前")
        )
    return ValidationReport(
        protocol="canonical-v1",
        status=manifest.get("status") if isinstance(manifest.get("status"), str) else None,
        manifest=manifest,
        sections=sections,
        issues=issues,
    )


def _render_section(section: Section) -> str:
    return (
        f"<!-- EDS:SECTION:BEGIN id={section.section_id} -->\n"
        f"{section.content}\n"
        f"<!-- EDS:SECTION:END id={section.section_id} -->"
    )


def _integration_slice(content: str, relevant_task_ids: set[str]) -> str:
    lines = content.splitlines()
    selected: list[str] = []
    task_reference = re.compile(r"R[1-9][0-9]*-T[1-9][0-9]*")
    for line in lines:
        mentioned = set(task_reference.findall(line))
        if not mentioned or mentioned.intersection(relevant_task_ids):
            selected.append(line)
    return "\n".join(selected).strip() or "## 联调计划\n\n当前选择范围没有联调条目。"


def select_scope(
    source: str | Path,
    repo_id: str,
    task_ids: Iterable[str] | None = None,
    output_format: str = "markdown",
) -> str | dict[str, Any]:
    """Return the deterministic consumption closure for one repository."""

    text, source_path = _read_source(source)
    report = validate_spec(text)
    if report.protocol != "canonical-v1":
        raise CanonicalSpecError("消费闭包选择只支持 Canonical Spec v1")
    if not report.ok or report.manifest is None:
        details = "；".join(issue.message for issue in report.issues[:5])
        raise CanonicalSpecError(f"Spec 校验失败，不能选择消费闭包：{details}")
    manifest = report.manifest
    repo_by_id = {item["repo_id"]: item for item in manifest["repositories"]}
    task_by_id = {item["task_id"]: item for item in manifest["tasks"]}
    contract_by_id = {item["contract_id"]: item for item in manifest["contracts"]}
    if repo_id not in repo_by_id:
        raise CanonicalSpecError(f"仓库不存在：{repo_id}")
    requested = list(task_ids or [])
    if requested:
        selected_ids: list[str] = []
        for task_id in requested:
            task = task_by_id.get(task_id)
            if task is None:
                raise CanonicalSpecError(f"任务不存在：{task_id}")
            if task.get("repo_id") != repo_id:
                raise CanonicalSpecError(f"任务 {task_id} 不属于仓库 {repo_id}")
            if task_id not in selected_ids:
                selected_ids.append(task_id)
    else:
        selected_ids = [item["task_id"] for item in manifest["tasks"] if item.get("repo_id") == repo_id]
    if not selected_ids:
        raise CanonicalSpecError(f"仓库 {repo_id} 没有可选择任务")

    selected_set = set(selected_ids)
    direct_dependency_ids = {
        dependency["task_id"]
        for task_id in selected_ids
        for dependency in task_by_id[task_id].get("depends_on", [])
        if dependency.get("task_id") not in selected_set
    }
    related_contract_ids = [
        contract_id
        for contract_id, contract in contract_by_id.items()
        if contract.get("owner_task_id") in selected_set
        or selected_set.intersection(contract.get("consumer_task_ids", []))
    ]
    relevant_task_ids = selected_set | direct_dependency_ids
    section_ids = ["global-context", repo_by_id[repo_id]["section_id"]]
    section_ids.extend(contract_by_id[contract_id]["section_id"] for contract_id in related_contract_ids)
    section_ids.extend(task_by_id[task_id]["section_id"] for task_id in selected_ids)
    sections = report.sections
    dependencies = []
    for dependency_id in sorted(direct_dependency_ids):
        dependency = task_by_id[dependency_id]
        edge_details = [
            edge
            for task_id in selected_ids
            for edge in task_by_id[task_id].get("depends_on", [])
            if edge.get("task_id") == dependency_id
        ]
        dependencies.append(
            {
                "task_id": dependency_id,
                "repo_id": dependency["repo_id"],
                "title": dependency["title"],
                "status": dependency["status"],
                "edges": edge_details,
            }
        )

    selected_tasks = [task_by_id[task_id] for task_id in selected_ids]
    selected_changes = [item for item in manifest["changes"] if item.get("task_id") in selected_set]
    selected_steps = [item for item in manifest["steps"] if item.get("task_id") in selected_set]
    selected_tests = [item for item in manifest["tests"] if item.get("task_id") in selected_set]
    related_contracts = [contract_by_id[contract_id] for contract_id in related_contract_ids]
    payload: dict[str, Any] = {
        "schema": SCHEMA,
        "spec_id": manifest["spec_id"],
        "revision": manifest["revision"],
        "status": manifest["status"],
        "source_path": source_path,
        "source_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "repo": repo_by_id[repo_id],
        "selected_task_ids": selected_ids,
        "selected_tasks": selected_tasks,
        "selected_changes": selected_changes,
        "selected_steps": selected_steps,
        "selected_tests": selected_tests,
        "direct_dependency_summaries": dependencies,
        "related_contract_ids": related_contract_ids,
        "related_contracts": related_contracts,
        "sections": [
            {"section_id": section_id, "content": sections[section_id].content}
            for section_id in section_ids
        ],
        "integration_plan": _integration_slice(
            sections["integration-plan"].content, relevant_task_ids
        ),
    }
    if output_format == "json":
        return payload
    if output_format != "markdown":
        raise CanonicalSpecError(f"不支持的输出格式：{output_format}")

    routing_manifest = {
        key: payload[key]
        for key in (
            "schema",
            "spec_id",
            "revision",
            "status",
            "source_path",
            "source_sha256",
            "repo",
            "selected_task_ids",
            "selected_tasks",
            "selected_changes",
            "selected_steps",
            "selected_tests",
            "direct_dependency_summaries",
            "related_contract_ids",
            "related_contracts",
        )
    }
    manifest_json = json.dumps(routing_manifest, ensure_ascii=False, indent=2)
    output = [
        f"# {manifest['title']} · {repo_id} 消费闭包",
        "",
        "<!-- EDS:CONSUMPTION-SCOPE:BEGIN -->",
        "```json",
        manifest_json,
        "```",
        "<!-- EDS:CONSUMPTION-SCOPE:END -->",
        "",
        f"> 来源 SHA-256：`{payload['source_sha256']}`",
        f"> 选择任务：{', '.join(selected_ids)}",
        "",
    ]
    for section_id in section_ids:
        output.extend([_render_section(sections[section_id]), ""])
    output.extend(["## 直接依赖任务摘要", ""])
    if dependencies:
        for dependency in dependencies:
            edge_text = "；".join(
                f"{edge['type']}，完成证据：{edge['required_evidence']}" for edge in dependency["edges"]
            )
            output.append(
                f"- `{dependency['task_id']}`（仓库 `{dependency['repo_id']}`，"
                f"状态 `{dependency['status']}`）：{dependency['title']}；{edge_text}"
            )
    else:
        output.append("- 无直接依赖任务。")
    integration = Section(
        section_id="integration-plan",
        content=payload["integration_plan"],
        begin_line=0,
        end_line=0,
    )
    output.extend(["", _render_section(integration), ""])
    return "\n".join(output).rstrip() + "\n"
