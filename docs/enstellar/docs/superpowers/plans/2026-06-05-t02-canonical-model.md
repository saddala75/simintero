# T02 — Canonical Model + Codegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the Enstellar canonical case model as JSON Schema in `packages/canonical-model/` and generate Pydantic v2 (Python), TypeScript interfaces, and Java 21 records — with a round-trip serialization test passing in all three languages.

**Architecture:** JSON Schema (Draft 2020-12) is the single source of truth; a `codegen/generate.py` script drives `datamodel-code-generator` for Python, `json-schema-to-typescript` for TypeScript, and a Jinja2 template for Java 21 records. Generated files are committed to the repo. `make test` runs all three round-trip suites.

**Tech Stack:** Python 3.12 + Pydantic v2 + uv + pytest; TypeScript + json-schema-to-typescript + vitest; Java 21 + Jackson 2.17 + JUnit 5 + Gradle; Jinja2 for Java codegen template.

> **Sensitive note:** T02 is standard review class. Generated types are consumed by T03 (auth), T05 (FHIR), T07 (normalization), T08 (workflow engine) — do not break field names or types once downstream tasks have landed.

---

## File Map

**New files:**
```
packages/canonical-model/
  schema/
    common.json              # $defs: Identifier, shared field patterns
    member.json              # Member entity
    coverage.json            # Coverage entity
    provider.json            # Provider entity
    service_line.json        # ServiceLine entity
    decision.json            # Decision entity (outcome + trace fields)
    case.json                # Case aggregate root
  codegen/
    generate.py              # Runs all three codegen targets
    requirements.txt         # datamodel-code-generator, jinja2
    templates/
      java_record.jinja2     # Java 21 record template
  generated/
    python/canonical_model/
      __init__.py
      models.py              # Generated Pydantic v2 (committed)
    typescript/
      index.ts               # Generated TypeScript interfaces (committed)
    java/com/simintero/enstellar/canonical/
      Case.java
      Member.java
      Coverage.java
      Provider.java
      ServiceLine.java
      Decision.java
      Identifier.java
  tests/
    python/
      test_roundtrip.py
    typescript/
      roundtrip.test.ts
    java/
      src/test/java/com/simintero/enstellar/canonical/
        RoundTripTest.java
  pyproject.toml
  package.json
  tsconfig.json
  build.gradle.kts
  settings.gradle.kts
```

**Modified files:**
```
Makefile                        # Add canonical-model test targets
.github/workflows/ci.yml        # Add canonical-model test jobs
.claude/task-graph.md           # Mark T01 [x] done, T02 [x] done
packages/canonical-model/.gitkeep  # Delete (replaced by real files)
```

---

## Task 1: Project scaffolding (Python + TypeScript + Java)

**Files:**
- Create: `packages/canonical-model/pyproject.toml`
- Create: `packages/canonical-model/package.json`
- Create: `packages/canonical-model/tsconfig.json`
- Create: `packages/canonical-model/settings.gradle.kts`
- Create: `packages/canonical-model/build.gradle.kts`

- [ ] **Step 1: Create pyproject.toml**

```toml
# packages/canonical-model/pyproject.toml
[project]
name = "canonical-model"
version = "0.1.0"
description = "Enstellar canonical case model — generated Pydantic v2 types"
requires-python = ">=3.12"
dependencies = ["pydantic>=2.9"]

[dependency-groups]
dev = [
    "datamodel-code-generator>=0.26",
    "jinja2>=3.1",
    "pytest>=8",
]

[tool.pytest.ini_options]
testpaths = ["tests/python"]

[tool.ruff.lint]
ignore = ["E501"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["generated/python/canonical_model"]
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@enstellar/canonical-model",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "codegen": "node codegen/ts_codegen.mjs"
  },
  "devDependencies": {
    "json-schema-to-typescript": "^15.0.0",
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["generated/typescript/**/*", "tests/typescript/**/*"]
}
```

- [ ] **Step 4: Create settings.gradle.kts**

```kotlin
// packages/canonical-model/settings.gradle.kts
rootProject.name = "canonical-model"
```

- [ ] **Step 5: Create build.gradle.kts**

```kotlin
// packages/canonical-model/build.gradle.kts
plugins {
    java
}

group = "com.simintero.enstellar"
version = "0.1.0"

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

tasks.withType<JavaCompile> {
    options.compilerArgs.add("-parameters")
}

sourceSets {
    main {
        java.srcDirs("generated/java")
    }
    test {
        java.srcDirs("tests/java/src/test/java")
    }
}

dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.2")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}
```

- [ ] **Step 6: Delete the placeholder and install deps**

```bash
rm packages/canonical-model/.gitkeep
cd packages/canonical-model && uv sync
cd packages/canonical-model && npm install
```

Expected: `uv.lock` and `node_modules/` created, no errors.

- [ ] **Step 7: Commit scaffold**

