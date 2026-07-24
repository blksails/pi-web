# AIGC-Agent 扩展功能纳入 Tab-Iframe-WebExt 体系分析

> 基于 `C:\workcode\aigc-agent` 项目的调研，分析搜索/画布/素材抽屉如何规范化纳入 pi-web Tab 体系。

---

## 1. AIGC-Agent 现有实现概览

### 1.1 项目架构
- **框架**：Vite + React 19 SPA + Hono 风格 API
- **状态管理**：Zustand（UI 状态）+ React Query（服务端状态）
- **核心依赖**：`@blksails/pi-web-*` 系列包

### 1.2 三大扩展功能

| 功能 | 当前实现位置 | 组件 | 通信方式 |
|------|-------------|------|----------|
| **搜索** | `/search` 独立页面 | `SearchPage` | REST API (`/api/creative-search`) |
| **画布** | `panelRight` 插槽 | `CanvasWorkspace` | 内部状态 + DOM 事件 |
| **素材抽屉** | `panelRight` 插槽内 | `MaterialDrawer` | REST API + Zustand |

### 1.3 当前 WebExt 配置
```typescript
// agents/aigc/.pi/web/web.config.tsx
export default defineWebExtension({
  manifestId: "aigc-main",
  capabilities: ["slots", "renderers", "config"],
  slots: {
    promptToolbar: <AigcPromptToolbar />,  // 工具选择栏
    dialogLayer: <SkillPanel />,            // 技能管理
    panelRight: <CanvasPanelSlot />,        // 画布+素材（单一组件）
  },
  renderers: {
    tools: { /* 13 个媒体工具渲染器 */ },
  },
  config: { /* 主题/布局/空态 */ },
});
```

**问题**：`panelRight` 是单一组件，画布和素材抽屉耦合在一起，无法独立作为 Tab。

---

## 2. 各功能详细分析

### 2.1 搜索功能

**当前实现**：
```
src/routes/search.tsx
├── SearchInput (文本输入)
├── SearchResults (瀑布流图片网格)
└── POST /api/creative-search → DashScope embedding + PgVector
```

**特点**：
- 独立路由页面，与聊天分离
- 纯前端渲染，无 iframe
- 后端依赖 DashScope API + PostgreSQL pgvector

**纳入 Tab 体系的挑战**：
- 需要从独立页面改为 iframe 内嵌
- 需要与主对话流通信（发送搜索结果到对话）

### 2.2 画布系统

**当前实现**：
```
agents/aigc/.pi/web/canvas-panel.tsx (CanvasWorkspace)
├── TabBar (多 Tab 管理)
├── AigcGallery (6 种视图模式)
│   ├── overview (网格)
│   ├── masonry (瀑布流)
│   ├── focus (大图+导航)
│   ├── time (时间分组)
│   ├── lineage (血缘分组)
│   └── all (全部)
├── BlankCanvas (拖拽上传)
└── CanvasWorkbench (编辑引擎，来自 @blksails/pi-web-canvas-ui)
```

**特点**：
- 多 Tab 架构（每个资产一个 Tab）
- 状态持久化（缩放/平层/撤销历史）
- 使用 `display: none` 保留非激活 Tab 状态
- 拖拽交互（`text/att-id` 格式）

**纳入 Tab 体系的优势**：
- 已有多 Tab 概念，容易映射
- 组件化程度高，可独立封装

### 2.3 素材抽屉

**当前实现**：
```
components/material-drawer.tsx (MaterialDrawer, 1700+ 行)
├── TabBar (三 Tab: 素材库/素材目录/并列)
├── LibPane (当前会话资产，按日期分组)
├── DirPane (全局文件夹树，CRUD)
├── CurPane (选中文件夹内容)
└── AssetCell (资产卡片，右键菜单)
```

**特点**：
- 三 Tab 设计（已验证可用）
- Zustand 状态持久化到 localStorage
- 支持多选、批量操作、拖拽
- Portal-based 右键菜单

**纳入 Tab 体系的优势**：
- 已有 Tab  UI 模式
- 状态管理完善

---

## 3. 纳入 Tab-Iframe-WebExt 体系的方案

