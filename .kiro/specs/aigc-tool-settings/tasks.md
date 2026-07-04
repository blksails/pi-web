# Implementation Plan

> **R2(2026-07-04):设置表面 = /settings config 域 `aigc`(非 canvas 弹层)。** 见 design.md R2 修订。
> 依赖方向：protocol ← tool-kit(纯 catalog)/ server(config 域 + 目录端点)← ui(widget)← app(register-panels)。
> e2e 用 `NEXT_DIST_DIR=.next-e2e` + external server + `PI_WEB_STUB_AGENT=1`;改注入路由/配置域后须重启 dev。

## 1. Foundation —— 纯过滤、占位接缝、模型目录

- [x] 1.1 tool-kit：模型设置解析与纯过滤
  - `resolveAigcToolSettings` 读 config 域文件 `<agentDir>/aigc.json` → `{disabledModels, enablePromptOptimization}`，fail-soft 降级安全默认；`filterRoutes` 纯过滤（全禁保留默认、不重排、未知 id 忽略）。
  - 观察完成：单测覆盖 fail-soft、优化开关解析、过滤各分支，全绿。
  - _Requirements: 1.4, 1.5, 1.6, 2.5, 2.6, 4.6_
  - _Boundary: model-config_

- [x] 1.2 tool-kit：提示词优化占位接缝
  - `optimizePrompt` 无改写透传占位；观察完成：单测断言返回值恒等于入参。
  - _Requirements: 4.4_
  - _Boundary: optimize-prompt_

- [x] 1.3 tool-kit：纯模型目录 + 防漂移
  - `AIGC_MODEL_CATALOG`（`{model,label,provider}[]`，零 import，主入口导出供 server 用）；sync 单测断言与 ROUTES 并集一致。
  - 观察完成：catalog sync 测试通过（model 集合/label/provider/顺序全一致）。
  - _Requirements: 5.3, 7.1_
  - _Boundary: model-catalog_

## 2. Core —— 工具过滤、开关读取、config 域、目录端点、widget

- [x] 2.1 tool-kit：图像工具注册接受被禁集合并收敛枚举
  - 两注册函数接 `disabledModels`，按 activeRoutes 现建枚举/描述/路由；缺省全量；请求被移除模型回退默认。
  - _Requirements: 2.1, 2.4, 2.6_
  - _Depends: 1.1_
  - _Boundary: image-generation/image-edit tools_

- [x] 2.2 tool-kit：run-image-tool 读提示词优化开关调接缝
  - 派发 provider 前读会话状态 `aigc.enablePromptOptimization`，真则调 optimizePrompt，假/未设透传。
  - _Requirements: 4.1, 4.3, 4.5, 7.2_
  - _Depends: 1.2_
  - _Boundary: run-image-tool_

- [x] 2.3 protocol + server：aigc config 域
  - protocol `aigcConfigSchema`/`aigcFormSchema`（disabledModels widget + enablePromptOptimization boolean）+ index 注册；server `DOMAIN_SCHEMAS.aigc` → `/api/config/aigc` GET/PUT 落 `aigc.json`。
  - 观察完成：config-routes 集成测试 PUT→GET 往返一致 + 非法 422。
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 4.6_
  - _Boundary: protocol/config/domains/aigc, config-routes DOMAIN_SCHEMAS_

- [x] 2.4 server：模型目录端点
  - `GET /aigc/models` 返回纯 `AIGC_MODEL_CATALOG`（widget 数据源；/settings 无会话态）。
  - 观察完成：路由单测返回非空目录、每项形态完整。
  - _Requirements: 5.3_
  - _Depends: 1.3_
  - _Boundary: aigc-models-routes_

- [x] 2.5 ui：模型开关自定义 widget
  - `AigcModelTogglesField`（widget `aigcModelToggles`）：fetch `/api/aigc/models` 勾选清单 + label + provider 徽章，勾选=启用、值=被禁 id 数组；取数失败回退占位。
  - 观察完成：组件测试覆盖回显、切换更新数组、徽章渲染、取数失败退化。
  - _Requirements: 5.2, 5.3, 7.3_
  - _Depends: 2.4_
  - _Boundary: AigcModelTogglesField_

## 3. Integration —— 装配读取、面板注册、目录端点注入

- [x] 3.1 tool-kit：扩展装配期读设置→过滤 + 发布开关
  - aigcExtension 装配期读 aigc.json：filterRoutes 过滤枚举/清单（被禁模型四处移除）+ `state.set("aigc.enablePromptOptimization", 持久值)`；当前会话不追溯。
  - 观察完成：集成测试断言枚举 + models/labels/providers 四处不含被禁 + 会话状态发布优化开关。
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 7.1_
  - _Depends: 1.1, 2.1_
  - _Boundary: aigcExtension_

- [x] 3.2 app：注册 /settings 面板 + 注入目录端点转发器
  - register-panels 注册 `aigc` 面板（makeConfigDomainIO）+ `aigcModelToggles` renderer；pi-handler 注入 `createAigcModelsRoute`；`app/api/aigc/[[...path]]` catch-all（GET）。
  - 观察完成：重启 server 后 `/settings` 左导航含「AIGC 图像」、`/api/aigc/models` 与 `/api/config/aigc` 非 404。
  - _Requirements: 5.1_
  - _Depends: 2.3, 2.4, 2.5_
  - _Boundary: register-panels, pi-handler, app/api/aigc forwarder_

## 4. Validation —— e2e 闭环与回归

- [x] 4.1 端到端闭环验证（/settings）
  - 浏览器 e2e（隔离 build + stub）：/settings → AIGC 图像面板 → 关某模型 + 开优化 → 保存 → GET /api/config/aigc 回读一致（落 aigc.json）。
  - 观察完成：2 用例以新鲜运行输出通过。
  - _Requirements: 3.1, 3.2, 5.1, 5.2, 7.4_
  - _Depends: 3.1, 3.2_
  - _Boundary: e2e_

- [x] 4.2 全量类型检查与受影响包回归
  - protocol/tool-kit/server/ui/app typecheck + 单测/集成全绿、strict 无 `any`。
  - 观察完成：全 workspace typecheck + root tsc 干净；受影响包测试留证。
  - _Requirements: 7.1, 7.2, 7.3, 7.5_
  - _Depends: 3.1, 3.2_
  - _Boundary: 全仓回归_
