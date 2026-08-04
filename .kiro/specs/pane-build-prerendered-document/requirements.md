# Requirements Document

## Introduction

`pi-web build` 的 pane 声明只能表达**一种** pane：给出模块入口，由构建器打包成脚本再包进
HTML 文档。但现实中存在第二种形态——**已经写好的完整 HTML 文档**（无需打包，通常也不含
React，只做变量替换后原样写出）。这类 pane 用现行声明无从表达，于是在迁移到 `pi-web build`
的 agent 上被静默丢弃：产物目录里可能还留着上一次自建脚本写出的 HTML 文件，但 `panes.json`
不声明它，宿主便看不见这个 pane。

实证（`aigc-agent`，真机）：

```
panes.json 声明:      canvas, materials, search        ← 3 个
dist 里的 pane 文档:   pane-canvas / pane-materials / pane-search / pane-logs   ← 4 个
```

`pane-logs.html` 在产物里，但不在声明里，宿主遂不渲染该 pane。该 agent 的构建入口已从自建
`build.ts` 换成 `pi-web build --panes panes/panes-declaration.ts`，而 `build.ts` 里对 logs
pane 的处理（引用一段预写 HTML 常量、做变量替换后写出）在新声明里没有对应表达。

本特性给 pane 声明补上这第二种形态，使 `pi-web build` 能完整取代自建构建脚本。

## Boundary Context

- **In scope**
  - pane 声明中「预渲染 HTML 文档」这一形态的表达方式。
  - 构建器对该形态的处理：产出可寻址文档、纳入 `panes.json` 声明、纳入内联文档映射。
  - 两种形态在同一份声明中并存时的行为。
  - 声明非法（两种形态都给、或都不给）时的诊断。

- **Out of scope**
  - 既有「模块入口」形态的打包行为、CSS 解析、脚本命名：一律不动。
  - 运行期 pane 契约（`PaneDefinitionInput` / `PaneDocument` 的形状）：本特性只增加**构建期**
    的输入形态，不改变产物被消费的方式。
  - 预渲染 HTML 的内容生成：agent 自己负责产出该字符串（含其中的变量替换），构建器不解释它。
  - `aigc-agent` 仓自身的声明改写：那是消费方的事，本 spec 只提供能力。

- **Adjacent expectations**
  - 依赖既有的 `panes.json` sidecar 与内联文档映射机制，不新增产物类别。
  - 依赖既有的 pane id / title / capabilities 字段语义，不重新定义。

## Requirements

### Requirement 1: 预渲染 HTML pane 可被声明与构建

**Objective:** As a agent 作者, I want 把一段已经写好的 HTML 直接声明成 pane, so that 不需要为它编造一个模块入口，也不必为此保留一套自建构建脚本

#### Acceptance Criteria

1. When 声明中的某个 pane 给出预渲染 HTML 文档而非模块入口，the 构建器 shall 接受该声明并为其产出 pane。
2. When 构建预渲染 HTML pane，the 构建器 shall 不对其执行脚本打包。
3. The 构建器 shall 使预渲染 HTML pane 与模块入口 pane 在产物中**同等可寻址**（产出同样命名规则的文档文件）。
4. The 构建器 shall 把预渲染 HTML pane 一并写入 pane 集合声明，使宿主能够发现它。
5. The 构建器 shall 把预渲染 HTML pane 一并纳入内联文档映射，使依赖内联形态的消费方同样可用。

### Requirement 2: 两种形态并存且互斥

**Objective:** As a agent 作者, I want 在同一份声明里混用两种 pane, so that 我不必为了一个特殊 pane 把整套 pane 都改成另一种写法

#### Acceptance Criteria

1. When 同一份声明中同时存在模块入口 pane 与预渲染 HTML pane，the 构建器 shall 全部构建成功。
2. The 构建器 shall 保持产物顺序与声明顺序一致，不因形态不同而重排。
3. If 某个 pane 既给出模块入口又给出预渲染文档，the 构建器 shall 拒绝该声明并指出是哪个 pane。
4. If 某个 pane 两者都未给出，the 构建器 shall 拒绝该声明并指出是哪个 pane。
5. When 拒绝非法声明，the 构建器 shall 以可定位的诊断信息说明原因，不得静默跳过该 pane。

### Requirement 3: 既有行为不得回退

**Objective:** As a 维护者, I want 新增形态不影响任何既有 agent, so that 这次扩展不会让已经在用的构建流程出问题

#### Acceptance Criteria

1. When 声明中只有模块入口 pane，the 构建器 shall 产出与本特性引入前**逐字节相同**的结果。
2. The 构建器 shall 不改变模块入口 pane 的脚本打包、CSS 解析与文件命名。
3. The 构建器 shall 不改变 `panes.json` 与内联文档映射的结构。
4. When 既有 agent 未做任何声明改动而重新构建，the 构建器 shall 不产生新的告警或错误。

### Requirement 4: 静默丢失必须变为显式失败

**Objective:** As a agent 作者, I want 声明表达不了的东西当场报错, so that 不会像现在这样构建成功、产物却少了一个 pane 而无人察觉

#### Acceptance Criteria

1. If 声明中出现构建器无法处理的 pane 形态，the 构建器 shall 使构建失败，而非产出不完整的 pane 集合。
2. The 构建器 shall 使失败信息包含出问题的 pane 标识与声明来源位置。
3. When 构建成功，the 构建器 shall 使 pane 集合声明中的条目数与声明中的 pane 数**相等**。

### Requirement 5: 验收须覆盖「丢失」这一原始症状

**Objective:** As a 维护者, I want 验收证据直接针对本缺陷的表现形式, so that 不会只测了新形态能构建、却没测它真的进了声明

#### Acceptance Criteria

1. The 验收证据 shall 证明预渲染 HTML pane 出现在构建产出的 pane 集合声明中。
2. The 验收证据 shall 证明两种形态混合声明时，产出的 pane 数与声明数相等。
3. The 验收证据 shall 覆盖真实 agent（当前受影响者）重新构建后 pane 不再缺失。
4. If 某项验收仅以构造夹具完成，the 验收证据 shall 另有一条针对真实 agent 的观测，不得以夹具通过充当真实场景的证明。
