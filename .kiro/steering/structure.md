# 项目结构

## 组织哲学

**分层 + 可单独发布的包**:从内核(协议/后端引擎)到外围(组件/嵌入/整站)逐层依赖单向收敛。
依赖方向:`protocol ← 所有`;`server` 仅依赖 `protocol`;`react`/`ui` 与后端解耦。这条规则决定每个 spec 的边界。

## 目录模式

### 后端引擎(Node)
**位置**:`lib/pi/`(或 `@pi-web/server` 包)
**职责**:agent 源解析、bootstrap runner、RPC 通道、会话注册与翻译。
**示例**:`agent-source.ts`(目录|git + 模式检测)、`runner.ts`(jiti + `runRpcMode`)、`agent-loader.ts`、`pi-rpc-process.ts`(`PiRpcChannel` 的 local 实现)、`rpc-types.ts`、`session.ts`、`registry.ts`、`event-to-uimessage.ts`。

### API 路由(Node runtime)
**位置**:`app/api/sessions/...`
**职责**:REST + SSE,薄转发到引擎。
**示例**:`route.ts`(POST 建会话)、`[id]/stream/route.ts`(SSE)、`[id]/messages|steer|abort|model|thinking|ui-response/route.ts`。

### 前端(浏览器)
**位置**:`components/`、`hooks/`、`lib/transport/`
**职责**:headless hooks + transport(无样式)与 AI Elements 组件(有样式)分离。
**示例**:`lib/transport/pi-transport.ts`、`hooks/use-pi-session.ts`、`components/chat/chat-view.tsx`、`components/ai-elements/*`、`components/dialogs/extension-ui-dialog.tsx`。

### Agent 套件
**位置**:`packages/agent-kit/`
**职责**:`defineAgent()` 类型帮助,给用户写 `index.ts` 用(运行时不强制依赖)。

## 命名约定

- **文件**:kebab-case(`pi-rpc-process.ts`)
- **组件**:PascalCase(`<PiChat>`、`<PiToolPart>`)
- **公开包**:`@pi-web/{protocol,server,react,ui,embed,agent-kit}`

## 导入组织

```typescript
import { PiRpcChannel } from '@/lib/pi/pi-rpc-process'  // 绝对(@/ → 项目根)
import { translate } from './event-to-uimessage'        // 相对(同模块)
```

## 代码组织原则

- **传输/隔离/存储用接口隔开**:`PiRpcChannel`、`agentHostProvider`、`SessionStore`、`BlobStore`(附件对象存储,LocalFs→S3)是为未来(e2b/edge/device、对象存储)预留的接缝,按接口写、后端经配置切换。附件能力按 L0 存储 / L1 引用 / L2 投影(resolve) / L3 context 闸门分层,模块在 `@pi-web/server` 的 `attachment/`(存储)与 `attachment-bridge/`(tool 桥接)。
- **协议是稳定契约**:`@pi-web/protocol` 的类型/schema 改动需语义化版本;SSE 帧带 `protocolVersion`。
- **安全是可替换策略而非硬编码**:沙箱、信任(`trustPolicy`)、鉴权(`authResolver`)做成插件点。
- **spec 边界 = 包/层边界**:从内核到外围拆分,每层可独立测试 + e2e。

---
_文档化模式,而非文件树。遵循模式的新文件不应需要更新本文件。权威设计见 `PLAN.md`。_