### 3.1 整体架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    PiChat Container                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Tab Panel Container                      │  │
│  │  ┌─────────┬─────────┬─────────┬─────────┬─────────┐  │  │
│  │  │ 搜索    │ 画布    │ 素材库  │ 浏览器  │ Play-   │  │  │
│  │  │         │         │         │         │ ground  │  │  │
│  │  ├─────────┴─────────┴─────────┴─────────┴─────────┤  │  │
│  │  │              Tab Content Area                    │  │  │
│  │  │  ┌─────────────────────────────────────────────┐ │  │  │
│  │  │  │           iframe (sandboxed)                │ │  │  │
│  │  │  │  ┌───────────────────────────────────────┐  │ │  │  │
│  │  │  │  │         AIGC Tab Extension            │  │ │  │  │
│  │  │  │  │  ┌─────────────┐  ┌─────────────────┐ │  │ │  │  │
│  │  │  │  │  │ Tab UI      │  │ PiBridge SDK    │ │  │ │  │  │
│  │  │  │  │  │ (React)     │  │ (postMessage)   │ │  │ │  │  │
│  │  │  │  │  └─────────────┘  └─────────────────┘ │  │ │  │  │
│  │  │  │  └───────────────────────────────────────┘  │ │  │  │
│  │  │  └─────────────────────────────────────────────┘ │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Tab 定义

```typescript
// 新增 Tab 定义
const AIGC_TABS: TabDefinition[] = [
  {
    id: "aigc-search",
    label: "搜图",
    icon: "🔍",
    type: "iframe",
    entry: "/extensions/aigc-search/index.html",
    communication: "postMessage",
    capabilities: ["search:query", "search:results"],
    persistent: false,  // 搜索不需要保持状态
    lazy: true,
  },
  {
    id: "aigc-canvas",
    label: "画布",
    icon: "🎨",
    type: "iframe",
    entry: "/extensions/aigc-canvas/index.html",
    communication: "hybrid",  // postMessage + state-bridge
    capabilities: ["canvas:read", "canvas:write", "canvas:export"],
    persistent: true,  // 保持画布状态
    lazy: false,       // 默认激活
    initialHeight: 600,
  },
  {
    id: "aigc-materials",
    label: "素材库",
    icon: "📁",
    type: "iframe",
    entry: "/extensions/aigc-materials/index.html",
    communication: "postMessage",
    capabilities: ["materials:read", "materials:write", "materials:manage"],
    persistent: true,
    lazy: true,
  },
];
```

### 3.3 各 Tab 实现方案

#### 3.3.1 搜索 Tab

**改造点**：
1. 将 `src/routes/search.tsx` 改造为独立 SPA 入口
2. 使用 PiBridge 与主界面对话

**PiBridge 集成**：
```typescript
// extensions/aigc-search/index.tsx
import { PiBridge } from "@blksails/pi-web-kit/bridge";

const bridge = new PiBridge({ tabId: "aigc-search" });

// 处理搜索请求（从对话触发）
bridge.on("tool:invoke", async (payload) => {
  const { toolName, args } = payload;
  
  if (toolName === "search") {
    const results = await searchCreatives(args.query, args.limit);
    return results;
  }
});

// 发送搜索结果到对话
async function sendToChat(imageUrl: string) {
  await bridge.send("ui:action", {
    action: "sendMessage",
    content: `![image](${imageUrl})`,
  });
}
```

**API 迁移**：
- `/api/creative-search` 需要移到 Tab iframe 可访问的路径
- 或通过 PiBridge `tool:invoke` 代理调用

#### 3.3.2 画布 Tab

**改造点**：
1. 将 `CanvasWorkspace` 封装为独立 iframe 应用
2. 保持多 Tab 架构（画布内 Tab）
3. 使用 state-bridge 同步画布状态到 agent

**PiBridge 集成**：
```typescript
// extensions/aigc-canvas/index.tsx
import { PiBridge } from "@blksails/pi-web-kit/bridge";

const bridge = new PiBridge({ tabId: "aigc-canvas", communication: "hybrid" });

// 处理画布操作
bridge.on("tool:invoke", async (payload) => {
  const { toolName, args } = payload;
  
  switch (toolName) {
    case "openAsset":
      return canvasWorkspace.openTab(args.assetId);
    case "export":
      return canvasWorkspace.exportCurrent();
    case "getState":
      return canvasWorkspace.getState();
    case "draw":
      return canvasWorkspace.executeCommand(args);
  }
});

// 同步画布状态到 agent
canvasWorkspace.on("change", (state) => {
  bridge.updateState({
    currentAsset: state.activeTab,
    zoom: state.zoom,
    layers: state.layers,
  });
});

// 处理 agent 工具调用
bridge.on("tool:invoke", async (payload) => {
  if (payload.toolName === "image_edit") {
    // 将编辑结果添加到画布
    const asset = await assetStore.add(payload.args.result);
    canvasWorkspace.openTab(asset.id);
    return { success: true, assetId: asset.id };
  }
});
```