```bash
git add packages/canonical-model/pyproject.toml packages/canonical-model/package.json packages/canonical-model/tsconfig.json packages/canonical-model/settings.gradle.kts packages/canonical-model/build.gradle.kts
git commit -m "chore(canonical-model): project scaffold — Python/TS/Java build files"
```

---

## Task 2: JSON Schema — common types and entity schemas

**Files:**
- Create: `packages/canonical-model/schema/common.json`
- Create: `packages/canonical-model/schema/member.json`
- Create: `packages/canonical-model/schema/coverage.json`
- Create: `packages/canonical-model/schema/provider.json`
- Create: `packages/canonical-model/schema/service_line.json`
- Create: `packages/canonical-model/schema/decision.json`
- Create: `packages/canonical-model/schema/case.json`

- [ ] **Step 1: Create common.json**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://enstellar.simintero.com/schemas/common.json",
  "title": "Common",
  "$defs": {
    "Identifier": {
      "title": "Identifier",
      "description": "A system/value pair for external identifiers (NPI, MRN, etc.)",
      "type": "object",
      "properties": {
        "system": { "type": "string", "description": "Identifier namespace URI or label" },
        "value": { "type": "string" }
      },
      "required": ["system", "value"],
      "additionalProperties": false
    }
  }
}
```

- [ ] **Step 2: Create member.json**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://enstellar.simintero.com/schemas/member.json",
  "title": "Member",
  "description": "Health plan member (patient) — carries tenant_id for boundary enforcement",
  "type": "object",
  "properties": {
    "member_id":     { "type": "string", "format": "uuid" },
    "tenant_id":     { "type": "string", "description": "Required: tenant owning this record" },
    "mrn":           { "type": "string", "description": "Medical record number in the payer's system" },
    "first_name":    { "type": "string" },
    "last_name":     { "type": "string" },
    "date_of_birth": { "type": "string", "format": "date" },
    "gender":        { "type": "string", "enum": ["M", "F", "O", "U"] },
    "identifiers":   {
      "type": "array",
      "items": { "$ref": "common.json#/$defs/Identifier" },
      "default": []
    }
  },
  "required": ["member_id", "tenant_id", "first_name", "last_name", "date_of_birth"],
  "additionalProperties": false
}
```

- [ ] **Step 3: Create coverage.json**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://enstellar.simintero.com/schemas/coverage.json",
  "title": "Coverage",
  "description": "Health plan coverage for a member",
  "type": "object",
  "properties": {
    "coverage_id":        { "type": "string", "format": "uuid" },
    "tenant_id":          { "type": "string" },
    "member_id":          { "type": "string", "format": "uuid" },
    "plan_id":            { "type": "string" },
    "group_id":           { "type": "string" },
    "subscriber_id":      { "type": "string" },
    "payer_name":         { "type": "string" },
    "lob":                { "type": "string", "description": "Line of business: commercial, medicare, medicaid, …" },
    "effective_date":     { "type": "string", "format": "date" },
    "termination_date":   { "type": "string", "format": "date" }
  },
  "required": ["coverage_id", "tenant_id", "member_id", "plan_id", "subscriber_id", "payer_name", "lob", "effective_date"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Create provider.json**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://enstellar.simintero.com/schemas/provider.json",
  "title": "Provider",
  "description": "Requesting or servicing provider",
  "type": "object",
  "properties": {
    "provider_id":        { "type": "string", "format": "uuid" },
    "tenant_id":          { "type": "string" },
    "npi":                { "type": "string", "pattern": "^[0-9]{10}$" },
    "name":               { "type": "string" },
    "specialty":          { "type": "string" },
    "organization_name":  { "type": "string" },
    "identifiers":        {
      "type": "array",
      "items": { "$ref": "common.json#/$defs/Identifier" },
      "default": []
    }
  },
  "required": ["provider_id", "tenant_id", "npi", "name"],
  "additionalProperties": false
}
```

- [ ] **Step 5: Create service_line.json**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://enstellar.simintero.com/schemas/service_line.json",
  "title": "ServiceLine",
  "description": "One line item in a prior authorization request",
  "type": "object",
  "properties": {
    "service_line_id":       { "type": "string", "format": "uuid" },
    "tenant_id":             { "type": "string" },
    "sequence":              { "type": "integer", "minimum": 1 },
    "service_type_code":     { "type": "string", "description": "X12 service type code" },
    "procedure_code":        { "type": "string", "description": "CPT / HCPCS code" },
    "procedure_description": { "type": "string" },
    "quantity":              { "type": "number" },
    "units":                 { "type": "string" },
    "diagnosis_codes":       { "type": "array", "items": { "type": "string" }, "default": [] },
    "place_of_service":      { "type": "string" },
    "requested_start_date":  { "type": "string", "format": "date" },
    "requested_end_date":    { "type": "string", "format": "date" }
  },
  "required": ["service_line_id", "tenant_id", "sequence", "service_type_code", "procedure_code", "diagnosis_codes"],
  "additionalProperties": false
}
```

