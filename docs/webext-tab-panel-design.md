# 右侧栏 Tab 面板架构设计方案

> 本文档是 pi-web WebExtension 体系的扩展设计方案，旨在支持右侧栏多 Tab 页面嵌入。

## 1. 设计目标

### 1.1 核心需求
- 支持多个 Tab 页面共存于右侧面板
- 每个 Tab 可嵌入 iframe（内置浏览器、搜索、画布、素材、代码执行 playground）
- Tab 页面作为 pi 扩展或 tools 接入系统
- 使用 postMessage 等协议与主对话流交互
- 与现有 webext 体系无缝集成

### 1.2 设计原则
- **渐进增强**：兼容现有 panelRight 单一组件模式
- **安全隔离**：iframe 沙箱 + 签名验证
- **松耦合**：Tab 之间互不影响
- **可扩展**：支持第三方 Tab 注册

---

## 2. 整体架构

### 2.1 架构层次图
```
┌─────────────────────────────────────────────────────────────┐
│                    PiChat Container                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Tab Panel Container                      │  │
│  │  ┌─────────┬─────────┬─────────┬─────────┬─────────┐  │  │
│  │  │ Tab 1   │ Tab 2   │ Tab 3   │ Tab 4   │ Tab 5   │  │  │
│  │  │ Browser │ Search  │ Canvas  │ Assets  │ Play-   │  │  │
│  │  │         │         │         │         │ ground  │  │  │
│  │  ├─────────┴─────────┴─────────┴─────────┴─────────┤  │  │
│  │  │              Tab Content Area                    │  │  │
│  │  │  ┌─────────────────────────────────────────────┐ │  │  │
│  │  │  │           iframe (sandboxed)                │ │  │  │
│  │  │  │  ┌───────────────────────────────────────┐  │ │  │  │
│  │  │  │  │         Tab Web Extension              │  │ │  │  │
│  │  │  │  │  ┌─────────────┐  ┌─────────────────┐ │  │ │  │  │
│  │  │  │  │  │ Tab UI      │  │ PiBridge SDK    │ │  │ │  │  │
│  │  │  │  │  │ (React)     │  │ (postMessage)   │ │  │ │  │  │
│  │  │  │  │  └─────────────┘  └─────────────────┘ │  │ │  │  │
│  │  │  │  └───────────────────────────────────────┘  │ │  │  │
│  │  │  └─────────────────────────────────────────────┘ │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Tab Registry (Service)                   │  │
│  │  - Tab 注册/注销                                      │  │
│  │  - Tab 切换/激活                                      │  │
│  │  - Tab 状态管理                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Message Bridge                           │  │
│  │  - postMessage 路由                                   │  │
│  │  - UiRpc 扩展                                         │  │
│  │  - State Bridge 扩展                                  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件
1. **TabPanelContainer**：Tab 面板容器，管理 Tab 栏和内容区
2. **TabRegistry**：Tab 注册表服务，管理 Tab 生命周期
3. **TabIframe**：iframe 封装组件，处理通信和安全
4. **PiBridge SDK**：iframe 内部使用的通信 SDK
5. **MessageBridge**：消息路由层，统一分发消息

---

## 3. Tab 注册与管理机制

### 3.1 Tab 定义接口
```typescript
// packages/protocol/src/web-ext/tab.ts

import { z } from "zod";

// Tab 类型
export const TabTypeSchema = z.enum([
  "iframe",      // 标准 iframe 嵌入
  "component",   // React 组件（不推荐，失去隔离）
  "artifact",    // 兼容现有 artifact 模式
]);
export type TabType = z.infer<typeof TabTypeSchema>;

// Tab 通信模式
export const TabCommunicationSchema = z.enum([
  "postMessage",    // 标准 postMessage
  "rpc",           // UiRpc 扩展
  "state-bridge",  // 状态注入桥
  "hybrid",        // 混合模式
]);
export type TabCommunication = z.infer<typeof TabCommunicationSchema>;

