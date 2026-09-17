---
name: hello
description: Phase 0 smoke test for the dev-memory plugin. Use only when the user asks to test or say hello to dev-memory.
---

# dev-memory hello

This skill exists to verify that the plugin loads in both Claude Code and Codex CLI.

1. Reply with the line `DEV_MEMORY_SKILL_OK`.
2. Call the `hello` tool provided by the `dev-memory` MCP server with `name` set to the user's name if known, otherwise `world`, and show its text result verbatim.
3. If no `dev-memory` MCP server or `hello` tool is available, say `DEV_MEMORY_MCP_MISSING` instead of guessing.
