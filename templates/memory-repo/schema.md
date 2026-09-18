# Memory repo 規則

這份檔案是 LLM 維護這個 repo 時的規則書。改這裡就等於改 AI 的行為，不需要改 plugin 的程式碼。

> **待補**：n8n workflow 裡原本的 prompt（category／slug 規則）要合併進「頁面種類」與「命名」兩節。

## 這個 repo 有什麼

| 路徑 | 是什麼 | 誰寫 |
|---|---|---|
| `records/<product>/<yyyy-mm>/<author>.jsonl` | 開發紀錄，一行一筆，**只新增不修改** | 每個人用 plugin 提交 |
| `wiki/index.md` | 總目錄，AI 查東西的入口 | LLM 維護 |
| `wiki/log.md` | 變更紀錄，一次 ingest 一段 | LLM 維護 |
| `wiki/<product>/` | 整理過的頁面 | LLM 維護 |
| `repos.yaml` | 產品跟 code repo 的對應 | 人維護 |
| 其他既有目錄 | 原本就有的文件，**不要動** | 人維護 |

## 紀錄（records）

一行一個 JSON，欄位如下：

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✔ | ULID，由 plugin 產生 |
| `author` | ✔ | git 的 user.name |
| `host` | ✔ | `claude-code` 或 `codex` |
| `type` | ✔ | `decision` / `feature` / `runbook` / `note` |
| `title` | ✔ | 一句話，可搜尋 |
| `body` | ✔ | 原因、決定、放棄的方案 |
| `content_hash` | ✔ | `sha256:...`，同樣內容不重複提交 |
| `created_at` | ✔ | ISO 8601 |
| `product` | | 對應 `repos.yaml` 裡的產品 |
| `repos` | | `["owner/repo"]` |
| `branch` `entities` `files` `commits` `supersedes` | | 有就填 |

**不可以**修改或刪除既有的行。決策變了就寫一筆新的，並在新紀錄的 `supersedes` 填舊的 `id`。

## 頁面（wiki）

每頁開頭是 YAML frontmatter：

```yaml
---
type: decision            # feature / decision / entity / repo / runbook / overview
title: ErpDataRecordType 未知 type 改為不中斷
product: billing
status: active            # active / superseded
superseded_by: null
sources: [01JB...]        # 這頁的內容來自哪幾筆紀錄
code_refs:
  - repo: 104corp/104mis-billing-batch-aws
    paths: [src/main/java/.../ErpDataRecordType.java]
related: ["[[sap-create-bu-data]]"]
updated: 2026-09-04
---
```

### 頁面種類

| 種類 | 路徑 | 一頁講什麼 |
|---|---|---|
| `overview` | `wiki/<product>/overview.md` | 這個產品在做什麼 |
| `feature` | `wiki/<product>/features/<slug>.md` | 一個功能橫跨哪些 repo、怎麼運作 |
| `decision` | `wiki/<product>/decisions/<slug>.md` | 一個決定：原因、決定、放棄的方案 |
| `entity` | `wiki/<product>/entities/{tables,apis,queues,external}/<name>.md` | 誰寫、誰讀這張表／這個 API |
| `repo` | `wiki/<product>/repos/<repo>.md` | 這個 repo 負責什麼 |
| `runbook` | `wiki/<product>/runbooks/<slug>.md` | 怎麼操作、怎麼救 |

### 命名

- slug 用小寫英數字加連字號，對應 branch 或功能名稱，例如 `sap-create-bu-data`。
- 檔名就是 slug，頁面之間用 `[[slug]]` 互相連結。

## 寫頁面的規則

1. **每一句都要有來源**。`sources[]` 列出支撐這頁的紀錄 id；沒有紀錄支撐的推測不要寫進去。
2. **保留原因跟放棄的方案**。只寫結論的頁面，半年後沒有人敢動它。
3. **用當初討論的語言寫**（中文就中文），程式碼識別字保留原文。
4. **決策被推翻時不要刪頁**：把舊頁的 `status` 改成 `superseded`、`superseded_by` 指向新頁，新頁的 `related` 指回舊頁。
5. **不要寫進 secret、憑證、個資**。CI 會擋，但第一道關是寫的人。
6. **既有的人工文件不要改格式**，只在 `wiki/index.md` 連過去。

## ingest 的兩個步驟

1. **分析**：讀新的紀錄，列出要新增哪些頁、更新哪些頁、哪個舊決策被取代、有沒有互相矛盾。只能從這幾種動作裡選，並且要作者確認。
2. **產生**：照分析結果寫頁面，更新 `wiki/index.md` 跟 `wiki/log.md`，然後交給作者在本機審核頁確認。

`wiki/log.md` 的格式固定成一行標題加重點，方便用 grep 找：

```markdown
## [2026-09-18] ingest | 匯出報表改成單筆失敗不中斷
- 新增 wiki/billing/decisions/export-partial-failure.md
- 更新 wiki/billing/features/export-report.md
- 取代 wiki/billing/decisions/export-rollback.md（status: superseded）
```

## CI 會檢查什麼

- `records/` 的每一行是合法 JSON、必填欄位齊全、路徑符合規則、`id` 不重複。
- `wiki/` 的 frontmatter 欄位齊全、`type`／`status` 是合法值、`sources[]` 指得到真實紀錄、`[[連結]]` 指得到真實頁面。
- 整個 repo 掃一次 gitleaks。

lint 只掃 `wiki/` 跟 `records/`，既有的人工文件不受影響。