// Tab 定义
export const TabDefinitionSchema = z.object({
  // 基础信息
  id: z.string().min(1),
  label: z.string(),
  icon: z.string().optional(),
  tooltip: z.string().optional(),
  
  // 类型与入口
  type: TabTypeSchema.default("iframe"),
  entry: z.string(),  // iframe src 或组件路径
  
  // iframe 配置
  sandbox: z.string().default("allow-scripts allow-same-origin"),
  initialHeight: z.number().optional(),
  preload: z.string().optional(),  // 预加载脚本
  
  // 通信配置
  communication: TabCommunicationSchema.default("postMessage"),
  
  // 权限
  capabilities: z.array(z.string()).default([]),
  
  // 生命周期
  persistent: z.boolean().default(false),  // 切换时是否保持状态
  lazy: z.boolean().default(true),         // 是否懒加载
  
  // 扩展点
  metadata: z.record(z.unknown()).default({}),
});
export type TabDefinition = z.infer<typeof TabDefinitionSchema>;

// Tab 状态
export const TabStateSchema = z.object({
  id: z.string(),
  active: z.boolean(),
  loaded: z.boolean(),
  error: z.string().optional(),
  lastAccess: z.number().optional(),
});
export type TabState = z.infer<typeof TabStateSchema>;
```

### 3.2 Tab Registry 服务
```typescript
// packages/ui/src/tab-panel/tab-registry.ts

import { EventEmitter } from "events";
import type { TabDefinition, TabState } from "@blksails/pi-web-protocol";

export interface TabRegistryEvents {
  "tab:registered": (tab: TabDefinition) => void;
  "tab:unregistered": (tabId: string) => void;
  "tab:activated": (tabId: string) => void;
  "tab:deactivated": (tabId: string) => void;
  "tab:error": (tabId: string, error: Error) => void;
}

export class TabRegistry extends EventEmitter {
  private tabs = new Map<string, TabDefinition>();
  private states = new Map<string, TabState>();
  private activeTabId: string | null = null;

  // 注册 Tab
  register(tab: TabDefinition): void {
    if (this.tabs.has(tab.id)) {
      throw new Error(`Tab ${tab.id} already registered`);
    }
    
    this.tabs.set(tab.id, tab);
    this.states.set(tab.id, {
      id: tab.id,
      active: false,
      loaded: false,
    });
    
    this.emit("tab:registered", tab);
  }

  // 注销 Tab
  unregister(tabId: string): void {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }
    
    if (this.activeTabId === tabId) {
      this.deactivate(tabId);
    }
    
    this.tabs.delete(tabId);
    this.states.delete(tabId);
    
