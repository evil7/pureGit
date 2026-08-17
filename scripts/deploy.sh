#!/usr/bin/env bash
# PureGit one-click deploy script (Cloudflare Workers)
#
# Usage:
#   ./scripts/deploy.sh             one-click: detect -> login -> create KV -> deploy
#   ./scripts/deploy.sh --update    git pull to latest, then re-deploy
#
# What it does (all steps are idempotent, safe to re-run):
#   1. (--update) git pull --ff-only
#   2. detect node / pnpm / wrangler (local node_modules/.bin first, then global)
#   3. pnpm install (only when node_modules is missing)
#   4. wrangler whoami -> if not logged in, wrangler login
#   5. generate worker/wrangler.jsonc from example when missing
#   6. create KV namespace SESSIONS + backfill its id into wrangler.jsonc (only when id is a placeholder)
#   7. wrangler secret put GITHUB_CLIENT_SECRET (only when not yet configured)
#   8. pnpm --filter web build && wrangler deploy
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$REPO_ROOT/worker"
CONFIG="$WORKER_DIR/wrangler.jsonc"

say()  { printf '\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!   %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31mx   %s\033[0m\n' "$*"; exit 1; }

# 0. --update: pull latest
if [[ "${1:-}" == "--update" ]]; then
  say "git pull to latest ..."
  git -C "$REPO_ROOT" pull --ff-only || err "git pull failed"
fi

# 1. detect node
command -v node >/dev/null 2>&1 || err "Node.js not found (>=20 required)"
say "node: $(node --version)"

# 2. detect pnpm (project locks pnpm workspace)
command -v pnpm >/dev/null 2>&1 || err "pnpm not found; install from https://pnpm.io"

# 3. install deps when missing
if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  say "pnpm install ..."
  (cd "$REPO_ROOT" && pnpm install)
fi

# 4. detect wrangler (local node_modules/.bin first, then global)
if [[ -x "$REPO_ROOT/node_modules/.bin/wrangler" ]]; then
  WRANGLER="$REPO_ROOT/node_modules/.bin/wrangler"
elif command -v wrangler >/dev/null 2>&1; then
  WRANGLER="$(command -v wrangler)"
else
  err "wrangler not found; run 'pnpm install' or 'npm i -g wrangler'"
fi
say "wrangler: $WRANGLER"
# run wrangler inside worker dir so it picks up wrangler.jsonc
run_wrangler() { (cd "$WORKER_DIR" && "$WRANGLER" "$@"); }

# 5. login check
if ! run_wrangler whoami >/dev/null 2>&1; then
  warn "Not logged in to Cloudflare; launching browser login ..."
  run_wrangler login || err "wrangler login failed"
fi

# 6. generate wrangler.jsonc from example when missing
if [[ ! -f "$CONFIG" ]]; then
  cp "$WORKER_DIR/wrangler.jsonc.example" "$CONFIG"
  say "Generated worker/wrangler.jsonc from example"
  warn "Edit worker/wrangler.jsonc to fill GITHUB_CLIENT_ID / domain, then re-run"
fi

# 7. create KV namespace + backfill id (only when id is still a placeholder like "id": "<...")
if grep -qE '"id"[[:space:]]*:[[:space:]]*"<' "$CONFIG"; then
  say "Creating KV namespace SESSIONS ..."
  KV_OUT="$(run_wrangler kv namespace create SESSIONS 2>&1 || true)"
  KV_ID="$(printf '%s\n' "$KV_OUT" | grep -oE '[0-9a-f]{32}' | head -1 || true)"
  if [[ -z "$KV_ID" ]]; then
    echo "$KV_OUT" >&2
    err "Failed to parse KV namespace id from wrangler output above"
  fi
  say "KV namespace id: $KV_ID"
  # backfill the id into wrangler.jsonc (replace any "id": "<...>" placeholder)
  node -e '
    const fs = require("fs");
    const p = process.argv[1], id = process.argv[2];
    let c = fs.readFileSync(p, "utf8");
    c = c.replace(/"id"\s*:\s*"<[^"]*>"/, `"id": "${id}"`);
    fs.writeFileSync(p, c);
  ' "$CONFIG" "$KV_ID"
  say "Backfilled kv_namespaces id into wrangler.jsonc"
fi

# 8. secret: GITHUB_CLIENT_SECRET (only when not yet configured)
if ! run_wrangler secret list 2>/dev/null | grep -q "GITHUB_CLIENT_SECRET"; then
  warn "GITHUB_CLIENT_SECRET not configured; entering interactive (hidden) input ..."
  run_wrangler secret put GITHUB_CLIENT_SECRET || err "secret put failed"
fi

# 9. build frontend + deploy worker
say "Building frontend (pnpm --filter web build) ..."
(cd "$REPO_ROOT" && pnpm --filter web build)
say "Deploying Worker (wrangler deploy) ..."
run_wrangler deploy

say "Deploy completed."
