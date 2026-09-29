#!/usr/bin/env bash
# One-time installer: makes `git up` run the smart deploy script on the server.
# Run on the VPS:  bash scripts/install-deploy-alias.sh
set -euo pipefail
cd "$(dirname "$0")/.."

LINE='alias git_up_deploy="bash '$PWD'/scripts/deploy.sh"'

# `git up` is not a valid git subcommand by default, so users typically have a
# shell function/alias. Install a bash function that shadows `git up <args>`:
BLOCK_START="# >>> narrative-health smart deploy >>>"
BLOCK_END="# <<< narrative-health smart deploy <<<"

for RC in "$HOME/.bashrc" "$HOME/.bash_aliases"; do
  [[ -f $RC ]] || continue
  if grep -q "$BLOCK_START" "$RC" 2>/dev/null; then
    echo "already installed in $RC — nothing to do"
  else
    cat >> "$RC" <<EOF

$BLOCK_START
# Smart deploy: 'git up' pulls + deps + migrations + build + pm2 restart,
# skipping every step that did not change. Direct git usage unaffected.
git() {
  if [[ "\$1" == "up" ]]; then
    shift
    bash "$(pwd)/scripts/deploy.sh" "\$@"
  else
    command git "\$@"
  fi
}
$BLOCK_END
EOF
    echo "installed in $RC — run:  source $RC"
  fi
done

echo
echo "From now on, on this server:"
echo "  git up          → smart deploy (5-step, idempotent)"
echo "  git status/pull → normal git, unchanged"