**状态同步**：
- 使用 `state-bridge` 模式
- agent 可通过 `read_state` 获取画布状态
- 画布操作可通过 `tool:invoke` 触发 agent 工具

#### 3.3.3 素材库 Tab

**改造点**：
1. 将 `MaterialDrawer` 的三 Tab 设计迁移到独立 iframe
2. 保持文件夹树和批量操作功能
3. 使用 postMessage 与主界面对话

**PiBridge 集成**：
```typescript
// extensions/aigc-materials/index.tsx
import { PiBridge } from "@blksails/pi-web-kit/bridge";

const bridge = new PiBridge({ tabId: "aigc-materials" });

// 处理素材操作
bridge.on("tool:invoke", async (payload) => {
  const { toolName, args } = payload;
  
  switch (toolName) {
    case "list":
      return materialStore.list(args.folder, args.type);
    case "search":
      return materialStore.search(args.query);
    case "move":
      return materialStore.move(args.ids, args.targetFolder);
    case "delete":
      return materialStore.delete(args.ids);
    case "createFolder":
      return materialStore.createFolder(args.name, args.parentId);
  }
});

// 拖拽到对话
async function handleDropToChat(assets: Asset[]) {
  for (const asset of assets) {
    await bridge.send("ui:action", {
      action: "sendMessage",
      content: `[attachment id=${asset.id}]`,
    });
  }
}
```

---

## 4. WebExt 配置改造

### 4.1 新的 WebExtension 定义

```typescript
// agents/aigc/.pi/web/web.config.tsx (改造后)
export default defineWebExtension({
  manifestId: "aigc-main",
  capabilities: ["slots", "renderers", "config", "tabPanel"],
  
  // 保留现有插槽
  slots: {
    promptToolbar: <AigcPromptToolbar />,
    dialogLayer: <SkillPanel />,
    // panelRight 改为 tabPanel 配置
  },
  
  // 新增 Tab Panel 配置
  tabPanel: {
    tabs: [
      {
        id: "aigc-search",
        label: "搜图",
        icon: "🔍",
        entry: "/extensions/aigc-search/index.html",
        communication: "postMessage",
        lazy: true,
      },
      {
        id: "aigc-canvas",
        label: "画布",
        icon: "🎨",
        entry: "/extensions/aigc-canvas/index.html",
        communication: "hybrid",
        persistent: true,
      },
      {
        id: "aigc-materials",
        label: "素材库",
        icon: "📁",
        entry: "/extensions/aigc-materials/index.html",
        communication: "postMessage",
        persistent: true,
      },
    ],
    defaultTab: "aigc-canvas",
  },
  
  // 保留渲染器
  renderers: {
    tools: { /* ... */ },
  },
  
  // 保留配置
  config: { /* ... */ },
});
```

### 4.2 渐进式迁移策略

**Phase 1：保持兼容**
- `panelRight` 继续渲染 `CanvasPanelSlot`
- 内部使用 Tab 但不暴露为 Tab Panel

**Phase 2：双模式并存**
- 检测是否启用 Tab Panel
- 支持 `panelRight`（单一组件）和 `tabPanel`（多 Tab）两种模式

**Phase 3：完全迁移**
- 废弃 `panelRight` 单一组件模式
- 全面使用 `tabPanel`

---

## 5. 通信协议设计

### 5.1 搜索 Tab 通信

```typescript
// 搜索结果 → 对话
interface SearchResultsMessage {
  type: "search:results";
  payload: {
    query: string;
    results: Array<{
      id: string;
      url: string;
      similarity: number;
    }>;
  };
}

// 对话 → 搜索（触发搜索）
interface SearchTriggerMessage {
  type: "search:trigger";
  payload: {
    query: string;
    limit?: number;
  };
}
```

### 5.2 画布 Tab 通信

