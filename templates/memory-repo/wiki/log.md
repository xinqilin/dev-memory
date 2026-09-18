# 變更紀錄

一次 ingest 一段，格式固定成下面這樣，方便用 grep 找：

```markdown
## [YYYY-MM-DD] ingest | 一句話說明
- 新增 wiki/<product>/decisions/<slug>.md
- 更新 wiki/<product>/features/<slug>.md
- 取代 wiki/<product>/decisions/<old>.md（status: superseded）
```
