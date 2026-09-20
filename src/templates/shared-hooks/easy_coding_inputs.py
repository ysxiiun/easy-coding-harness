"""Scoped evidence inputs. Caches live for one state operation, never across edits."""

import hashlib
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path


_operation = ContextVar("evidence_operation", default=None)
BUILD_FILES = ("pom.xml", "package.json", "package-lock.json", "pnpm-lock.yaml",
               "yarn.lock", "tsconfig.json", "build.gradle", "build.gradle.kts",
               "settings.gradle", "gradle.properties", ".gitattributes", ".npmrc",
               "vitest.config.ts", "jest.config.js", "biome.json", "pytest.ini", "pyproject.toml")


@contextmanager
def evidence_operation():
    token = _operation.set({})
    try:
        yield
    finally:
        _operation.reset(token)


def memo(key, compute):
    cache = _operation.get()
    if cache is None:
        return compute()
    if key not in cache:
        cache[key] = compute()
    return cache[key]


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise ValueError(result.stderr.decode("utf-8", "replace").strip())
    return result.stdout


class RepositoryInputs:
    def __init__(self, root):
        self.root = root
        self.content = {}
        self.index = {}
        self.unmerged = set()
        try:
            raw = git(root, "ls-files", "--stage", "-z")
        except ValueError:
            # Non-Git fixtures and newly initialized projects use the explicit input paths.
            self.paths = set()
            self.dirty = set()
            self.is_git = False
            return
        self.is_git = True
        for entry in raw.split(b"\0"):
            if not entry:
                continue
            metadata, name = entry.split(b"\t", 1)
            mode, oid, stage = metadata.split()
            if stage != b"0":
                self.unmerged.add(os.fsdecode(name))
            self.index[os.fsdecode(name)] = (mode.decode(), oid.decode())
        self.dirty = set(map(os.fsdecode, filter(None, git(
            root, "diff-files", "--relative", "--name-only", "-z").split(b"\0"))))
        untracked = set(map(os.fsdecode, filter(None, git(
            root, "ls-files", "--others", "--exclude-standard", "-z").split(b"\0"))))
        self.paths = set(self.index) | untracked
        self.dirty.update(untracked)

    def capture(self, scopes, production_only=False):
        names = set()
        for scope in scopes:
            path = self.root / scope
            if path.is_dir():
                names.update(n for n in self.paths if n.startswith(scope.rstrip("/") + "/"))
                if not self.is_git:
                    names.update(p.relative_to(self.root).as_posix() for p in path.rglob("*")
                                 if p.is_file() and "__pycache__" not in p.parts)
            else:
                names.add(scope)
        if production_only:
            names = {n for n in names if not is_test(n)}
        if names & self.unmerged:
            raise ValueError("Resolve unmerged check inputs: " + ", ".join(sorted(names & self.unmerged)))
        pending = []
        for name in sorted(names):
            if name in self.content:
                continue
            path = self.root / name
            if name in self.index and name not in self.dirty:
                mode, oid = self.index[name]
                if mode == "160000":
                    raise ValueError("Declare the checked-out submodule as an input repository: " + name)
                self.content[name] = [mode, oid]
            elif path.is_symlink():
                content = os.fsencode(os.readlink(path))
                algorithm = "sha256" if any(len(oid) == 64 for _, oid in self.index.values()) else "sha1"
                oid = hashlib.new(algorithm, b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
                self.content[name] = ["120000", oid]
            elif path.is_file():
                pending.append(name)
            else:
                self.content[name] = None
        if pending:
            # Batch Git's filtered blob hashing; no subprocess per changed file.
            if self.is_git:
                values = git(self.root, "hash-object", "--", *pending).decode().splitlines()
            else:
                values = [hashlib.sha256((self.root / n).read_bytes()).hexdigest() for n in pending]
            for name, oid in zip(pending, values):
                executable = (self.root / name).stat().st_mode & stat.S_IXUSR
                self.content[name] = ["100755" if executable else "100644", oid]
        return {name: self.content[name] for name in sorted(names)}


def is_test(path):
    return any(p in {"test", "tests", "__tests__"} for p in Path(path).parts) or is_test_case(path)


def is_test_case(path):
    name = Path(path).name
    return bool(re.search(r"(?:Test|Tests|IT)\.java$|\.(?:test|spec)\.[cm]?[jt]sx?$|^test_.*\.py$", name))


def command_tokens(command):
    tokens = shlex.split(command)
    if tokens and tokens[0] == "env":
        tokens = tokens[1:]
    while tokens and re.match(r"^[A-Za-z_][A-Za-z_0-9]*=", tokens[0]):
        tokens = tokens[1:]
    return tokens


def toolchain_identity(command):
    tokens = command_tokens(command)
    executable = tokens[0] if tokens else ""
    resolved = shutil.which(executable) if executable else None
    metadata = Path(resolved).stat() if resolved else None
    return {
        "executable": resolved,
        "binary": [metadata.st_size, metadata.st_mtime_ns] if metadata else None,
        "python": sys.version,
        "environment": {key: os.environ.get(key) for key in (
            "JAVA_HOME", "JAVA_TOOL_OPTIONS", "MAVEN_OPTS", "NODE_OPTIONS", "PATH", "GRADLE_USER_HOME"
        )},
    }


def maven_modules(root):
    modules = {}
    def visit(directory):
        pom = directory / "pom.xml"
        if not pom.is_file():
            return
        try:
            tree = ET.fromstring(pom.read_bytes())
        except ET.ParseError:
            # The POM bytes still bind the check; Maven reports malformed build input.
            modules[directory] = (None, [])
            return
        ns = "{http://maven.apache.org/POM/4.0.0}" if tree.tag.startswith("{") else ""
        artifact = tree.findtext(ns + "artifactId")
        dependencies = [d.findtext(ns + "artifactId") for d in tree.findall(
            f"{ns}dependencies/{ns}dependency")]
        modules[directory] = (artifact, dependencies)
        for child in tree.findall(f"{ns}modules/{ns}module"):
            visit((directory / child.text).resolve())
    visit(root)
    return modules


def input_spec(root, task, plan, check):
    units = plan.get("units", [])
    by_id = {u["id"]: u for u in units}
    selected = [u for u in units if
                (not check.get("unit_id") or u["id"] == check["unit_id"]) and
                (not check.get("source_task_id") or u.get("source_task_id") == check["source_task_id"])]
    if not selected:
        raise ValueError("Check must belong to an existing implementation Unit.")
    owners = list(selected)
    for unit in selected:
        for dep in unit.get("depends_on", []):
            if dep in by_id and by_id[dep] not in selected:
                selected.append(by_id[dep])
    command = check.get("command", "")
    tokens = command_tokens(command)
    executable = Path(tokens[0]).name if tokens else ""
    builds_module = check.get("type") == "verify" and executable in {
        "mvn", "mvnw", "gradle", "gradlew", "npm", "npx", "pnpm", "yarn", "tsc"
    }
    repositories = {}
    for unit in selected:
        repo_id = unit.get("repo_id") or "current"
        base = Path(task.get("repo_paths", {}).get(repo_id, root))
        base = (base if base.is_absolute() else root / base).resolve()
        paths = repositories.setdefault(str(base), set())
        for name in [*unit.get("files", []), *unit.get("input_files", [])]:
            absolute = Path(name) if Path(name).is_absolute() else base / name
            relative = absolute.relative_to(base).as_posix()
            if ".." in Path(relative).parts:
                raise ValueError("Input path escapes repository: " + name)
            paths.add(relative)
            directory = absolute if absolute.is_dir() else absolute.parent
            while directory != base and not any((directory / marker).is_file() for marker in ("pom.xml", "package.json", "build.gradle", "build.gradle.kts")):
                directory = directory.parent
            modules = memo(("maven", str(base)), lambda: maven_modules(base))
            involved = {directory}
            # A reactor-wide command consumes every module, even when attributed to one Unit.
            if executable in {"mvn", "mvnw"}:
                selector = next((t.split("=", 1)[1] for t in tokens if t.startswith("--projects=")), None)
                for flag in ("-pl", "--projects"):
                    if flag in tokens and tokens.index(flag) + 1 < len(tokens):
                        selector = tokens[tokens.index(flag) + 1]
                if selector is None:
                    involved.update(modules)
                else:
                    selected_modules = set(selector.split(","))
                    involved.update(m for m, (artifact, _) in modules.items()
                                    if m.relative_to(base).as_posix() in selected_modules
                                    or f":{artifact}" in selected_modules)
            pending = list(involved)
            for module in pending:
                for dep in modules.get(module, (None, []))[1]:
                    for candidate, (artifact, _) in modules.items():
                        if artifact == dep and candidate not in involved:
                            involved.add(candidate)
                            pending.append(candidate)
            for module in involved:
                for folder in ("src/main", "src" if not (module / "pom.xml").exists() else "src/test"):
                    if (builds_module or "input_files" not in unit) and (module / folder).is_dir():
                        paths.add((module / folder).relative_to(base).as_posix())
                for parent in [module, *module.parents]:
                    if not parent.is_relative_to(base):
                        break
                    for filename in BUILD_FILES:
                        if (parent / filename).is_file():
                            paths.add((parent / filename).relative_to(base).as_posix())
            for config in (".mvn", "gradle", "test" if builds_module else "test/fixtures",
                           "tests" if builds_module else "tests/fixtures"):
                if (base / config).is_dir():
                    paths.add(config)
    if task.get("unit_test_mode") in {"ut", "tdd"}:
        for directory in {str(root.resolve()), *repositories}:
            manifest = Path(directory) / ".easy-coding/tdd/readiness.json"
            if manifest.is_file():
                readiness = json.loads(manifest.read_text())
                paths = repositories.setdefault(directory, set())
                for field in ("build_files", "tool_files"):
                    paths.update(record["path"] for record in readiness.get(field, []))
    return {
        "schema": 1,
        "repositories": {r: sorted(paths) for r, paths in sorted(repositories.items())},
        "production_only": check.get("review_scope") == "production",
        "contract": [{"id": u["id"], "contracts": u.get("contracts", []),
                      "acceptance_criteria": u.get("acceptance_criteria", [])} for u in owners]
                    if check.get("type") == "review" else [],
        "command": shlex.split(command),
        "environment": check.get("environment", {}),
        "toolchain": toolchain_identity(command) if check.get("type") == "verify" else {},
    }


def capture(spec):
    inputs = {}
    for root, scopes in spec["repositories"].items():
        repository = memo(("repository", root), lambda: RepositoryInputs(Path(root)))
        inputs[root] = repository.capture(scopes, spec["production_only"])
    return {"spec": spec, "files": inputs, "signature": digest([spec, inputs])}


def changed_inputs(before, after):
    changes = []
    for repo in sorted(set(before["files"]) | set(after["files"])):
        old, new = before["files"].get(repo, {}), after["files"].get(repo, {})
        changes.extend(f"{repo}:{p}" for p in sorted(set(old) | set(new)) if old.get(p) != new.get(p))
    if before["spec"] != after["spec"]:
        changes.append("check command, contract, configuration, or input scope changed")
    return changes


def command_covers(executed, required):
    """A grouped Maven test command proves each selector; other arguments stay exact."""
    actual, expected = shlex.split(executed), shlex.split(required)
    a = [t for t in actual if t.startswith("-Dtest=")]
    b = [t for t in expected if t.startswith("-Dtest=")]
    if len(a) != 1 or len(b) != 1:
        return actual == expected
    return ([t for t in actual if t not in a] == [t for t in expected if t not in b]
            and set(b[0][7:].split(",")) <= set(a[0][7:].split(",")))