    this.emit("tab:unregistered", tabId);
  }

  // 激活 Tab
  activate(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`);
    }
    
    // 停用当前 Tab
    if (this.activeTabId && this.activeTabId !== tabId) {
      this.deactivate(this.activeTabId);
    }
    
    // 激活新 Tab
    this.activeTabId = tabId;
    this.states.set(tabId, {
      ...this.states.get(tabId)!,
      active: true,
      lastAccess: Date.now(),
    });
    
    this.emit("tab:activated", tabId);
  }

  // 停用 Tab
  deactivate(tabId: string): void {
    if (this.activeTabId !== tabId) {
      return;
    }
    
    this.states.set(tabId, {
      ...this.states.get(tabId)!,
      active: false,
    });
    
    this.activeTabId = null;
    this.emit("tab:deactivated", tabId);
  }

  // 获取 Tab 列表
  getTabs(): TabDefinition[] {
    return Array.from(this.tabs.values());
  }

  // 获取激活的 Tab
  getActiveTab(): TabDefinition | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) ?? null : null;
  }

  // 获取 Tab 状态
  getState(tabId: string): TabState | undefined {
    return this.states.get(tabId);
  }

  // 更新 Tab 状态
  setState(tabId: string, state: Partial<TabState>): void {
    const current = this.states.get(tabId);
    if (current) {
      this.states.set(tabId, { ...current, ...state });
    }
  }
}
```

### 3.3 扩展 API（WebExtension 新增）
```typescript
// packages/web-kit/src/define-web-extension.ts 扩展

export interface WebExtension {
  // ... 现有字段
  
  // 新增：Tab 面板贡献
  tabPanel?: TabPanelContribution;
}

export interface TabPanelContribution {
  // 注册多个 Tab
  tabs: TabDefinition[];
  
  // 默认激活的 Tab
  defaultTab?: string;
  
  // Tab 栏位置（未来扩展）
  tabBarPosition?: "top" | "left";
}

// 使用示例
export default defineWebExtension({
  manifestId: "my-tabs-extension",
  capabilities: ["tabPanel"],
  tabPanel: {
    tabs: [
      {
        id: "browser",
        label: "浏览器",
        icon: "🌐",
        type: "iframe",
        entry: "/extensions/browser/index.html",
        communication: "postMessage",
        persistent: true,
      },
      {
        id: "search",
        label: "搜索",
        icon: "🔍",
        type: "iframe",
        entry: "/extensions/search/index.html",
        communication: "rpc",
      },
      {
        id: "canvas",
        label: "画布",
        icon: "🎨",
        type: "iframe",
        entry: "/extensions/canvas/index.html",
        communication: "state-bridge",
        capabilities: ["canvas:read", "canvas:write"],
      },
      {
        id: "playground",
        label: "Playground",
        icon: "⚡",
        type: "iframe",
        entry: "/extensions/playground/index.html",
        communication: "hybrid",
        sandbox: "allow-scripts allow-same-origin allow-popups",
      },
    ],
    defaultTab: "browser",
  },
});
```

---

## 4. iframe 通信协议

### 4.1 通用消息格式
```typescript
// packages/protocol/src/web-ext/tab-message.ts

import { z } from "zod";

// 消息方向
export const MessageDirectionSchema = z.enum([
  "host-to-tab",    // 主界面 → iframe
  "tab-to-host",    // iframe → 主界面
  "tab-to-agent",   // iframe → agent（经主界面路由）
  "agent-to-tab",   // agent → iframe（经主界面路由）
]);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

// 消息类型
export const MessageTypeSchema = z.enum([
  // 生命周期
  "tab:init",
  "tab:ready",
  "tab:destroy",
  
  // 状态同步
  "state:sync",
  "state:update",
  
  // 工具调用
  "tool:invoke",
  "tool:result",
  
  // UI 交互
  "ui:action",
  "ui:notification",
  
  // 数据传输
  "data:request",
  "data:response",
  "data:stream",
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

// 统一消息格式
export const TabMessageSchema = z.object({
  // 消息 ID（用于请求-响应匹配）
  id: z.string(),
  
  // 方向
  direction: MessageDirectionSchema,
  
  // 类型
  type: MessageTypeSchema,
  
  // 来源 Tab ID
  tabId: z.string(),
  
  // 目标（可选，默认路由到对应方向）
  target: z.string().optional(),
  
  // 负载
  payload: z.record(z.unknown()),
  
  // 时间戳
  timestamp: z.number(),
  
  // 元数据
  metadata: z.object({
    requestId: z.string().optional(),  // 请求 ID（用于响应匹配）
    replyTo: z.string().optional(),    // 回复的消息 ID
    correlationId: z.string().optional(), // 关联 ID（追踪链路）
  }).default({}),
});
export type TabMessage = z.infer<typeof TabMessageSchema>;
```

### 4.2 PiBridge SDK（iframe 内部使用）
```typescript
// packages/web-kit/src/tab-bridge/sdk.ts

import type { TabMessage } from "@blksails/pi-web-protocol";

export interface PiBridgeOptions {
  tabId: string;
  targetOrigin?: string;
  timeout?: number;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PiBridge {
  private tabId: string;
  private targetOrigin: string;
  private timeout: number;
  private requestId = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>();

  constructor(options: PiBridgeOptions) {
    this.tabId = options.tabId;
    this.targetOrigin = options.targetOrigin ?? "*";
    this.timeout = options.timeout ?? 30000;
    
    // 监听来自主界面的消息
    window.addEventListener("message", this.handleMessage.bind(this));
  }

  // 发送消息到主界面
  async send(type: string, payload: unknown): Promise<void> {
    const message: TabMessage = {
      id: this.generateId(),
      direction: "tab-to-host",
      type: type as any,
      tabId: this.tabId,
      payload: payload as Record<string, unknown>,
      timestamp: Date.now(),
    };
    
    window.parent.postMessage(message, this.targetOrigin);
  }

  // 发送请求并等待响应
  async request(type: string, payload: unknown, timeout?: number): Promise<unknown> {
    const id = this.generateId();
    const message: TabMessage = {
      id,
      direction: "tab-to-host",
      type: type as any,
      tabId: this.tabId,
      payload: payload as Record<string, unknown>,
      timestamp: Date.now(),
    };
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out`));
      }, timeout ?? this.timeout);
      
      this.pendingRequests.set(id, { resolve, reject, timer });
      window.parent.postMessage(message, this.targetOrigin);
    });
  }

  // 调用 agent 工具
  async invokeTool(toolName: string, args: unknown): Promise<unknown> {
    return this.request("tool:invoke", { toolName, args });
  }

  // 请求数据
  async requestData(query: string): Promise<unknown> {
    return this.request("data:request", { query });
  }

  // 更新状态
  async updateState(state: Record<string, unknown>): Promise<void> {
    await this.send("state:update", state);
  }

  // 注册消息处理器
  on(type: string, handler: (payload: unknown) => unknown | Promise<unknown>): void {
    this.handlers.set(type, handler);
  }

  // 处理接收到的消息
  private handleMessage(event: MessageEvent): void {
    // 安全校验
    if (this.targetOrigin !== "*" && event.origin !== this.targetOrigin) {
      return;
    }
    
    const message = event.data as TabMessage;
    if (!message || message.tabId !== this.tabId) {
      return;
    }

    // 处理响应
    if (message.metadata.replyTo) {
      const pending = this.pendingRequests.get(message.metadata.replyTo);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.metadata.replyTo);
        
        if (message.type === "tool:result" && (message.payload as any).error) {
          pending.reject(new Error((message.payload as any).error));
        } else {
          pending.resolve(message.payload);
        }
      }
      return;
    }

    // 处理请求
    const handler = this.handlers.get(message.type);
    if (handler) {
      const result = handler(message.payload);
      
      // 如果是请求类型，发送响应
      if (message.metadata.requestId) {
        Promise.resolve(result).then(
          (value) => {
            const response: TabMessage = {
              id: this.generateId(),
              direction: "tab-to-host",
              type: message.type,
              tabId: this.tabId,
              payload: value as Record<string, unknown>,
              timestamp: Date.now(),
              metadata: {
                replyTo: message.id,
                requestId: message.metadata.requestId,
              },
            };
            window.parent.postMessage(response, this.targetOrigin);
          },
          (error) => {
            const response: TabMessage = {
              id: this.generateId(),
              direction: "tab-to-host",
              type: "tool:result",
              tabId: this.tabId,
              payload: { error: error.message },
              timestamp: Date.now(),
              metadata: {
                replyTo: message.id,
                requestId: message.metadata.requestId,
              },
            };
            window.parent.postMessage(response, this.targetOrigin);
          }
        );
      }
    }
  }

  private generateId(): string {
    return `${this.tabId}-${++this.requestId}-${Date.now()}`;
  }

  destroy(): void {
    window.removeEventListener("message", this.handleMessage.bind(this));
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error("Bridge destroyed"));
    });
    this.pendingRequests.clear();
    this.handlers.clear();
  }
}
```

### 4.3 主界面消息路由
```typescript
// packages/ui/src/tab-panel/message-bridge.ts

