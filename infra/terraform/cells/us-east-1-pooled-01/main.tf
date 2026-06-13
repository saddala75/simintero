terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

module "cell" {
  source    = "../../modules/cell"
  cell_name = "us-east-1-pooled-01"
  region    = "us-east-1"
  tier      = "pooled"
  tags = {
    env   = "prod"
    owner = "platform"
  }
}

output "vpc_id"               { value = module.cell.vpc_id }
output "rds_cluster_endpoint" { value = module.cell.rds_cluster_endpoint }
output "eks_cluster_name"     { value = module.cell.eks_cluster_name }
