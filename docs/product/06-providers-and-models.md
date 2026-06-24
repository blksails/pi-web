# 06 · Provider 与模型接入

本章说明 pi-web 如何发现可用模型、如何接入内置 provider 与自定义 OpenAI-compatible 网关，以及设置页下拉列表的数据来源与过滤机制。

---

## 1. 模型来源：两类 provider

| 类型 | 凭证存放 | 典型 provider |
|---|---|---|
| **内置 provider** | `~/.pi/agent/auth.json`（由 `pi` 登录写入） | anthropic、openai、google 等 |
| **自定义 provider** | `~/.pi/agent/models.json`（手动编写） | NewAPI 网关、本地推理服务、DashScope 等 |

两类 provider 均由 pi SDK 的 `ModelRegistry` 统一管理。`ModelRegistry.getAvailable()` 只返回**有凭证**的模型——内置 provider 凭证来自 `auth.json`，自定义 provider 凭证内嵌在 `models.json` 的 `apiKey` 字段。

相关入口：`packages/server/src/config/model-options.ts:listModelOptions`

```ts
const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
const models = registry.getAvailable();
```

---

## 2. 内置 provider 接入（`auth.json`）

登录一次，凭证即持久化，无需额外配置：

```bash
pi          # 按提示完成 OAuth / API key 设置
```

登录后 `~/.pi/agent/auth.json` 由 pi SDK 维护；pi-web 在运行时读取，不需要再设置 env 变量。

若要在不同机器或容器里免交互注入凭证，也可通过 env 变量透传（相关变量见 [05-configuration.md](./05-configuration.md)）：

```bash
ANTHROPIC_API_KEY=sk-ant-...  pnpm dev
OPENAI_API_KEY=sk-...         pnpm dev
```

env 变量与 `auth.json` 叠加生效，优先级以 pi SDK 内部逻辑为准。

---

## 3. 自定义 OpenAI-compatible 网关（`models.json`）

自定义 provider **必须**写在 `~/.pi/agent/models.json`，不能写在 `auth.json`。

> agent 配置目录默认为 `~/.pi/agent`，可经 env `PI_CODING_AGENT_DIR` 覆盖（见 `lib/app/config.ts:resolveAgentDir`）；覆盖后 `models.json` 须放到对应目录下。

### 3.1 最小配置

