# Enclave Cell Provisioning Checklist

> **HUMAN_REVIEW: This checklist requires compliance review before production use.
> All steps must be executed by authorized personnel only. This document is NOT
> production-approved. See docs/adr/ADR-12-enclave-cell-pattern.md for design
> rationale and constraints.**

---

## Prerequisites

Before beginning provisioning, confirm all of the following:

- [ ] FedRAMP ATO coverage documentation obtained and on file with the enclave
      ops team.
- [ ] GovCloud account provisioned with appropriate IAM permission boundaries
      (SCPs applied at the AWS Organization level).
- [ ] Enclave KMS keys provisioned inside GovCloud and confirmed air-gapped from
      non-enclave cells (no cross-account key sharing policies).
- [ ] Internal model inference endpoint provisioned and accessible via VPC
      endpoint (not the public Anthropic API).
- [ ] Enclave ops team members with appropriate GovCloud IAM access confirmed.
- [ ] Out-of-band transfer channel reviewed and approved by security team.

---

## Step 1: Terraform Provisioning

Run the following from inside an environment with GovCloud credentials configured.
Do NOT run `terraform apply` without team review of the plan output.

```bash
cd infra/terraform/cells/us-gov-west-1-enclave-01
terraform init
terraform plan -var-file=terraform.tfvars
# Review plan with enclave ops team before apply
terraform apply -var-file=terraform.tfvars
```

- [ ] `terraform plan` output reviewed and approved by enclave ops team.
- [ ] `terraform apply` completed without errors.
- [ ] State file stored in GovCloud S3 backend (not in commercial AWS).

---

## Step 2: Post-Deploy Hardening

After Terraform apply, perform the following hardening steps manually. Each step
must be verified and signed off by the security team.

- [ ] Disable all internet gateways attached to the enclave VPC.
- [ ] Configure VPC endpoints for the following services (Gateway or Interface
      type as appropriate):
  - **ECR** (pull container images without internet egress)
  - **S3** (artifact and state storage)
  - **EKS** (cluster API access)
  - **RDS** (if using RDS Proxy or direct endpoint via VPC)
  - **KMS** (key operations)
  - **SSM** (Systems Manager / Parameter Store / Session Manager)
  - **Model inference** — internal endpoint, NOT the public Anthropic API
- [ ] Verify **no outbound `0.0.0.0/0` routes** exist in any route table
      associated with enclave subnets.
- [ ] Confirm network ACLs deny all outbound traffic except to approved VPC
      endpoint CIDR prefixes.
- [ ] Security group audit: confirm no security group allows outbound port 443
      to non-VPC-endpoint destinations.

---

## Step 3: Desired-State Handoff

The enclave cell does not pull configuration from the external Simintero control
plane. Configuration is applied via an approved out-of-band process.

- [ ] External control plane generates the desired-state manifest:
  - Helm values files for all platform services
  - ArgoCD Application definitions
  - Any Kubernetes secrets (pre-encrypted with enclave KMS key)
- [ ] Manifest transferred to enclave boundary via **secure out-of-band channel**
      approved by security team (e.g., AWS Transfer Family with SCPs, or
      physically air-gapped media — channel choice documented in the ATO package).
- [ ] Enclave ops team reviews the manifest in full before applying.
- [ ] Manifest applied inside the enclave boundary:
  - ArgoCD configured in **manual-sync / offline mode** (no external Git pull).
  - `kubectl apply` or ArgoCD sync triggered by enclave ops team.
- [ ] Confirm ArgoCD sync status shows all applications **Synced / Healthy**.

---

## Step 4: Validation

Run the following validation commands **from inside the enclave boundary**
(e.g., from a bastion host or SSM Session Manager session within the VPC).

```bash
# Verify RLS policies are in place for qual.* and fabric.* tables
pnpm rls-harness

# Verify no breaking contract changes relative to the last signed manifest
pnpm contracts:check
```

- [ ] `pnpm rls-harness` passes with no failures.
- [ ] `pnpm contracts:check` passes with no breaking changes detected.
- [ ] Enclave ops team verifies model inference endpoint responds to internal
      health check (no external API traffic observed in VPC flow logs).
- [ ] VPC flow logs reviewed — confirm zero flows to external internet
      destinations.

---

## Step 5: Sign-Off

All sign-offs must be obtained before the enclave cell is considered
production-ready and before any covered data is loaded into the cell.

- [ ] **Compliance officer sign-off** — ATO coverage confirmed, operational
      procedures align with documented controls.
- [ ] **Platform architect sign-off** — cell configuration matches ADR-12
      enclave constraints; no deviations from the approved design.
- [ ] **Security team sign-off** — VPC endpoint configuration verified, network
      hardening steps confirmed, no internet egress paths detected.

---

> **HUMAN_REVIEW: This checklist requires compliance review before production use.
> All steps must be executed by authorized personnel only. This document is NOT
> production-approved and does not constitute legal, regulatory, or compliance
> advice.**
