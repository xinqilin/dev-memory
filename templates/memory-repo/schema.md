# Memory repo 規則

這份檔案是 LLM 維護這個 repo 時的規則書。改這裡就等於改 AI 的行為，不需要改 plugin 的程式碼。

## 這個 repo 有什麼

| 路徑 | 是什麼 | 誰寫 |
|---|---|---|
| `records/<product>/<yyyy-mm>/<author>.jsonl` | 開發紀錄，一行一筆，**只新增不修改** | 每個人用 plugin 提交 |
| `wiki/index.md` | 總目錄，人跟 AI 都從這裡進去 | LLM 維護 |
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
- 檔名就是 slug。

### 連結

- **正文裡用一般 markdown 相對連結**：`[匯出報表](../features/export-report.md)`。GitHub 上點得動。
- **`related:` 欄位用 `[[slug]]`**：給 AI 跟 Obsidian 用。GitHub 不會把它變成連結，所以不要只靠它。
- 每頁至少要被 `wiki/index.md` 連到一次，否則沒有人找得到。

---

# 寫頁面的規則

下面是 ingest 時 LLM 要遵守的規則。這裡取代了原本放在自動化流程裡的 prompt。

## 寫給誰看

**半年後的隊友，他不記得這件事，也沒參與當時的討論。** 他會問的是「為什麼當初這樣決定」「我改這裡會影響誰」，不是「這段程式做了什麼」——後者看程式碼就好。

所以：**程式碼講得清楚的事不要寫進來**，會過期又沒人更新。要寫的是程式碼看不出來的東西：為什麼、試過什麼失敗了、哪個選項被否決、有什麼限制。

## 一頁只講一件事

一個決定、一個功能、一張表、一個 runbook。混在一起的頁面，搜尋會找不到、更新時不知道該改哪段。

## decision 頁的骨架

```markdown
## 原因
是什麼逼出這個決定：壞掉的行為、太慢的數字、擋住的限制。寫具體的。

## 決定
現在起會怎麼做。點出檔案、資料表、欄位、旗標的名字。

## 放棄的方案
考慮過但沒採用的，以及為什麼。**這一段最容易被省略，卻最值錢**——它擋掉半年後有人重走同一條死路。
```

`feature` 頁改成：這個功能橫跨哪些 repo、資料怎麼流動、邊界條件。
`entity` 頁改成：誰寫、誰讀、欄位的意義、改動要注意什麼。
`runbook` 頁改成：什麼情況會用到、步驟、怎麼確認成功、失敗了怎麼辦。

## 每一句都要有來源

- `sources[]` 列出支撐這頁的紀錄 id。
- **紀錄裡沒有的東西不要寫**。寧可一頁短，也不要摻進推測。真的需要補背景才看得懂，就標明「推測」或「待確認」。
- 引用程式碼位置時填 `code_refs`，不要貼大段程式碼進來——那會馬上過期。

## 語言與用字

- **用當初討論的語言寫**（中文討論就寫中文），程式碼識別字、錯誤訊息、指令保留原文。
- 直接講結論，不要「本文件旨在說明」這種開場白。
- 數字要具體：「2,596 筆」「Recall@5 從 0% 變 40%」，不要「大幅改善」。

## 決策被推翻的時候

1. 舊頁的 `status` 改成 `superseded`，`superseded_by` 填新頁的 slug。
2. 新頁的 `related` 指回舊頁，並在「原因」裡一句話說明為什麼推翻。
3. **不要刪舊頁**。刪掉的話，後面的人只會看到結論，不知道曾經試過別的路。

## 絕對不要寫進去

- 密碼、token、金鑰、連線字串（CI 會擋，但第一道關是寫的人）
- 客戶資料、個資、身分證字號、電話
- 大段貼上的公司程式碼
- 對同事的評價

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
