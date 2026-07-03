# Brief: aigc-canvas

> 权威设计:`docs/agent-authoritative-surface-design.md`(§5 端到端实例即 Canvas)。建在 `agent-authoritative-surface` SDK 之上。

## Problem
AIGC agent 生成/编辑的图片散落在对话流的各个工具卡里,无法聚合浏览、筛选、二次创作。用户拿到一张满意的图后,想继续基于它迭代(换背景、局部重绘、出变体),只能靠自然语言反复描述,既慢又不精确。

## Current State
`image_generation` / `image_edit` 工具(`aigc-*` specs)产出 `att_` 附件 + transcript 里的 markdown 图片;`runImageTool` 是可独立调用的编排器;attachment store 统一 `att_` 空间(用户上传 = 工具产出)。但没有画廊聚合、没有二次创作工作台、没有血缘。

## Desired Outcome
- 生成图**自动进画廊**排列;
- 画廊**9 宫格全景 / 密度可切换(概览·瀑布流·聚焦)+ 分页**;
- 格子是主交互单元,**点击展开为全屏工作台,可关闭回画廊**;
- 工作台可**二次创作**,与 `image_edit` 深度结合,激发大量创作路径;
- 刷新 / 重开会话能还原(零 REST,靠 SSE 粘性 + hydrate)。

## Approach
建在 AAS SDK 上,`domain="canvas"`:
- **画廊数据 = attachment store 的物化视图**(非独立持久 state):图本就落 `att_`,重启由 agent 侧 extension 经 `attachment ctx` 枚举重建;`control:"state"` 实时推 + 粘性回放;血缘存 `.att.json` 扩展字段(`derivedFrom`/`genParams`)。
- **编辑执行走 ui-rpc agent 转发**调 `runImageTool`(在 agent 子进程,拿得到 `models.json`/provider/key,**保独立性**),不经宿主服务端、不经 LLM 意图猜测。
- **图字节走 Bulk**(`att_` 签名 URL),永不进帧。

## Scope
- **In**:画廊 UI(9宫格/密度切换/分页/血缘或时间分组);工作台(展开·关闭·工具栏);二次创作——**A 档**(映射 `image_edit`:指令编辑 / inpaint 涂 mask / 参考图融合 / 扩图 outpaint / 多模型变体 / 比例重构)、**B 档**(纯客户端:裁剪·旋转·拼贴·标注,产出新 `att_`)、**C 档**(灵感放大:血缘树 / 参数复用 / A-B 对比 / 当前工作图链);`image_edit` 集成(ui-rpc 转发);非 AIGC source 优雅退化(只读图库 + 客户端编辑);门控 `NEXT_PUBLIC_PI_WEB_CANVAS`。
- **Out**:AAS SDK 本身(上游 `agent-authoritative-surface`);粘性帧机制(`state-injection-bridge`);新增图像 model/provider(`aigc-*`);宿主 REST 端点。

## Boundary Candidates
- 画廊视图(布局 / 分页 / 密度 / 分组)
- 工作台编辑(展开态 / mask 画布 / 客户端处理)
- image_edit 命令桥(surface 命令 → agent 转发 → runImageTool)
- 血缘与派生(`.att.json` 字段 + 视图重建)

## Out of Boundary
- 通用 surface 通信机制(归 AAS SDK)
- provider / model 路由(归 aigc 工具)
- attachment 存储与签名(归 attachment-store)

## Upstream / Downstream
- **Upstream**:`agent-authoritative-surface`、`aigc-generation-tools` / `aigc-tools-interactive-params` / `detoolspec-unify-builtin-tools`、`attachment-store` / `attachment-tool-bridge`、`web-ui-custom-rendering`(SlotContribution)。
- **Downstream**:未来更多创作型 surface(视频、拼版海报导出等)。

## Existing Spec Touchpoints
- **Extends/依赖**:`agent-authoritative-surface`(首个 domain 落地)。
- **Adjacent**:`aigc-*` 工具 specs、`attachment-*`、`sidebar-launcher-rail`(入口挂载)。

## Constraints
- **零 REST route**;画廊载入 = SSE 粘性回放 + 子进程 hydrate(前端只订阅 SSE)。
- **宿主中立**:grep 宿主找不到 `canvas`/`gallery`/`image_edit`。
- 门控 `NEXT_PUBLIC_PI_WEB_CANVAS` 默认关;非 AIGC source 退化不报错。
- 客户端 mask/outpaint 的坐标系对齐;`delete` 帧的粘性清理(与上游对齐)。
- 项目硬规则:单元/集成测试 + 浏览器 e2e,以新鲜运行证据证明。
