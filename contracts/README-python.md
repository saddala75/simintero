# simintero-contracts (Python)

Pip-installable package exposing the generated Pydantic v2 types (`canonical_model`):
canonical entities (`Case`, `Member`, `Coverage`, `Provider`, `ServiceLine`, `Decision`)
and the platform event envelope (`EventEnvelope`). Generated from the JSON schemas under
`contracts/schemas/` by `contracts/codegen/generate.py` — do not edit `generated/` by hand.

Note: typed event-PAYLOAD Python models are deferred (Section A RISK-1: the event schemas
reference canonical schemas by absolute `$id`, which datamodel-code-generator cannot resolve
offline). Event payloads remain `dict` on `EventEnvelope.payload` until a local ref-resolver
shim is added. The TypeScript and Java targets generate standalone typed payload classes (e.g. `CaseStateChanged`), though the `EventEnvelope.payload` field itself remains loosely typed in all languages.

## Install (dev)

The Python contract package + the platform conformance libs share one venv at
`platform/libs/.venv` (gitignored). To set it up from the repo root:

```bash
python3 -m venv platform/libs/.venv
platform/libs/.venv/bin/pip install -U pip hatchling
platform/libs/.venv/bin/pip install -e contracts
```

Then `from canonical_model import Case, EventEnvelope` resolves from any cwd.
Later conformance libs (`platform/libs/*/py`) editable-install into the same venv.