import type { TabMessage } from "@blksails/pi-web-protocol";
import type { TabRegistry } from "./tab-registry";

export interface MessageBridgeOptions {
  tabRegistry: TabRegistry;
  agentSessionId?: string;
}

export class MessageBridge {
  private tabRegistry: TabRegistry;
  private agentSessionId?: string;
  private tabIframes = new Map<string, HTMLIFrameElement>();

  constructor(options: MessageBridgeOptions) {
    this.tabRegistry = options.tabRegistry;
    this.agentSessionId = options.agentSessionId;
    
    // 监听来自 iframe 的消息
    window.addEventListener("message", this.handleMessage.bind(this));
  }

  // 注册 iframe 引用
  registerIframe(tabId: string, iframe: HTMLIFrameElement): void {
    this.tabIframes.set(tabId, iframe);
  }

  // 注销 iframe
  unregisterIframe(tabId: string): void {
    this.tabIframes.delete(tabId);
  }

  // 路由消息
  private handleMessage(event: MessageEvent): void {
    const message = event.data as TabMessage;
    if (!message || !message.tabId) {
      return;
    }

    // 验证来源 iframe
    const iframe = this.tabIframes.get(message.tabId);
    if (!iframe || event.source !== iframe.contentWindow) {
      return;
    }

    // 根据方向路由
    switch (message.direction) {
      case "tab-to-host":
        this.handleTabToHost(message);
        break;
      case "tab-to-agent":
        this.handleTabToAgent(message);
        break;
      default:
        console.warn(`Unknown message direction: ${message.direction}`);
    }
  }

