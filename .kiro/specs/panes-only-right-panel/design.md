# Design Document — panes-only-right-panel

## Overview

把右侧面板从「两套并存」收敛为「唯一的 pane 机制」,并删除旧的那一套。

主体工作不是切换开关,而是 **补三项能力 → 逐个重写 9 个声明者 → 删类型 + 留守卫**。
勘察(见 `research.md`)修正了两项原判断,直接改变了工作量分布:

- **插件不需要跨 realm 传组件**(I3)。pane 文档是构建期打出的自足 IIFE,React 与 canvas-ui
  已经跑在 iframe 内。插件的正确形态是**构建期一起打包**,在 iframe 内用既有的
  `registerPluginBundles` 注册。brief 里估的「本波最大单点」不成立。
- **surface 四件套 pane 已全有**(I4)。依赖它的示例是纯 UI 改写,零协议工作。

于是九个声明者里真正需要**新协议**的只有一个(`state-bridge`,需要可写回的共享状态)。

### Goals

- 右侧面板只有一种声明方式;内置 pane 对**所有** agent 生效,不存在「让位」形态。
- 补齐共享状态跨隔离边界访问(读/订阅/**写回**),形态与既有 `pane:surface` 一致。
- 宿主环境信息(主题、对话流焦点事件)由宿主以**领域中立**的具名信号统一供给。
- 迁移是等价改写:断言载体可换,**保护面不可缩**。
- 删除以「零声明者」为**机械**前置判据。

### Non-Goals

- 不废其余 18 个保留槽。
- 不重设计面板内容的功能与外观。
- 不做 pane 的宿主文件系统能力(属 `pane-host-capabilities`)。
- 不改 pane 隔离模型本身(属 `isolated-panes`)。

## Boundary Commitments

### This Spec Owns

- `panelRight` 槽键的删除,及其在 `web-kit` / `protocol` 中的全部类型痕迹。
- pane 共享状态通道的契约、授权与宿主侧绑定。
- 宿主环境信号族(主题、对话流焦点)的供给与领域中立命名。
- 9 个声明者的重写,及各自既有验收断言的等价改写。
- 可复用的 pane 文档构建函数(消除两份 canvas 构建的漂移)。
- `host-builtin-panes` 中「旧槽让位」规则的作废与相应断言清理。

### Out of Boundary

- 其余保留槽;pane 内部 UI 的功能增强;宿主文件系统能力;pane 隔离模型;agent 侧工具与权限。

### Allowed Dependencies

- `panes-kit`(协议、授权、guest SDK、`PanesHost`)—— 本 spec 会扩展它。
- `web-kit`(扩展契约与槽常量)—— 本 spec 会从中删除一个键。
- `canvas-kit` / `canvas-ui`(插件注册与画布组件)—— 只调用,不改其模型。
- 会话外壳(`packages/ui`)—— 只改注入与装载点,**且必须保持领域中立**(既有守卫会拒绝
  其中出现领域词汇)。

### Revalidation Triggers

- pane 协议的请求判别式或授权结构发生变化 → 共享状态通道需重验。
- 宿主主题状态的来源发生变化 → 信号族需重验。
- 新增 `panelRight` 声明者(理论上不应发生,守卫会拦) → 删除前置判据需重跑。

## Architecture

### Existing Architecture Analysis

右侧面板当前有两条路径,分派点在会话外壳的装载处:

```
agent 声明 slots.panelRight ?
  ├─ 是 → SlotHost(宿主同 realm 渲染 React 节点)   ← 本 spec 删除这条
  └─ 否 → PanesHost(合并内置 ⊕ agent 声明,各跑独立 iframe)
```

pane 侧已有四条受管通道:agent route / surface / attachment / conversation,外加两种下行原语
—— `pane:signal`(宿主→pane 的具名值,最后值即真值,无发送方身份)与 `pane:surface`
(agent 权威快照,逐键授权 + 宿主侧绑定推送)。

### Architecture Pattern & Boundary Map

```
                      ┌──────────────── 宿主 realm ────────────────┐
  会话外壳(领域中立)  │  主题状态  对话流点击  共享状态访问器      │
        │             │      │          │            │             │
        │  宿主信号族 ▼      ▼          │            │             │
        └──────────────── PanesHost ────┼────────────┘             │
                              │  bindSurface / bindState(重绑)    │
                      ┌───────┴────────┐                           │
                      │ MessageChannel │  ← 授权在此逐项判定       │
                      └───────┬────────┘                           │
                      ┌───────▼────────┐                           │
                      │  pane 文档     │  构建期自足 IIFE:         │
                      │  (opaque origin)│  React + canvas-ui        │
                      │                │  + 本 source 的插件集      │
                      └────────────────┘                           │
                      └────────────────────────────────────────────┘
```

**关键结构判断**:插件位于 pane 文档**内部**,与画布组件同一 bundle。跨边界的只有数据
(快照/信号/状态)与受管请求,**没有组件**。

### Technology Stack

沿用现状,不引入新依赖:esbuild(pane 文档打包)、zod(协议校验)、既有 MessageChannel 传输。

## 关键设计决策

### D1 · 共享状态采纳 `pane:surface` 的既有形态,只增写回

**决策**:读与订阅逐字镜像 `bindSurface`(逐键授权 → 宿主侧读一次并订阅 → 经下行帧推送);
写回新增一个上行 operation,由宿主转发到既有的写回原语。

**理由**:两者的问题形状完全相同,而既有实现已经踩平了两个坑(见 D2)。另立一套等于把那两个坑
重挖一遍。授权结构也同构 —— 读授权是一张键表,写授权另立一张(**读写分离**,因为写是显著更强
的权力,不该被读授权顺带捎上)。

**代价**:协议的请求判别式与能力结构各多一项。可接受。

### D2 · ★ 共享状态绑定必须复制「访问器换身份 → 整组重绑 + 立即重推」语义

**决策**:共享状态访问器一旦换身份,所有在世连接整组重新绑定,且重绑时立即重推当前值。

**理由**:这是既有实现在 `bindSurface` 上用一整段注释记录的**前科**。宿主的访问器由 `useMemo`
依赖会话连接构造,就绪握手与控制流重开都会换出新实例,新实例读的是**新的** store;建连那一刻
的订阅挂在旧 store 上,此后永不触发。症状是「pane 起来了、能力也对,但值永远是空的」——
并且极易被误判成 agent 没发数据。立即重推则覆盖「建连早于首帧数据到达」的竞态。

**这不是优化项**。漏掉它的失败形态是静默的。

### D3 · 宿主环境信息作为一族**领域中立**具名信号供给

**决策**:主题明暗与「对话流内可聚焦元素被点击」由宿主计算并作为 `host:` 前缀的具名信号推送,
agent 不再自行在宿主环境挂监听。

**理由**:隔离形态下 agent 根本挂不上;而会话外壳是领域中立层,既有守卫会拒绝其中出现领域
词汇(本作者上一轮刚被它拦过)。焦点判定所依据的两个 data 属性本就是**宿主的**(附件标识与
工具卡),故中立化是自然的,不需要重新定义语义。

**★ 必须保留的语义**:`pane:signal` 是最后值即真值,值不变不重推 —— 因此同一目标连点两次时,
第二次必须仍能触达。既有示例用附加递增序号解决,宿主内置化时须自带等效规避。

**附带项**:「悬浮态可点」的样式钩子当前由示例打在宿主 `document.body` 上且属性名含领域词 ——
随之移交宿主并中立化。

### D4 · 插件在**构建期**进入 pane 文档,不经运行时跨 realm

**决策**:贡献插件的 source 拥有自己的 pane 文档构建,插件源码与画布组件一起打包;
在 pane 内用既有的 `registerPluginBundles` 注册。`canvasPlugins` 作为**宿主 realm 声明键**
的用途随之终结。

**理由**:见 `research.md` I3 —— pane 文档已是自足 IIFE,React 就在里面跑。「运行时 resolve
车道无法承载组件」这条既有约束针对的是**运行时车道**,与构建期打包无关。

**推论**:两个用到画布的 source 会各需一份构建。故把该构建抽成**可复用函数**(见 D5)。

### D5 · pane 文档构建抽成可复用函数

**决策**:把「画布组件 + 自选插件集 → 自足 IIFE + 内联 CSS → 带 CSP 的 HTML」抽成一个构建
函数,两个 source 各自调用并传入自己的插件集。

**理由**:否则是两份 CSP、两份样式内容配置的可预见漂移源。

### D6 · 删除以「零声明者」为机械前置判据,且守卫长期驻留

**决策**:删除动作的前置条件是一条**可执行的核验**(全仓无该槽键的声明与引用),而非人工确认;
删除后该核验作为常驻守卫保留。

**理由**:Requirement 1.4/1.5、7.3/7.4 直接要求。人工通读在 19 个槽键与 40+ 示例的规模下不可靠。

## File Structure Plan

### 新建

| 路径 | 职责 |
|------|------|
| `packages/panes-kit/src/state-binding.ts` | 共享状态的宿主侧绑定(读/订阅/推送/重绑),与 `bindSurface` 同构 |
| `packages/panes-kit/test/state-binding.test.ts` | 绑定与**重绑**语义的单测(含 D2 的换身份用例) |
| `packages/panes-kit/test/state-authorization.test.ts` | 读/写授权分离、越权拒绝、键不在授权内的拒绝 |
| `packages/ui/src/chat/host-signals.ts` | 宿主环境信号族的计算(主题、对话流焦点),**领域中立** |
| `packages/ui/test/chat/host-signals.test.tsx` | 信号族单测(含连点两次的去重规避) |
| `packages/canvas-ui/src/build-canvas-pane.ts`(或 canvas-kit) | D5 的可复用 pane 文档构建函数 |
| `examples/canvas-plugin-stickers/build.ts` | 该 source 的 pane 文档构建(调用 D5,传入贴纸插件集) |
| `examples/canvas-plugin-stickers/web/panes/canvas.tsx` | 该 source 的 pane 入口 |
| `scripts/check-no-panel-right.ts` | D6 的机械核验(零声明者守卫) |
| `test/guards/no-panel-right.test.ts` | 把该核验接入测试面,使其常驻 |

### 修改

| 路径 | 改动 |
|------|------|
| `packages/panes-kit/src/contract.ts` | 请求判别式增写回 operation;能力结构增读/写键表 |
| `packages/panes-kit/src/authorization.ts` | 增共享状态的授权判定(读写分离) |
| `packages/panes-kit/src/guest.ts` | guest SDK 增 `state` 门面(get/subscribe/set/delete) |
| `packages/panes-kit/src/react/panes-host.tsx` | 接入 `bindState` + 写回请求处理 |
| `packages/ui/src/chat/pi-chat.tsx` | 删旧槽分派与废弃诊断;注入宿主信号族;去掉双路径判据 |
| `components/chat-app.tsx` | 同步删除旧槽判据分支 |
| `packages/web-kit/src/{slots,define-web-extension}.ts` | **删** `panelRight`;终结 `canvasPlugins` 的宿主 realm 用途 |
| `packages/protocol/src/web-ext/{config,descriptor}.ts`、`plugin/plugin-manifest.ts` | **删** `panelRight` |
| `examples/aigc-canvas-agent/web/web.config.tsx` + `build.ts` | 迁声明键;包装层的两处逻辑分别下沉/内置化;构建改调 D5 |
| `examples/canvas-plugin-stickers/.pi/web/web.config.tsx` | 迁声明键 + 插件改构建期 |
| `examples/aigc-canvas-nosurface-agent/`、`surface-demo-agent/`、`state-bridge-agent/` | 各自重写为 pane |
| `examples/webext-{layout,slots,runtime-code,slots-runtime*}-agent/` | 夹具改挂其余保留槽 |
| `packages/ui/test/chat/host-panes-{gating,dispatch}.test.tsx` | 删让位与废弃诊断相关断言(D6 后成死断言) |
| `e2e/browser/*.e2e.ts` | 受影响断言等价改写 |

## Requirements Traceability

| 需求 | 由什么承载 |
|------|-----------|
| 1.1–1.3 | 装载点删除旧分派(`pi-chat.tsx`/`chat-app.tsx`);内置 pane 无条件渲染 |
| 1.4–1.5 | D6 的机械核验 + 常驻守卫 |
| 2.1–2.4 | D1 契约 + D2 绑定语义(`state-binding.ts`) |
| 2.5–2.8 | `authorization.ts` 的读写分离判定,复用既有超限与拒绝语义 |
| 3.1–3.6 | D3 的宿主信号族(`host-signals.ts`) |
| 4.1–4.5 | D4 构建期插件 + D5 可复用构建 |
| 5.1–5.6 | 各迁移任务逐条列「原断言 → 新断言」;跨边界行为独立断言 |
| 6.1–6.4 | 夹具改挂其余保留槽;签名校验用例不动 |
| 7.1–7.2 | 过渡期诊断沿用现有实现,删除时一并移除 |
| 7.3–7.5 | D6 前置判据 + 收尾一次性核验 |

## Error Handling

沿用 `panes-kit` 既有结构化错误,**不另立一套**:未授权 → `CAPABILITY_DENIED`;
超限 → `PAYLOAD_TOO_LARGE`。共享状态的键越权拒绝**不泄露该键是否存在**(Requirement 2.6)——
即"未授权"与"键不存在"返回同一载荷。

## Testing Strategy

### 单元

- **共享状态绑定**:逐键推送;订阅到变化;**访问器换身份后整组重绑并立即重推**(D2,必须有);
  未授权键不推送。
- **共享状态授权**:读授权不蕴含写授权;越权读/写各自被拒;拒绝载荷与既有未授权操作一致;
  键不在授权内与键不存在返回同一载荷。
- **宿主信号族**:主题切换传播;焦点事件**连点同一目标两次**都触达(D3 陷阱);
  信号名不含领域词汇。
- **零声明者守卫**:核验能在人为植入一处声明时报红(判别力自证)。

### 集成 / 组件

- 装载点只剩单路径:任何扩展形态下都渲染 pane 宿主,不存在让位分支。
- 插件在 pane 内注册并生效;单个插件不合法时其余仍可用。

### 端到端

- 每个被迁移示例的既有 e2e **逐条**验证等价:载体可改,原断言守护的行为必须仍被守护。
- **跨边界行为独立断言**:轮末自动同步(既有前科)、人机共驾写回闭环(点面板 → agent 读到新值)。
- 全量浏览器验收;存量红(`attachment-tool-bridge`×1 + `desktop-cloud-login`×5)单列,
  不计入本特性,也不作为放宽依据。

### 判别力纪律

每条「不应出现」类断言必须先证明其判别力(篡改实现,确认对应用例报红)。删除类改动尤其危险:
「正确地没有了」与「守卫根本没装上」在观察上同形。

## Migration Strategy

分五段推进,每段有独立可验证的完成态,且**顺序不可换**:

1. **补能力**(共享状态通道 + 宿主信号族 + 可复用构建函数)—— 无此不能迁 B 类。
2. **迁低成本者**(静态面板夹具改挂其余槽、`surface-demo`)—— 纯 UI/配置,先拿掉一批。
3. **迁 `state-bridge`** —— 第一个真正消费新通道的,也是它的活体验证。
4. **迁 canvas 系三者** —— 包装层两处逻辑分别下沉/内置化;插件转构建期。
5. **删除与收尾** —— 零声明者核验通过后删类型,清死断言,常驻守卫,全量回归。
