#!/usr/bin/env bash
# Production deploy — run on the server after git pull (or via GitHub Actions SSH).
set -euo pipefail

APP_DIR="${APP_DIR:-/home/pceaserver/SmartPOS}"
BRANCH="${DEPLOY_BRANCH:-master}"

echo "==> SmartPOS deploy (${BRANCH}) in ${APP_DIR}"
cd "$APP_DIR"

# Keep server secrets out of git
if [[ -f backend/.env ]]; then
  cp backend/.env /tmp/smartpos-backend.env.bak
else
  echo "ERROR: backend/.env missing. Create it on the server before deploying."
  exit 1
fi

if [[ -f frontend/.env ]]; then
  cp frontend/.env /tmp/smartpos-frontend.env.bak
fi

echo "==> Fetch latest from GitHub"
git fetch origin
git reset --hard "origin/${BRANCH}"

cp /tmp/smartpos-backend.env.bak backend/.env
if [[ -f /tmp/smartpos-frontend.env.bak ]]; then
  cp /tmp/smartpos-frontend.env.bak frontend/.env
fi

echo "==> Backend: install + Prisma"
cd backend
npm ci 2>/dev/null || npm install
npx prisma generate
npx prisma db push --skip-generate

echo "==> Frontend: install + build"
cd ../frontend
npm ci 2>/dev/null || npm install
npm run build

echo "==> Restart backend (PM2)"
cd "$APP_DIR"
if pm2 describe smartpos-backend >/dev/null 2>&1; then
  pm2 restart smartpos-backend
else
  pm2 start bash --name smartpos-backend --cwd "${APP_DIR}/backend" -- \
    -c "npx ts-node -r tsconfig-paths/register index.ts"
  pm2 save
fi

echo "==> Deploy complete"
pm2 status smartpos-backend
echo "Site: https://betterfork.millenium.co.ke"