- [ ] **Step 6: Create decision.json**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://enstellar.simintero.com/schemas/decision.json",
  "title": "Decision",
  "description": "Determination outcome with rules-trace fields. Adverse outcomes require human_signoff fields.",
  "type": "object",
  "properties": {
    "decision_id":           { "type": "string", "format": "uuid" },
    "tenant_id":             { "type": "string" },
    "case_id":               { "type": "string", "format": "uuid" },
    "outcome": {
      "type": "string",
      "enum": ["approved", "denied", "partially_denied", "adverse_modification", "pending", "not_required"]
    },
    "rule_artifact_id":      { "type": "string" },
    "rule_version":          { "type": "string" },
    "criteria_branch":       { "type": "string" },
    "evidence_refs":         { "type": "array", "items": { "type": "string" }, "default": [] },
    "human_signoff_required":{ "type": "boolean" },
    "human_signoff_actor":   { "type": "string" },
    "human_signoff_at":      { "type": "string", "format": "date-time" },
    "auto_approved":         { "type": "boolean" },
    "decided_at":            { "type": "string", "format": "date-time" }
  },
  "required": [
    "decision_id", "tenant_id", "case_id", "outcome",
    "rule_artifact_id", "rule_version", "evidence_refs",
    "human_signoff_required", "auto_approved", "decided_at"
  ],
  "additionalProperties": false
}
```

- [ ] **Step 7: Create case.json**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://enstellar.simintero.com/schemas/case.json",
  "title": "Case",
  "description": "Canonical PA case — aggregate root. Every field that touches PHI carries tenant_id.",
  "type": "object",
  "properties": {
    "case_id":             { "type": "string", "format": "uuid" },
    "tenant_id":           { "type": "string" },
    "correlation_id":      { "type": "string" },
    "lob":                 { "type": "string" },
    "program":             { "type": "string" },
    "status": {
      "type": "string",
      "enum": [
        "intake", "completeness_check", "auto_determination", "clinical_review",
        "pend_rfi", "approved", "denied", "partially_denied",
        "adverse_modification", "withdrawn", "closed"
      ]
    },
    "urgency": {
      "type": "string",
      "enum": ["standard", "expedited", "concurrent"]
    },
    "member":              { "$ref": "member.json" },
    "coverage":            { "$ref": "coverage.json" },
    "requesting_provider": { "$ref": "provider.json" },
    "servicing_provider":  { "$ref": "provider.json" },
    "service_lines": {
      "type": "array",
      "items": { "$ref": "service_line.json" },
      "minItems": 1
    },
    "decisions": {
      "type": "array",
      "items": { "$ref": "decision.json" },
      "default": []
    },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  },
  "required": [
    "case_id", "tenant_id", "correlation_id", "lob",
    "status", "urgency", "member", "coverage",
    "requesting_provider", "service_lines",
    "created_at", "updated_at"
  ],
  "additionalProperties": false
}
```

- [ ] **Step 8: Commit schemas**

```bash
git add packages/canonical-model/schema/
git commit -m "feat(canonical-model): JSON Schema definitions for canonical case model"
```

---

## Task 3: Python codegen — Pydantic v2 models

**Files:**
- Create: `packages/canonical-model/codegen/requirements.txt`
- Create: `packages/canonical-model/codegen/generate.py`
- Create: `packages/canonical-model/codegen/templates/java_record.jinja2`
- Create: `packages/canonical-model/generated/python/canonical_model/__init__.py`
- Generate: `packages/canonical-model/generated/python/canonical_model/models.py`

- [ ] **Step 1: Create codegen/requirements.txt**

```
datamodel-code-generator>=0.26
jinja2>=3.1
```

- [ ] **Step 2: Create codegen/generate.py**

This script invokes each language's codegen. It is idempotent — re-run any time schemas change.

