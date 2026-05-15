#!/usr/bin/env bash
set -euo pipefail

TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-.}"

cd "$TARGET_DIR"

echo "==> Scaffolding toolchain into $(pwd)"

# ── 1. Copy config files ──────────────────────────────────────────
echo "==> Copying config files..."
cp "$TEMPLATE_DIR/.editorconfig" .
cp "$TEMPLATE_DIR/.prettierrc" .
cp "$TEMPLATE_DIR/.prettierignore" .
cp "$TEMPLATE_DIR/commitlint.config.js" .
cp "$TEMPLATE_DIR/eslint.config.mjs" .

if [ ! -f "tsconfig.json" ]; then
  cp "$TEMPLATE_DIR/tsconfig.json" tsconfig.json
  echo "  ✔ tsconfig.json created"
else
  echo "  ⚠ tsconfig.json exists - skipping (add project references manually)"
fi

mkdir -p .husky
cp "$TEMPLATE_DIR/.husky/pre-commit" .husky/pre-commit
cp "$TEMPLATE_DIR/.husky/commit-msg" .husky/commit-msg

# ── 2. Update package.json ───────────────────────────────────────
echo "==> Updating package.json..."
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

// Scripts
pkg.scripts = {
  ...pkg.scripts,
  lint: 'eslint .',
  'lint:fix': 'eslint . --fix',
  'lint:strict': 'eslint . --max-warnings 0',
  typecheck: 'tsc --noEmit',
  format: 'prettier --write .',
  'format:check': 'prettier --check .',
  prepare: 'husky',
};

// lint-staged
pkg['lint-staged'] = {
  '*.{ts,tsx}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,css}': ['prettier --write'],
};

// Dev dependencies
const deps = {
  '@commitlint/cli': '^21.0.1',
  '@commitlint/config-conventional': '^21.0.1',
  '@eslint/js': '^9.39.4',
  eslint: '^9.39.4',
  'eslint-plugin-react': '^7.37.5',
  'eslint-plugin-react-hooks': '^7.1.1',
  'eslint-plugin-perfectionist': '^5.9.0',
  'eslint-plugin-unicorn': '^64.0.0',
  husky: '^9.1.7',
  'lint-staged': '^17.0.4',
  prettier: '^3.8.3',
  'typescript-eslint': '^8.59.3',
};

// Add Next.js plugin if next is in dependencies
if (pkg.dependencies?.next) {
  deps['@next/eslint-plugin-next'] = '^16.2.6';
}

pkg.devDependencies = { ...pkg.devDependencies, ...deps };

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('  ✔ package.json updated');
"

# ── 3. Install dependencies ──────────────────────────────────────
echo "==> Installing dependencies..."
if [ -f "pnpm-lock.yaml" ]; then
  pnpm install
elif [ -f "yarn.lock" ]; then
  yarn install
else
  npm install
fi

# ── 4. Init Husky ─────────────────────────────────────────────────
echo "==> Setting up Husky..."
pnpm exec husky || npx husky || npx --yes husky

echo ""
echo "  ✔ Done! Toolchain is ready."
echo ""
echo "  Next steps:"
echo "  1. Add a root tsconfig.json (create one if missing)"
echo "  2. Run: pnpm run lint:fix   (to auto-fix existing code)"
echo "  3. Run: pnpm run typecheck  (to check types)"
echo "  4. Make a test commit to verify hooks work"
