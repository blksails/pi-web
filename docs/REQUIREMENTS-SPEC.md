# REQUIREMENTS-SPEC

## REQ-A13 · Pane 生命周期、公共加载与环境载体

- 状态: ACTIVE
- 行为: Pane 在载体握手及首屏未就绪时显示公共 loading；关闭后后台保活；显式重载、切 Agent 或退出可销毁。

## REQ-PANE-201 · Pane 隔离载体与宿主交互

- 状态: ACTIVE
- 批准依据: 用户要求禁止 React Pane；网页仅用 iframe，Tauri 仅用 ChildWebView，并修复弹层、缩放、主题及日志 Pane。
- 行为: 所有 Pane 以隔离文档承载；宿主统一管理创建、隐藏、恢复、销毁、缩放与主题同步，日志作为同类隔离 Pane 接入。

## REQ-PANE-202 · AIGC Agent 独立装载与工作区 Pane

- 状态: ACTIVE
- 批准依据: 用户要求 pi-web 装载独立 aigc-agent 源，并恢复素材、搜图、画布与日志 Tab；aigc-agent 可独立打包。
- 行为: pi-web 通过稳定静态入口装载独立 aigc-agent 包；缺失或畸形 Pane 声明不得令宿主白屏。

## REQ-PANE-203 · 草稿带入与标题投射

- 状态: ACTIVE
- 批准依据: 用户要求“带入对话”只写入输入框、不直接发送；移除扩展头部，并将标题投射到网页标签与 Tauri 窗口。
- 行为: Pane 可把文字与附件暂存到当前对话草稿；宿主不得自动提交；扩展标题同步到 document.title 与桌面窗口标题。
