# Implementation Plan

- [x] 1. Memory 核心类型与 frontmatter / name 工具
  - [x] 1.1 实现 `types.ts`：MemoryEntry、MemoryStore 端口、错误码与结果判别联合
  - [x] 1.2 实现 `name.ts`：规范化与校验
  - [x] 1.3 实现 `frontmatter.ts`：最小 YAML frontmatter 编解码 + 单元测试
  - _Requirements: 1.1, 1.2, 1.3, 4.5_

- [x] 2. 可见性与 ops
  - [x] 2.1 实现 `ops.ts`：可见性过滤、tags 全包含、关键词子串匹配
  - _Requirements: 3.1–3.4, 4.3, 4.4_

- [x] 3. FileMemoryStore
  - [x] 3.1 实现目录布局 `global/` + `by-source/<id>/` 的 put/get/delete/list/search
  - [x] 3.2 契约测试对临时目录全绿
  - _Requirements: 1.2, 2.1, 2.4, 3.x, 4.x, 6.1, 6.2_

- [x] 4. SupabaseMemoryStore
  - [x] 4.1 实现 PostgREST fetch 客户端（select/upsert/delete）
  - [x] 4.2 mock fetch 契约测试
  - _Requirements: 2.2, 2.3, 2.4, 6.3_

- [x] 5. 配置工厂
  - [x] 5.1 `memoryConfigFromEnv` + `createMemoryStore`；未知 kind / 缺凭据装配失败
  - _Requirements: 2.1–2.3, 6.4_

- [x] 6. Extension 与工具
  - [x] 6.1 `tools/register.ts` 注册五工具 + 结构化结果
  - [x] 6.2 `memoryExtension` + runtime 导出
  - [x] 6.3 extension 单测（注册名 + write/read）
  - _Requirements: 5.1–5.3_

- [x] 7. 示例 agent
  - [x] 7.1 `examples/memory-agent`（index + package.json + README）
  - [x] 7.2 在 `examples/README.md` 登记一行
  - _Requirements: 5.4_

- [x] 8. 验收
  - [x] 8.1 `pnpm --filter @blksails/pi-web-tool-kit test` 相关用例通过
  - [x] 8.2 typecheck 通过
  - [x] 8.3 e2e：真实 runner + `examples/memory-agent` + file 后端，memory_write→memory_read 正文往返 + 磁盘 skills-like 落盘
  - _Requirements: 6.x_
