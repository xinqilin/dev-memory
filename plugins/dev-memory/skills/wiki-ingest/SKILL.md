---
name: wiki-ingest
description: Write a technical document about one subject — a batch job, a data flow, a subsystem — by reading the actual code, and open it for review in the team doc repo. Use when the user wants documentation written, updated, or prepared as a PR. Never pushes.
---

# 寫一份技術文件

**產出是給人讀的規格文件**，不是決策摘要。一支批次、一條資料流、一個子系統各一頁，
照執行順序講成一個故事，附真實 payload 與情境對照表。

**第一來源是程式碼。** 對話紀錄只用來補「為什麼這樣設計」與「Known Issue」。

**你不 push，也不開 PR。** 送出是作者在審核頁按的按鈕。不要呼叫 `/api/publish`、不要跑
`dev-memory publish`、不要跑 `git push`。

Let `CLI` mean `bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts"`.

## 0. 確定主題

主題是**一個東西**，不是「最近的幾個決定」。例如：

- 一支批次：`sap-create-bu-data`
- 一條資料流：測評點數從 BU 到 ERP
- 一個子系統：3DS 交易

主題不明確就問。範圍太大（「整個 billing」）就切小。

## 1. 讀程式碼 — 這一步不能跳過

`repos.yaml` 說這個產品有哪些 repo；本機位置在 `~/.dev-memory/config.toml` 的 `[repos]`。
找不到路徑就請作者補設定，**不要猜路徑，也不要憑記憶寫規格**。

```bash
CLI repos            # 列出 repo 與本機路徑，缺的會告訴你要補哪一行
```

**一律用 `git show <ref>:<path>` 與 `git ls-tree` 讀，絕對不要 `git checkout`。**
那是作者正在工作的 repo，切分支會毀掉他的進度。

```bash
git -C <repo> ls-tree -r --name-only <ref> <dir>
git -C <repo> show "<ref>:<path>"
```

有些 repo 是**一支批次一個分支**（`repos.yaml` 標 `branch_per_job: true`），
預設分支上找不到模組，要讀 `batch/<job-name>`。

至少要查清楚：

| 要查的 | 去哪找 |
|---|---|
| 端點、HTTP method、路徑前綴 | Controller 的 `@RequestMapping` / `@PostMapping` |
| **完整 request / response 欄位** | request / response DTO 類別 |
| 必填、格式、值域、上限 | DTO 上的 validation annotation |
| 狀態值與意義 | enum，連同實際的數字 |
| 排程 | `deploy/env-*.sh`、CDK、terraform 裡的 cron，**並換算成當地時間** |
| 資料表欄位 | entity 的 `@Column` |
| 流程分支與錯誤處理 | service / 批次主程式 |

同時搜記憶，補「為什麼」：

```bash
CLI search <主題相關的詞> --limit 20
```

**程式碼與紀錄衝突時以程式碼為準。** 紀錄常常記的是當初的提案而不是最後的實作。

## 2. 骨架 — **確認點 ①**

給作者看的是**大綱**，不是卡片清單。列出：

- 主題與一句話說明
- 讀了哪些 repo / 分支 / 檔案
- 分成哪幾節（照執行順序）
- 哪幾節會有 payload、mermaid 圖、情境對照表
- 發現的不一致（程式碼 vs 既有文件 vs 紀錄）

先查這個主題**是不是已經有頁**：

```bash
CLI search <主題> --kind page
```

動作只能從這四種選：**新增文件 / 更新既有文件 / 補一節 / 不動**。

等作者同意才往下。

## 3. 開工作區並寫

```bash
CLI ingest-start <slug>     # 印出分支與 worktree 路徑，作者的 clone 完全不動
```

先讀 worktree 裡的 `schema.md` —— **規則在那裡，不在這份 skill 裡**。
也看一眼既有文件的寫法，照它的慣例寫。

文件最後的「程式碼位置」表要列出**第 1 步讀過的每個檔**，照 `schema.md` 的格式。
`stale` 靠這張表判斷文件有沒有過時；漏列的檔之後改了，不會有人知道。

寫完把紀錄原料一起匯出：

```bash
CLI export --branch <branch>
```

**一定要更新 `README.md` 索引**，沒有被索引到的文件等於不存在。

## 4. 審核頁 — **確認點 ②**

```bash
CLI review --branch <branch>
```

印出網址並開瀏覽器。告訴作者接下來是他的事：左邊改、右邊看、跟 main 比對，
然後按「核准並 commit」，準備好再按「送出 PR」。送出後頁面會自己跳到 PR。

他要求改的時候你可以直接改檔案，頁面會自己重載。

## 5. PR 合併之後

```bash
CLI sync
```

把合併的內容匯進本機索引，搜尋才找得到。

合併時如果 `records/…/<作者>.jsonl` 衝突（同一個人同時開了兩個都有新卡片的 PR），
**一律兩邊都保留**。行的順序沒有意義；少留一邊，那幾張卡片就從團隊 repo 消失，而且沒有任何檢查會發現。

## 作者不要這次 ingest 了

只有作者明確說不要了才做：

```bash
CLI ingest-discard --branch <branch>
```

它先把這次匯出的卡片退回本機（下次 ingest 會再帶上），再刪工作區跟本機分支。
**不要自己刪工作區或分支**：那樣卡片會停在「已送出」，之後再也不會被匯出。
已經送出 PR 的分支它會拒絕——卡片在那個 PR 裡，要放棄就到 GitHub 關掉 PR。

## 常見錯誤

- **寫成流水帳**：「重構了 X」「開了兩支 API」——那是 git log 的工作，不是文件。
- **沒有 payload**：一份沒有完整 request/response 的 API 文件等於沒寫。
- **編造欄位**：讀的人會照著打然後失敗。查不到就寫「待確認」。
- **照紀錄寫規格**：紀錄是提案，程式碼是事實。
- **一個決定一頁**：決定是文件裡的一節（「設計考量」），不是一頁文件。
- **漏掉「重跑行為」**：出事時第一個被問的就是這個。
