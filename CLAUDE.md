# Simintero Root Agent Conventions

## STOP — read this before writing any code

### Cross-module rules
- NEVER import from `modules/A` inside `modules/B`. Use generated contract clients only.
- NEVER import from `modules/*` inside `platform/*`.
- Wire formats (FHIR classes, X12) appear ONLY under `integration/` and `platform/libs/fhir-mapping`.
- Before any cross-module call, regenerate client: `pnpm contracts:generate`.

### Tenancy (NON-NEGOTIABLE)
- NEVER pass `tenant_id` as a plain function parameter across service boundaries.
- ALWAYS use `platform/libs/tenant-context` — `ctx()` accessor only.
- NEVER write a DB query without going through the `db()` wrapper in `platform/libs/tenant-context`.
  It sets `sim.tenant_id` GUC. A query without it will fail the RLS harness.

### New table checklist (do all four or the CI RLS harness will fail)
1. `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY`
2. `ALTER TABLE <t> FORCE ROW LEVEL SECURITY`
3. `CREATE POLICY tenant_isolation ON <t> USING (tenant_id = current_setting('sim.tenant_id', true))`
4. Add `<t>` to `platform/services/rls-harness/manifest.json`

### PHI rules
- NEVER interpolate request bodies or payload objects into log strings.
- Use the typed logger from `platform/libs/audit-client`. Fields tagged `@phi` are auto-tokenized.
- NEVER log a free-form JSON.stringify of any object that could contain clinical data.

### Events
- ALL state changes emit via `outbox.append()` from `platform/libs/outbox`.
- Event consumers MUST be idempotent on `event_id`. Use the dedup pattern in `platform/libs/outbox`.

### Adverse-action path (CRITICAL)
- Do NOT create any code path that calls `decision.record` with outcome `deny | partial_deny | modify`
  outside the guarded command handler in `modules/enstellar/case/commands/RecordDecision.ts`.
- If a task seems to require it: STOP immediately, write a `REVIEW_REQUIRED.md` at the repo root
  describing the code path found, and halt with status BLOCKED. Do not implement it.

### Artifacts over branches
- Behavior that varies by tenant, LOB, or state MUST be a VKAS artifact + engine call.
- If a PR adds `if (tenantId === 'x')`, the review MUST reject it.

### Verify before PR
```bash
pnpm verify          # lint + typecheck + unit tests
pnpm rls-harness     # cross-tenant probe suite
pnpm contracts:check # contract compatibility check
```
