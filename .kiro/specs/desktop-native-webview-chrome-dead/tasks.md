# 实施任务 — desktop-native-webview-chrome-dead

> 前置：requirements/design 均已批准（spec.json）。方案 A 已实施并经三条视觉判据
> 判定**有效**（design.md「判定」节）。剩余任务全部是收口性质。

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
