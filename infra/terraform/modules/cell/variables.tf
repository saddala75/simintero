variable "cell_name" {
  type        = string
  description = "Unique name for this cell (e.g. us-east-1-pooled-01)"
}

variable "region" {
  type        = string
  description = "AWS region for this cell"
}

variable "tier" {
  type        = string
  description = "Cell tier: pooled, dedicated, or enclave"
  validation {
    condition     = contains(["pooled", "dedicated", "enclave"], var.tier)
    error_message = "tier must be one of: pooled, dedicated, enclave"
  }
}

variable "vpc_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPC CIDR block"
}

variable "rds_instance" {
  type        = string
  default     = "db.r7g.large"
  description = "RDS Aurora instance class"
}

variable "eks_node_type" {
  type        = string
  default     = "m7g.xlarge"
  description = "EKS worker node instance type"
}

variable "eks_min_nodes" {
  type        = number
  default     = 2
  description = "Minimum EKS worker node count"
}

variable "eks_max_nodes" {
  type        = number
  default     = 10
  description = "Maximum EKS worker node count"
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Additional tags applied to all resources"
}
