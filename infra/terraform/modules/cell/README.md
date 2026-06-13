# Cell Stamp Module

Parameterized Terraform module that provisions a single Simintero cell: one VPC,
one Aurora PostgreSQL cluster, and one EKS cluster — all scoped to a single AWS region.

## Cell Tiers

| Tier        | Description                                                         |
|-------------|---------------------------------------------------------------------|
| `pooled`    | Multiple tenants share the cell. Default for new payers.           |
| `dedicated` | Single-tenant cell; tenant data never co-mingles with others.      |
| `enclave`   | Hardened single-tenant cell with stricter network isolation, used for HITRUST/FedRAMP payers. |

The `tier` variable is validated at plan time; any value outside the three above is rejected.

## Stamping a New Cell

```bash
# 1. Copy the reference instantiation
cp -r infra/terraform/cells/us-east-1-pooled-01 \
       infra/terraform/cells/<new-cell-name>

# 2. Edit main.tf — update cell_name, region, tier
# 3. Edit terraform.tfvars to match

cd infra/terraform/cells/<new-cell-name>
terraform init
terraform plan
terraform apply
```

## Data Residency Guarantees

Every cell creates its own KMS key (`aws_kms_key.cell`) scoped to that cell only.
The Aurora cluster sets `storage_encrypted = true` and pins `kms_key_id` to this
cell-local key. No cross-region or cross-cell key sharing occurs. The `data_residency`
tag on every resource records the target region for audit purposes.

## Module Inputs

| Variable       | Required | Default         | Description                          |
|----------------|----------|-----------------|--------------------------------------|
| `cell_name`    | yes      | —               | Unique cell identifier               |
| `region`       | yes      | —               | AWS region                           |
| `tier`         | yes      | —               | pooled / dedicated / enclave         |
| `vpc_cidr`     | no       | `10.0.0.0/16`  | VPC CIDR block                       |
| `rds_instance` | no       | `db.r7g.large` | Aurora instance class                |
| `eks_node_type`| no       | `m7g.xlarge`   | EKS worker node type                 |
| `eks_min_nodes`| no       | `2`             | EKS autoscaler minimum               |
| `eks_max_nodes`| no       | `10`            | EKS autoscaler maximum               |
| `tags`         | no       | `{}`            | Extra tags applied to all resources  |

## Reference Cells

`infra/terraform/cells/` contains one directory per instantiated cell.
Each directory holds a `main.tf` (provider + module call + output re-exports)
and a `terraform.tfvars` (variable overrides). Add a new directory to stamp
an additional cell; no changes to the module itself are needed.
