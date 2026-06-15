# Enstellar → Simintero Platform Alignment Audit — Specification v1.0

**Purpose:** produce, from the existing Enstellar codebase, two fixed-format deliverables — the **Capability Map** (`audit/capability-map.md`) and the **Divergence Register** (`audit/divergence-register.md`) — plus an evidence appendix. This document defines what to check, how to classify, and the exact output schemas. The companion file `platform-audit-command.md` is the Claude Code prompt that executes it.

**Reference set (must be present in the repo or `/audit/refs/` before running):**
`simintero_architecture.md` (SAD) · `simintero_detailed_design.md` (DDD) · `c1_digicore_runtime_contract.md` · `c2_revital_advisory_contract.md` · `c3_platform_event_catalog.md` · `canonical_case_evidence_model.md` (CCEM)

**Ground rules:** read-only audit — no code changes, no refactors, no "quick fixes." Every claim cites file paths + line ranges. Unknown is an acceptable answer; guessed evidence is not.

---

## Part A — Capability inventory (the Capability Map)

For each of the 12 substrate capabilities below, the audit answers: *does Enstellar contain this, in what shape, and what should happen to it?*

### A.1 Classification rubric (one value per capability)

| Class | Meaning | Test |
|---|---|---|
| `ABSENT` | No implementation exists | Nothing found beyond trivial usage of a vendor default |
| `EMBEDDED` | Exists but tangled into domain code | Capability logic imports/is imported by Enstellar domain modules; no stable internal interface; duplicated call sites |
| `EXTRACTABLE` | Exists behind a reasonably clean seam | Single module/package, coherent interface, <5 leak points into domain code |
| `CONFORMANT` | Already matches the SAD/DDD design | Could be promoted to `platform/` with renames only |

### A.2 Disposition rubric (one value per capability — the decision the map drives)

