#!/bin/sh
# Nightly database backup. Compressed, checksummed, retention-pruned.
# An untested backup is not a backup — see scripts/restore.sh.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/phantom}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/phantom-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "[backup] dumping ${POSTGRES_DB} → ${FILE}"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    --host=postgres \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --file="$FILE"

# Checksum written alongside so a silently truncated file is detectable before
# it is ever needed.
sha256sum "$FILE" > "${FILE}.sha256"

SIZE="$(wc -c < "$FILE")"
echo "[backup] wrote ${SIZE} bytes"

echo "[backup] pruning dumps older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'phantom-*.dump*' -type f -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] done"
