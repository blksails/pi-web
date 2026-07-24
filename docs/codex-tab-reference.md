# Codex (ChatGPT) 右侧栏 Tab 设计参考

## 1. UI 布局分析

### 1.1 三栏布局
```
┌──────────────┬─────────────────────────┬──────────┬─────────┐
│  左侧边栏    │       主内容区           │  内容面板 │ Tab 栏  │
│  (240px)     │       (flex:1)          │  (可选)  │ (48px)  │
├──────────────┼─────────────────────────┼──────────┼─────────┤
│ 会话列表      │  任务对话/代码/文档      │ 浏览器   │ 🌐 浏览器│
│              │                         │ 文件     │ 📄 文件  │
│              │                         │ 侧边任务 │ 📋 任务  │
│              │                         │          │         │
└──────────────┴─────────────────────────┴──────────┴─────────┘
```

### 1.2 左侧边栏结构
- **顶部**：应用名下拉 + 搜索图标
- **功能区**：新建任务、项目、站点、已安排、插件
- **最近会话**：可展开/收起的历史会话列表
- **底部**：设置按钮 + 继续设置进度 + 用户头像

### 1.3 右侧 Tab 栏（关键设计）
- **位置**：最右侧边缘，垂直排列
- **宽度**：约 48px（仅图标）或 160px（展开显示文字）
- **Tab 项**：
  - 🌐 浏览器 `⌘T`
  - 📄 文件 `⌘P`
  - 📋 侧边任务 `⌘⇧S`
- **交互**：
  - 点击 Tab → 展开对应内容面板
  - 再次点击 → 收起内容面板
  - 快捷键切换

---

## 2. 设计模式总结

### 2.1 垂直 Tab 栏优势
1. **节省水平空间**：不占用宝贵的横向宽度
2. **符合 F 型阅读**：右侧边缘不影响主内容阅读
3. **扩展性好**：可容纳更多 Tab 而不拥挤
4. **快捷键友好**：垂直排列便于手势操作

### 2.2 内容面板模式
- **按需展开**：点击 Tab 才展开内容面板
- **可调宽度**：内容面板宽度可拖拽调整
- **独立滚动**：内容面板有独立滚动区域
- **收起保留状态**：收起时保留内部状态

### 2.3 快捷键设计
| Tab | 快捷键 | 说明 |
|-----|--------|------|
| 浏览器 | ⌘T | 新建/聚焦浏览器 Tab |
| 文件 | ⌘P | 快速打开文件 |
| 侧边任务 | ⌘⇧S | 切换侧边任务面板 |

---

## 3. 对 pi-web 的启示

### 3.1 推荐采用垂直 Tab 栏
- Tab 栏固定在右侧面板最右侧（48px 宽）
- 点击 Tab 展开/收起内容面板
- 内容面板默认宽度 300-400px，可拖拽调整

### 3.2 Tab 项设计
```typescript
interface VerticalTab {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;  // 如 "⌘T"
  badge?: number;     // 未读数/状态
  panel?: {
    width: number;    // 默认宽度
    minWidth: number; // 最小宽度
    maxWidth: number; // 最大宽度
  };
}
```

### 3.3 交互规范
1. **点击 Tab**：
   - 未展开 → 展开内容面板
   - 已展开 → 收起内容面板
   - 当前已展开 → 收起（toggle）

2. **快捷键**：
   - 未展开 → 展开并聚焦
   - 已展开 → 收起（toggle）
   - 其他 Tab 已展开 → 切换到此 Tab

3. **拖拽调整**：
   - 内容面板左侧边缘可拖拽
   - 记住用户调整的宽度（localStorage）

---

## 4. 视觉规范

### 4.1 Tab 栏样式
```css
.tab-bar {
  width: 48px;           /* 仅图标 */
  /* 或 width: 160px; */ /* 展开显示文字 */
  background: hsl(var(--muted));
  border-left: 1px solid hsl(var(--border));
  display: flex;
  flex-direction: column;
  padding: 8px 0;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s ease;
}

.tab-item:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.tab-item.active {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  border-left: 2px solid hsl(var(--primary));
}

.tab-shortcut {
  margin-left: auto;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  opacity: 0.6;
}
```

### 4.2 内容面板样式
```css
.tab-panel {
  width: 300px;          /* 默认宽度 */
  min-width: 200px;
  max-width: 500px;
  background: hsl(var(--background));
  border-left: 1px solid hsl(var(--border));
  overflow-y: auto;
  resize: horizontal;    /* 允许水平拖拽调整 */
}

.tab-panel.collapsed {
  display: none;
}
```

---

## 5. 实现建议

### 5.1 状态管理
```typescript
interface TabPanelState {
  // 哪个 Tab 展开（null = 全部收起）
  expandedTabId: string | null;
  
  // 各 Tab 面板宽度
  panelWidths: Record<string, number>;
  
  // 各 Tab 内部状态
  tabStates: Record<string, unknown>;
}
```

### 5.2 动画
- 展开/收起：`width` 过渡 200ms ease
- 内容淡入：`opacity` 过渡 150ms ease
- 图标旋转：展开时旋转 90°（可选）

### 5.3 无障碍
- Tab 栏使用 `role="tablist"`
- Tab 项使用 `role="tab"` + `aria-selected`
- 内容面板使用 `role="tabpanel"`
- 支持键盘导航（↑↓ 切换 Tab，Enter 展开/收起）
