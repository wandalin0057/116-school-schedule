#!/bin/sh
# 網站啟動：套用資料庫 migration → 啟動 Next.js（初始化資料於背景同時執行）
# 初始化資料（期限規則、範本、日曆、既有案件資料調整）在免費主機上可能需要數分鐘，
# 若等它完成才啟動網站，Render 會因偵測不到開啟的連接埠而判定部署逾時，因此改為背景執行。
# 初始化失敗（例如初始管理員密碼不符規則）不會阻止網站啟動，登入頁會顯示提示。
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "套用資料庫 migration…"
  if ! npx prisma migrate deploy; then
    echo "✗ 資料庫 migration 失敗：請確認 DATABASE_URL 是否正確（Neon 連線字串、需含 sslmode=require）"
    exit 1
  fi
fi
if [ "${RUN_SEED:-true}" = "true" ]; then
  # 冪等：建立期限規則、預設範本、115 年辦公日曆；設定 INITIAL_ADMIN_* 時建立初始管理員
  (npx tsx prisma/seed.ts && echo "✓ 初始化資料完成" || echo "! 初始化資料未完全成功（見上方訊息），網站仍可使用") &
fi
echo "啟動網站…"
# 部分雲端平台會以容器名稱覆寫 HOSTNAME，這裡固定監聽所有網路介面
export HOSTNAME=0.0.0.0
exec node .next/standalone/server.js
