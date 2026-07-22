# panes-agent

一个可运行的强隔离 Pane 范例。文件、编辑、Diff、画布、Artifact 五个标签页分别运行在独立的 `sandbox="allow-scripts"` iframe 中；每个 iframe 都有自己的 React runtime、DOM、状态和 `MessagePort`。

页面顶部只有 Pane 导航、权威修订号和 `Ctrl+K` 切换器，不额外套“工作台”标题。颜色、边框和间距使用 pi-web 语义 token；各 Pane 内部同时支持亮/暗色。

## 真实交互

| Pane | React 交互 | 数据通道 |
|---|---|---|
| 文件 | 搜索、创建文件 Dialog、输入校验 | Agent Route GET/POST |
| 编辑 | 文件切换、未保存状态、放弃更改确认 Dialog、revision 冲突 | Agent Route GET/POST + Surface |
| Diff | 并排/统一视图、文件切换、自动刷新 | Agent Route GET + Surface |
| 画布 | 图形工具、色板、点击绘制、清空确认、图片上传 | Agent Route + Surface + Attachments |
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
│  ├─ panes-host.tsx           # 薄 Host：tabs/lifecycle/grants/MessageChannel
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

Guest 不持有 API URL、sessionId、Surface 或上传函数。Host 按当前 `PaneDefinition.capabilities` 决定是否代理 query、mutation 和 attachment；能力默认拒绝。

## 构建与运行

```bash
node --import ./node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti-register.mjs examples/panes-agent/build.ts
pnpm dev
```

在源选择器选择 `panes-agent`。快捷键：`Alt+1..5` 切 Pane，`Ctrl/Cmd+K` 打开切换器。
