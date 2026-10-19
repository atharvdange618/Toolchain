#!/usr/bin/env bash
# Packs the CLI, scaffolds real projects from the tarball, and checks that
# each one passes its own lint, typecheck, format, build, and commit hooks.
# Catches what unit tests can't: a plugin's new major breaking the
# generated config, or a package manager changing its install rules.
#
# Usage: scripts/smoke.sh [template:pm ...]   (default: every case below)
set -uo pipefail

CASES=("$@")
if [ ${#CASES[@]} -eq 0 ]; then
  CASES=(plain:npm plain:pnpm express:npm react:npm nextjs:npm pnpm-monorepo:pnpm turbo:pnpm)
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
echo "Working in $WORK"

cd "$REPO" && pnpm run build >/dev/null || { echo "build failed"; exit 1; }
mkdir -p "$WORK/pack" "$WORK/tool"
npm pack --silent --pack-destination "$WORK/pack" >/dev/null || { echo "npm pack failed"; exit 1; }

# Installed into a plain folder and run with node, not npx: npx exports its
# own npm_config_* to child processes, which breaks the nested
# create-vite / create-next-app calls in ways real users never see.
cd "$WORK/tool" && echo '{"name":"smoke-tool","private":true}' > package.json
npm install --silent "../pack/$(ls "$WORK/pack")" || { echo "tarball install failed"; exit 1; }
CLI="$WORK/tool/node_modules/@atharvdange/toolchain/bin/index.js"

run_case() {
  local template=${1%%:*} pm=${1##*:}
  local dir="$WORK/$template-$pm" result="" failed=0
  mkdir -p "$dir/logs" && cd "$dir"

  node "$CLI" scaffold app --template "$template" --pm "$pm" --yes > logs/scaffold.log 2>&1
  [ $? -eq 0 ] && result="scaffold:ok" || { result="scaffold:FAIL"; failed=1; }

  if cd app 2>/dev/null; then
    git config user.email smoke@example.com && git config user.name smoke
    for script in lint typecheck format:check build; do
      if "$pm" run "$script" > "../logs/$script.log" 2>&1; then result="$result $script:ok"
      else result="$result $script:FAIL"; failed=1; fi
    done
    # Good message first: if it passes, pre-commit works, so a rejected bad
    # message can only be commitlint's doing. The grep confirms that.
    if git commit -q --allow-empty -m "chore: smoke test" > ../logs/commit-good.log 2>&1; then
      result="$result commit-good:ok"
    else result="$result commit-good:FAIL"; failed=1; fi
    if ! git commit -q --allow-empty -m "bad message" > ../logs/commit-bad.log 2>&1 \
      && grep -q "type-empty" ../logs/commit-bad.log; then
      result="$result commit-bad-rejected:ok"
    else result="$result commit-bad-rejected:FAIL"; failed=1; fi
  fi

  echo "$failed $1 $result" > "$dir/result"
}

for c in "${CASES[@]}"; do run_case "$c" & done
wait

status=0
echo ""
for c in "${CASES[@]}"; do
  read -r failed name rest < "$WORK/${c%%:*}-${c##*:}/result"
  echo "$name: $rest"
  [ "$failed" = "0" ] && continue
  status=1
  for log in "$WORK/${c%%:*}-${c##*:}"/logs/*.log; do
    step=$(basename "$log" .log)
    [[ " $rest " == *" $step:FAIL "* || ( "$step" == commit-bad && " $rest " == *"commit-bad-rejected:FAIL"* ) ]] || continue
    echo "----- $name $step (last 40 lines) -----"
    tail -n 40 "$log"
  done
done

echo ""
[ $status -eq 0 ] && echo "All smoke cases passed." || echo "Smoke test failed. Full logs in $WORK"
exit $status