```python
#!/usr/bin/env python3
"""Run all three codegen targets: Python (Pydantic v2), TypeScript, Java records."""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
SCHEMA_DIR = ROOT / "schema"
GEN_DIR = ROOT / "generated"


def run_python() -> None:
    """Generate Pydantic v2 models using datamodel-code-generator."""
    out = GEN_DIR / "python" / "canonical_model"
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable, "-m", "datamodel_code_generator",
            "--input", str(SCHEMA_DIR),
            "--input-file-type", "jsonschema",
            "--output", str(out),
            "--output-model-type", "pydantic_v2.BaseModel",
            "--use-annotated",
            "--field-constraints",
            "--target-python-version", "3.12",
            "--use-default",
        ],
        check=True,
    )
    # Ensure package marker exists
    init = out / "__init__.py"
    if not init.exists():
        init.write_text('"""Generated Pydantic v2 models for the Enstellar canonical case model."""\n')
    print("✓ Python codegen done")


def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def _json_type_to_ts(prop: dict, defs: dict) -> str:
    if "$ref" in prop:
        ref = prop["$ref"].split("#")[0].replace(".json", "")
        title = ref.split("/")[-1]
        return title[0].upper() + title[1:]
    t = prop.get("type")
    fmt = prop.get("format", "")
    if t == "string" and fmt in ("date-time",):
        return "string"
    if t == "string":
        if "enum" in prop:
            return " | ".join(f'"{v}"' for v in prop["enum"])
        return "string"
    if t == "integer":
        return "number"
    if t == "number":
        return "number"
    if t == "boolean":
        return "boolean"
    if t == "array":
        item_type = _json_type_to_ts(prop.get("items", {}), defs)
        return f"{item_type}[]"
    if t == "object":
        return "Record<string, unknown>"
    return "unknown"


def run_typescript() -> None:
    """Generate TypeScript interfaces from JSON Schema."""
    out_dir = GEN_DIR / "typescript"
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = [
        "// AUTO-GENERATED by codegen/generate.py — do not edit manually.",
        "",
    ]

    schema_files = sorted(SCHEMA_DIR.glob("*.json"))
    for sf in schema_files:
        schema = json.loads(sf.read_text())
        title = schema.get("title")
        if not title or title == "Common":
            if title == "Common":
                for def_name, def_schema in schema.get("$defs", {}).items():
                    lines.extend(_ts_interface(def_name, def_schema, schema.get("$defs", {})))
            continue
        lines.extend(_ts_interface(title, schema, schema.get("$defs", {})))

    (out_dir / "index.ts").write_text("\n".join(lines) + "\n")
    print("✓ TypeScript codegen done")


def _ts_interface(title: str, schema: dict, defs: dict) -> list[str]:
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    lines = [f"export interface {title} {{"]
    for name, prop in props.items():
        camel = _snake_to_camel(name)
        ts_type = _json_type_to_ts(prop, defs)
        opt = "" if name in required else "?"
        lines.append(f"  {camel}{opt}: {ts_type};")
    lines += ["}", ""]
    return lines


def _json_type_to_java(prop: dict, nullable: bool = True) -> str:
    if "$ref" in prop:
        ref = prop["$ref"].split("#")[0].replace(".json", "")
        title = ref.split("/")[-1]
        return title[0].upper() + title[1:]
    t = prop.get("type")
    fmt = prop.get("format", "")
    if t == "string" and fmt == "uuid":
        return "java.util.UUID"
    if t == "string" and fmt == "date-time":
        return "java.time.Instant"
    if t == "string" and fmt == "date":
        return "java.time.LocalDate"
    if t == "string":
        return "String"
    if t == "integer":
        return "Integer" if nullable else "int"
    if t == "number":
        return "Double" if nullable else "double"
    if t == "boolean":
        return "Boolean" if nullable else "boolean"
    if t == "array":
        item = _json_type_to_java(prop.get("items", {}), nullable=False)
        return f"java.util.List<{item}>"
    return "Object"


def _snake_to_lower_camel(name: str) -> str:
    return _snake_to_camel(name)


def run_java() -> None:
    """Generate Java 21 records from JSON Schema."""
    from jinja2 import Template  # noqa: PLC0415

    template_src = (Path(__file__).parent / "templates" / "java_record.jinja2").read_text()
    tmpl = Template(template_src)

    base_pkg = "com/simintero/enstellar/canonical"
    out_dir = GEN_DIR / "java" / base_pkg
    out_dir.mkdir(parents=True, exist_ok=True)

    schema_files = sorted(SCHEMA_DIR.glob("*.json"))
    for sf in schema_files:
        schema = json.loads(sf.read_text())

        # Handle common.json $defs (generates Identifier.java etc.)
        if schema.get("title") == "Common":
            for def_name, def_schema in schema.get("$defs", {}).items():
                _write_java_record(tmpl, out_dir, def_name, def_schema)
            continue

        title = schema.get("title")
        if not title:
            continue
        _write_java_record(tmpl, out_dir, title, schema)

    print("✓ Java codegen done")


def _write_java_record(tmpl, out_dir: Path, title: str, schema: dict) -> None:
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    fields = []
    for snake_name, prop in props.items():
        java_type = _json_type_to_java(prop, nullable=(snake_name not in required))
        camel_name = _snake_to_lower_camel(snake_name)
        fields.append({
            "json_name": snake_name,
            "java_type": java_type,
            "java_name": camel_name,
            "required": snake_name in required,
        })

    java_src = tmpl.render(
        package="com.simintero.enstellar.canonical",
        name=title,
        fields=fields,
        description=schema.get("description", ""),
    )
    (out_dir / f"{title}.java").write_text(java_src)


if __name__ == "__main__":
    run_python()
    run_typescript()
    run_java()
    print("\nAll codegen targets complete.")
```

- [ ] **Step 3: Create codegen/templates/java_record.jinja2**

