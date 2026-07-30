# Brief: panes-only-right-panel

> 本 brief 由 `host-builtin-panes` 收口时的实地勘察产出(2026-07-30),不是 `/kiro discovery`
> 的输出。所有「Current State」条目均为**实测**,非推断;来源标注在各条内。

## Problem

右侧面板现在有**两套互不相通的机制**:

1. `slots.panelRight` —— agent 交一个**宿主 realm 的 React 节点**,宿主直接渲染;
2. pane 声明键 —— agent 交一份**可枚举的 pane 定义**,宿主实例化 `PanesHost`,每个 pane 跑在
   独立的 opaque-origin iframe 里。

两套并存的代价不是「代码重复」,而是**能力面分叉**:

- 旧槽拿得到宿主 realm 的一切(React context、`surfaceAccess` 对象图、共享状态 KV、
  已装载扩展描述符),pane 只拿得到协议明确搬运的那几样。于是「同一件事在旧槽能做、
  在 pane 做不了」成为常态,而这**不是刻意的权限设计**,只是历史顺序。
- `host-builtin-panes` 的 design D3 因此被迫规定:声明了旧槽的 agent,宿主内置 panes
  **整体让位**。也就是说只要还有一个 agent 用旧槽,内置 pane 在那个 agent 下就永远不存在 ——
  这与「内置 pane 对所有 agent 可用」的目标直接冲突。
- 旧槽是**同 realm**,第三方 agent 的面板代码与宿主同权。pane 的隔离边界是本项目已经付出
  成本建起来的(`isolated-panes`),旧槽在旁边留了一个绕过它的口子。

用户已决策:**废弃 `slots.panelRight`,把右侧面板收敛为唯一的 pane 机制,最终从
`web-kit`/`protocol` 删除该类型。**

## Current State

### 声明者盘点(实测 `grep -rln "panelRight" examples/`,9 个)

| 类 | source | 现状 | 迁移成本 |
|---|---|---|---|
| **A** | `aigc-canvas-agent` | `panelRight: ConfiguredPanesHost` —— **已经是 PanesHost**,自己实例化 | 中(见下,不是纯包装) |
| **B** | `aigc-canvas-nosurface-agent` | `CanvasPanel as never`(宿主 realm React) | 高 |
| **B** | `canvas-plugin-stickers` | `CanvasPanel as never` + `canvasPlugins`(含 React 组件) | **最高**,见下 |
| **B** | `state-bridge-agent` | `CountPanel`,经共享状态 KV 双向读写 | 高,**且有协议缺口** |
| **B** | `surface-demo-agent` | `SurfaceDemoPanel`,读 domain 快照 + 触发命令 | 中高 |
| **C** | `webext-layout-agent` | 静态 `<InfoPanel />` | 低 |
| **C** | `webext-slots-agent` | `<Slot id="panel-right" />` | 低,但**它就是槽车道的测试夹具** |
| **C** | `webext-runtime-code-agent` | `<RuntimeCodePanel />` | 低,运行时代码车道夹具 |
| **C** | `webext-slots-runtime-{,badsig-,tampered-}agent` | 同上,签名校验夹具 ×3 | 低,**与 pane 无关** |

### ★ 根本阻碍:两者之间没有机械转换

`panelRight` 收的是宿主 realm 的 React 节点;pane 是 opaque-origin iframe。凡是伸手进宿主
realm 的东西(React context / `surfaceAccess` 对象图 / canvas 插件的 `Render`/`Inspector`
组件)都必须改写成**经 MessageChannel + 显式授权说话的 guest**。这不是重命名一个键。

### ★ `aigc-canvas` 的包装层不是纯包装(这才是 `host-builtin-panes` 任务 5.1「刻意不动 canvas」的真因)

`examples/aigc-canvas-agent/web/web.config.tsx` 的 `ConfiguredPanesHost` 带两处宿主 realm 逻辑:

1. **`useHostSignals()`** 算 `theme:dark` 与 `canvas:focus`。后者靠在宿主 `document.body` 上挂
   点击监听,实现「点对话流里的图 → 画廊聚焦」。
