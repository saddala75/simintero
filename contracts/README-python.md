# simintero-contracts (Python)

Pip-installable package exposing the generated Pydantic v2 types (`canonical_model`):
canonical entities (`Case`, `Member`, `Coverage`, `Provider`, `ServiceLine`, `Decision`)
and the platform event envelope (`EventEnvelope`). Generated from the JSON schemas under
`contracts/schemas/` by `contracts/codegen/generate.py` — do not edit `generated/` by hand.

Note: typed event-PAYLOAD Python models are deferred (Section A RISK-1: the event schemas
reference canonical schemas by absolute `$id`, which datamodel-code-generator cannot resolve
offline). Event payloads remain `dict` on `EventEnvelope.payload` until a local ref-resolver
shim is added. The TypeScript and Java targets DO have typed event payloads.
