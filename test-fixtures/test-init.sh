#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES=("plain-ts" "react-vite" "nextjs" "express-api" "pnpm-monorepo" "turborepo")

echo "Building and packing the toolchain..."
cd "$REPO_ROOT"
pnpm run build
TARBALL="$REPO_ROOT/$(npm pack --silent)"
echo "Packed: $(basename "$TARBALL")"

cleanup() {
  rm -f "$TARBALL"
}
trap cleanup EXIT

for fixture in "${FIXTURES[@]}"; do
  echo ""
  echo "========================================"
  echo "Testing: $fixture"
  echo "========================================"

  cd "$SCRIPT_DIR/$fixture"

  # Install the toolchain from tarball
  npm install "$TARBALL" --save-dev 2>&1 | tail -1

  # Run init with --yes to skip prompts
  npx toolchain init --yes 2>&1

  # Check what was generated
  echo ""
  echo "Generated files:"
  ls eslint.config.mjs tsconfig.json .prettierrc .editorconfig commitlint.config.js 2>/dev/null || true
  ls .husky/ 2>/dev/null || true

  # Check detected framework from the generated eslint config
  if grep -q "nextPlugin" eslint.config.mjs 2>/dev/null; then
    echo "Detected: Next.js"
  elif grep -q "reactPlugin" eslint.config.mjs 2>/dev/null; then
    echo "Detected: React"
  elif grep -q "no-unsafe-assignment" eslint.config.mjs 2>/dev/null; then
    echo "Detected: Express"
  else
    echo "Detected: Plain"
  fi

  # Check monorepo detection from eslint ignores
  if grep -q "'\\\\*\\\\*\\\\/packages\\\\/\\\\*\\\\*'" eslint.config.mjs 2>/dev/null || grep -q "packages" eslint.config.mjs 2>/dev/null; then
    echo "Monorepo: Yes"
  else
    echo "Monorepo: No"
  fi

  # Cleanup - remove generated and installed files
  rm -rf node_modules package-lock.json .husky eslint.config.mjs tsconfig.json .prettierrc .editorconfig commitlint.config.js .prettierignore
  npm uninstall @atharvdange/toolchain --save-dev 2>/dev/null || true

  cd "$SCRIPT_DIR"

  echo ""
  echo "✓ $fixture passed"
done

echo ""
echo "All tests passed!"
