#!/usr/bin/env bash
#
# Verify the two Supabase connection strings before pasting them into Vercel or
# GitHub. Nothing here prints a password: the report covers structure only, so
# its output is safe to share when asking for help.
#
# Usage:
#   ./scripts/check-db-urls.sh          # prompts, input hidden
#   POSTGRES_PRISMA_URL=... POSTGRES_URL_NON_POOLING=... ./scripts/check-db-urls.sh
#
# Exits non-zero if either string fails to authenticate.

set -uo pipefail

POOLED="${POSTGRES_PRISMA_URL:-}"
DIRECT="${POSTGRES_URL_NON_POOLING:-}"

if [ -z "$POOLED" ]; then
  printf 'POSTGRES_PRISMA_URL      (port 6543): '
  read -rs POOLED
  echo
fi

if [ -z "$DIRECT" ]; then
  printf 'POSTGRES_URL_NON_POOLING (port 5432): '
  read -rs DIRECT
  echo
fi

if [ -z "$POOLED" ] || [ -z "$DIRECT" ]; then
  echo "Both connection strings are required." >&2
  exit 2
fi

echo
echo "================ structure ================"

POOLED="$POOLED" DIRECT="$DIRECT" python3 - <<'PY'
import os
import urllib.parse as u

EXPECTED_HOST = "aws-0-eu-west-3.pooler.supabase.com"
EXPECTED_USER = "postgres.dwfzxbxripkwqowvzzbt"

passwords = {}
problems = []

for label, var, port in (
    ("pooled  (app runtime)", "POOLED", 6543),
    ("direct  (migrations) ", "DIRECT", 5432),
):
    raw = os.environ[var]
    parsed = u.urlsplit(raw.strip())
    pw = parsed.password or ""
    passwords[label] = pw

    print(f"--- {label} ---")
    print(f"  scheme            : {parsed.scheme}")
    print(f"  username          : {parsed.username}")
    print(f"  host              : {parsed.hostname}")
    print(f"  port              : {parsed.port}")
    print(f"  database          : {parsed.path.lstrip('/')}")
    print(f"  query             : {parsed.query or '(none)'}")
    print(f"  password length   : {len(pw)}")
    print(f"  non-alphanumeric  : {sum(not c.isalnum() for c in pw)}")

    # Characters that change meaning inside a URL and must be percent-encoded.
    needs_encoding = sorted({c for c in pw if c in "@:/?#&%"})
    print(f"  needs encoding    : {needs_encoding or 'no'}")

    # Catches the classic mistake of storing the template verbatim.
    placeholder = any(c in pw for c in "<>[]{}") or "PASSWORD" in pw.upper()
    print(f"  looks like a placeholder : {placeholder}")

    if raw != raw.strip():
        problems.append(f"{label}: has leading or trailing whitespace")
    if parsed.scheme != "postgresql":
        problems.append(f"{label}: scheme is {parsed.scheme!r}, expected 'postgresql'")
    if parsed.hostname != EXPECTED_HOST:
        problems.append(f"{label}: host is {parsed.hostname!r}, expected {EXPECTED_HOST!r}")
    if parsed.port != port:
        problems.append(f"{label}: port is {parsed.port}, expected {port}")
    if parsed.username != EXPECTED_USER:
        problems.append(f"{label}: username is {parsed.username!r}, expected {EXPECTED_USER!r}")
    if placeholder:
        problems.append(f"{label}: password still looks like a placeholder")
    if needs_encoding:
        problems.append(f"{label}: password contains characters needing percent-encoding")

if len(set(passwords.values())) != 1:
    problems.append("the two URLs carry different passwords")
else:
    print("\npasswords match across both URLs : True")

if problems:
    print("\nproblems found:")
    for p in problems:
        print(f"  - {p}")
else:
    print("no structural problems found")
PY

echo
echo "================ authentication ================"

if ! command -v psql >/dev/null 2>&1; then
  cat <<'MSG'
psql not found, skipping the connection test. This is the check that actually
settles whether the credentials work, so it is worth installing:

  brew install libpq && brew link --force libpq

MSG
  exit 1
fi

# libpq rejects unknown query parameters, and `pgbouncer` / `connection_limit`
# are Prisma-only. Strip the query string so the pooled URL can be tested.
POOLED_PSQL="${POOLED%%\?*}"

status=0

for entry in "pooled  (6543):$POOLED_PSQL" "direct  (5432):$DIRECT"; do
  label="${entry%%:*}"
  url="${entry#*:}"
  if psql "$url" -Atc 'select current_user' >/dev/null 2>/tmp/spliit-psql-err; then
    echo "  $label  OK"
  else
    echo "  $label  FAILED"
    sed 's/^/      /' /tmp/spliit-psql-err
    status=1
  fi
  rm -f /tmp/spliit-psql-err
done

exit $status
