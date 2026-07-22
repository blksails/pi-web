# workbench-modules-agent

一个可运行的最简多模块范例：文件管理器、代码编辑器、Diff 查看器和 Canvas 各自运行在独立的 sandbox iframe 中。宿主只负责模块切换、生命周期和能力代理。

## 目录结构

```text
workbench-modules-agent/
├─ index.ts                         # Agent、Surface、LLM inspect_workbench 工具
├─ workbench-state.ts               # 单一权威状态与变更摘要
├─ workbench-extension.ts           # Surface 热投影
├─ routes/
│  ├─ index.ts
│  └─ workbench-data.ts             # GET 冷读 + POST 写入
└─ .pi/web/
   ├─ web.config.tsx                # 唯一的 pi-web 落位适配
   ├─ workbench-host.tsx             # Tab、iframe、能力代理
   ├─ guest-document.ts              # 极小 MessageChannel Guest 启动器
   ├─ workbench-types.ts
   └─ modules/                       # 一模块一文件，可独立替换
      ├─ files.ts
      ├─ editor.ts
      ├─ diff.ts
      └─ canvas.ts
```

## 数据面

- `surface:workbench`：只放 revision、文件元数据、Canvas 计数和最近变更摘要。
- `workbench-data` Agent Route：GET 按模块拉正文；POST 执行带 `expectedRevision` 的写入。
- 附件系统：Canvas 图片先上传为 `att_`，模块状态只保存引用。
- `inspect_workbench`：LLM 每次需要判断工作台内容时读取同一权威状态，避免模块内修改对 LLM 不可见。

四个 iframe 都使用 `sandbox="allow-scripts"`，不共享 JS Realm，也不持有 API URL、会话凭据或 Surface 对象；它们只获得各自的 `MessagePort` 和声明过的能力。

## 运行

```bash
pi-web ./examples/workbench-modules-agent
```

打开会话后，右侧工作区会同时创建四个隔离 View；Tab 切换只改变可见性。可在代码编辑器保存内容，再切到 Diff 查看结果；随后询问 Agent 当前修改，LLM 会先调用 `inspect_workbench` 读取同一 revision。
