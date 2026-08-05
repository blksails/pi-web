# 实施任务 — desktop-native-webview-chrome-dead

> 前置：requirements/design 均已批准（spec.json）。判定已修正：方案 A **部分有效**
> ——绘制死区已修（判据 1/2），**点击死区仍在**（判据 3 FAIL，机械读数 + 用户复现
> 一致）。任务 1/2 的收口内容仍然成立（绘制半边的事实没变），新增任务 3/4。

- [x] 1. 收口：过时结论回写
  - window.rs 载体开关的 doc 注释仍写「原生载体 chrome 不可见也不可点」——已被判据
    1/2/3 推翻，改为「方案 A（force_host_redraw）后已验证可见可点」，保留浮层载体
    缺陷的警告不变
  - 提交 spec 三件套（spec.json/design.md/tasks.md）与注释更新
  - _Requirements: 4.2（文档如实反映验证状态）_

- [x] 2. ~~严格归因对照包~~（用户裁决：不执行）
  - 保留触发条件备查：症状复发或需上报 wry 上游时，构建去掉 force_host_redraw 的
    对照包复跑三判据
  - _Requirements: 2.4_

- [ ] 3. 点击死区根因判别（绘制已修，事件不通）
  - 判别「事件在哪一层丢失」：宿主 DOM 指针探针（P 数组法）配一次**保证送达**的
    对照点击（中央栏宿主区域，排除首击吞焦点），三种可能——事件被 child NSView
    拦截 / 被 wry 层拦截 / 到宿主 WebView 但未派发 DOM
  - 判别成立后出方案 B（候选：槽变化后重排子视图 z 序、事件穿透区域声明、
    或 child 让开期间临时 hide）
  - ★ 取证纪律：每次点击前重取窗口几何；「有反应」类读数必须指名元素+预期效果+实见效果
  - _Requirements: 2.4, 6.2_

- [ ] 4. 验证轮发现的两个活缺陷立案（不在本 spec 内修）
  - 主窗口自漂移/自增长循环（落位日志：run1 高度逐像素缩、run2 宽 1200→1756 逐像素长）
  - 第二扇主窗口不受原生布局管理（零落位日志、pane 区无 chrome）
  - 各自另立 spec 或归入现有线索，本任务只负责立案记录
  - _Requirements: 4.2_

## 范围外移交

- 浮层载体（`PI_WEB_NATIVE_CHILD_WEBVIEWS=0`）窗口位置漂移（「奇怪的悬浮块」）：
  **不在本 spec 边界内**，需另立 spec。线索已记入项目记忆
  `desktop-pane-chrome-empty-not-occluded`。
- CLI E2E workflow 在 main 上的存量红（`payload/payload.json` ENOENT，合并前已连红
  5 次）：与本 spec 无关，待另立线索。

## Implementation Notes

- 2026-08-05：判据 3 由用户实机点击确认（自动化点击因用户占用实机多轮失败；
  其中两次经复盘落在标题栏——窗口移位后未重量几何就点。教训：每次点击前必须
  重取窗口几何，且承认人工读数与自动化读数同等有效）。