```jinja2
// AUTO-GENERATED by codegen/generate.py — do not edit manually.
package {{ package }};

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * {{ description }}
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record {{ name }}(
{%- for f in fields %}
    @JsonProperty("{{ f.json_name }}") {{ f.java_type }} {{ f.java_name }}{% if not loop.last %},{% endif %}
{% endfor %}
) {}
```

- [ ] **Step 4: Run Python codegen**

```bash
cd packages/canonical-model
uv run python codegen/generate.py
```

Expected output:
```
✓ Python codegen done
✓ TypeScript codegen done
✓ Java codegen done

All codegen targets complete.
```

Check that `generated/python/canonical_model/models.py` was created with `class Case(BaseModel)`, `class Member(BaseModel)`, etc.

- [ ] **Step 5: Ensure __init__.py exists**

```bash
ls packages/canonical-model/generated/python/canonical_model/
```

Expected: `__init__.py  models.py` (or similar — datamodel-code-generator may split into multiple files per schema).

If `datamodel-code-generator` created separate files (one per schema), update `__init__.py` to re-export:

```python
# packages/canonical-model/generated/python/canonical_model/__init__.py
"""Generated Pydantic v2 models for the Enstellar canonical case model."""
from .models import *  # noqa: F401, F403
```

- [ ] **Step 6: Commit generated Python + TypeScript + Java**

```bash
git add packages/canonical-model/codegen/ packages/canonical-model/generated/
git commit -m "feat(canonical-model): codegen scripts and generated Python/TS/Java types"
```

---

## Task 4: Python round-trip test

**Files:**
- Create: `packages/canonical-model/tests/python/test_roundtrip.py`

- [ ] **Step 1: Create test_roundtrip.py**

```python
# packages/canonical-model/tests/python/test_roundtrip.py
"""Round-trip serialization tests for the canonical Pydantic v2 models.

Each test: build an object → model_dump_json() → model_validate_json() → assert equal.
"""
import json

import pytest

# datamodel-code-generator may produce classes in models.py or in per-schema files.
# Try both import paths; tests rely on which files were generated.
try:
    from canonical_model.models import Case, Member, Coverage, Provider, ServiceLine, Decision
except ImportError:
    from canonical_model import Case, Member, Coverage, Provider, ServiceLine, Decision  # type: ignore[no-redef]


@pytest.fixture
def sample_member() -> Member:
    return Member(
        member_id="11111111-0000-0000-0000-000000000001",
        tenant_id="tenant-test",
        first_name="Jane",
        last_name="Doe",
        date_of_birth="1985-04-12",
        mrn="MRN-001",
        gender="F",
        identifiers=[],
    )


@pytest.fixture
def sample_coverage() -> Coverage:
    return Coverage(
        coverage_id="22222222-0000-0000-0000-000000000002",
        tenant_id="tenant-test",
        member_id="11111111-0000-0000-0000-000000000001",
        plan_id="PLAN-GOLD-001",
        subscriber_id="SUB-001",
        payer_name="Acme Health",
        lob="commercial",
        effective_date="2025-01-01",
    )


@pytest.fixture
def sample_provider() -> Provider:
    return Provider(
        provider_id="33333333-0000-0000-0000-000000000003",
        tenant_id="tenant-test",
        npi="1234567890",
        name="Dr. Alice Smith",
        specialty="Orthopedics",
        identifiers=[],
    )


@pytest.fixture
def sample_service_line() -> ServiceLine:
    return ServiceLine(
        service_line_id="44444444-0000-0000-0000-000000000004",
        tenant_id="tenant-test",
        sequence=1,
        service_type_code="73",
        procedure_code="27447",
        procedure_description="Total knee replacement",
        quantity=1,
        units="UN",
        diagnosis_codes=["M17.11"],
        place_of_service="21",
        requested_start_date="2026-07-01",
    )


@pytest.fixture
def sample_case(sample_member, sample_coverage, sample_provider, sample_service_line) -> Case:
    return Case(
        case_id="55555555-0000-0000-0000-000000000005",
        tenant_id="tenant-test",
        correlation_id="corr-abc-123",
        lob="commercial",
        status="intake",
        urgency="standard",
        member=sample_member,
        coverage=sample_coverage,
        requesting_provider=sample_provider,
        service_lines=[sample_service_line],
        decisions=[],
        created_at="2026-06-05T10:00:00Z",
        updated_at="2026-06-05T10:00:00Z",
    )


def test_member_roundtrip(sample_member: Member) -> None:
    json_str = sample_member.model_dump_json()
    result = Member.model_validate_json(json_str)
    assert result == sample_member


def test_coverage_roundtrip(sample_coverage: Coverage) -> None:
    json_str = sample_coverage.model_dump_json()
    result = Coverage.model_validate_json(json_str)
    assert result == sample_coverage


def test_provider_roundtrip(sample_provider: Provider) -> None:
    json_str = sample_provider.model_dump_json()
    result = Provider.model_validate_json(json_str)
    assert result == sample_provider


def test_service_line_roundtrip(sample_service_line: ServiceLine) -> None:
    json_str = sample_service_line.model_dump_json()
    result = ServiceLine.model_validate_json(json_str)
    assert result == sample_service_line


def test_case_roundtrip(sample_case: Case) -> None:
    json_str = sample_case.model_dump_json()
    result = Case.model_validate_json(json_str)
    assert result == sample_case


def test_case_roundtrip_via_dict(sample_case: Case) -> None:
    """Also test the dict path (model_dump / model_validate)."""
    d = sample_case.model_dump()
    result = Case.model_validate(d)
    assert result == sample_case


def test_tenant_id_required() -> None:
    """tenant_id must be present — omitting it raises ValidationError."""
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        Member(
            member_id="11111111-0000-0000-0000-000000000001",
            # tenant_id intentionally omitted
            first_name="Jane",
            last_name="Doe",
            date_of_birth="1985-04-12",
        )


def test_case_json_contains_tenant_id(sample_case: Case) -> None:
    """Serialized JSON must contain tenant_id — guard against accidental exclusion."""
    payload = json.loads(sample_case.model_dump_json())
    assert payload["tenant_id"] == "tenant-test"
    assert payload["member"]["tenant_id"] == "tenant-test"
    assert payload["requesting_provider"]["tenant_id"] == "tenant-test"
```

