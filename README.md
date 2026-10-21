# 通學區案件期程暨發文管理系統

交通工程顧問公司用的通學區規劃案管理網站。以學校為單位管理案件，依臺灣行政機關辦公日曆自動推算期程，並管理工作待辦、公文草稿、Email 草稿與每日提醒。

- 技術：Next.js 15（App Router）、TypeScript、React 19、Tailwind CSS、shadcn/ui 風格元件（Radix）、Lucide、PostgreSQL、Prisma 6、Zod、date-fns 4（`@date-fns/tz`）、Resend／SMTP、Docker、Render
- 介面語言：繁體中文（臺灣），日期以民國紀年顯示，所有工作天計算使用 `Asia/Taipei`

> 使用者操作說明請見 [docs/使用者操作手冊.md](docs/使用者操作手冊.md)。
> **免費部署（Render 免費方案 + Neon + GitHub 排程寄信）的逐步教學請見 [docs/免費部署教學.md](docs/免費部署教學.md)。**

---

## 1. 功能總覽

| 模組 | 內容 |
| --- | --- |
| 登入與權限 | 管理員／一般使用者；bcrypt 密碼雜湊；資料庫工作階段（HttpOnly Cookie，權杖以 HMAC 雜湊儲存）；登入失敗 5 次鎖定 15 分鐘；停用帳號立即失效；所有頁面、Server Action、API 皆在伺服器端驗證權限 |
| 學校案件 | 案件編號不重複、可修改計畫名稱、日期可分次填寫；案件授權（可編輯／僅檢視） |
| 期程自動計算 | 獨立 `BusinessDayService`；12 項工作依期限規則自動建立；改期前顯示期限差異預覽 |
| 工作待辦 | 5 種狀態、人工鎖定期限（須填原因）、異動歷史、避免重複建立 |
| 儀表板 | 今日／明日／7 天內／逾期、待創稿／待發文／待寄 Email／待上傳簡報、本週會議與會勘、各校進度（即時查詢資料庫） |
| 公文草稿 | 3 種範本（含版本管理）、即時預覽、複製、DOCX／PDF 匯出、列印、標記已創稿／已發文、使用者輸入正式發文字號 |
| Email 草稿 | 3 種範本、複製、以郵件程式開啟；**系統不寄送業務信**，使用者確認寄出後才標記完成 |
| 每日提醒 | 獨立排程（臺灣時間 08:30 起），防重複寄送、失敗紀錄與安全重試、執行紀錄、測試模式 |
| 行事曆 | 月／週／清單、依類型著色、篩選、ICS 匯出 |
| 系統設定 | 使用者、通知、工作天、官方日曆匯入、期限重新計算、期限規則、範本、備份、操作紀錄 |

## 2. 專案結構

```
prisma/
  schema.prisma            資料庫結構（外鍵、唯一索引、日期索引、刪除限制）
  migrations/              Migration
  seed.ts                  初始化：期限規則、範本、115 年辦公日曆、初始管理員、示範資料
data/calendars/            官方辦公日曆資料（2026.json）與格式說明
scripts/
  run-daily-reminders.ts   每日提醒排程（Render Cron Job 執行）
  create-admin.ts          建立／重設管理員
  backup-json.ts           JSON 備份
  docker-entrypoint.sh     容器啟動（migrate → seed → server）
src/
  lib/                     日期（臺北時區、民國紀年）、加密、日誌遮蔽、登入工作階段
  server/                  業務邏輯（與介面分離，可獨立測試）
    business-days/         BusinessDayService、日曆匯入解析、日曆管理
    schedule/              期限規則、期程計算與差異比對、工作同步
    cases/ tasks/          案件與工作服務
    documents/             公文範本變數、排版、DOCX、PDF
    emails/                Email 草稿
    reminders/             寄信服務、提醒內容、每日排程
    templates/ users/ settings/ calendar/ dashboard/ backup/ audit/
  app/                     Next.js 頁面、Server Actions、API 路由
  components/              介面元件
tests/
  unit/                    純函式測試（工作天、期程、範本、提醒、ICS、加密）
  integration/             PostgreSQL 整合測試（期程同步、權限、提醒防重複、草稿）
```

