#!/usr/bin/env bash
# fs-optimize.sh -- reclaim disk space on a 32G devcontainer overlay.
#
#   ./fs-optimize.sh           (default) dry run: print every action, change nothing
#   ./fs-optimize.sh --run     execute the actions
#
# Only touches regenerable caches / old build artifacts. User project
# files under /workspaces are NEVER modified. Run as the codespace user.

set -uo pipefail

DRY=1
case "${1:-}" in
  --run) DRY=0 ;;
  --help|-h) sed -n '1,8p' "$0"; exit 0 ;;
  "") ;;
  *) echo "usage: $0 [--run]"; exit 2 ;;
esac
CACHE="${HOME}/.cache"
NPM="${HOME}/.npm"

say()  { printf '\n== %s\n' "$*"; }
doit() {
  if [ "$DRY" = "1" ]; then
    printf '[dry-run] %s\n' "$*"
  else
    printf '[run]     %s\n' "$*"
    bash -c "$*" || true
  fi
}

df_snapshot() {
  df -h / | awk 'NR==2 {printf "  /  %s used, %s free (%s)\n", $3, $4, $5}'
}

now="$(date +%Y%m%d-%H%M%S)"
echo "== Before =="
df_snapshot

# ---------------------------------------------------------------- apt/deb
say "1/6  Apt lists + package archives (root)"
doit "sudo apt-get clean"
doit "sudo rm -rf /var/lib/apt/lists/*"
doit "sudo rm -rf /var/cache/apt/archives/*.deb"

# ---------------------------------------------------------------- npm
say "2/6  npm cache ($(du -sh "$NPM" 2>/dev/null | cut -f1))"
doit "rm -rf '$NPM/_cacache' '$NPM/_npx' '$NPM/_logs'"

# ---------------------------------------------------------------- pip
say "3/6  pip download cache ($(du -sh "$CACHE/pip" 2>/dev/null | cut -f1))"
doit "pip cache purge 2>/dev/null || rm -rf '$CACHE/pip'"

# ---------------------------------------------------------------- conda
say "4/6  conda package tarball cache"
doit "/opt/conda/bin/conda clean --all -y"

# ---------------------------------------------------------------- playwright
say "5/6  Playwright browsers ($(du -sh "$CACHE/ms-playwright" 2>/dev/null | cut -f1))"
# Keep the newest build of each browser family, drop stale ones (e.g. chromium-1223/1228).
# NOTE: the dev screenshot harness (dev/test, `npm run install:browsers`) re-downloads as needed.
if [ -d "$CACHE/ms-playwright" ]; then
  for family in chromium chromium_headless_shell firefox; do
    for d in "$CACHE/ms-playwright/$family-"*; do
      [ -e "$d" ] || continue
      newest=$(ls -d "$CACHE/ms-playwright/$family-"* 2>/dev/null \
        | sed "s/.*$family-//" | sort -n | tail -1)
      [ "${d##*-}" = "$newest" ] && continue
      doit "rm -rf '$d'"
    done
  done
fi

# ---------------------------------------------------------------- misc caches
say "6/6  misc build caches (typescript, hugo, gh, uv/pipx wheels)"
doit "rm -rf '$CACHE/typescript' '$CACHE/hugo_cache' '$CACHE/gh' '$CACHE/kilo' 2>/dev/null"
doit "rm -rf ${TMPDIR:-/tmp}/node-compile-cache"

echo
echo "== After =="
df_snapshot

if [ "$DRY" = "1" ]; then
  echo
  echo "Dry run only. Re-run with  --run  to actually free space."
  echo "Reserve the names though: this script is brand new -- inspect 'say' blocks before applying."
fi

# ----------------------------------------------------------------------
# NOT included (intentional) -- comment out to opt in aggressively:
#
#   # CPU-only box: drop CUDA toolkits from system python  (~3.9G)
#   run "sudo rm -rf /usr/local/python/3.12.1/lib/python3.12/site-packages/{nvidia,triton,torch}"
#   # alt python interpreter
#   run "sudo rm -rf /usr/local/python/3.11.9"
#   # oversized agent-state DBs (opencode/kilo snapshots) -- only if you accept losing history
#   run "rm -rf '$HOME/.local/share/kilo/snapshot'"
#   run "rm -rf '$HOME/.opencode'"