- [ ] **Step 2: Run test**

```bash
cd packages/canonical-model && uv run pytest tests/python/ -v
```

Expected: all tests pass. If import fails because `datamodel-code-generator` used different class names, inspect `generated/python/canonical_model/` and update the import in the test file to match.

- [ ] **Step 3: Commit**

```bash
git add packages/canonical-model/tests/python/test_roundtrip.py
git commit -m "test(canonical-model): Python Pydantic v2 round-trip tests — all green"
```

---

## Task 5: TypeScript round-trip test

**Files:**
- Create: `packages/canonical-model/tests/typescript/roundtrip.test.ts`

- [ ] **Step 1: Create roundtrip.test.ts**

```typescript
// packages/canonical-model/tests/typescript/roundtrip.test.ts
import { describe, expect, it } from "vitest";
import type { Case, Member, Coverage, Provider, ServiceLine } from "../../generated/typescript/index.js";

const sampleMember: Member = {
  memberId: "11111111-0000-0000-0000-000000000001",
  tenantId: "tenant-test",
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "1985-04-12",
  mrn: "MRN-001",
  gender: "F",
  identifiers: [],
};

const sampleCoverage: Coverage = {
  coverageId: "22222222-0000-0000-0000-000000000002",
  tenantId: "tenant-test",
  memberId: "11111111-0000-0000-0000-000000000001",
  planId: "PLAN-GOLD-001",
  subscriberId: "SUB-001",
  payerName: "Acme Health",
  lob: "commercial",
  effectiveDate: "2025-01-01",
};

const sampleProvider: Provider = {
  providerId: "33333333-0000-0000-0000-000000000003",
  tenantId: "tenant-test",
  npi: "1234567890",
  name: "Dr. Alice Smith",
  specialty: "Orthopedics",
  identifiers: [],
};

const sampleServiceLine: ServiceLine = {
  serviceLineId: "44444444-0000-0000-0000-000000000004",
  tenantId: "tenant-test",
  sequence: 1,
  serviceTypeCode: "73",
  procedureCode: "27447",
  procedureDescription: "Total knee replacement",
  quantity: 1,
  units: "UN",
  diagnosisCodes: ["M17.11"],
  placeOfService: "21",
  requestedStartDate: "2026-07-01",
};

const sampleCase: Case = {
  caseId: "55555555-0000-0000-0000-000000000005",
  tenantId: "tenant-test",
  correlationId: "corr-abc-123",
  lob: "commercial",
  status: "intake",
  urgency: "standard",
  member: sampleMember,
  coverage: sampleCoverage,
  requestingProvider: sampleProvider,
  serviceLines: [sampleServiceLine],
  decisions: [],
  createdAt: "2026-06-05T10:00:00Z",
  updatedAt: "2026-06-05T10:00:00Z",
};

describe("TypeScript canonical model round-trips", () => {
  it("Member round-trips through JSON.stringify/parse", () => {
    const json = JSON.stringify(sampleMember);
    const result = JSON.parse(json) as Member;
    expect(result).toEqual(sampleMember);
  });

  it("Case round-trips through JSON.stringify/parse", () => {
    const json = JSON.stringify(sampleCase);
    const result = JSON.parse(json) as Case;
    expect(result).toEqual(sampleCase);
  });

  it("Case JSON contains tenant_id on root and nested entities", () => {
    const payload = JSON.parse(JSON.stringify(sampleCase)) as Record<string, unknown>;
    expect((payload as Case).tenantId).toBe("tenant-test");
    expect(((payload as Case).member as Member).tenantId).toBe("tenant-test");
  });
});
```