2. **轮末 auto-sync 跨 realm 补齐** —— 文件注释写得很直白:`syncSignal` 不在 pane 协议里,
   故宿主侧包装层代跑 `surface.run("canvas","sync")`。这条线断了的表现是「LLM 生了图,
   画廊不更新」,有前科。

**已查证的出路(都比现状更对)**:

- `theme:dark` → 宿主本就知道主题,应成为**内置宿主信号**(与已接好的 `host:syncSignal`、
  `host:livePreviewImage` 同族),而非每个 agent 自己算;
- auto-sync → **guest 本来就能跑 surface 命令**(`packages/panes-kit/src/guest.ts:122` 的
  `surface.run` + `surfaceCommands` 授权),且 `host:syncSignal` 已在 `host-builtin-panes`
  任务 4.2 推进 pane ⇒ 这段该**下沉进 canvas guest 自己**,宿主包装层随之消失;
- `canvas:focus` 是唯一真赖在宿主 realm 的 —— 点的是**对话流**里的图,不在 pane 里。
  它不属于「右侧面板」这个语义,须单独定去向。

### ★ 两处协议缺口(已登记在 `packages/ui/test/chat/host-panes-dispatch.test.tsx` 的注入登记表)

pane 协议今天只有 `pane:surface`(agent 权威快照)/ `pane:signal`(宿主具名值,单向)/
`pane:event`(pane 间事件)。缺:

- **共享状态 KV**(旧槽的 `state` 注入项,即 `createWebExtStateAccess` 产物)——
  **`state-bridge-agent` 的 panelRight 正是靠它**,是那个示例迁移的前置条件。
  `pane:signal` 不能替代:它是单向、last-value、无写回。
- **`extensions` 数组**(已装载扩展描述符)—— 宿主 realm 对象图,跨 realm 需先定义
  可序列化投影。

### ★ canvas 插件车道是宿主 realm React,不能直接进 iframe

`lib/app/webext-registry.ts` 的注释已写明:`canvasPlugins` 含 React 组件(`Render`/
`Inspector`),**必须走构建期静态 import 车道,运行时 resolve 车道无法承载组件**。
把 canvas 做成 pane 意味着插件也要跨进 iframe —— 需要一条**guest 侧插件车道**
(插件产物如何进 iframe、如何注册图层/工具/Inspector、如何与宿主的插件枚举对齐)。
这本身的体量接近一个独立 spec,是本波最大的单点。

### C 类夹具的特殊性

`webext-slots-agent` 等 5 个是**槽车道自身的测试夹具**,`-badsig-`/`-tampered-` 守的是
**运行时代码 webext 的签名校验**,与 pane 毫无关系。把它们「迁到 pane」是范畴错误 ——
真正的问题是:槽机制整体废弃后,这些夹具守护的东西(12 个协议保留插槽、签名校验)
该由什么承载。**注意 `panelRight` 只是 12 个槽之一**,本 spec 不废其余 11 个槽。

### 类型删除的前置条件

`packages/web-kit/src/slots.ts`、`packages/protocol/src/web-ext/{config,descriptor}.ts`、
`packages/protocol/src/plugin/plugin-manifest.ts` 都带 `panelRight`。夹具还在用时删类型 =
红构建。**删除必须是最后一步,且以「零声明者」为可机械验证的前置判据。**

## Desired Outcome

- 右侧面板只有一种机制:agent 交 pane 定义,宿主实例化 `PanesHost`。
- `slots.panelRight` 从 `web-kit`/`protocol` **删除**,且有机械判据证明零残留。
- `host-builtin-panes` 的 D3「旧槽让位」规则随之作废 —— 内置 pane 对**所有** agent 可用,
  不再有例外形态。
- 迁移后的示例**行为不回退**:每个被重写的示例,其既有 e2e 断言的**语义**必须仍被守住
  (载体可换,保护面不可缩)。
- 补齐的协议通道(共享状态 KV 等)是**通用能力**,不是为某个示例开的后门。

## Approach

分层推进,每层有独立可验证的完成态:

