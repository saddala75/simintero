locals {
  common_tags = merge(var.tags, {
    cell_name      = var.cell_name
    region         = var.region
    tier           = var.tier
    data_residency = var.region
    managed_by     = "terraform"
  })
}

# KMS key — one per cell, not shared across regions
resource "aws_kms_key" "cell" {
  description             = "Simintero cell ${var.cell_name} encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = local.common_tags
}

resource "aws_kms_alias" "cell" {
  name          = "alias/simintero/${var.cell_name}"
  target_key_id = aws_kms_key.cell.key_id
}

# VPC
resource "aws_vpc" "cell" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = merge(local.common_tags, { Name = "${var.cell_name}-vpc" })
}

# Data residency: RDS storage encrypted with cell-scoped KMS key
resource "aws_rds_cluster" "cell" {
  cluster_identifier          = "${var.cell_name}-aurora"
  engine                      = "aurora-postgresql"
  engine_version              = "15.4"
  database_name               = "simintero"
  master_username             = "simadmin"
  manage_master_user_password = true
  storage_encrypted           = true
  kms_key_id                  = aws_kms_key.cell.arn
  tags                        = local.common_tags

  lifecycle {
    ignore_changes = [master_username]
  }
}

resource "aws_rds_cluster_instance" "cell" {
  identifier         = "${var.cell_name}-aurora-0"
  cluster_identifier = aws_rds_cluster.cell.id
  instance_class     = var.rds_instance
  engine             = aws_rds_cluster.cell.engine
  engine_version     = aws_rds_cluster.cell.engine_version
  tags               = local.common_tags
}

# EKS cluster
resource "aws_eks_cluster" "cell" {
  name     = var.cell_name
  role_arn = aws_iam_role.eks_cluster.arn

  vpc_config {
    subnet_ids = []
  }

  tags = local.common_tags

  depends_on = [aws_iam_role_policy_attachment.eks_cluster_policy]
}

resource "aws_iam_role" "eks_cluster" {
  name = "${var.cell_name}-eks-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster.name
}

resource "aws_eks_node_group" "cell" {
  cluster_name    = aws_eks_cluster.cell.name
  node_group_name = "${var.cell_name}-workers"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = []

  instance_types = [var.eks_node_type]

  scaling_config {
    desired_size = var.eks_min_nodes
    min_size     = var.eks_min_nodes
    max_size     = var.eks_max_nodes
  }

  tags = local.common_tags

  depends_on = [
    aws_iam_role_policy_attachment.eks_node_policy,
    aws_iam_role_policy_attachment.eks_cni_policy,
    aws_iam_role_policy_attachment.eks_ecr_policy,
  ]
}

resource "aws_iam_role" "eks_nodes" {
  name = "${var.cell_name}-eks-node-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "eks_node_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "eks_ecr_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.eks_nodes.name
}
