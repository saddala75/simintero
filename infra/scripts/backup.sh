#!/usr/bin/env bash
# infra/scripts/backup.sh
# Automated backup procedure for Postgres databases and MinIO object storage.
# Usage: BACKUP_S3_BUCKET=s3://mybackups ./infra/scripts/backup.sh

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/simintero_backups_${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

echo "Starting Postgres backup at ${TIMESTAMP}..."
PGPASSWORD="${POSTGRES_PASSWORD:-devpassword}" pg_dump \
  -h "${POSTGRES_HOST:-localhost}" \
  -p "${POSTGRES_PORT:-5432}" \
  -U "${POSTGRES_USER:-sim}" \
  -d simintero \
  --no-owner \
  > "${BACKUP_DIR}/simintero_${TIMESTAMP}.sql"

gzip "${BACKUP_DIR}/simintero_${TIMESTAMP}.sql"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "Uploading Postgres backup to ${BACKUP_S3_BUCKET}..."
  aws s3 cp "${BACKUP_DIR}/simintero_${TIMESTAMP}.sql.gz" \
    "${BACKUP_S3_BUCKET}/postgres/simintero_${TIMESTAMP}.sql.gz"

  echo "Backing up MinIO raw bundles..."
  if command -v mc &>/dev/null; then
    mc alias set local "${MINIO_ENDPOINT:-http://localhost:9000}" "${MINIO_ACCESS_KEY:-minioadmin}" "${MINIO_SECRET_KEY:-minioadmin}" --api S3v4 || true
    mc mirror local/enstellar-raw-bundles "${BACKUP_S3_BUCKET}/minio/enstellar-raw-bundles/${TIMESTAMP}/" || true
  fi
fi

rm -rf "${BACKUP_DIR}"
echo "Backup procedure completed successfully."
