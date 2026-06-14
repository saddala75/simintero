#!/usr/bin/env python3
"""Run all three codegen targets: Python (Pydantic v2), TypeScript, Java records."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent          # contracts/
SCHEMA_DIRS = [
    ROOT / "schemas" / "canonical",
    ROOT / "schemas" / "envelope",
    ROOT / "schemas" / "events",
]
GEN_DIR = ROOT / "generated"


def _all_schema_files():
    files = []
    for d in SCHEMA_DIRS:
        files.extend(sorted(d.glob("*.json")))
    return files


def _schema_registry() -> dict:
    """Map each schema's $id to its parsed body, for cross-file ref resolution."""
    registry: dict = {}
    for sf in _all_schema_files():
        body = json.loads(sf.read_text())
        if "$id" in body:
            registry[body["$id"]] = body
    return registry


def _write_python_init(out: Path) -> None:
    """Scan generated Python files and write a proper __init__.py with re-exports."""
    import ast

    exports_by_module: dict[str, list[str]] = {}
    for py_file in sorted(out.glob("*.py")):
        if py_file.name == "__init__.py":
            continue
        mod_name = py_file.stem
        try:
            tree = ast.parse(py_file.read_text())
        except SyntaxError:
            continue
        names = [
            node.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.ClassDef,))
            and node.name != "Common"
        ]
        if names:
            exports_by_module[mod_name] = names

    lines = ['"""Generated Pydantic v2 models for the Enstellar canonical case model."""', ""]
    all_names: list[str] = []
    for mod_name, names in exports_by_module.items():
        lines.append(f"from .{mod_name} import {', '.join(names)}")
        all_names.extend(names)
    lines += [
        "",
        "__all__ = [",
        *[f'    "{n}",' for n in all_names],
        "]",
        "",
    ]
    (out / "__init__.py").write_text("\n".join(lines))


# Python codegen input scope.
#
# RISK-1 FALLBACK (taken): The event schemas in schemas/events/ reference the
# canonical schemas by ABSOLUTE $id (e.g. https://schemas.simintero.io/canonical/
# case.json). datamodel-code-generator treats those as remote HTTP refs and tries
# to fetch them over the network, which fails offline. Pointing --input at the whole
# schemas/ tree therefore aborts with an unresolved-remote-ref error.
#
# Per the Task 6 plan we fall back to generating Python from canonical + envelope
# only (both are self-contained: canonical uses relative sibling refs, envelope has
# no cross-file refs). Event-payload Python models are DEFERRED. Each input dir is
# generated independently, then the per-file modules are merged into the single
# `canonical_model` package so that `from canonical_model import Case` keeps working.
PY_INPUT_DIRS = [
    ROOT / "schemas" / "canonical",
    ROOT / "schemas" / "envelope",
]


def _generate_python_into(input_dir: Path, dest: Path) -> None:
    subprocess.run(
        [
            sys.executable, "-m", "datamodel_code_generator",
            "--input", str(input_dir),
            "--input-file-type", "jsonschema",
            "--output", str(dest),
            "--output-model-type", "pydantic_v2.BaseModel",
            "--use-annotated",
            "--field-constraints",
            "--target-python-version", "3.12",
            "--use-default",
            "--disable-timestamp",
        ],
        check=True,
    )


def run_python() -> None:
    """Generate Pydantic v2 models using datamodel-code-generator.

    See RISK-1 note above: generated from canonical + envelope only; events deferred.
    """
    import shutil
    import tempfile

    out = GEN_DIR / "python" / "canonical_model"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    for input_dir in PY_INPUT_DIRS:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            _generate_python_into(input_dir, tmp_path)
            for py_file in tmp_path.glob("*.py"):
                if py_file.name == "__init__.py":
                    continue  # rebuilt below with proper re-exports
                shutil.copy2(py_file, out / py_file.name)

    # datamodel-code-generator writes a bare __init__.py per run; replace it with a
    # single set of proper re-exports spanning all merged modules.
    _write_python_init(out)
    print("✓ Python codegen done (canonical + envelope; events deferred — see RISK-1)")


def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def _snake_to_pascal(name: str) -> str:
    return "".join(p.title() for p in name.split("_"))


def _resolve_ref_name(ref_str: str) -> str:
    """Resolve a $ref string to a PascalCase type name.

    Handles two forms:
      - "service_line.json"              → "ServiceLine"
      - "common.json#/$defs/Identifier"  → "Identifier"
    """
    if "#" in ref_str:
        # Use the fragment's last path segment (e.g. /$defs/Identifier → Identifier)
        fragment = ref_str.split("#", 1)[1]
        return fragment.split("/")[-1]
    # Plain file ref: strip .json and convert snake_case → PascalCase
    filename = ref_str.replace(".json", "").split("/")[-1]
    return _snake_to_pascal(filename)


def _json_type_to_ts(prop: dict, defs: dict, registry: dict | None = None) -> str:
    if "$ref" in prop:
        ref = prop["$ref"]
        # A ref into another schema's #/properties/... has no emitted named type,
        # so inline the referenced property's type (e.g. the status enum).
        if "#/properties/" in ref and registry is not None:
            file_id, fragment = ref.split("#", 1)
            target = registry.get(file_id)
            if target is not None:
                node = target
                for seg in [s for s in fragment.split("/") if s]:
                    node = node.get(seg, {})
                if node:
                    return _json_type_to_ts(node, target.get("$defs", {}), registry)
        return _resolve_ref_name(ref)
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
        item_type = _json_type_to_ts(prop.get("items", {}), defs, registry)
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

    registry = _schema_registry()
    schema_files = _all_schema_files()
    for sf in schema_files:
        schema = json.loads(sf.read_text())
        title = schema.get("title")
        if not title or title == "Common":
            if title == "Common":
                for def_name, def_schema in schema.get("$defs", {}).items():
                    lines.extend(_ts_interface(def_name, def_schema, schema.get("$defs", {}), registry))
            continue
        lines.extend(_ts_interface(title, schema, schema.get("$defs", {}), registry))

    (out_dir / "index.ts").write_text("\n".join(lines) + "\n")
    print("✓ TypeScript codegen done")


def _ts_interface(title: str, schema: dict, defs: dict, registry: dict | None = None) -> list[str]:
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    lines = [f"export interface {title} {{"]
    for name, prop in props.items():
        camel = _snake_to_camel(name)
        ts_type = _json_type_to_ts(prop, defs, registry)
        opt = "" if name in required else "?"
        lines.append(f"  {camel}{opt}: {ts_type};")
    lines += ["}", ""]
    return lines


def _json_type_to_java(prop: dict, nullable: bool = True) -> str:
    if "$ref" in prop:
        return _resolve_ref_name(prop["$ref"])
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

    schema_files = _all_schema_files()
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
