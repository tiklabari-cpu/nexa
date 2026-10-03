#!/bin/bash
# SessionStart hook — yalnız Claude Code cloud oturumlarında çalışır.
# Kurar: Node 24 (engines), pnpm (packageManager), Docker daemon, Postgres+Redis
# (docker-compose.yml), .env, workspace bağımlılıkları, migration'lar, Task Master CLI.
# İdempotent: her adım varsa atlanır.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

NODE_MAJOR=24
NODE_PREFIX=/opt/node24

# 1) Node 24 (container varsayılanı Node 22; package.json engines >=24)
if ! "$NODE_PREFIX/bin/node" -v 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  tmp=$(mktemp -d)
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  file=$(curl -sSfL "$base/SHASUMS256.txt" | awk '/linux-x64\.tar\.xz$/ {print $2}')
  sum=$(curl -sSfL "$base/SHASUMS256.txt" | awk '/linux-x64\.tar\.xz$/ {print $1}')
  curl -sSfL "$base/$file" -o "$tmp/$file"
  echo "$sum  $tmp/$file" | sha256sum -c -
  mkdir -p "$NODE_PREFIX"
  tar -xJf "$tmp/$file" -C "$NODE_PREFIX" --strip-components=1
  rm -rf "$tmp"
fi
export PATH="$NODE_PREFIX/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  grep -qs "$NODE_PREFIX/bin" "$CLAUDE_ENV_FILE" || echo "export PATH=\"$NODE_PREFIX/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

# 2) pnpm — package.json'daki packageManager sürümü
PNPM_VERSION=$(node -p "require('./package.json').packageManager.split('@')[1]")
if [ "$(pnpm -v 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
  npm install -g "pnpm@$PNPM_VERSION" --prefix "$NODE_PREFIX" >/dev/null
fi

# 3) Task Master CLI (MCP sunucusu `npx task-master-ai` ile açılır; önceden kurulu olunca hızlı)
if ! command -v task-master >/dev/null 2>&1; then
  npm install -g task-master-ai --prefix "$NODE_PREFIX" >/dev/null || echo "task-master-ai kurulamadı (devam)" >&2
fi

# 4) .env
[ -f .env ] || cp .env.example .env

# 5) Docker daemon + Postgres/Redis
if ! docker info >/dev/null 2>&1; then
  nohup dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
docker compose up -d db redis
for _ in $(seq 1 60); do
  db=$(docker compose ps --format json db 2>/dev/null | grep -c '"Health":"healthy"' || true)
  rd=$(docker compose ps --format json redis 2>/dev/null | grep -c '"Health":"healthy"' || true)
  if [ "$db" -ge 1 ] && [ "$rd" -ge 1 ]; then break; fi
  sleep 1
done

# 6) Bağımlılıklar (install, ci değil — container önbelleğinden yararlanır)
pnpm install --frozen-lockfile || pnpm install

# 7) Prisma client + workspace paketleri (types/ai-mock/contract dist'i testlerde kullanılır)
pnpm --filter @siyahtus/api db:generate
pnpm turbo run build --filter=@siyahtus/types --filter=@siyahtus/ai-mock --filter=@siyahtus/contract

# 8) Migration'lar (.env'i export ederek, Makefile ile aynı)
set -a
# shellcheck disable=SC1091
. ./.env
set +a
pnpm db:migrate

# 9) Playwright: repo'nun playwright-core'u container'daki Chromium'dan yeni bir revizyon bekliyor
# ve indirme proxy'de kapalı. Beklenen revizyon dizinini mevcut Chromium'a symlink'le (headless yeterli).
PW=/opt/pw-browsers
if [ -d "$PW" ]; then
  want_json=$(ls -d node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json 2>/dev/null | sort -V | tail -1)
  if [ -n "$want_json" ]; then
    want=$(node -p "require('./$want_json').browsers.find(b=>b.name==='chromium').revision")
    have=$(ls -d "$PW"/chromium-[0-9]* 2>/dev/null | grep -v "chromium-$want$" | sed 's/.*-//' | sort -n | tail -1)
    if [ -n "$have" ] && [ ! -e "$PW/chromium_headless_shell-$want/INSTALLATION_COMPLETE" ]; then
      mkdir -p "$PW/chromium-$want" "$PW/chromium_headless_shell-$want/chrome-headless-shell-linux64"
      ln -sfn "$PW/chromium-$have/chrome-linux" "$PW/chromium-$want/chrome-linux64"
      for f in "$PW/chromium_headless_shell-$have"/chrome-linux/*; do
        ln -sfn "$f" "$PW/chromium_headless_shell-$want/chrome-headless-shell-linux64/"
      done
      ln -sfn "$PW/chromium_headless_shell-$have/chrome-linux/headless_shell" \
        "$PW/chromium_headless_shell-$want/chrome-headless-shell-linux64/chrome-headless-shell"
      for d in "chromium-$want" "chromium_headless_shell-$want"; do
        touch "$PW/$d/INSTALLATION_COMPLETE" "$PW/$d/DEPENDENCIES_VALIDATED"
      done
    fi
  fi
fi