```typescript
// 画布状态同步
interface CanvasStateMessage {
  type: "state:update";
  payload: {
    activeTab: string | null;
    zoom: number;
    layers: Layer[];
    undoStack: Command[];
  };
}

// 画布操作
interface CanvasOperationMessage {
  type: "tool:invoke";
  payload: {
    toolName: "openAsset" | "export" | "draw" | "undo" | "redo";
    args: Record<string, unknown>;
  };
}
```

### 5.3 素材库 Tab 通信

```typescript
// 素材列表
interface MaterialsListMessage {
  type: "data:response";
  payload: {
    assets: Asset[];
    total: number;
  };
}

// 拖拽到对话
interface MaterialDropMessage {
  type: "ui:action";
  payload: {
    action: "attachMaterial";
    assetId: string;
    filename: string;
  };
}
```

---

## 6. 迁移工作量评估

### 6.1 搜索 Tab
| 任务 | 工作量 | 说明 |
|------|--------|------|
| 创建 iframe 入口 | 1 天 | 新建 `extensions/aigc-search/` |
| 迁移搜索逻辑 | 2 天 | 复用现有 API 和 UI |
| PiBridge 集成 | 1 天 | 对话触发搜索 + 结果发送 |
| 测试 | 1 天 | 端到端测试 |
| **小计** | **5 天** | |

### 6.2 画布 Tab
| 任务 | 工作量 | 说明 |
|------|--------|------|
| 创建 iframe 入口 | 1 天 | 新建 `extensions/aigc-canvas/` |
| 迁移 CanvasWorkspace | 3 天 | 多 Tab + 编辑器 |
| 迁移 Gallery | 2 天 | 6 种视图模式 |
| PiBridge 集成 | 2 天 | state-bridge + tool:invoke |
| 测试 | 2 天 | 画布操作 + 状态同步 |
| **小计** | **10 天** | |

### 6.3 素材库 Tab
| 任务 | 工作量 | 说明 |
|------|--------|------|
| 创建 iframe 入口 | 1 天 | 新建 `extensions/aigc-materials/` |
| 迁移 MaterialDrawer | 3 天 | 三 Tab + 文件夹树 |
| API 适配 | 1 天 | 路径调整 |
| PiBridge 集成 | 1 天 | 拖拽 + 批量操作 |
| 测试 | 1 天 | 端到端测试 |
| **小计** | **7 天** | |

### 6.4 Tab Panel 框架
| 任务 | 工作量 | 说明 |
|------|--------|------|
| TabRegistry 实现 | 2 天 | 注册/切换/生命周期 |
| TabPanelContainer | 2 天 | UI 组件 |
| MessageBridge | 2 天 | 消息路由 |
| PiBridge SDK | 2 天 | iframe 通信 |
| WebExt 集成 | 1 天 | 协议扩展 |
| 测试 | 2 天 | 单元 + 集成测试 |
| **小计** | **11 天** | |

### 6.5 总计
| 模块 | 工作量 |
|------|--------|
| Tab Panel 框架 | 11 天 |
| 搜索 Tab | 5 天 |
| 画布 Tab | 10 天 |
| 素材库 Tab | 7 天 |
| **总计** | **33 天** |

---

## 7. 风险与建议

### 7.1 风险
1. **性能**：多个 iframe 同时存在可能占用大量内存
2. **状态同步**：画布状态实时同步可能有延迟
3. **拖拽交互**：跨 iframe 拖拽需要特殊处理
4. **CSP 限制**：iframe 沙箱可能限制某些 API 调用

### 7.2 建议
1. **优先实现 Tab Panel 框架**：先搭建基础设施，再迁移功能
2. **保持向后兼容**：支持 `panelRight` 和 `tabPanel` 双模式
3. **渐进式迁移**：一次迁移一个 Tab，验证后再迁移下一个
4. **性能优化**：使用懒加载 + 状态保持，避免重复渲染

---

## 8. 总结

AIGC-Agent 的搜索/画布/素材抽屉功能已经具备良好的组件化基础，纳入 Tab-Iframe-WebExt 体系的主要工作是：

1. **创建 iframe 入口**：将各功能封装为独立 SPA
2. **集成 PiBridge**：实现 iframe 与主界面的通信
3. **适配 Tab Panel**：使用新的 Tab 注册和管理机制
4. **状态同步**：通过 state-bridge 保持画布状态同步

预计总工作量 33 天，建议分阶段实施，优先完成 Tab Panel 框架，再逐步迁移各功能模块。
