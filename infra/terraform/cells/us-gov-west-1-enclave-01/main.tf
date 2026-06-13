terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-gov-west-1"
}

# HUMAN_REVIEW: Enclave cell configuration requires compliance officer review
# before production provisioning. See docs/adr/ADR-12-enclave-cell-pattern.md
# and infra/cell-stamp/enclave-checklist.md.

module "cell" {
  source    = "../../modules/cell"
  cell_name = "us-gov-west-1-enclave-01"
  region    = "us-gov-west-1"
  tier      = "enclave"
  tags = {
    env        = "prod"
    tier       = "enclave"
    compliance = "fedramp"
    owner      = "platform-enclave-ops"
  }
}

output "vpc_id"               { value = module.cell.vpc_id }
output "rds_cluster_endpoint" { value = module.cell.rds_cluster_endpoint }
output "eks_cluster_name"     { value = module.cell.eks_cluster_name }
output "kms_key_arn"          { value = module.cell.kms_key_arn }