  // 处理 tab → 主界面 消息
  private handleTabToHost(message: TabMessage): void {
    switch (message.type) {
      case "tab:ready":
        this.tabRegistry.setState(message.tabId, { loaded: true });
        break;
        
      case "state:update":
        // 更新 Tab 状态
        this.tabRegistry.setState(message.tabId, {
          metadata: message.payload,
        });
        break;
        
      case "ui:action":
        // 处理 UI 动作（如打开对话、切换 Tab 等）
        this.handleUIAction(message);
        break;
        
      default:
        console.log(`Tab message: ${message.type}`, message.payload);
    }
  }

  // 处理 tab → agent 消息（转发给 agent）
  private async handleTabToAgent(message: TabMessage): Promise<void> {
    if (!this.agentSessionId) {
      console.warn("No agent session, cannot forward message to agent");
      return;
    }

    switch (message.type) {
      case "tool:invoke":
        // 转发工具调用到 agent
        const result = await this.invokeAgentTool(
          message.payload.toolName as string,
          message.payload.args as Record<string, unknown>
        );
        
        // 发送响应给 tab
        this.sendToTab(message.tabId, {
          id: this.generateId(),
          direction: "host-to-tab",
          type: "tool:result",
          tabId: message.tabId,
          payload: result,
          timestamp: Date.now(),
          metadata: {
            replyTo: message.id,
            requestId: message.metadata.requestId,
          },
        });
        break;
        
      case "data:request":
        // 转发数据请求到 agent
        const data = await this.requestAgentData(
          message.payload.query as string
        );
        
        this.sendToTab(message.tabId, {
          id: this.generateId(),
          direction: "host-to-tab",
          type: "data:response",
          tabId: message.tabId,
          payload: data,
          timestamp: Date.now(),
          metadata: {
            replyTo: message.id,
            requestId: message.metadata.requestId,
          },
        });
        break;
    }
  }

