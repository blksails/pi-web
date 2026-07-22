# panes-agent

一个可运行的强隔离 Pane 范例。它只消费 `@blksails/pi-web-panes-kit` 公开接口；每个打开的 Tab 都是独立 `PaneInstance`，拥有自己的 `sandbox="allow-scripts"` iframe、React runtime、DOM、状态、`MessagePort` 和 epoch。同一种 Pane 可按定义多开。

页面顶部只有 Pane 导航、权威修订号和 `Ctrl+K` 切换器，不额外套“工作台”标题。颜色、边框和间距使用 pi-web 语义 token；各 Pane 内部同时支持亮/暗色。

## 真实交互

| Pane | React 交互 | 数据通道 |
|---|---|---|
| 文件 | 搜索、创建文件 Dialog、输入校验 | Agent Route GET/POST |
| 编辑 | 文件切换、未保存状态、放弃更改确认 Dialog、revision 冲突 | Agent Route GET/POST + Surface |
| Diff | 并排/统一视图、文件切换、自动刷新 | Agent Route GET + Surface |
| Canvas | 复用项目现有画廊、工作台、二创工具和上传 | Canvas Surface + Attachments + Conversation |
| Artifact | 创建内容 Dialog、草稿/审核/发布状态流转 | Agent Route GET/POST + Surface |

Artifact Pane 参考 `webext-artifact-agent` 的隔离原则：不带 `allow-same-origin`，无法读取宿主 DOM、cookie、storage 或会话对象。区别是它作为 Panes 中的一个可切换单元，由最小 Pane bridge 获得明确授权后的能力。

## 目录与构建边界

```text
panes-agent/
├─ index.ts                    # Agent、inspect_panes 工具
├─ panes-state.ts              # 单一权威状态、revision、change journal
├─ panes-extension.ts          # surface:panes 热摘要
├─ routes/
│  └─ pane-data.ts             # 会话内 GET/POST 数据面
├─ web/                        # 作者源码（不放进 .pi）
│  ├─ web.config.tsx           # 配置化页面与 panelRight 落位
│  ├─ pane-types.ts
│  └─ panes/                   # 五个独立 React 应用入口
├─ build.ts                    # 先打包各 Pane，再构建 WebExtension
└─ .pi/web/dist/               # 仅可加载编译产物与 manifest
```

`lib/app/webext-registry.ts` 直接导入 `.pi/web/dist/web-extension.mjs`，因此 `.pi` 不再承担作者源码目录。构建时临时生成内联 Pane 文档，WebExtension 完成后立即删除临时文件。

## 数据收敛

- `surface:panes`：只承载 revision、文件版本、Canvas/Artifact 计数和最近变更。
- `pane-data`：GET 拉正文，POST 以 `expectedRevision` 写入；handler 运行在 agent 子进程。
- Attachments：画布上传先落 `att_`，权威状态只保存引用。
- `inspect_panes`：LLM 查询同一权威状态，避免 Pane 内修改对下一轮对话不可见。

Guest 不持有 API URL、sessionId、Surface 或上传函数。通用 Host 按当前实例的 `PaneDefinition.capabilities` 代理 route/method、Surface key/action、附件和 Conversation；能力默认拒绝。失效会话的 `SESSION_NOT_FOUND` 会被归一化为明确的 `HOST_UNAVAILABLE`，不会只显示裸 `Agent Route HTTP 404`。

Canvas Pane 不维护第二套画布状态。它在自己的 iframe 内直接装载 `@blksails/pi-web-canvas-ui/CanvasPanel`，经 Guest SDK 代理 `surface:canvas`、上传和对话能力；Agent 侧装载既有 `canvasSurfaceExtension`。

`web.config.tsx` 声明 `panelWidth/minPanelWidth/maxPanelWidth`。pi-web ChatApp 使用受控状态接入 PiChat 现有连续拖拽分隔条；Pane Host 不实现另一套侧栏拖拽。

## 构建与运行

```bash
node --import ./node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti-register.mjs examples/panes-agent/build.ts
pnpm dev
```

在源选择器选择 `panes-agent`。`+` 可新开同类型 Pane，Tab 上 `×` 关闭；`Alt+1..9` 切换实例，`Ctrl/Cmd+K` 打开新建器，高级模式可拖排 Tab。