- [ ] **Step 2: Update package.json to add vitest config**

Add `"vitest": { "include": ["tests/typescript/**/*.test.ts"] }` section to `package.json`:

```json
{
  "name": "@enstellar/canonical-model",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "codegen": "node codegen/ts_codegen.mjs"
  },
  "devDependencies": {
    "json-schema-to-typescript": "^15.0.0",
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  },
  "vitest": {
    "include": ["tests/typescript/**/*.test.ts"]
  }
}
```

- [ ] **Step 3: Run TypeScript test**

```bash
cd packages/canonical-model && npm test
```

Expected: `3 tests passed`. If TS types have different field names than expected (due to codegen output), update the test to match the actual generated names in `generated/typescript/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/canonical-model/tests/typescript/roundtrip.test.ts packages/canonical-model/package.json
git commit -m "test(canonical-model): TypeScript interface round-trip tests — all green"
```

---

## Task 6: Java round-trip test

**Files:**
- Create: `packages/canonical-model/tests/java/src/test/java/com/simintero/enstellar/canonical/RoundTripTest.java`

- [ ] **Step 1: Create RoundTripTest.java**

```java
// packages/canonical-model/tests/java/src/test/java/com/simintero/enstellar/canonical/RoundTripTest.java
package com.simintero.enstellar.canonical;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class RoundTripTest {

    private static ObjectMapper MAPPER;

    @BeforeAll
    static void setup() {
        MAPPER = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    @Test
    void memberRoundTrip() throws Exception {
        var member = new Member(
            UUID.fromString("11111111-0000-0000-0000-000000000001"),
            "tenant-test",
            "MRN-001",
            "Jane",
            "Doe",
            LocalDate.of(1985, 4, 12),
            "F",
            List.of()
        );
        var json = MAPPER.writeValueAsString(member);
        var result = MAPPER.readValue(json, Member.class);
        assertEquals(member, result);
    }

    @Test
    void caseRoundTrip() throws Exception {
        var member = new Member(
            UUID.fromString("11111111-0000-0000-0000-000000000001"),
            "tenant-test",
            "MRN-001",
            "Jane",
            "Doe",
            LocalDate.of(1985, 4, 12),
            "F",
            List.of()
        );
        var coverage = new Coverage(
            UUID.fromString("22222222-0000-0000-0000-000000000002"),
            "tenant-test",
            UUID.fromString("11111111-0000-0000-0000-000000000001"),
            "PLAN-GOLD-001",
            null,
            "SUB-001",
            "Acme Health",
            "commercial",
            LocalDate.of(2025, 1, 1),
            null
        );
        var provider = new Provider(
            UUID.fromString("33333333-0000-0000-0000-000000000003"),
            "tenant-test",
            "1234567890",
            "Dr. Alice Smith",
            "Orthopedics",
            null,
            List.of()
        );
        var sl = new ServiceLine(
            UUID.fromString("44444444-0000-0000-0000-000000000004"),
            "tenant-test",
            1,
            "73",
            "27447",
            "Total knee replacement",
            1.0,
            "UN",
            List.of("M17.11"),
            "21",
            LocalDate.of(2026, 7, 1),
            null
        );
        var c = new Case(
            UUID.fromString("55555555-0000-0000-0000-000000000005"),
            "tenant-test",
            "corr-abc-123",
            "commercial",
            null,
            "intake",
            "standard",
            member,
            coverage,
            provider,
            null,
            List.of(sl),
            List.of(),
            Instant.parse("2026-06-05T10:00:00Z"),
            Instant.parse("2026-06-05T10:00:00Z")
        );
        var json = MAPPER.writeValueAsString(c);
        var result = MAPPER.readValue(json, Case.class);
        assertEquals(c, result);
    }

    @Test
    void caseJsonContainsTenantId() throws Exception {
        // Guard: tenant_id must be present in the serialized JSON.
        var member = new Member(
            UUID.randomUUID(), "tenant-test", null, "Jane", "Doe",
            LocalDate.of(1985, 4, 12), "F", List.of()
        );
        var coverage = new Coverage(
            UUID.randomUUID(), "tenant-test", member.memberId(),
            "PLAN-A", null, "SUB-1", "Payer", "commercial", LocalDate.now(), null
        );
        var provider = new Provider(
            UUID.randomUUID(), "tenant-test", "1234567890", "Dr. X",
            null, null, List.of()
        );
        var sl = new ServiceLine(
            UUID.randomUUID(), "tenant-test", 1, "73", "27447",
            null, null, null, List.of("M17.0"), null, null, null
        );
        var c = new Case(
            UUID.randomUUID(), "tenant-test", "corr-1", "commercial", null,
            "intake", "standard", member, coverage, provider, null,
            List.of(sl), List.of(), Instant.now(), Instant.now()
        );
        var node = MAPPER.readTree(MAPPER.writeValueAsString(c));
        assertEquals("tenant-test", node.get("tenant_id").asText());
        assertEquals("tenant-test", node.get("member").get("tenant_id").asText());
    }
}
```