  // 发送消息给 tab
  sendToTab(tabId: string, message: TabMessage): void {
    const iframe = this.tabIframes.get(tabId);
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(message, "*");
    }
  }

  // 调用 agent 工具（通过 SSE 或 HTTP）
  private async invokeAgentTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    // 实现 agent 工具调用逻辑
    // 可以通过 SSE 或 HTTP API
    const response = await fetch(`/api/sessions/${this.agentSessionId}/tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: toolName, args }),
    });
    return response.json();
  }

  // 请求 agent 数据
  private async requestAgentData(query: string): Promise<unknown> {
    const response = await fetch(`/api/sessions/${this.agentSessionId}/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    return response.json();
  }

  private handleUIAction(message: TabMessage): void {
    const action = message.payload.action as string;
    
    switch (action) {
      case "openChat":
        // 打开对话输入
        document.querySelector("[data-pi-input-textarea]")?.focus();
        break;
        
      case "switchTab":
        const tabId = message.payload.tabId as string;
        this.tabRegistry.activate(tabId);
        break;
        
      case "sendMessage":
        const content = message.payload.content as string;
        // 发送消息到对话
        // ... 实现细节
        break;
    }
  }

  private generateId(): string {
    return `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
```

---

## 5. UI 组件实现

### 5.1 TabPanelContainer 组件
```tsx
// packages/ui/src/tab-panel/tab-panel-container.tsx

import * as React from "react";
import type { TabDefinition } from "@blksails/pi-web-protocol";
import { TabRegistry } from "./tab-registry";
import { MessageBridge } from "./message-bridge";
import { TabIframe } from "./tab-iframe";
import { TabBar } from "./tab-bar";

export interface TabPanelContainerProps {
  tabs: TabDefinition[];
  defaultTab?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function TabPanelContainer({
  tabs,
  defaultTab,
  className,
  style,
}: TabPanelContainerProps): React.JSX.Element {
  const [activeTabId, setActiveTabId] = React.useState<string | null>(
    defaultTab ?? tabs[0]?.id ?? null
  );
  const [loadedTabs, setLoadedTabs] = React.useState<Set<string>>(new Set());
  
  const registryRef = React.useRef<TabRegistry | null>(null);
  const bridgeRef = React.useRef<MessageBridge | null>(null);
  const iframesRef = React.useRef<Map<string, HTMLIFrameElement>>(new Map());

  // 初始化 Registry 和 Bridge
  React.useEffect(() => {
    const registry = new TabRegistry();
    const bridge = new MessageBridge({ tabRegistry: registry });
    
    // 注册所有 Tab
    tabs.forEach((tab) => registry.register(tab));
    
    // 激活默认 Tab
    if (defaultTab) {
      registry.activate(defaultTab);
    }
    
    registryRef.current = registry;
    bridgeRef.current = bridge;
    
    return () => {
      registry.removeAllListeners();
      bridge.destroy();
    };
  }, [tabs, defaultTab]);

  // 处理 Tab 切换
  const handleTabChange = React.useCallback((tabId: string) => {
    setActiveTabId(tabId);
    registryRef.current?.activate(tabId);
    
    // 标记为已加载
    setLoadedTabs((prev) => new Set(prev).add(tabId));
  }, []);

  // 处理 iframe 引用
  const handleIframeRef = React.useCallback((tabId: string, iframe: HTMLIFrameElement | null) => {
    if (iframe) {
      iframesRef.current.set(tabId, iframe);
      bridgeRef.current?.registerIframe(tabId, iframe);
    } else {
      const oldIframe = iframesRef.current.get(tabId);
      if (oldIframe) {
        bridgeRef.current?.unregisterIframe(tabId);
        iframesRef.current.delete(tabId);
      }
    }
  }, []);

  // 过滤可见的 Tab（支持 lazy 加载）
  const visibleTabs = React.useMemo(() => {
    return tabs.filter((tab) => {
      if (tab.lazy && !loadedTabs.has(tab.id) && tab.id !== activeTabId) {
        return false;
      }
      return true;
    });
  }, [tabs, loadedTabs, activeTabId]);

  return (
    <div
      className={`pi-tab-panel ${className ?? ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        ...style,
      }}
      data-pi-tab-panel
    >
      {/* Tab 栏 */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={handleTabChange}
      />
      
      {/* Tab 内容区 */}
      <div
        className="pi-tab-content"
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {visibleTabs.map((tab) => (
          <TabIframe
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onIframeRef={(iframe) => handleIframeRef(tab.id, iframe)}
          />
        ))}
      </div>
    </div>
  );
}
```

### 5.2 TabBar 组件
```tsx
// packages/ui/src/tab-panel/tab-bar.tsx

import * as React from "react";
import type { TabDefinition } from "@blksails/pi-web-protocol";

export interface TabBarProps {
  tabs: TabDefinition[];
  activeTabId: string | null;
  onTabChange: (tabId: string) => void;
}

export function TabBar({ tabs, activeTabId, onTabChange }: TabBarProps): React.JSX.Element {
  return (
    <div
      className="pi-tab-bar"
      role="tablist"
      aria-label="Panel tabs"
      style={{
        display: "flex",
        borderBottom: "1px solid hsl(var(--border))",
        background: "hsl(var(--muted))",
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTabId}
          aria-controls={`tabpanel-${tab.id}`}
          id={`tab-${tab.id}`}
          className="pi-tab-button"
          onClick={() => onTabChange(tab.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            border: "none",
            background: tab.id === activeTabId ? "hsl(var(--background))" : "transparent",
            borderBottom: tab.id === activeTabId ? "2px solid hsl(var(--primary))" : "2px solid transparent",
            cursor: "pointer",
            fontSize: 13,
            color: tab.id === activeTabId ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
            transition: "all 0.15s ease",
          }}
          data-pi-tab={tab.id}
          data-pi-tab-active={tab.id === activeTabId}
        >
          {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
```

### 5.3 TabIframe 组件
```tsx
// packages/ui/src/tab-panel/tab-iframe.tsx

import * as React from "react";
import type { TabDefinition } from "@blksails/pi-web-protocol";

export interface TabIframeProps {
  tab: TabDefinition;
  active: boolean;
  onIframeRef: (iframe: HTMLIFrameElement | null) => void;
}

export function TabIframe({ tab, active, onIframeRef }: TabIframeProps): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    onIframeRef(iframeRef.current);
    return () => onIframeRef(null);
  }, [onIframeRef]);

  return (
    <iframe
      ref={iframeRef}
      src={tab.entry}
      sandbox={tab.sandbox}
      title={tab.label}
      id={`tabpanel-${tab.id}`}
      role="tabpanel"
      aria-labelledby={`tab-${tab.id}`}
      loading={tab.lazy ? "lazy" : "eager"}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        border: "none",
        opacity: active ? 1 : 0,
        pointerEvents: active ? "auto" : "none",
        visibility: active ? "visible" : "hidden",
      }}
      data-pi-tab-iframe={tab.id}
      data-pi-tab-active={active}
    />
  );
}
```

---

## 6. 与现有 Webext 体系集成

### 6.1 扩展点映射
```typescript
// lib/app/webext-registry.ts 扩展

