# pi-web 右侧栏 Tab-Iframe-WebExt 最终架构设计文档

本方案旨在为 `pi-web` 打造一套兼具 **Codex (ChatGPT) 审美**与 **IDE 级扩展能力**的右侧面板系统。该系统利用 React 19 的原生特性与安全的 iframe 隔离技术，深度集成 AIGC-Agent 的核心创作流（搜索/画布/素材）。

---

### 1. 视觉与布局架构 (Visual Architecture)

采用 **Codex 风格的垂直 Tab 栏**设计，将原本拥挤的顶部空间释放，最大化创作区域。

*   **布局逻辑 [1-3]**：
    *   **垂直 Tab 栏**：固定在屏幕最右侧（宽度 48px），仅展示图标。
    *   **动态内容面板**：位于 Tab 栏左侧，默认宽度 300px-400px，支持点击 Tab 切换展开/收起状态。
    *   **多窗口弹性网格**：支持水平（左右）或垂直（上下）拆分，屏幕内最多平铺 **4 个窗口** [4, 5]。
*   **响应式收敛 [6, 7]**：
    *   当右侧总宽度 < 800px 时，多栏布局自动收敛为单栏纵向堆叠。
    *   当分屏宽度 < 400px 时，非活跃分屏折叠为 Tab 标签。

---

### 2. 核心组件与状态管理 (Component & Lifecycle)

利用 React 19 的新特性确保 iframe 在切换过程中不重载，维持创作状态。

*   **状态保持 (Keep-alive) [8, 9]**：
    使用 **`<Activity mode="hidden">`** 包裹非活跃 Tab。当用户切换 Tab 时，React 保留 iframe 的 DOM 节点和内部内存（如画布的撤销历史），仅通过 CSS `display: none` 隐藏并暂停高频渲染，实现“秒开”体验 [10, 11]。
*   **组件分层 [12]**：
    1.  `TabPanelContainer`：宿主容器，管理分屏状态。
    2.  `VerticalTabBar`：右侧 48px 宽的导航条。
    3.  `TabIframe`：带沙箱权限管控的 iframe 封装组件 [13, 14]。

---

### 3. Tab 注册与管理机制 (Registry Schema)

基于 **配置驱动** 的注册体系，支持动态添加第三方扩展模块。

*   **模块定义接口 [15, 16]**：
    ```typescript
    interface TabModule {
      id: string;          // 唯一标识 (如 'aigc-canvas')
      label: string;       // 显示名称
      icon: LucideIcon;    // 图标
      url: string;         // iframe 入口地址
      allowMultiple: boolean; // 是否允许多开 (搜索结果允许多开)
      singleton: boolean;  // 是否单例 (素材库通常为单例)
    }
    ```
*   **生命周期钩子 [17, 18]**：
    *   `Initialize`：建立 RPC 连接，注入 Session 上下文。
    *   `VisibilityChange`：Tab 进入后台时通知 iframe 暂停 WebSocket 或动画 [8, 19]。

---

### 4. iframe 通信协议 (PiBridge RPC)

放弃不可靠的原始 `postMessage` 字符串通信，采用 **Promise-based RPC**。

*   **握手协议 (Strict Handshake) [17, 20]**：
    宿主加载后发起 `ping` 轮询；iframe 初始化完成后回传 `ready` 信号，锁定通信 Origin [21, 22]。
*   **通信 SDK (PiBridge) [23, 24]**：
    ```javascript
    // iframe 内部调用示例
    import { piBridge } from '@blksails/pi-web-kit';

    // 向 Agent 发送工具指令
    await piBridge.call('tool:invoke', { name: 'image_edit', args: { prompt: '变红' } });

    // 订阅主对话状态
    piBridge.on('state:update', (state) => {
      console.log('当前画布状态:', state.canvasJson);
    });
    ```

---

### 5. 功能模块详细设计 (Feature Integration)

#### 5.1 搜索模块 (Search-to-Tab) [25, 26]
*   **流程**：侧边栏搜索按钮 -> 弹出悬浮输入框 -> 回车 -> 右侧自动**新建/聚焦**搜索结果 Tab。
*   **闭环**：通过 `piBridge` 将搜到的素材 `attachmentId` 发送至主对话框。

#### 5.2 画布系统 (Canvas Workspace) [26, 27]
*   **状态桥接 (State Bridge) [28, 29]**：画布状态（图层 JSON）通过 `state-bridge` 与 Agent 子进程同步。Agent 可通过 `read_state` 工具实时读取画布当前层级。
*   **实时性**：利用 `SharedWorker` 管理画布数据缓存，减少多 Tab 间的数据同步延迟 [18, 30]。

#### 5.3 素材抽屉 (Materials Center) [31, 32]
*   **交互规范**：支持三 Tab 设计（历史、收藏、本地）。
*   **跨域拖拽**：支持将素材从 iframe 拖拽至主对话框，通过 `DataTransfer` 传递 `pi-att-id` 协议头 [5]。

---

### 6. API 规范与代码示例

#### 6.1 宿主层：TabRegistry 注册示例
```typescript
// lib/app/tab-registry.ts
export const DEFAULT_TABS = [
  { id: 'search', label: '搜索', url: '/ext/search', icon: SearchIcon, allowMultiple: true },
  { id: 'canvas', label: '画布', url: '/ext/canvas', icon: PaletteIcon, singleton: true },
  { id: 'assets', label: '素材', url: '/ext/materials', icon: FolderIcon, singleton: true },
];
```

#### 6.2 扩展层：通信协议格式 [33, 34]
```json
{
  "requestId": "uuid-123",
  "method": "ui:resize | tool:invoke | state:push",
  "payload": {
    "width": "400px",
    "data": { "attachmentId": "att_abc" }
  },
  "source": "pi-web-host"
}
```

---

### 7. 安全与性能考虑 (Security & Performance)

*   **安全策略 [14, 21, 35]**：
    *   **严格沙箱**：iframe 开启 `sandbox="allow-scripts"`，禁止访问父窗 DOM。
    *   **Origin 白名单**：所有监听器必须强校验 `event.origin` [36, 37]。
    *   **SRI 校验**：WebExt 静态资源必须匹配服务端签名的 Content Hash [38]。
*   **性能优化 [35]**：
    *   **资源共享**：通过 `SharedWorker` 统一 WebSocket 链路 [30]。
    *   **懒加载**：Tab 首次点击时才注入 `src`，避免首屏加载过多 iframe 导致崩溃 [39, 40]。

---

### 8. 实施计划 (Implementation Plan) [32, 40]

预计总开发周期：**33 天**。

1.  **Phase 1 (11天)**：基础设施开发。实现 `TabPanelContainer` 垂直布局及 `PiBridge SDK`。
2.  **Phase 2 (5天)**：搜索模块迁移。将现有搜索 SPA 封装为动态 Tab 模式。
3.  **Phase 3 (17天)**：核心能力迁移。重构画布与素材系统，接入 `state-bridge` 同步机制。

---
*文档版本：v1.1.0*
*该架构完全适配 Electron/Tauri 桌面容器，符合现代 Agent 应用的工作流需求。* [1, 41]