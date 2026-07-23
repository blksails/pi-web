这份文档基于 `pi-web` 现有架构及 AIGC-Agent 扩展需求，旨在规划一套支持多 Tab 切换、iframe 隔离、且深度集成 WebExt 体系的右侧面板（Side Panel）架构。

---

### pi-web 右侧栏 Tab-Iframe-WebExt 架构设计文档

#### 1. 整体架构设计
采用基于 **微前端（Micro-frontend）** 的 iframe 隔离方案，将右侧面板从单一插槽升级为动态工作区 [1, 2]。

*   **核心分层**：
    *   **UI 宿主层 (Host)**：`TabPanelContainer` 负责渲染 Tab 栏和 iframe 容器，利用 React 19 的 `<Activity>` 维持 iframe 存活 [2, 3]。
    *   **管理层 (Management)**：`TabRegistry` 服务负责 Tab 的注册、生命周期维护及状态持久化 [2, 4]。
    *   **通信层 (Bridge)**：基于 `postMessage` 封装的 `MessageBridge` 与 `PiBridge SDK`，实现双向异步 RPC 调用 [2, 5]。
*   **布局逻辑**：支持原生窗口风格（无 Header），支持 **上下/左右双栏** 展示，屏幕内最多平铺 **4 个窗口**，当宽度小于阈值（如 800px）时自动收敛为单栏 [6-8]。

#### 2. Tab 注册与管理机制
建立一套基于配置驱动的注册制体系，支持动态扩展 [9]。

*   **注册对象 (Module Registration Schema)**：
    每个模块需定义：`id` (唯一标识)、`label` (显示名称)、`icon` (图标)、`url/component` (入口)、`allowMultiple` (是否允许多实例) [10]。
*   **状态保持 (Keep-alive)**：
    使用 React 19 的 **`<Activity mode="hidden">`** 组件。当 Tab 切换到后台时，React 会保留其 DOM 和内部状态（如 Canvas 的缩放、编译器的代码），同时暂停非必要的 Effect 执行以节省 CPU [3, 11]。
*   **生命周期**：
    1.  **Initialize**：宿主发送初始化配置（主题、Session ID）[12]。
    2.  **Active/Inactive**：通过 `state:visibility_change` 通知 iframe 暂停/恢复高频操作 [13, 14]。
    3.  **Destroy**：用户点击 `✕` 时彻底卸载 [15]。

#### 3. iframe 通信协议设计
放弃原始字符串通信，采用类型安全的 **Promise-based RPC** [5, 16]。

*   **握手协议**：采用双向轮询（Ping-Pong）机制。宿主加载 iframe 后发起 Ping，iframe 就绪后回传 Ready 信号，防止消息丢失 [12, 17]。
*   **通用消息格式** [4, 16]：
    ```json
    {
      "requestId": "uuid",
      "method": "tool:invoke | state:update | ui:resize",
      "payload": { ... },
      "source": "tab-id"
    }
    ```
*   **自动调整尺寸**：iframe 内部通过 `ResizeObserver` 监测高度，并发送 `ui:resize` 消息告知宿主调整容器高度 [18, 19]。

#### 4. 各功能模块详细设计
各功能均封装为独立 SPA 入口，通过 `PiBridge` 接入 [20, 21]。

*   **搜索 (Search)**：从独立页面改为 Tab 内嵌。点击侧边栏搜索按钮弹出悬浮输入框，回车后在右侧新建或聚焦“搜索结果” Tab。通过 `PiBridge` 将选中的搜索结果发送回主对话流 [20, 22]。
*   **画布 (Canvas)**：作为高性能渲染层，使用 **`state-bridge`** 与 Agent 子进程同步数据。Agent 可通过 `read_state` 工具读取画布层级和操作历史 [20, 23]。
*   **素材 (Materials)**：迁移原有的素材抽屉设计。支持文件夹树、批量操作。支持通过拖拽（Drag & Drop）将素材 `attachmentId` 发送至聊天输入框 [24, 25]。
*   **内置浏览器 (Browser)**：提供安全受限的 Web 访问，支持 Agent 驱动网页截图及元素检视 [26]。
*   **Playground**：代码执行沙箱，捕获标准输出并实时通过 `PiBridge` 返回给主界面 [26]。

#### 5. 安全与性能考虑
*   **安全防御**：
    *   **严格沙箱**：iframe 必须设置 `sandbox="allow-scripts"`，禁止直接访问父窗口 DOM [27-29]。
    *   **Origin 校验**：所有消息监听器必须首先校验 `event.origin` 是否在信任白名单内 [30-32]。
    *   **验签机制**：WebExt 清单通过服务端验签，并使用内容哈希（SRI）校验静态资源完整性 [33, 34]。
*   **性能优化**：
    *   **资源共享**：使用 **`SharedWorker`** 集中管理网络缓存和 WebSocket 连接，避免每个 Tab 重复建立连接 [35]。
    *   **延迟加载 (Lazy Load)**：非活跃 Tab 在首次切换前不加载 iframe 资源 [26]。

#### 6. 迁移路径与实施计划
预计总工作量 **33 天** [36]。

*   **Phase 1: 基础设施 (11天)**：实现 `TabRegistry`、`TabPanelContainer` 及基础通信 SDK。
*   **Phase 2: 搜索模块迁移 (5天)**：改造搜索 SPA 入口，对接 `PiBridge` 触发逻辑。
*   **Phase 3: 画布与素材迁移 (17天)**：将 `CanvasWorkspace` 和 `MaterialDrawer` 封装为独立 iframe，实现 `state-bridge` 状态对齐 [36, 37]。
*   **Phase 4: 全面收敛**：废弃旧的单一组件 `panelRight` 插槽，全面转向 tabPanel 模式 [25]。

#### 7. API 设计规范 (PiBridge SDK)
供 iframe 内部调用的核心 API [4, 38]：

| 方法 | 说明 |
| :--- | :--- |
| `sendAction(id, data)` | 向 Agent 发送指令或工具调用请求 |
| `readState(key)` | 读取当前会话或画布的同步状态 |
| `onEvent(event, callback)` | 监听来自宿主的 UI 状态变化（如主题切换） |
| `updateContext(ctx)` | 更新当前模块的上下文信息 |
| `close()` | 请求关闭当前 Tab |