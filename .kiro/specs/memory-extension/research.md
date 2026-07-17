# Research — memory-extension

## Decisions

1. **Skills-like 文件形态**（用户明确偏好）：本地每条记忆一个 `.md`，YAML frontmatter + body，对齐 `SKILL.md` 心智模型，便于人工编辑与 git。
2. **Ports & Adapters**：对齐 `session-store` / `attachment-backend-pluggable`；契约测试保证 file/supabase 一致。
3. **Supabase 用 fetch 而非 SDK**：避免 tool-kit 新增 `@supabase/supabase-js`；与 attachment S3 手写客户端策略一致。
4. **默认 global 跨 agent source**：用户选择；隔离为显式 `scope: agent-source`。
5. **检索不做向量**：精确 name + 关键词/tags；语义检索列为 non-goal。
6. **Opt-in extension**：不强制注入全部会话，与 aigc/vision 一样由 agent 声明 `extensions`。

## Alternatives rejected

- 纯 KV JSON 文件：用户要求 skills metadata 形态。
- 强制注入：增加所有 agent 工具噪声；记忆非框架基础设施。
- REST API：本轮 tools 足够；宿主 API 可后续。
