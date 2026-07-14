#!/usr/bin/env bash
# check-docs-sync.sh — CI validation for documentation co-changes
#
# This script checks that documentation stays in sync with code changes:
# 1. Migration files changed → data-dictionary.md should also be updated
# 2. Route handlers or UI components changed → user-manual.md should also be updated
# 3. Route handlers changed → openapi.yaml should also be updated
# 4. OpenAPI spec is syntactically valid
#
# Exit code is always 0 (non-blocking warnings only).
# Designed to run in GitHub Actions where GITHUB_BASE_REF is set,
# or locally where it compares against the main branch.

set -euo pipefail

# Determine the base ref for diff comparison
if [ -n "${GITHUB_BASE_REF:-}" ]; then
  # In a pull request context
  BASE_REF="origin/${GITHUB_BASE_REF}"
elif [ -n "${GITHUB_EVENT_NAME:-}" ] && [ "${GITHUB_EVENT_NAME}" = "push" ]; then
  # Push event — compare with the previous commit
  BASE_REF="HEAD~1"
else
  # Local usage — compare against main
  BASE_REF="origin/main"
fi

echo "=== Documentation Co-change Validation ==="
echo "Comparing against: ${BASE_REF}"
echo ""

# Get list of changed files
CHANGED_FILES=$(git diff --name-only "${BASE_REF}" HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")

if [ -z "${CHANGED_FILES}" ]; then
  echo "No changed files detected. Skipping checks."
  exit 0
fi

WARNINGS=0

# -------------------------------------------------------------------
# Check 1: Migration files changed without Data Dictionary update
# -------------------------------------------------------------------
echo "--- Check 1: Migration ↔ Data Dictionary sync ---"

MIGRATION_CHANGES=$(echo "${CHANGED_FILES}" | grep -E '^migrations/' || true)
DATA_DICT_CHANGED=$(echo "${CHANGED_FILES}" | grep -c 'docs/data-dictionary.md' || true)

if [ -n "${MIGRATION_CHANGES}" ] && [ "${DATA_DICT_CHANGED}" -eq 0 ]; then
  echo "::warning::Migration files were modified without updating docs/data-dictionary.md"
  echo "  ⚠️  WARNING: The following migration files were changed:"
  echo "${MIGRATION_CHANGES}" | sed 's/^/    - /'
  echo "  Please update docs/data-dictionary.md to reflect schema changes."
  echo ""
  WARNINGS=$((WARNINGS + 1))
else
  if [ -n "${MIGRATION_CHANGES}" ]; then
    echo "  ✓ Migration files changed and data-dictionary.md was updated."
  else
    echo "  ✓ No migration files changed."
  fi
fi
echo ""

# -------------------------------------------------------------------
# Check 2: Route handlers or UI components changed without User Manual update
# -------------------------------------------------------------------
echo "--- Check 2: Route/UI ↔ User Manual sync ---"

ROUTE_CHANGES=$(echo "${CHANGED_FILES}" | grep -E '^src/server/routes/|^src/client/components/|^src/client/admin/' || true)
USER_MANUAL_CHANGED=$(echo "${CHANGED_FILES}" | grep -c 'docs/user-manual.md' || true)

if [ -n "${ROUTE_CHANGES}" ] && [ "${USER_MANUAL_CHANGED}" -eq 0 ]; then
  echo "::warning::Route handlers or UI components were modified without updating docs/user-manual.md"
  echo "  ⚠️  WARNING: The following route/UI files were changed:"
  echo "${ROUTE_CHANGES}" | sed 's/^/    - /'
  echo "  Please update docs/user-manual.md to reflect user-facing changes."
  echo ""
  WARNINGS=$((WARNINGS + 1))
else
  if [ -n "${ROUTE_CHANGES}" ]; then
    echo "  ✓ Route/UI files changed and user-manual.md was updated."
  else
    echo "  ✓ No route handler or UI component files changed."
  fi
fi
echo ""

# -------------------------------------------------------------------
# Check 3: Route handlers changed without OpenAPI spec update
# -------------------------------------------------------------------
echo "--- Check 3: Route handlers ↔ OpenAPI spec sync ---"

ROUTE_HANDLER_CHANGES=$(echo "${CHANGED_FILES}" | grep -E '^src/server/routes/' || true)
OPENAPI_CHANGED=$(echo "${CHANGED_FILES}" | grep -c 'docs/openapi.yaml' || true)

if [ -n "${ROUTE_HANDLER_CHANGES}" ] && [ "${OPENAPI_CHANGED}" -eq 0 ]; then
  echo "::warning::Route handlers were modified without updating docs/openapi.yaml"
  echo "  ⚠️  WARNING: The following route handler files were changed:"
  echo "${ROUTE_HANDLER_CHANGES}" | sed 's/^/    - /'
  echo "  Please update docs/openapi.yaml to reflect API changes."
  echo ""
  WARNINGS=$((WARNINGS + 1))
else
  if [ -n "${ROUTE_HANDLER_CHANGES}" ]; then
    echo "  ✓ Route handlers changed and openapi.yaml was updated."
  else
    echo "  ✓ No route handler files changed."
  fi
fi
echo ""

# -------------------------------------------------------------------
# Check 4: Validate OpenAPI spec syntax
# -------------------------------------------------------------------
echo "--- Check 4: OpenAPI spec validation ---"

OPENAPI_FILE="docs/openapi.yaml"

if [ ! -f "${OPENAPI_FILE}" ]; then
  echo "::warning::OpenAPI spec file not found at ${OPENAPI_FILE}"
  echo "  ⚠️  WARNING: ${OPENAPI_FILE} does not exist."
  WARNINGS=$((WARNINGS + 1))
else
  # Validate with @redocly/cli, skipping opinionated lint rules.
  # We only care about structural/syntactic validity here.
  LINT_OUTPUT=$(npx --yes @redocly/cli lint "${OPENAPI_FILE}" \
    --skip-rule no-unused-components \
    --skip-rule no-empty-servers \
    --skip-rule security-defined \
    2>&1) || true

  # Check if there are actual errors (not just warnings)
  if echo "${LINT_OUTPUT}" | grep -q "error"; then
    echo "::warning::OpenAPI spec validation found issues — check docs/openapi.yaml"
    echo "  ⚠️  WARNING: OpenAPI spec has validation issues:"
    echo "${LINT_OUTPUT}" | grep -E "error|Error" | head -10 | sed 's/^/    /'
    WARNINGS=$((WARNINGS + 1))
  else
    echo "  ✓ OpenAPI spec is syntactically valid."
  fi
fi
echo ""

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
echo "=== Summary ==="
if [ "${WARNINGS}" -gt 0 ]; then
  echo "  ${WARNINGS} warning(s) found. These are non-blocking but should be addressed."
else
  echo "  All documentation co-change checks passed. ✓"
fi

# Always exit 0 — these are non-blocking warnings
exit 0
