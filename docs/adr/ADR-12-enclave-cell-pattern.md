# ADR-12: Enclave Cell Pattern for FedRAMP GovCloud Tenants

> **HUMAN_REVIEW:** This ADR is in **Proposed** status. It has NOT been ratified.
> It must be reviewed and approved by a compliance officer and security team before
> any enclave cell is provisioned for production use. The content below is a
> design proposal only and is NOT production-approved.

---

## Status

**Proposed** — requires compliance officer and security review before adoption.

---

## Context

The Simintero payer platform currently supports two cell tiers:

- **Pooled** — shared infrastructure; multiple tenants per cell; lowest cost.
- **Dedicated** — single-tenant infrastructure; still connected to the shared
  control plane and public Anthropic API endpoints.

Certain US federal and state government payer tenants require a **FedRAMP-compatible
deployment pattern** for workloads that handle covered data (PHI/PII under HIPAA,
CUI under NIST 800-171, or data subject to FedRAMP Moderate/High baselines). These
tenants must be hosted in AWS GovCloud (US) and must meet the following constraints:

1. No egress to external (non-GovCloud) API endpoints, including the public
   Anthropic API.
2. No pull-through from an external control plane — all configuration must be
   applied inside the enclave boundary by authorized personnel.
3. Telemetry must not cross the enclave boundary in raw form.
4. All cryptographic keys must be provisioned and managed inside GovCloud, never
   shared with non-enclave cells.

The existing `infra/terraform/modules/cell` module already parameterizes tier,
region, instance types, and key management. A new **enclave tier** can be realized
by re-using this module with additional constraints applied via variables and
post-deploy hardening — no new Terraform module is required.

---

## Decision

Introduce a **`tier = "enclave"`** variant of the existing `cell` module. Enclave
cells differ from dedicated cells only through:

1. Variables passed to the module (tier tag, GovCloud region, larger node sizes
   required for on-prem model inference).
2. Post-deploy hardening steps (VPC endpoint configuration, removal of internet
   gateways) documented in `infra/cell-stamp/enclave-checklist.md`.
3. An out-of-band desired-state handoff process that replaces the normal control
   plane pull mechanism.

No new Terraform module is added. The `us-gov-west-1-enclave-01` cell definition
lives at `infra/terraform/cells/us-gov-west-1-enclave-01/` and serves as the
reference implementation.

### Enclave-Specific Constraints

#### 1. No External LLM API Egress

Enclave cells must not make outbound connections to `api.anthropic.com` or any
other public LLM API endpoint. Model inference is served through a
**VPC-endpoint-accessible internal model endpoint** provisioned inside the
GovCloud VPC. Network ACLs and security groups must block all outbound port-443
traffic except to approved VPC endpoint CIDR prefixes.

#### 2. Control-Plane Handoff (Out-of-Band)

Normal dedicated/pooled cells pull desired state (Helm values + ArgoCD app
definitions) from the Simintero control plane over the internet. Enclave cells
cannot do this.

Instead:

- The **external control plane** generates a desired-state manifest at each
  release cycle.
- The manifest is transferred to the enclave boundary via a **secure
  out-of-band channel** approved by the enclave security team (e.g., AWS
  Transfer Family with SCPs, or a physically air-gapped media process).
- The **enclave ops team** reviews the manifest, then applies it inside the
  boundary using ArgoCD in offline/manual-sync mode.
- The external control plane has no direct network path into the enclave.

#### 3. Federated Observability

Raw telemetry (traces, logs, metrics) must not leave the enclave boundary.

- Metrics are replicated to an **enclave-local Prometheus** instance.
- Only **aggregated, de-identified compliance reports** (e.g., SLA uptime
  percentages, anonymized error rates) are permitted to cross the boundary.
- Log retention and access controls are managed by the enclave ops team in
  accordance with the ATO documentation.

#### 4. Cell-Scoped KMS Keys

- All KMS keys for the enclave cell are provisioned inside AWS GovCloud.
- Keys are never exported and are not shared with or accessible from
  non-GovCloud cells.
- Key rotation and access policies are managed solely by the enclave ops team.

---

## Consequences

### Positive

- Provides a compliant deployment path for US federal and state government
  payer tenants requiring FedRAMP Moderate/High coverage.
- Re-uses the existing `cell` module, avoiding a separate code path to
  maintain.
- Establishes a clear operational boundary between the Simintero control plane
  and the enclave, reducing the attack surface.

### Negative / Trade-offs

- **Higher operational cost:** The manual desired-state handoff process
  significantly increases operational overhead relative to pooled or dedicated
  cells. Each release cycle requires enclave ops team involvement.
- **Slower time-to-update:** Feature rollouts and security patches reach
  enclave cells more slowly due to the out-of-band handoff process.
- **Model inference dependency:** Enclave cells depend on the availability of
  an internal model endpoint; operational responsibility for that endpoint is
  out of scope for the Simintero platform team and must be negotiated with the
  tenant.

---

## References

- `infra/cell-stamp/enclave-checklist.md` — step-by-step provisioning runbook
- `infra/terraform/cells/us-gov-west-1-enclave-01/main.tf` — reference cell definition
- `infra/terraform/modules/cell/` — shared cell Terraform module
- ADR-08: Cell Stamp Pattern (pooled + dedicated tiers)
- ADR-10: Observability Architecture

---

> **HUMAN_REVIEW:** This ADR must be ratified by a compliance officer before any
> enclave cell is provisioned for production use. All enclave provisioning steps
> must be executed by authorized personnel only. This document does not constitute
> legal, regulatory, or compliance advice.