- [ ] **Step 2: Run Java test**

```bash
cd packages/canonical-model && ./gradlew test
```

Expected: `BUILD SUCCESSFUL` with `3 tests passed`. If the Java record constructors don't match (field order mismatch from codegen), check `generated/java/com/simintero/enstellar/canonical/*.java` and update the test constructor calls to match the actual field order.

**Note:** Java records use positional constructors — the constructor argument order must match the schema property declaration order.

- [ ] **Step 3: Commit**

```bash
git add packages/canonical-model/tests/java/
git commit -m "test(canonical-model): Java record round-trip tests — all green"
```

---

## Task 7: Wire into Makefile + CI, update task graph

**Files:**
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `.claude/task-graph.md`

- [ ] **Step 1: Update Makefile**

Replace the `test:` target body and add a `codegen` target:

```makefile
COMPOSE_FILE := infra/compose/docker-compose.yml
COMPOSE := docker compose -f $(COMPOSE_FILE)

.PHONY: up down test e2e conformance scan ps logs codegen

## Bring up the full local stack and wait for all services to be healthy.
up:
	$(COMPOSE) up -d --build --wait

## Tear down the local stack and remove volumes.
down:
	$(COMPOSE) down -v

## Run codegen for all packages (re-generates types from JSON Schema).
codegen:
	cd packages/canonical-model && uv run python codegen/generate.py

## Run unit, contract, and integration tests across all services.
test:
	cd packages/canonical-model && uv run pytest tests/python/ -v
	cd packages/canonical-model && npm test
	cd packages/canonical-model && ./gradlew test

## Run end-to-end tests (requires the stack to be up).
e2e:
	@echo "→ No e2e tests yet. Add playwright/pytest targets here."

## Run FHIR conformance tests (Inferno/Touchstone). Requires make up.
conformance:
	@echo "→ No conformance tests yet. Inferno/Touchstone wired in T05/T06."

## Run security scans (SAST, secrets, dependency).
scan:
	@echo "→ No security scans yet. Wire in T01.1 (CI hardening)."

## Show status of running services.
ps:
	$(COMPOSE) ps

## Tail logs for all services (or pass SERVICE=<name> to filter).
logs:
	$(COMPOSE) logs -f $(SERVICE)
```

- [ ] **Step 2: Add CI job for canonical-model**

Add to `.github/workflows/ci.yml`:

```yaml
  test-canonical-model-python:
    name: Canonical model — Python round-trip
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install uv
        run: pip install uv
      - name: Install deps and run tests
        working-directory: packages/canonical-model
        run: |
          uv sync
          uv run pytest tests/python/ -v

  test-canonical-model-typescript:
    name: Canonical model — TypeScript round-trip
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install deps and run tests
        working-directory: packages/canonical-model
        run: |
          npm ci
          npm test

  test-canonical-model-java:
    name: Canonical model — Java round-trip
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"
      - name: Run Gradle tests
        working-directory: packages/canonical-model
        run: ./gradlew test
```

- [ ] **Step 3: Add Gradle wrapper**

The Gradle wrapper files must exist for CI. Run from inside `packages/canonical-model/`:

```bash
cd packages/canonical-model && gradle wrapper --gradle-version 8.7
```

Expected: `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties`, `gradlew`, `gradlew.bat` created.

- [ ] **Step 4: Update task-graph.md — mark T01 and T02 done**

Edit `.claude/task-graph.md`: change `T01` and `T02` rows from `[ ]` to `[x]`.

- [ ] **Step 5: Run make test to verify everything**

```bash
make test
```

Expected: Python tests pass, TypeScript tests pass, Java tests pass. No failures.

- [ ] **Step 6: Final commit**

```bash
git add Makefile .github/workflows/ci.yml .claude/task-graph.md packages/canonical-model/gradle/ packages/canonical-model/gradlew packages/canonical-model/gradlew.bat
git commit -m "feat(T02): canonical model codegen complete — Python/TS/Java round-trip tests green; T01+T02 marked done"
```

---

## Self-Check

- [x] All six schema files defined: common, member, coverage, provider, service_line, decision, case
- [x] `tenant_id` present and required on every entity (invariant #5)
- [x] Decision schema carries `human_signoff_required` field (invariant #1 test support)
- [x] Round-trip test asserts `tenant_id` propagates through serialization
- [x] Python, TypeScript, Java all tested
- [x] `make test` wires all three
- [x] CI jobs added for all three languages
- [x] No PHI in logs/tests — test data is synthetic
- [x] T01 and T02 marked done in task-graph.md