| Disposition | When |
|---|---|
| `PROMOTE` | Lift into `platform/libs` or `platform/services` as the shared implementation (target for `EXTRACTABLE`/`CONFORMANT`) |
| `CONFORM` | Keep in place short-term; wrap behind the platform interface; schedule extraction (typical for `EMBEDDED` with good logic) |
| `REBUILD` | Replace — only when the implementation violates a non-negotiable invariant (tenancy, immutability, PHI) at its core |
| `ADOPT-NEW` | `ABSENT` → build per DDD design |
| `AMEND-SPEC` | The built reality is *better* than the document → change the SAD/DDD/ICD via ADR (legitimate outcome; record it, don't hide it) |

### A.3 The 12 capabilities — what to look for

| # | Capability | DDD ref | Evidence to hunt for | Capability-specific checks |
|---|---|---|---|---|
| 1 | Tenant context & propagation | §3.1–3.2 | Auth middleware, JWT claims, context objects, `tenant_id` plumbed through calls | Is context verified (signature) or trusted from request body? Fail-open paths? Any code path reaching the DB without context? |
| 2 | Data isolation (RLS) | §3.3 | Migrations, table DDL, ORM config, RLS policies, DB roles | % of tables with `tenant_id NOT NULL`; any RLS at all; service role privileges; cross-tenant query tests? |
| 3 | Eventing & outbox | §4 | Message broker usage, event classes, pub/sub, transactional boundaries | Dual-write risk (DB write + publish not atomic)? Envelope fields vs C-3? Idempotent consumers? Topic naming? |
| 4 | Case event sourcing / history | §4.4, CCEM §4.1 | Case persistence: event table vs mutable rows; state-change history | Is history reconstructable? Optimistic concurrency? Snapshot strategy? |
| 5 | Audit trail | §4.2 (SAD §7.2) | Audit tables/loggers, who-did-what records, read auditing | App-log-as-audit anti-pattern? Immutability/tamper evidence? PHI reads audited? Exportable? |
| 6 | Workflow engine | §9.2 | State machine: code enums/switches vs metadata definitions; Temporal/queue usage | Are states/transitions/guards data or code? Versioned definitions? In-flight upgrade story? Idempotent/retryable steps? |
| 7 | Regulatory clocks & calendars | §9.3 | Timer code, SLA fields, deadline computation, pause/resume | Profiles as config or hardcoded CMS values? Business-calendar handling? Pause arithmetic correctness? |
| 8 | Rules/decision logic + versioning seam | C-1 consumer side | Wherever PA criteria are evaluated today (embedded rules, config tables, hardcoded checks) | Are decisions recorded with logic-version pins + trace? Could the eval call sites be re-pointed at C-1 `evaluate`? How many call sites? |
| 9 | Document/attachment handling | §5 (SAD §7.5) | Upload/storage code, object-store usage, OCR, access checks | Span-addressable? Access policy enforcement? Raw payload retention (ENS-INT-2)? Retention/hold? |
| 10 | Task/worklist & notification | DDD §7.7-analog, CCEM §4.4 | Queue/assignment code, worklist queries, email/webhook senders | Generic task shape or PA-review-only? Template management? Could Qualitron outreach reuse it unchanged? |
| 11 | Artifact versioning (proto-VKAS) | §5 | Any versioned config: workflow defs, templates, routing rules, code tables | Version + effective-date + approval semantics? Immutable versions? Promotion between envs? |
| 12 | AI/LLM access (proto–Model Gateway) | §11.1 | Any direct LLM/API calls, prompts in code, model config | Direct provider calls bypassing a gateway seam? Prompts versioned? PHI sent unfiltered? Logging of model+prompt versions? |

### A.4 Capability Map — fixed output format (`audit/capability-map.md`)

One row per capability. **All columns required**; `evidence` cites ≥1 `path:lines`.

```markdown
| # | Capability | Class | Evidence (path:lines) | Interface quality (0-3) | Domain leak points (count + worst 3) | Invariant violations (IDs from Part B) | Disposition | Extraction cost (S/M/L/XL) | Blocks | Notes |
```

- `Interface quality`: 0 = none, 1 = implicit, 2 = defined but leaky, 3 = clean seam.
- `Blocks`: which planned work this capability's state blocks (e.g., "Digicore start", "C-3 emission", "appeal reproduction").
- Follow the table with a per-capability subsection (≤15 lines each): current shape, target shape (DDD ref), recommended extraction path in 3–5 steps.

## Part B — Invariant scan (feeds the Divergence Register)

Concrete, mechanically checkable rules. For each: status `PASS / FAIL / PARTIAL / UNKNOWN`, evidence, blast radius.

**Tenancy & isolation**
- **T-1** Every persisted table has `tenant_id NOT NULL` (list exceptions).
- **T-2** No SQL/ORM query path executes without tenant scoping (search for raw queries, repository methods lacking tenant predicate).
- **T-3** Zero per-tenant conditionals in code: `grep -rEn "tenant(_id|Id)?\s*(==|===|\.equals|in\s*\[)" --include='*.{ts,js,java,py}'` minus legitimate context-lib code.
- **T-4** Tenant context originates only from verified token/header, never request body/query params.

**Decisions & provenance**
- **D-1** Determination records satisfy CCEM §4.3: adverse ⇒ human decider + non-auto + rationale + trace ref (check schema AND write paths).
- **D-2** Every decision persists pins (logic/rule/workflow versions used). *FAIL here = permanent data loss for past cases — flag count of affected historical rows.*
- **D-3** Decisions are immutable (no UPDATE path; corrections supersede).
- **D-4** Any rules-trace equivalent exists and could map to the Trace schema (CCEM §7).

**Events & history**
- **E-1** State changes emit events (or are derivable from an event/history table) — coverage % of CCEM lifecycle events vs C-3 §4.1 list.
- **E-2** No dual-write: publish and DB write share a transaction (outbox) or events are derived from the store.
- **E-3** Case history is reconstructable end-to-end for a sample of 5 real (or synthetic) cases.

**Workflow & clocks**
- **W-1** Lifecycle states/transitions defined in data, not `switch`/enum logic (count hardcoded transition sites).
- **W-2** No code path can record an adverse outcome from an automated context (trace the auto-determination path if one exists).
- **W-3** Clock limits (72h/7d etc.) are configuration, not literals: `grep -rn "72\|P7D\|seven\|business day" src/` and classify hits.

**PHI & security**
- **P-1** No PHI in logs: scan log statements interpolating request/member/document objects; check logger for redaction.
- **P-2** No secrets in repo; no provider API keys in code/env files committed.
- **P-3** Document access goes through an authorization check (find direct object-store URL handouts).

**Standards & mappings**
- **S-1** FHIR/X12 parsing confined to an integration layer (count domain files importing FHIR/X12 types).
- **S-2** Raw inbound payloads retained pre-transformation (ENS-INT-2).
- **S-3** Round-trip fidelity tests exist for any mapping in production use.

**AI (if any LLM usage exists)**
- **A-1** All inference behind one seam; **A-2** model+prompt versions logged per interaction; **A-3** AI output cannot reach a decision-recording path (trace data flow).

## Part C — Divergence Register — fixed output format (`audit/divergence-register.md`)

One row per divergence between built reality and the SAD/DDD/ICD/CCEM set. **A divergence is not automatically a defect** — the register exists to force an explicit disposition on each.

```markdown
| ID | Source of truth (doc §) | Built reality (path:lines) | Description | Severity | Irreversibility | Disposition | Owner | Target phase | ADR needed? |
```

- `ID`: `DIV-<area>-<n>` (areas: TEN, DEC, EVT, WF, CLK, DOC, TSK, ART, AI, STD, SEC).
- `Severity`: `S1` invariant violation with compliance/audit exposure · `S2` blocks a planned module/contract · `S3` rework cost grows with time · `S4` cosmetic/naming.
- `Irreversibility` (the priority driver): `PERMANENT` (data being lost now — e.g., unpinned decisions) · `COMPOUNDING` (every new row/feature deepens it — e.g., missing tenant_id) · `STATIC` (fixable anytime at similar cost).
- `Disposition`: `CONFORM-CODE` / `AMEND-SPEC` / `ACCEPT-RISK` (with expiry date) — no blanks permitted at review sign-off.

**Priority order for the resulting backlog (fixed):** 1) `PERMANENT` items regardless of severity → 2) `S1` → 3) `COMPOUNDING` → 4) everything else by severity. This encodes the irreversibility-over-effort rule.

## Part D — Review & sign-off

1. Engineer review of evidence sampling: spot-check 20% of citations for accuracy (agents occasionally cite plausible-but-wrong lines).
2. Architecture review ratifies every Disposition; `AMEND-SPEC` items each open an ADR PR against the SAD/DDD/ICDs.
3. Outputs become: the extraction backlog (from the Capability Map), the conformance backlog (from the Register), and the CLAUDE.md freeze-rule update ("no module builds capabilities 1–12; consume platform or halt-and-ask").
4. Re-run cadence: after each extraction milestone, re-run Parts B and C scans (they are cheap) to verify the violation counts trend to zero — these become permanent CI fitness functions.
