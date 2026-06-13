output "vpc_id" {
  value       = aws_vpc.cell.id
  description = "VPC ID for this cell"
}

output "rds_cluster_endpoint" {
  value       = aws_rds_cluster.cell.endpoint
  description = "Aurora cluster writer endpoint"
}

output "eks_cluster_name" {
  value       = aws_eks_cluster.cell.name
  description = "EKS cluster name"
}

output "kms_key_arn" {
  value       = aws_kms_key.cell.arn
  description = "Cell-scoped KMS key ARN (data residency enforcement)"
}
