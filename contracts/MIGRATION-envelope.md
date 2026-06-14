# Envelope migration: Enstellar legacy → platform standard

Source (retired): Enstellar/packages/event-contracts/schema/event_envelope.json
Target (standard): contracts/schemas/envelope/event-envelope.schema.json

| Legacy field        | Platform field          | Transform                                                                 |
|---------------------|-------------------------|---------------------------------------------------------------------------|
| event_id (uuid)     | event_id (ULID evt_…)   | Generate a fresh ULID, prefix `evt_`. Do NOT reuse the uuid.              |
| tenant_id (string)  | tenant.tenant_id        | Wrap in object; populate tenant.lob/region from case context.            |
| (n/a)               | tenant.lob              | Required-ish for routing; from Case.lob.                                  |
| (n/a)               | tenant.program/product/region | From Case/tenant context; null allowed.                            |
| type (dotted)       | schema_ref (topic/Name/vN) | Map via topics.py SchemaRef constants (already C-3 form).             |
| schema_version      | (folded into schema_ref /vN) | Drop the separate field; version lives in schema_ref suffix.       |
| actor.type user     | actor.type human        | user→human                                                                |
| actor.type system   | actor.type service      | system→service                                                            |
| actor.type service  | actor.type service      | unchanged                                                                 |
| (n/a)               | actor.type model_agent  | NEW — emit for agent-layer-produced events.                              |
| case_id             | correlation_id          | Legacy used correlation_id already; case_id becomes payload.case_id.     |
| (n/a)               | causation_id            | NEW nullable — set to the triggering event_id when known.                |
| (n/a)               | trace_ref               | NEW nullable — populated once observability lands (Section D).           |
| occurred_at         | occurred_at             | unchanged (ISO-8601 UTC).                                                 |
