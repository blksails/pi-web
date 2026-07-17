# memory-agent

pi-web 示例：长期记忆扩展（kiro feature `memory-extension`）。

## 能力

| 工具 | 作用 |
|------|------|
| `memory_write` | 创建/更新记忆（skills-like：name + 正文） |
| `memory_read` | 按 name 读取 |
| `memory_list` | 列举元数据（tags/scope 过滤） |
| `memory_search` | 关键词搜索 |
| `memory_delete` | 删除 |

## 后端

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `PI_WEB_MEMORY_BACKEND` | `file` | `file` 或 `supabase` |
| `PI_WEB_MEMORY_DIR` | `~/.pi/agent/memory` | 文件根目录 |
| `PI_WEB_MEMORY_SUPABASE_URL` | — | Supabase project URL |
| `PI_WEB_MEMORY_SUPABASE_KEY` | — | 具备表权限的 key |
| `PI_WEB_MEMORY_SUPABASE_TABLE` | `pi_web_memories` | 表名 |
| `PI_WEB_MEMORY_AGENT_SOURCE_ID` | — | 默认 agent-source 标识 |

文件布局：

```
$PI_WEB_MEMORY_DIR/
  global/<name>.md
  by-source/<agentSourceId>/<name>.md
```

每条记忆是 YAML frontmatter + Markdown 正文，类似 `SKILL.md`。

### Supabase 建表

```sql
create table if not exists pi_web_memories (
  name text not null,
  description text,
  content text not null default '',
  tags text[] not null default '{}',
  scope text not null check (scope in ('global', 'agent-source')),
  agent_source_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (name, scope, agent_source_id)
);
```

`agent_source_id` 在 global 作用域固定为 `''`。

## 运行

```bash
# 本地文件后端
pnpm dev
# 选择 source: examples/memory-agent

# 云上 Supabase
export PI_WEB_MEMORY_BACKEND=supabase
export PI_WEB_MEMORY_SUPABASE_URL=https://xxxx.supabase.co
export PI_WEB_MEMORY_SUPABASE_KEY=...
pnpm dev
```

## 测试

```bash
pnpm --filter @blksails/pi-web-tool-kit test -- test/memory
```
