#!/bin/sh
# Restore from a dump produced by backup.sh.
#
#   ./scripts/restore.sh backups/phantom-20260801-030000.dump
#
# Verifies the checksum first, then restores into a fresh database. Run this on
# a staging copy at least once a quarter — a restore procedure nobody has
# executed is a hope, not a plan.
set -eu

FILE="${1:-}"
if [ -z "$FILE" ]; then
    echo "usage: $0 <dump-file>" >&2
    exit 1
fi
if [ ! -f "$FILE" ]; then
    echo "error: $FILE not found" >&2
    exit 1
fi

if [ -f "${FILE}.sha256" ]; then
    echo "[restore] verifying checksum"
    sha256sum -c "${FILE}.sha256"
else
    echo "[restore] WARNING: no checksum file alongside the dump"
fi

printf '[restore] This overwrites %s. Type the database name to confirm: ' "$POSTGRES_DB"
read -r CONFIRM
if [ "$CONFIRM" != "$POSTGRES_DB" ]; then
    echo "[restore] aborted"
    exit 1
fi

echo "[restore] restoring"
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
    --host=postgres \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --clean \
    --if-exists \
    --no-owner \
    --exit-on-error \
    "$FILE"

echo "[restore] complete — run 'npm run prisma:migrate' in apps/api to apply any newer migrations"