1. **补协议缺口** —— 共享状态 KV 的跨 realm 通道(双向、有写回语义);`theme` 等宿主信号
   内置化。这是 B 类迁移的前置,先做完才谈得上迁。
2. **建 guest 侧 canvas 插件车道** —— 本波最大单点,建议**独立成阶段**并先于 canvas 系
   三个示例的迁移。
3. **逐个重写声明者** —— 按成本从低到高(C 类静态面板 → surface-demo → state-bridge →
   canvas 系),每个迁完立即跑其既有 e2e。
4. **处置槽车道夹具** —— 明确 12 个保留槽中其余 11 个的去留边界,以及签名校验夹具的新载体。
5. **删类型 + 机械判据** —— 零声明者后删除,并留一条「`panelRight` 字面量零命中」的守卫。

## Scope

- **In**:9 个声明者的重写;guest 侧 canvas 插件车道;共享状态 KV 跨 realm 通道;
  宿主信号内置化(theme 等);`canvas:focus` 的去向决策;槽车道夹具的处置;
  `panelRight` 类型删除与零残留守卫;`host-builtin-panes` D3 规则的作废与相应测试清理。
- **Out**:其余 11 个协议保留槽的废弃(本 spec 只废 `panelRight`);
  pane 的宿主文件系统能力(→ `pane-host-capabilities`);新增内置 pane(→ `builtin-pane-suite`);
  pane 隔离模型本身的修改(→ `isolated-panes`)。

## Boundary Candidates

- **共享状态 KV 跨 realm 通道**(协议 + 授权 + guest SDK,纯契约面可穷举测试)
- **guest 侧 canvas 插件车道**(插件产物打包、注册、与宿主枚举对齐)
- **逐示例重写**(彼此独立,天然可并发 —— 各自 `_Boundary:_` 不相交)
- **类型删除与零残留守卫**(必须最后,依赖前面全部完成)

## Out of Boundary

- pane 内部 UI 的美化与功能增强(迁移是等价改写,不是重设计)
- 其余 11 个保留槽
- agent 侧能力(pi SDK 领域)

## Upstream / Downstream

- **Upstream**:`host-builtin-panes`(已完成 18/18,提供合并原语、声明键、宿主装载与
  `host:` 信号)、`isolated-panes`(pane 隔离与授权模型)
- **Downstream**:`builtin-pane-suite` / `builtin-pane-browser`(它们新增的内置 pane 将不再
  受「旧槽让位」影响)

## Existing Spec Touchpoints

- **Supersedes**:`host-builtin-panes` design D3(旧槽让位)—— 本 spec 完成后该规则作废,
  其 6.1 的「旧槽形态不回退」describe 块与 6.2 的废弃诊断断言应一并移除
- **Extends**:`isolated-panes`(共享状态通道接在其协议与授权模型上)
- **Adjacent**:`canvas-plugins-m3`(插件车道的既有形态)、`state-injection-bridge`
  (共享状态 KV 的既有语义)、`agent-web-extension`(12 个保留槽的契约来源)

## Constraints

- **迁移是等价改写**:每个示例迁完,其既有 e2e 断言的语义必须仍被守住。载体可换
  (`page.locator` → `frameLocator`),**保护面不可缩** —— 删断言换绿是本 spec 最需要防的事。
- **补的通道必须是通用能力**,不得为某个示例开专用后门;新通道一律走既有 grant 模型,
  默认拒绝。
- **类型删除以「零声明者」为机械前置判据**,不靠人工确认。
- ★ 已知的两类假绿在本波都会出现,须显式防:
  - 「删断言换绿」—— 迁移中最容易发生;
  - 「跨 realm 后行为悄悄降级」(如 auto-sync 断链表现为「只是没刷新」)——
    这类必须有独立的跨边界断言,不能只数元素个数。
- 存量红基线:`attachment-tool-bridge` ×1 + `desktop-cloud-login` ×5 为**已实测的存量失败**
  (基线 `efa3bd9e` 同样红),本波不得把它们算作自己的回归,也不得因它们放宽验收。