## 3. 本機執行

需求：Node.js 22（≥ 20.11）、PostgreSQL 14 以上。

```bash
cp .env.example .env
# 編輯 .env：設定 DATABASE_URL、SESSION_SECRET、DATA_ENCRYPTION_KEY
#   openssl rand -base64 48   # SESSION_SECRET
#   openssl rand -base64 32   # DATA_ENCRYPTION_KEY

npm install
npx prisma migrate deploy        # 建立資料表
npm run db:seed                  # 期限規則、範本、115 年辦公日曆
npm run admin:create             # 建立第一位管理員（互動式）

npm run dev                      # http://localhost:3000
```

示範資料（僅限開發環境）：`SEED_DEMO=true npm run db:seed`，會建立 `admin@example.com`／`chen@example.com`／`lin@example.com`（密碼 `Demo12345678`）與 3 筆案件。

正式模式在本機試跑：

```bash
npm run build
npm start                        # node .next/standalone/server.js
```

### 使用 Docker Compose

```bash
docker compose up --build        # 網站 + PostgreSQL
docker compose run --rm cron     # 手動執行一次每日提醒排程
```

預設管理員為 `admin@example.com`／`ChangeMe12345`（見 `docker-compose.yml`，僅供本機測試）。

## 4. 測試

```bash
npm run typecheck
npm test                         # 全部測試（需 TEST_DATABASE_URL）
npm run test:unit                # 僅純函式測試，不需資料庫
npm run test:integration
```

整合測試會**清空** `TEST_DATABASE_URL` 指向的資料庫，請使用專用測試資料庫。未設定時整合測試自動略過。

需求規格第 14 節的 15 項測試對應如下：

| # | 測試 | 檔案 |
| --- | --- | --- |
| 1–8 | 週五會議後 1 工作天、週一發文前 1 工作天、官方休假日、補行上班日、通知後 12 工作天、會議前 2／後 1、3 工作天、會勘前 2／後 1、3 工作天 | `tests/unit/business-days.test.ts`、`tests/unit/schedule-calculator.test.ts` |
| 9 | 發文前 1 工作天建立創稿工作 | `tests/unit/schedule-calculator.test.ts` |
| 10 | 變更會議日期後期限正確更新 | `tests/integration/schedule-sync.test.ts`、`tests/unit/schedule-calculator.test.ts` |
| 11 | 已完成工作不會被重設為未完成 | 同上 |
| 12 | 提醒排程不重複寄信 | `tests/integration/reminders.test.ts` |
| 13 | 不同使用者不能存取未授權案件 | `tests/integration/permissions.test.ts` |
| 14 | 三種公文範本正確帶入資料 | `tests/unit/templates.test.ts` |
| 15 | Email 草稿未確認時不會自動寄出 | `tests/integration/drafts.test.ts` |

GitHub Actions（`.github/workflows/ci.yml`）會在每次 push 時以 PostgreSQL 服務執行型別檢查、全部測試與建置。

## 5. 工作天規則

