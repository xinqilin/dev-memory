# dev-memory

`dev-memory`：同時給 Claude Code 跟 Codex CLI 用的開發記憶 plugin，中文對話也搜得到。可以單人用，也可以搭配團隊的文件庫。這個 repo 本身也是 plugin 的 marketplace。

## 開始工作前

維護者的工作筆記（進度、決策、被否決的方案）放在 `docs/internal/`，只存在維護者的電腦上，不在這個 repo 裡。
有的話先讀 `docs/internal/HANDOFF.md`，需要細節再讀 `docs/internal/PLAN.md`；沒有就略過。

## 規則

- 回覆一律用繁體中文（台灣用語），程式碼識別字保留原文。
- 不要執行 `git push`，push 跟開 PR 由維護者自己做。
- Skill 內容不能寫死任何單一工具專屬的 tool 名稱，因為要同時支援 Claude Code 跟 Codex。
- 使用者資料一律放在 `~/.dev-memory/`，不要用 `CLAUDE_PLUGIN_DATA` 或 `PLUGIN_DATA`。
- **這是公開的 repo**：不要 commit 任何公司、客戶或個人的資訊。範例一律用虛構的（`acme`、`billing`、發票），
  內部的東西寫在 `docs/internal/`。
- 決策有變動時，同步更新 README（兩種語言）跟 `docs/internal/` 的筆記。
