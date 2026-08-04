# Requirements Document

## Project Description (Input)

### 谁有问题

**独立仓 agent source 的作者**——即 agent 源码不在 pi-web 仓库 `examples/` 之内，而是自成一个 git 仓库（如 `agents/pi-agents/aigc-agent`）、并贡献 webext / pane 界面的开发者。次要受影响方是**发布带 webext 的 agent 的人**：`publish` 在产物缺失时会拒绝发布，却给不出一条可执行的构建路径。

### 现状

pi-web 没有官方的 agent 构建命令。每个贡献界面的 agent 各自携带一份 `build.ts`，自行调用构建工具链与 `@blksails/pi-web-kit/build`，把 `.pi/web` 打成 `.pi/web/dist`。这套做法在 agent 位于 pi-web 仓库内时能跑，一旦搬出仓库就断裂——2026-08-04 在 `aigc-agent` 上实测到三处断点：

1. **反向相对路径断裂**：`aigc-agent/build.ts:23` 写的是
   `import { piWebPreset } from "../../packages/ui/tailwind-preset.js"`，
   这是它还在 `pi-web/examples/aigc-agent/` 时的路径；搬到独立仓后指向一个不存在的目录（实测 `ls ../../packages` → No such file）。
2. **该资源没有包出口可替代**：`packages/ui/package.json` 的 `exports` 只有 `"."` 与 `"./styles.css"`，**未导出 `tailwind-preset`**——虽然 `files` 已把它打进发布包（`packages/ui/package.json:88`），却没有 subpath 出口可寻址。另一个消费者 `packages/canvas-ui/build/pane-document.ts:49-51` 同样绕过出口，靠调用方传 `repoRoot` 拼物理路径。
3. **构建工具链未声明也不该声明**：`build.ts` 需要构建器、样式管线与 `@blksails/pi-web-kit/build`，这些都不在 agent 的 `dependencies` 里。实测执行报 `Cannot find module 'esbuild'`。要跑通就得让每个 agent 各自复制一份宿主的构建依赖与版本，属于宿主实现细节的外泄。

后果不止是"跑不起来"，还有**沉默的契约漂移**：`.pi/web/dist` 作为预构建产物被提交进 agent 仓库，一旦无法重建，它就会长期停留在某个历史版本的结构上。实测已发生——agent 产物导出的是
`ext.panes = { definition: {...}, config: {...} }`（两层包装），
而宿主按扁平 definition 读：`packages/ui/src/chat/pi-chat.tsx:627` 取 `extension.panes.panes`、`packages/panes-kit/src/merge.ts:98` 迭代 `source.definition.panes`。结果是外部 agent 的 webext 一加载就白屏，报
`Cannot read properties of undefined (reading 'some')` 与 `source.definition.panes is not iterable`。

同时 `server/cli/index.ts:601` 的 publish 失败提示当前引导用户执行 `pnpm --filter <该包> build`——这条指令对独立仓 agent 不成立。

### 应该改变什么

pi-web CLI 增加 **`pi-web build`** 子命令，在 agent source 目录内构建 webext / pane 产物到 `.pi/web/dist`，**构建工具链由宿主提供**：agent 不必自带构建脚本、不必声明构建依赖、不必反向引用 pi-web 仓库内部文件；产物可随时按当前宿主版本重建，使结构契约漂移能被及时发现而非沉默积累。

### 关键定位：本特性是一笔未兑现完的旧账，不是新造语义

调研发现 `pi-web build` **已经是既有 spec 承诺过的具名工具**：

- `agent-web-extension/requirements.md:120` —— Requirement 9 标题即「`@blksails/pi-web-kit` 包与 `pi-web build` 工具」；
- 同 spec Requirement 8 全部 6 条 CSS scoping 条款的主语都是「the `pi-web build` 工具」；
- `agent-web-extension/tasks.md:56` —— `[x] 2.2 实现 pi-web build 编排与 externals 强制`；
- 后续三个 spec 均把它当既存能力引用并声明「不重做」：`webext-package-install/requirements.md:23`、`cli-component-add/requirements.md:28`、`plugin-system-unification/requirements.md:284`（后者依赖 `pi-web build --sign`）。

但它实际落成的只是 `packages/web-kit/build/cli.ts`——一个仅接 `--id/--api/--dir/--out/--sign` 的薄 CLI，且 `packages/web-kit/package.json:13` 声明了 `bin: {"pi-web": "./build/cli.ts"}`，**与主 CLI `bin/pi-web.mjs` 同名**；而 `cli-package-commands/design.md:322` 的 `SubcommandName` 联合中从无 `build`。

因此本特性的准确定位是：**把已承诺、但只以库与旁路 bin 形式存在的命令面收敛进主 CLI，并扩展到覆盖 pane 构建的全流程**。

## Boundary Context

