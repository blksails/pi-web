# Requirements Document

## Project Description (Input)

### 谁有问题

**在终端里启动 pi-web 并立刻开跑一轮对话的用户**（尤其 AIGC / 带参考图改图场景）：已有 agent 目录、本地图片与模型偏好，希望一条命令进入**已带首条消息与附件的会话**，而不是空会话再手工操作。

### 现状

`pi-web` 默认形态是：

```text
pi-web [source] [--open] …
```

- 位置参数是 agent source，不是提示词
- 无 `--model` / `--provider` / 附件 CLI 面
- `PI_WEB_AUTOSTART=1` 只跳过选源页并建**空**会话
- 附件只能在浏览器里上传

结果是「终端起服务 + UI 里再配任务」两段操作，无法脚本化/复现「同一提示词 + 同一组图」。

### 应该改变什么

增加 **`pi-web run <prompt>`** 子命令：用提示词启动实例，自动创建会话、上传附件、发送首条消息；`--open` 进入该会话页。

## Boundary Context

- **In scope**：`run` 子命令命令面；argv 解析（prompt、source、model、provider、attachments/`@`、open 等）；运行时 env 映射；服务就绪后的 HTTP 编排（create → setModel? → upload* → stream-before-message → messages）；打开浏览器到同一 `sessionId`；单元测试与帮助文案。

- **Out of scope**：
  - Tauri 桌面壳深链 / 从 CLI 拉起桌面二进制
  - headless「等 agent 回合结束再退出」
  - 完整 Playwright 浏览器 e2e（除非已极廉价）
  - 改动 `create`/`install`/`publish` 等包管理子命令
  - 无关桌面 pane occlusion 分支上的脏文件

- **Adjacent expectations**：
  - 复用既有 `POST /api/sessions`、`POST .../models`、`POST .../attachments`、`GET .../stream`、`POST .../messages` 与附件「先落库后 `attachmentIds`」契约
  - 保持默认 `pi-web [source]` 行为不变；`run` 为独立子命令，不抢占位置参数语义
  - 流式约定：先挂 stream 再 POST messages，避免首帧丢失

## Requirements

### Requirement 1: `run` 命令面与帮助

**Objective:** 作为终端用户，我想用明确的子命令与帮助文案启动「带提示词的任务」，以便与「只起服务」区分。

#### Acceptance Criteria

1. The pi-web CLI shall 提供 `run` 子命令，并在顶层 `pi-web --help` 的子命令列表中列出它及其一句话说明。
2. When 用户执行 `pi-web run --help`, the CLI shall 输出该子命令完整用法（含 prompt、source、model、provider、attachments、open），并以退出码 0 结束。
3. When 用户执行 `pi-web run` 且未提供位置参数提示词, the CLI shall 以非零退出码结束，并提示缺少 `<prompt>`，不启动服务器。
4. If 用户传入该子命令不接受的选项, then the CLI shall 以非零退出码结束，消息含未知选项名与查看 `pi-web run --help` 的提示。

### Requirement 2: 提示词与 source / 模型 / provider 参数

**Objective:** 作为用户，我想在一条命令里指定提示词、agent 源与模型，以便可复现地启动任务。

#### Acceptance Criteria

1. When 用户执行 `pi-web run <prompt> --source <dir>`, the CLI shall 将 `<prompt>` 识别为待发送的用户消息文本，并将 `<dir>`（或省略时的当前工作目录）作为 agent source 启动实例。
2. When 用户传入 `-m`/`--model <id>`, the CLI shall 将该模型写入会话默认环境（`PI_WEB_DEFAULT_MODEL`），并在创建会话请求中携带 model（若协议支持）。
3. When 用户同时传入 `--provider <name>` 与 model, the CLI shall 在创建会话后调用会话 setModel 接口（provider + modelId），使运行中模型与命令一致；若 setModel 失败，shall 记录警告并可继续发送消息（不静默吞掉）。
4. When 用户仅传入 provider 或仅传入 model, the CLI shall 仍能启动并发送消息；仅 model 时依赖环境/默认解析，不强制 setModel 双字段。
5. The CLI shall 支持与既有启动一致的 `-p/--port`、`--host`、`--cwd`、`--agent-dir`、`--stub`、`--open`、可选 `--trust`。

### Requirement 3: 附件路径（含 `@` 与多文件）

**Objective:** 作为 AIGC 用户，我想从命令行挂上本地参考图，以便 agent 在首条消息中引用这些附件。

#### Acceptance Criteria

1. When 用户通过 `--attachment <path>`（可重复）或 `--attachments` 提供一个或多个路径, the CLI shall 在发送消息前将这些文件上传到该会话的附件端点，并在 `POST .../messages` 中携带对应的 `attachmentIds`。
2. When 路径以 `@` 开头（如 `@images/1.jpg`）, the CLI shall 剥除 `@` 前缀后再解析文件系统路径。
3. When 用户写 `--attachments @a.jpg @b.jpg` 或逗号分隔的多路径, the CLI shall 将全部路径纳入附件列表（不把多余路径误判为非法位置参数）。
4. If 某一附件路径不存在, then the CLI shall 报告可读错误（含解析后的绝对路径），且不声称消息已成功发送。
5. The 上传 shall 使用 multipart 字段名 `file`，与既有 `POST /sessions/:id/attachments` 契约一致。

### Requirement 4: 就绪后编排与同一会话打开

**Objective:** 作为用户，我想服务就绪后自动完成「建会话 → 上传 → 发首条」，并在浏览器中看到**该**会话而非空白新聊。

#### Acceptance Criteria

1. When `run` 成功拉起后端且就绪探测通过, the CLI shall 按序：创建会话 →（可选）setModel → 上传全部附件 → 建立 stream 订阅 → 发送含 prompt 与 attachmentIds 的消息。
2. The CLI shall 在 POST messages **之前**建立对 `GET /sessions/:id/stream` 的订阅，以满足流式竞态约定。
3. When 用户指定 `--open`, the CLI shall 打开浏览器到该会话页路径 `/session/<sessionId>`（或等价 resume URL），而不是仅打开根路径 `/` 导致另建空会话。
4. When 编排某步失败, the CLI shall 向 stderr 输出可读错误；服务器进程可按既有 launch 语义继续监管（不因引导失败而强制假装成功）。
5. When 编排成功, the CLI shall 在 stdout 打印至少：会话已创建（含 id）与会话页 URL 或「首条消息已发送」类阶段信息，便于脚本与人工确认。

### Requirement 5: 可测试的纯函数边界与回归

**Objective:** 作为维护者，我想解析与编排核心可被单元测试直接驱动，以便不依赖完整浏览器 e2e 也能守住契约。

#### Acceptance Criteria

1. The 实现 shall 导出可测入口：至少包括 `parseCliArgs`（含 `run` → run-task 意图）、附件 argv 展开/`@` 剥离，以及 `bootstrapRunTask`（可注入 fetch）。
2. Automated tests shall 覆盖：代表性质的产品 argv（含中文 prompt、`--source`、`-m`、`--provider`、`--attachments @a @b`、`--open`）解析结果正确。
3. Automated tests shall 覆盖：bootstrap 在 mock fetch 下调用顺序为 create →（setModel）→ upload → stream → messages，且 messages body 含正确 prompt 与 attachmentIds。
4. The 既有默认 `pi-web [source]` 解析与子命令列表回归测试 shall 保持绿色（`run` 计入子命令集合）。