```json
{
  "providers": {
    "my-gateway": {
      "name": "My Gateway",
      "baseUrl": "https://example.com/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [
        {
          "id": "some-model",
          "name": "Some Model",
          "input": ["text"],
          "contextWindow": 131072,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

必填字段：

| 字段 | 说明 |
|---|---|
| `baseUrl` | OpenAI-compatible 端点前缀（到 `/v1`，不含 `/chat/completions`） |
| `apiKey` | 网关鉴权 token |
| `api` | 接入协议标识；OpenAI-compatible 的 chat completions 网关填 `"openai-completions"`（可在 provider 级或单条 model 级指定） |
| `models` | 至少一条模型描述；`id` 为调用时使用的模型名 |

可选字段（`cost`、`contextWindow`、`maxTokens`）建议填写，供 pi SDK 成本估算使用；不填时 SDK 会使用 0 或默认值。

### 3.2 多 provider 示例

```json
{
  "providers": {
    "newapi": {
      "name": "NewAPI 网关",
      "baseUrl": "https://newapi.example.com/v1",
      "apiKey": "sk-newapi-...",
      "api": "openai-completions",
      "models": [
        {
          "id": "gpt-4o",
          "name": "GPT-4o (via NewAPI)",
          "input": ["text", "image"],
          "contextWindow": 128000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "local-llm": {
      "name": "本地 Ollama",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "api": "openai-completions",
      "models": [
        {
          "id": "llama3.2",
          "name": "Llama 3.2",
          "input": ["text"],
          "contextWindow": 32768,
          "maxTokens": 4096,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

### 3.3 校验配置是否生效

```bash
pi --list-models
```

输出包含 `my-gateway` 下的模型即为配置成功。该命令与 pi-web 读取的是同一份 `ModelRegistry` 数据，是最直接的校验手段。

> **没看到自定义模型？** 多半是配置写错位置或必填字段缺失——排查清单见 [18-troubleshooting-faq.md · 2.1 自定义 provider 鉴权 401](./18-troubleshooting-faq.md#21-自定义-provider-鉴权-401)。

---

## 4. 设置页模型下拉：数据来源与过滤

### 4.1 端点

设置页的 provider/model 可搜索下拉由前端调用以下端点驱动：

```
GET /api/config/models
```

响应格式：

```json
{
  "providers": ["anthropic", "openai", "my-gateway"],
  "models": [
    { "provider": "anthropic", "id": "claude-opus-4-5", "name": "Claude Opus 4.5" },
    { "provider": "my-gateway", "id": "some-model", "name": "Some Model" }
  ]
}
```

服务端在 `packages/server/src/config/config-routes.ts` 挂载该路由（路径 `/config/models` 必须排在 `/config/:domain` 之前以避免被当成未知域）。

数据取自 `listModelOptions(agentDir)`（`packages/server/src/config/model-options.ts`），即进程内调用 `ModelRegistry.getAvailable()`——**只有已配置凭证的模型才出现在下拉中**。

### 4.2 隐藏指定 provider

通过 env 变量 `PI_WEB_HIDE_PROVIDERS` 可从下拉中剔除不想暴露的 provider：

```bash
PI_WEB_HIDE_PROVIDERS=anthropic,openai  pnpm dev
```

过滤逻辑在 `packages/server/src/config/model-options-filter.ts:excludeProviders`，精确匹配 provider 名（大小写敏感），同时从 `providers` 名单和 `models` 列表中剔除。`PI_WEB_HIDE_PROVIDERS` 为空时不过滤（零拷贝快路径）。

会话内 `get_available_models` RPC 也应用同一过滤（`excludeProviderModels`），保证下拉与运行时可选集一致。

---

## 5. 真实案例与常见坑

### 5.1 NewAPI 网关

NewAPI 是典型的 OpenAI-compatible 聚合网关，`api` 字段固定填 `"openai-completions"`，`baseUrl` 填到 `/v1` 前缀即可（网关内部再路由到各上游）：

```json
{
  "providers": {
    "newapi": {
      "name": "NewAPI",
      "baseUrl": "https://your-newapi-host/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [ ... ]
    }
  }
}
```

### 5.2 DashScope 的 key 与端点绑定坑

DashScope（阿里云百炼）的图像生成 **key 与服务端点强绑定**：拿错端点对应的 key 会直接 401。这一坑由 AIGC 图像工具的实测踩出，端点常量见 `packages/tool-kit/src/aigc/tools/image-generation.ts:29`。

- 图像 API 走原生 DashScope 协议（`input`/`parameters` 结构），**不是** OpenAI-compatible 的 `/images` 端点。
- 同步图像端点路径为 `/api/v1/services/aigc/multimodal-generation/generation`（base 默认指向 token plan 域 `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1`，经 env `DASHSCOPE_TOKENPLAN_BASE_URL` 可配）。
- 错误现象：图像生成请求返回 **401**，错误信息可能包含"渠道不存在"或空 model 名。

原因：token plan key（`DASHSCOPE_API_KEY`）对官方域 `dashscope.aliyuncs.com` 无效，必须打 token plan 末端；反之，官方控制台的 MAAS token 打 token plan 端点同样会 401。

**解决方案**：

1. 确认 key 与端点配对：token plan key 配 token plan base，官方 key 配官方域，不能混用。
2. 自定义 provider（或 AIGC 工具的 env）的 base/end-point 必须与所用 key 对应的服务端点匹配。
3. 文本对话与图像生成建议分两个 provider 条目，分别配置对应 key。

> 端点与 key 的完整说明见 [11-aigc-tools.md](./11-aigc-tools.md)；401 现象的排查步骤见 [18-troubleshooting-faq.md · 2.1 自定义 provider 鉴权 401](./18-troubleshooting-faq.md#21-自定义-provider-鉴权-401)。

---

## 6. 完整接入步骤

1. **确认 pi 已登录**（内置 provider）：
   ```bash
   pi --list-models   # 能看到 anthropic/openai 等内置模型即可
   ```

2. **编写 `~/.pi/agent/models.json`**（自定义 provider，参见第 3 节示例）。

3. **校验模型出现在列表中**：
   ```bash
   pi --list-models   # 自定义 provider 的模型应出现
   ```

4. **启动 pi-web**（开发模式）：
   ```bash
   pnpm dev           # next dev — http://localhost:3000
   ```

5. **在设置页确认下拉**：打开 Settings → 模型下拉 → 可搜索到自定义 provider 下的模型。

6. **（可选）隐藏不想暴露的 provider**：
   ```bash
   PI_WEB_HIDE_PROVIDERS=anthropic  pnpm dev
   ```

> 任一步出错（401、模型不出现、下拉为空），优先对照 [18-troubleshooting-faq.md · 2. Provider / 模型问题](./18-troubleshooting-faq.md#2-provider--模型问题)。

---

## 相关链接

- [05-configuration.md](./05-configuration.md) — 完整 env 变量表，含 `PI_WEB_DEFAULT_PROVIDER` / `PI_WEB_DEFAULT_MODEL`
- [12-config-ui.md](./12-config-ui.md) — 设置页 provider/model 可搜索下拉的前端实现
- [11-aigc-tools.md](./11-aigc-tools.md) — AIGC 图像工具，DashScope 端点与 key 的详细说明
- [13-http-api-reference.md](./13-http-api-reference.md) — `GET /api/config/models` 端点完整 API 说明
- [18-troubleshooting-faq.md](./18-troubleshooting-faq.md) — Provider 鉴权 401、模型不出现等常见故障排查
