# project-plugin

`dev-memory`：同時給 Claude Code 跟 Codex CLI 用的團隊開發記憶 plugin，搭配由 LLM 維護的 wiki。這個 repo 本身也是 plugin 的 marketplace。

## 開始工作前

1. 先讀 `docs/HANDOFF.md`：目前進度、做過的決策、被否決的方案、下一步。
2. 需要細節時再讀 `docs/PLAN.md`：完整架構、兩個工具的相容性、資料格式、Phase 0–5 的步驟跟驗證方式。

## 規則

- 回覆一律用繁體中文（台灣用語），程式碼識別字保留原文。
- 依照 `docs/PLAN.md` 的 Phase 進行。每個 Phase 做完先停下來，給 diff 摘要，確認後才進下一個。
- 不要執行 `git push`，push 跟開 PR 由使用者自己做。
- Skill 內容不能寫死任何單一工具專屬的 tool 名稱，因為要同時支援 Claude Code 跟 Codex。
- 使用者資料一律放在 `~/.dev-memory/`，不要用 `CLAUDE_PLUGIN_DATA` 或 `PLUGIN_DATA`。
- 決策有變動時，同步更新 `docs/PLAN.md` 跟 `docs/HANDOFF.md`。