- **In scope**：`pi-web build` 子命令的命令面与行为；webext 产物、pane 文档产物、pane URL 形态产物、pane 静态清单、隔离形态产物与统一分派入口的构建；为表达隔离入口所需的 manifest 结构扩展；agent 侧 pane 声明的发现约定；产物目录的版本控制约定；pi-web 仓库内既有示例 agent 从自带构建脚本迁出。

- **Out of scope**：
  - **宿主消费侧读取 pane 声明的代码修复**（`pi-chat.tsx:627`）。
    > ⚠ **本条的理由已被真机证伪，结论不变但依据须改写**（2026-08-04，见 `gaps.md` G11）。
    > 原写：「两层包装是外部 agent 陈旧产物的单方面漂移，产物按当前版本重建后即自然消解」。
    > 实测：用 `pi-web build` 完整重建 aigc-agent 后，产物导出的**仍是** `panes: { definition, config }`
    > —— 那是 agent 的 `.pi/web/web.config.tsx` 本来就这么写的，与产物新旧无关。
    > 且宿主内部两处消费方**自己就不一致**：`panes-kit/merge.ts:98` 读 `source.definition.panes`
    > （与 agent 产物**吻合**），而 `pi-chat.tsx:627` 读 `extension.panes.panes`（期望扁平）。
    > 因此这是**宿主消费侧的 bug**，不会随重建消解，必须另立 spec 修 `pi-chat.tsx:627`。
    > 本 spec 仍不承担该修复（边界不变），但不得再宣称「重建即可解决」。
  - webext 签名的信任链与验签策略（属 `webext-package-install`）。
  - 产物的安装与分发（属 `webext-package-install` 的 `pi install` 复用）。
  - 发布流程本身（属 `publish-agent-entry-and-bundle`）。

- **Adjacent expectations**：
  - 发布流程**不自动执行构建**，且在产物缺失时终止并给出应执行的构建命令——本特性提供的正是那条命令，使 `publish-agent-entry-and-bundle` 的 R3.3 得以兑现，而非推翻其 R3.4。
  - `agent-web-extension` Requirement 8（CSS scoping）与 R9.3（externals 强制、manifest 与 SRI）所定义的产物纪律，由本命令继续履行，本特性不放宽其中任何一条。
  - `--sign` 选项的语义被 `plugin-system-unification` 依赖，须原样保留。

## Requirements

### Requirement 1: 统一的构建命令面

**Objective:** 作为 agent 作者，我想用一条随 pi-web 分发的官方命令构建产物，以便不必自带构建脚本，也不必判断该调用哪个可执行入口。

#### Acceptance Criteria

1. The pi-web CLI shall 提供 `build` 子命令，并在 `pi-web --help` 的子命令列表中列出它及其一句话说明。
2. When 用户执行 `pi-web build --help`, the pi-web CLI shall 输出该子命令的完整选项说明，并以退出码 0 结束。
3. When 用户在一个 agent source 根目录内执行 `pi-web build` 且未提供位置参数, the 构建命令 shall 以当前工作目录为 agent source 根进行构建。
4. If 用户传入该子命令不接受的选项或参数, then the 构建命令 shall 以非零退出码结束，且不产生任何文件系统或网络副作用。
5. The 构建命令 shall 保留 `--sign` 选项及其既有签名语义，使既有依赖该选项的流程不受影响。
6. The pi-web 工具链 shall 只对外暴露一个名为 `pi-web` 的可执行入口，消除同名入口指向不同实现的歧义。
7. When 用户在任意安装形态下调用该子命令, the 构建命令 shall 可被正常解析与执行，不依赖工具自身源码树的相对位置。

### Requirement 2: 构建产物的完整覆盖

**Objective:** 作为 agent 作者，我想让一条命令产出运行与发布所需的全部产物，以便 agent 侧不再保留任何构建编排代码。

#### Acceptance Criteria

1. When 构建命令在一个含 web 扩展源的 agent source 上运行, the 构建命令 shall 产出该 source 的 web 扩展入口产物、样式产物与 manifest。
2. When agent source 声明了 pane, the 构建命令 shall 为每个 pane 同时产出内联文档形态与可独立寻址的 URL 形态两种产物。
3. When agent source 声明了 pane, the 构建命令 shall 产出一份描述全部 pane 能力与面板配置的静态清单产物，使宿主无需加载扩展代码即可发现 pane 能力。
4. Where agent source 需要在隔离宿主中运行, the 构建命令 shall 产出自包含入口产物，并产出可在运行时判别宿主形态、分派到对应入口的统一入口产物。
5. When 统一入口产物的字节被改写, the 构建命令 shall 同步更新 manifest 中该入口的完整性校验值，使校验值与最终字节一致。
6. The web 扩展 manifest 结构 shall 能同时表达同源入口与隔离入口，使二者的分派关系可被静态发现，而不依赖运行时探测约定。
7. The 构建命令 shall 继续强制既有的 externals 纪律与样式作用域隔离规则，不因新增 pane 构建能力而放宽。