import type { TabDefinition } from "@blksails/pi-web-protocol";

// 现有 REGISTRY 保持不变
const REGISTRY = [/* ... */];

// 新增：Tab Panel 注册
const TAB_REGISTRY: Record<string, TabDefinition[]> = {
  "webext-layout-agent": [
    {
      id: "info",
      label: "信息",
      icon: "📋",
      type: "component",
      component: InfoPanel,
    },
  ],
  
  "webext-tabs-agent": [
    {
      id: "browser",
      label: "浏览器",
      icon: "🌐",
      entry: "/extensions/browser/index.html",
    },
    {
      id: "search",
      label: "搜索",
      icon: "🔍",
      entry: "/extensions/search/index.html",
    },
    {
      id: "canvas",
      label: "画布",
      icon: "🎨",
      entry: "/extensions/canvas/index.html",
    },
  ],
};

// 解析 Tab Panel
export function resolveTabPanelForSource(source: string): TabDefinition[] | undefined {
  return TAB_REGISTRY[Object.keys(TAB_REGISTRY).find((key) => source.includes(key)) ?? ""];
}
```

### 6.2 panelRight 插槽升级
```typescript
// packages/web-kit/src/define-web-extension.ts

export interface SlotContribution {
  // 现有：支持单一组件或 ReactNode
  panelRight?: ReactNode | ComponentType<SlotRenderProps>;
  
  // 新增：支持 Tab Panel 配置
  panelRightTabs?: {
    tabs: TabDefinition[];
    defaultTab?: string;
  };
}

// 使用示例
export default defineWebExtension({
  manifestId: "my-extension",
  capabilities: ["slots"],
  slots: {
    panelRight: {
      tabs: [
        { id: "browser", label: "浏览器", icon: "🌐", entry: "..." },
        { id: "canvas", label: "画布", icon: "🎨", entry: "..." },
      ],
      defaultTab: "browser",
    },
  },
});
```

---

## 7. 内置 Tab 页面示例

### 7.1 内置浏览器 Tab
```tsx
// extensions/browser/index.tsx

import { PiBridge } from "@blksails/pi-web-kit/bridge";

const bridge = new PiBridge({ tabId: "browser" });

