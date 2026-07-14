#!/usr/bin/env bash
# Simple smoke test for check-docs-sync.sh
# Verifies the script exits 0 (non-blocking) in all scenarios.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/check-docs-sync.sh"

echo "=== Testing check-docs-sync.sh ==="

# Test 1: Script is executable
echo -n "Test 1: Script is executable... "
if [ -x "${SCRIPT}" ]; then
  echo "PASS"
else
  echo "FAIL — script is not executable"
  exit 1
fi

# Test 2: Script passes bash syntax check
echo -n "Test 2: Bash syntax check... "
if bash -n "${SCRIPT}" 2>/dev/null; then
  echo "PASS"
else
  echo "FAIL — syntax errors found"
  exit 1
fi

# Test 3: Script always exits 0 (even without git)
echo -n "Test 3: Non-blocking exit code... "
# Run in a temp dir without git
TMPDIR=$(mktemp -d)
cd "${TMPDIR}"
OUTPUT=$(bash "${SCRIPT}" 2>&1) || EXIT_CODE=$?
EXIT_CODE=${EXIT_CODE:-0}
cd - >/dev/null
rm -rf "${TMPDIR}"

if [ "${EXIT_CODE}" -eq 0 ]; then
  echo "PASS"
else
  echo "FAIL — script exited with code ${EXIT_CODE}"
  exit 1
fi

echo ""
echo "All tests passed. ✓"
