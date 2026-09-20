# 開發文件

由 [dev-memory](https://github.com/xinqilin/dev-memory) plugin 讀程式碼產生，經人工審核後以 PR 進來。

**這一頁是唯一索引。新增文件一定要在這裡加一行，否則沒有人找得到。**

## 規格文件

### 資料流

_還沒有。跨系統的資料流放 `spec/`。_

### 批次

_還沒有。一支批次一頁，放 `spec/batch/`。_

### 資料表

_還沒有。放 `spec/table/`。_

## 維運 SOP

_還沒有。放 `maintenance/`。_

## 設定

_還沒有。排程表之類的放 `config/`。_

## 團隊 Guidelines

_還沒有。約束程式碼 repo 的撰寫規範，放 `guidelines/`。_

---

## 這個 repo 怎麼運作

| 路徑 | 是什麼 |
|---|---|
| `spec/` `maintenance/` `guidelines/` `config/` | **文件。要讀的是這些。** |
| [`schema.md`](./schema.md) | 規則書。AI 寫文件時照這份做，改這裡等於改 AI 的行為 |
| `records/` | 開發紀錄原料（JSONL），只增不改。**給搜尋用，不是拿來讀的**——它是文件「設計考量」那一節的出處 |
| [`repos.yaml`](./repos.yaml) | 產品對應哪些 code repo |
| `tools/` `.github/` | CI 檢查：連結有效、索引完整、機密掃描 |

### 怎麼貢獻

不用手寫。裝好 plugin 之後在 Claude Code 或 Codex 裡說：

> 幫我寫一份 &lt;主題&gt; 的文件

它會讀程式碼、提一份大綱給你確認、寫成文件，然後開本機審核頁讓你逐字改，你按「送出 PR」才會上 GitHub。

第一次使用要先告訴它程式碼在哪：編輯 `~/.dev-memory/config.toml`

```toml
[repos]
"<owner>/<repo>" = "~/你 clone 的位置"
```

跑 `dev-memory setup` 會自動掃常見目錄並幫你填，找不到才需要手動補。

### 不要放進來的東西

金鑰、密碼、token、客戶個資、未修補的漏洞細節、大段程式碼。