### Requirement 3: agent 侧的最小声明

**Objective:** 作为 agent 作者，我想只声明业务事实（有哪些 pane、面板怎么排、pane 有什么能力），其余交给构建命令，以便声明不随宿主实现变化而返工。

#### Acceptance Criteria

1. When 构建命令运行, the 构建命令 shall 按约定发现 agent source 中声明的 pane 模块，不要求 agent source 提供构建脚本或构建入口函数。
2. The 构建命令 shall 允许 agent 以源码模块形式声明 pane 清单、面板配置与 pane 能力，使同一份声明同时被构建期与运行期消费，不产生第二份声明源。
3. If 约定位置上不存在任何 pane 声明, then the 构建命令 shall 仅构建 web 扩展产物并正常结束，不因缺少 pane 声明而失败。
4. If pane 声明存在但结构不合法, then the 构建命令 shall 终止构建，并指出不合法的声明位置与具体原因。
5. The 构建命令 shall 校验 pane 声明产出的结构符合宿主消费所需的形态，使形态不匹配在构建期暴露，而不是留到宿主运行期才以界面崩溃的形式出现。
6. Where 某个 agent 的构建需求无法由约定表达, the 构建命令 shall 允许该 agent 以显式选项补充，而不必回退到自带构建脚本。

### Requirement 4: 仓库外 agent source 的可用性

**Objective:** 作为独立仓 agent 作者，我想在自己的仓库里直接构建，以便不必把 agent 放回 pi-web 仓库内，也不必复制宿主的构建依赖。

#### Acceptance Criteria

1. When 构建命令在 pi-web 仓库之外的 agent source 上运行, the 构建命令 shall 正常完成，不要求该 source 位于 pi-web 仓库内，也不要求与之保持任何相对路径关系。
2. The 构建命令 shall 由 pi-web 侧提供构建所需的全部工具链与样式预设，不要求 agent source 声明这些依赖。
3. When agent source 与 pi-web 各自安装了同一前端运行时库的副本, the 构建命令 shall 使每个 pane 产物只包含该库的单一副本。
4. If 构建所需的工具链在当前安装形态下不可用, then the 构建命令 shall 终止并说明缺失项，而不产出不完整的产物。
5. The 构建命令 shall 使 agent source 无需引用 pi-web 仓库内部未经包出口暴露的文件。

### Requirement 5: 产物生命周期与新鲜度

**Objective:** 作为 agent 作者与维护者，我想让产物永远可由当前宿主版本重建，以便结构契约漂移无处积累。

#### Acceptance Criteria

1. The 构建命令 shall 把全部产物写入 agent source 的约定产物目录。
2. The agent source 的版本控制约定 shall 将构建产物与构建中间产物一并排除在版本库之外。
3. When 构建命令重新运行, the 构建命令 shall 以当前 pi-web 版本的产物覆盖既有产物。
4. If 产物目录中存在仅由更早版本产出的文件, then 重新构建 shall 使产物目录与当前版本一致，不残留过时文件。
5. Where 消费方需要产物而产物不存在, the 消费方 shall 终止并提示执行本构建命令，而不自动执行构建。
6. When 产物早于其源文件, the 消费方 shall 输出陈旧产物提示，且该提示 shall 指向本构建命令。

### Requirement 6: 既有 agent 的迁移

**Objective:** 作为 pi-web 维护者，我想让仓内示例与独立仓 agent 走同一条构建路径，以便样板不再逐份复制、离群实现不再沉淀。

#### Acceptance Criteria

1. When 迁移完成, the pi-web 仓库内的示例 agent shall 不再各自携带构建脚本，改由本构建命令构建。
2. The 构建命令 shall 使迁移后的示例产出与迁移前等价的产物集合。
3. When 迁移完成, the pi-web 仓库的构建流水线 shall 经由本构建命令构建示例，不再静态引用各示例的构建入口函数。
4. Where 既有实现中存在与通用能力重复的实现, the 迁移 shall 使其收敛到单一实现，不保留逐字同策的副本。

### Requirement 7: 错误与诊断

**Objective:** 作为 agent 作者，我想在构建失败时立刻知道该改什么，以便不必逐层翻查产物或宿主运行期日志。

#### Acceptance Criteria

1. If agent source 根下不存在可识别的 web 扩展源, then the 构建命令 shall 以明确错误结束，并说明期望的源位置。
2. When 构建失败, the 构建命令 shall 经统一的进度与错误呈现通道输出可操作信息，并以非零退出码结束。
3. If 输出中包含敏感值, then the 构建命令 shall 对其脱敏后再呈现。
4. When 构建成功, the 构建命令 shall 输出产出文件清单与关键完整性校验值。
5. When 发布流程因产物缺失而终止, the 发布流程 shall 在错误信息中给出本构建命令作为应执行的构建指令。