// 注册消息处理器
bridge.on("tool:invoke", async (payload) => {
  const { toolName, args } = payload as { toolName: string; args: unknown };
  
  switch (toolName) {
    case "navigate":
      // 导航到 URL
      window.location.href = args.url as string;
      return { success: true };
      
    case "screenshot":
      // 截图并返回
      const canvas = document.createElement("canvas");
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.getContext("2d")?.drawImage(document.body as any, 0, 0);
      return { dataUrl: canvas.toDataURL() };
      
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
});

// 通知主界面已就绪
bridge.send("tab:ready", {});
```

### 7.2 代码执行 Playground Tab
```tsx
// extensions/playground/index.tsx

import { PiBridge } from "@blksails/pi-web-kit/bridge";

const bridge = new PiBridge({ tabId: "playground" });

// 处理代码执行请求
bridge.on("tool:invoke", async (payload) => {
  const { toolName, args } = payload as { toolName: string; args: unknown };
  
  if (toolName === "execute") {
    const { code, language } = args as { code: string; language: string };
    
    // 发送到沙箱执行
    const result = await executeInSandbox(code, language);
    return result;
  }
  
  throw new Error(`Unknown tool: ${toolName}`);
});

// 监听代码编辑器变化
document.getElementById("editor")?.addEventListener("input", (e) => {
  bridge.send("state:update", {
    code: (e.target as HTMLTextAreaElement).value,
  });
});
```

### 7.3 画布 Tab
```tsx
// extensions/canvas/index.tsx

import { PiBridge } from "@blksails/pi-web-kit/bridge";

const bridge = new PiBridge({ tabId: "canvas" });

// 处理画布操作
bridge.on("tool:invoke", async (payload) => {
  const { toolName, args } = payload as { toolName: string; args: unknown };
  
  switch (toolName) {
    case "draw":
      // 执行绘图操作
      await canvasEngine.draw(args);
      return { success: true };
      
    case "export":
      // 导出画布
      const dataUrl = canvasEngine.export();
      return { dataUrl };
      
    case "getState":
      // 获取画布状态
      return canvasEngine.getState();
      
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
});

// 同步画布状态到 agent
canvasEngine.on("change", (state) => {
  bridge.send("state:update", state);
});
```

---

## 8. 安全与性能考虑

### 8.1 安全措施
1. **iframe sandbox**：严格限制权限
   ```html
   <iframe sandbox="allow-scripts allow-same-origin" />
   ```
   
2. **Origin 校验**：postMessage 验证来源
   ```typescript
   if (event.origin !== expectedOrigin) {
     return; // 忽略非法来源
   }
   ```

3. **消息签名**：关键消息附加签名
   ```typescript
   interface SignedMessage extends TabMessage {
     signature: string; // HMAC 签名
   }
   ```

4. **CSP 策略**：限制 iframe 可加载的资源
   ```
   Content-Security-Policy: frame-src 'self' https://trusted-origin.com;
   ```

### 8.2 性能优化
1. **懒加载**：非激活 Tab 不加载 iframe
   ```typescript
   loading={active ? "eager" : "lazy"}
   ```

2. **状态保持**：切换 Tab 时保持 iframe 状态
   ```typescript
   persistent: true, // 不销毁 iframe，只隐藏
   ```

3. **预加载**：提前加载即将激活的 Tab
   ```typescript
   preload: "/extensions/browser/index.html",
   ```

4. **虚拟化**：大量 Tab 时使用虚拟滚动
   ```typescript
   virtualized: tabs.length > 10,
   ```

5. **消息批处理**：合并高频消息
   ```typescript
   // 防抖处理状态更新
   const debouncedUpdate = debounce((state) => {
     bridge.send("state:update", state);
   }, 100);
   ```

---

## 9. 迁移路径

### 9.1 渐进式迁移
1. **Phase 1**：保持现有 panelRight 单一组件模式
2. **Phase 2**：新增 tabPanel 能力，与 panelRight 并存
3. **Phase 3**：panelRight 自动检测 Tab 配置，升级为 Tab Panel
4. **Phase 4**：废弃单一组件模式，全面使用 Tab Panel

### 9.2 兼容性处理
```typescript
// 智能检测 panelRight 类型
function isTabPanelConfig(value: unknown): value is TabPanelContribution {
  return (
    typeof value === "object" &&
    value !== null &&
    "tabs" in value &&
    Array.isArray((value as any).tabs)
  );
}

// 在渲染时适配
{isTabPanelConfig(panelRight) ? (
  <TabPanelContainer tabs={panelRight.tabs} defaultTab={panelRight.defaultTab} />
) : (
  <div className="pi-panel-right">{panelRight}</div>
)}
```

---

## 10. 总结

本方案设计了一个完整的右侧栏 Tab 面板系统：

1. **Tab 注册与管理**：通过 TabRegistry 服务统一管理 Tab 生命周期
2. **iframe 通信**：基于 postMessage 的统一消息协议，支持多种通信模式
3. **扩展 API**：与现有 WebExtension 体系无缝集成，新增 tabPanel 能力
4. **内置 Tab**：提供浏览器、搜索、画布、Playground 等内置 Tab 实现
5. **安全与性能**：严格的沙箱隔离、Origin 校验、懒加载、状态保持等优化
6. **迁移路径**：渐进式迁移，保持向后兼容

该设计充分利用了现有 webext 架构，同时提供了足够的扩展性来支持未来的 Tab 类型。