- 事件當日為 D0，不計入；往後／往前逐日以曆法運算（非 24 小時毫秒數），遇工作天才計數。
- 排除週六、週日與官方公告之休假日；納入補行上班日。
- 管理員手動調整（例如颱風停班）優先於官方日曆，並記錄操作者、時間、原因。
- **不猜測未公告之假日**：某年度未匯入完整官方日曆時，該年度僅排除週末，期限標示「暫估」，儀表板、行事曆與工作天設定頁會顯示警示。
- 系統內建 115 年（2026）辦公日曆（`data/calendars/2026.json`，依人事行政總處 114.06.13 核定公告整理，全年放假 120 日、無補行上班日）。**上線前請管理員自[政府資料開放平臺](https://data.gov.tw/dataset/14718)下載官方 CSV 重新匯入核對。** 116 年以後之日曆請於公告後匯入。
- 匯入日曆或新增調整後，至「系統設定 → 期限重新計算」預覽差異並套用。

預設期限規則（管理員可於「期限規則管理」修改並預覽影響）：

| 工作 | 基準 | 期限 |
| --- | --- | --- |
| 事前規劃及分析報告書發文掛件 | 機關通知日 | 後第 12 工作天 |
| 事前規劃報告書公文創稿 | 上項發文日 | 前第 1 工作天 |
| 寄送審查簡報 | 審查會議 | 前第 2 工作天 |
| 審查會議 | 審查會議 | 當日 |
| Email 審查會議紀錄 | 審查會議 | 後第 1 工作天 |
| 審查後修正圖說創稿 | 審查會議 | 後第 2 工作天 |
| 審查後修正圖說正式發文 | 審查會議 | 後第 3 工作天 |
| 上傳會勘簡報 | 會勘 | 前第 2 工作天 |
| 現場會勘 | 會勘 | 當日 |
| Email 會勘紀錄 | 會勘 | 後第 1 工作天 |
| 會勘後修正圖說創稿 | 會勘 | 後第 2 工作天 |
| 會勘後修正圖說正式發文 | 會勘 | 後第 3 工作天 |

日期變更時的處理：先計算新期限 → 顯示差異 → 保留已完成工作 → 只更新未完成且未人工鎖定的期限 → 寫入異動歷史 → 每案每種工作只有一筆（`@@unique([caseId, taskType])`）。

## 6. 上傳到 GitHub

```bash
git init                                   # 若尚未初始化
git add .
git commit -m "初始版本"
git branch -M main
git remote add origin git@github.com:<組織>/<儲存庫>.git
git push -u origin main
```

`.env` 已列入 `.gitignore`，請勿提交任何密碼或 API 金鑰。

## 7. Render 部署

本專案附 `render.yaml`（Blueprint），會建立：

- `school-zone-web`：網站（Docker），健康檢查 `/api/health`
- `school-zone-daily-reminders`：Cron Job，`30 0 * * *`（UTC 00:30 = 臺灣 08:30），執行 `npm run cron:daily-reminders`，與網站是否有人使用無關
- `school-zone-db`：PostgreSQL 16

步驟：

1. 將程式推送到 GitHub。
2. Render 控制台 → **New → Blueprint** → 選擇儲存庫，Render 會讀取 `render.yaml`。
3. 填寫標示 `sync: false` 的環境變數：
   - `APP_URL`：網站對外網址（例如 `https://school-zone-web.onrender.com` 或自訂網域）
   - `EMAIL_FROM`、`RESEND_API_KEY`：Resend 已驗證網域之寄件者與 API 金鑰
   - `EMAIL_TEST_RECIPIENT`：測試收件人
   - `COMPANY_NAME`：公文抬頭公司名稱
   - `INITIAL_ADMIN_EMAIL`、`INITIAL_ADMIN_PASSWORD`：首次啟動時建立的管理員
4. 部署完成後，以初始管理員登入並**立即變更密碼**，再於 Render 移除 `INITIAL_ADMIN_PASSWORD`。
5. 「系統設定 → 通知設定」寄送測試信；確認提醒內容正確後，關閉測試模式（或將 `EMAIL_TEST_MODE` 設為 `false`）。
6. 「系統設定 → 工作天設定」匯入官方辦公日曆 CSV 核對。

注意：

- `SESSION_SECRET`、`DATA_ENCRYPTION_KEY`、`CRON_SECRET` 由 Render 自動產生。**`DATA_ENCRYPTION_KEY` 設定後不可更改**，否則已儲存之附件下載密碼無法解密。
- 容器啟動時會自動執行 `prisma migrate deploy` 與冪等的初始化（`RUN_MIGRATIONS`、`RUN_SEED` 可設為 `false` 停用）。
- Render 免費 PostgreSQL 30 天後到期，正式環境請使用付費方案（具每日備份）。
- Render 預設提供 HTTPS；自訂網域請於 Render 設定並更新 `APP_URL`。

### 其他排程方式

若不使用 Render Cron Job，可由任何排程服務呼叫：

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<網站>/api/cron/daily-reminders
```

重複呼叫不會重複寄信（同一使用者同一日以唯一索引防重複）。

## 8. 管理員初始化方式

任一方式皆可：

1. **環境變數**：設定 `INITIAL_ADMIN_EMAIL`、`INITIAL_ADMIN_PASSWORD`（、`INITIAL_ADMIN_NAME`），執行 `npm run db:seed` 或啟動 Docker 容器。帳號已存在時不會覆寫密碼。
2. **命令列**：`npm run admin:create`（互動式），或
   `ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... npm run admin:create`
3. **忘記管理員密碼**：`npm run admin:create -- --reset`（會將該帳號設為管理員、重設密碼並登出所有工作階段）。Render 可於 web 服務的 Shell 執行。

密碼規則：至少 10 碼，需含英文字母與數字。

## 9. 正式環境設定說明

| 項目 | 做法 |
| --- | --- |
| HTTPS | Render 自動提供；Cookie 於正式環境設為 `Secure`，並送出 HSTS 等安全標頭 |
| 資料庫 | Render PostgreSQL 付費方案（持久化、每日備份、PITR） |
| Email | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`，或 `smtp` + `SMTP_*`。金鑰只存在伺服器環境變數，前端只顯示「是否已設定」 |
| 背景排程 | Render Cron Job（見上） |
| 環境變數 | Render Environment Group `school-zone-shared`；啟動時以 Zod 驗證，設定錯誤會拒絕啟動 |
| 資料庫備份 | Render 自動備份；另可 `pg_dump --format=custom "$DATABASE_URL" > backup.dump`；管理員可於「資料備份」下載 JSON |
| 錯誤紀錄 | 結構化 JSON 日誌輸出至 stdout（Render Logs），自動遮蔽密碼、金鑰、下載密碼；寄信失敗記錄於提醒紀錄 |
| 健康檢查 | `GET /api/health`（檢查資料庫連線） |
| 敏感資料 | 密碼 bcrypt；工作階段權杖 HMAC；附件下載密碼 AES-256-GCM 加密，不以明文存入公文內文；操作紀錄遮蔽敏感欄位；備份不含密碼雜湊 |

## 10. 已知限制與未完成項目

- **官方日曆需人工匯入**：系統未自動抓取人事行政總處資料（避免依賴外部網站格式）。內建 115 年資料為依公告整理，上線前請以官方 CSV 匯入核對；116 年以後需於公告後匯入。
- **Docker 映像檔**在開發環境未實際建置（開發環境無 Docker daemon）；容器內執行的各步驟（migrate、seed、standalone server、中文字型 PDF）已分別驗證。首次部署請留意建置日誌。
- **PDF 字型**：Docker 映像檔使用文泉驛正黑（無襯線）；公文慣用之標楷體因授權未內建。DOCX 匯出指定「標楷體」，於 Windows／Office 開啟時會套用。可透過 `PDF_FONT_PATH` 指定其他字型。
- **DOCX／PDF 為草稿排版**，非公文系統格式（無檔號、條碼、電子簽章），不可作為正式公文。
- **Email 業務信不自動寄送**（依需求）：需使用者自行寄出並確認。
- **JSON 備份僅供匯出**，尚無匯入還原介面；完整還原請使用 `pg_restore`。
- 無忘記密碼自助流程（需由管理員重設），亦無多因素驗證。
- 行事曆 ICS 為下載檔，尚未提供可訂閱之 URL。
- 單一會議／會勘：每案件同時只有一個有效之審查會議與會勘日期（改期歷史會保留）；若需多次審查會議，需另建案件或擴充資料模型。
- 登入失敗鎖定以帳號計，尚無以 IP 為單位之速率限制；建議於 Render 前方加上 WAF／Cloudflare。
