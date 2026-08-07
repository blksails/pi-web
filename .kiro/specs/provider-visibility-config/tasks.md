# Implementation Plan

## 1. 基础原语

- [x] 1.1 实现可见性过滤纯函数 (P)
  - 提供「判定配置是否为空」与「对 `{providers, models}` 形态结果套用可见性」两个能力
  - 空配置时**返回入参同一引用**（不是内容相等的新对象）——这是零侵入的机械判据
  - 隐藏某 provider 时其全部模型消失，且 providers 列表按剩余 models 同步收敛
  - 黑名单式模型剔除：不在名单中的一律保留，含目录后来新增的模型
  - 配置引用了不存在的 provider 或模型时按剔除式实现自然忽略，不使整份配置失效
  - 完成判据：单测覆盖上述五种情形，其中空配置一条用引用相等断言（`toBe`）
  - _Requirements: 2.1, 2.2, 4.2, 4.3, 4.4, 7.1, 7.4_
  - _Boundary: 可见性过滤器 — `packages/core/src/model-catalog/visibility-filter.ts`, `packages/core/test/model-catalog/visibility-filter.test.ts`_

- [x] 1.2 扩展 providers 配置域承载可见性配置 (P)
  - 在既有 providers 域中新增一个以 provider 标识为键的可见性字段，值含「是否隐藏」与「被勾掉的模型集合」，二者皆可缺省
  - 该字段缺省为空，既有自定义 provider 条目的字段与行为一律不动
  - 表单结构中为该字段声明自定义 widget 标记，保持静态；**不得**在后端注入或改写 formSchema（前端不消费后端 formSchema，此路已实测无效）
  - 完成判据：域单测覆盖「缺省为空」「非法形态被拒」「既有条目行为不变」三条
  - _Requirements: 5.4, 7.5_
  - _Boundary: providers 配置域 — `packages/protocol/src/config/domains/providers.ts`, `packages/protocol/test/config/providers-domain.test.ts`_

## 2. 展示出口接线

- [x] 2.1 使部署级模型目录出口遵守可见性配置 (P)
  - 在装配层的模型目录出口读取可见性配置，并对其产出套用过滤器
  - 该出口内部「零筛选走旧路径、带筛选走统一查询」的既有分流保持不变，过滤统一作用于两条路的产出之后
  - 配置为空时产出与本特性引入前一致
  - 完成判据：手工核对该出口在无配置时返回的对象与过滤前是同一引用；隐藏一个 provider 后该端点产出不再含它
  - _Requirements: 2.1, 2.2, 6.1, 6.3, 7.1, 7.2_
  - _Boundary: 装配层模型目录出口 — `lib/app/pi-handler.ts`_
  - _Depends: 1.1, 1.2_

- [x] 2.2 使会话可用模型出口遵守可见性配置 (P)
  - 会话内模型选择器的取数出口同样套用过滤器，使各处选择器呈现一致
  - 只过滤该出口的**清单产出**；已被会话选中的模型继续可用，不因隐藏而失败
  - 完成判据：隐藏某 provider 后该端点清单不再列出它，而既有会话仍能继续使用原选模型
  - _Requirements: 2.4, 4.7, 6.1, 6.2_
  - _Boundary: 会话模型查询路由 — `packages/core/src/http/routes/query-routes.ts`_
  - _Depends: 1.1_

## 3. 设置界面

- [x] 3.1 将只读 provider 汇总升级为可配置控件
  - 保留既有的两次带筛选参数取数与三档来源标注；**不得**改为零参数取数（零筛选会走回旧路径，清单实测恒空）
  - 每个 provider 一行，含标识、来源徽章、模型数与可见性开关；被自己隐藏的 provider 仍在本面板内列出并标明状态
  - 展开某 provider 后逐模型勾选，并提供按名称筛选模型的输入框
  - 开关处明示作用范围仅为展示，不影响已有会话与工具
  - 隐藏当前默认 provider、或勾掉某 provider 全部模型时，保存前要求确认
  - 取数失败时呈现可辨识的失败态，且不影响已保存的配置
  - 完成判据：组件测试断言请求 URL 带筛选参数、开关与勾选正确写回配置值、筛选框收敛列表、两种确认提示出现
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.3, 2.5, 3.1, 3.3, 4.1, 4.5, 4.6, 5.3_
  - _Boundary: Provider 可见性控件 — `packages/ui/src/config/provider-registry-summary.tsx`, `packages/ui/src/config/index.ts`, `packages/ui/test/config/provider-visibility-field.test.tsx`_
  - _Depends: 1.2_

- [x] 3.2 在设置页注册该控件
  - 按既有 widget 注册惯例把控件接到设置页，使 providers 面板渲染出可配置清单
  - 完成判据：打开设置页 Provider 面板可见清单与开关（改配置域后需重启 dev，否则不生效）
  - _Requirements: 5.1, 5.2_
  - _Boundary: 设置面板注册 — `lib/settings/register-panels.ts`_
  - _Depends: 3.1_

## 4. 集成与验证

- [x] 4.1 补齐两个出口的集成测试
  - 覆盖「无配置时产出与引入前一致」「隐藏 provider 后两个出口都不再列出」「勾掉模型后仅该模型消失」
  - 覆盖类型筛选与可见性过滤的叠加：二者同时生效而非互相覆盖
  - 完成判据：新增集成测试在应用级测试面通过
  - _Requirements: 6.1, 6.2, 6.3, 7.1_
  - _Boundary: 出口集成测试 — `test/provider-visibility-endpoints.test.ts`_
  - _Depends: 2.1, 2.2_

- [x] 4.2 端到端验证设置页到选择器的闭环
  - 在设置页隐藏一个 provider 并保存，确认模型选择器中该 provider 消失；改回可见后恢复出现
  - 沿用本仓 /settings 端到端范式（面板导航、字段、保存按钮与已保存反馈的既有定位方式）
  - 完成判据：端到端用例在隔离构建下通过
  - _Requirements: 2.1, 2.2, 5.1, 5.2, 6.2_
  - _Boundary: 端到端用例 — `e2e/browser/provider-visibility.e2e.ts`_
  - _Depends: 3.2, 4.1_

- [x] 4.3 边界与零侵入终验
  - 机械核对边界承诺：目录服务内部文件未被本特性改动（彻底禁用语义未受影响）
  - 机械核对零侵入：未配置时目录出口产出与改动前一致
  - 跑全量测试面与类型检查，确认无既有回归
  - 完成判据：给出三条核对的具体命令与输出，而非口头断言
  - _Requirements: 3.2, 7.1, 7.2, 7.3, 7.5_
  - _Boundary: 终验核对（只读核对，不改产品代码） — `.kiro/specs/provider-visibility-config/tasks.md`_
  - _Depends: 4.1, 4.2_

## Implementation Notes

### 实施中发现的设计偏差（design.md 的 File Structure Plan 未预见）

1. **根包不能 deep-import core**。`packages/server/src/host-assembly/custom-providers.ts` 头注写明：
   根 `package.json` 只依赖 `@blksails/pi-web-server`，`lib/app/pi-handler.ts` 无法 deep-import
   core 子路径。故过滤器与配置读取器须经该 host-assembly 桥转出，设计文件表漏了这一环。
   → 实际改动多出 `packages/server/src/host-assembly/custom-providers.ts`。

2. **会话侧出口需要一条注入接缝**。`makeModelsHandler` 在 `create-handler.ts` 内部构造，
   拿不到配置。新增可选接缝 `PiWebHandlerOptions.readProviderVisibility`（缺省不注入 =
   行为与引入前一致）。→ 多出 `handler.types.ts` 与 `create-handler.ts` 两处改动。

3. **配置读取落在既有模块而非新建**。`custom-provider-source.ts` 已在读同一份
   `providers.json`，其头注明确反对「为同一份配置另建第二份数据源」，故 `readProviderVisibility`
   加在该模块内，复用其 fail-soft 惯例。

4. **过滤器需要一个宽松形态**。会话侧 `get_available_models` 的条目形状不由本产品保证
   （既有 `excludeProviderModels` 就是 `provider?: unknown`），故补 `filterVisibleModels`，
   `applyProviderVisibility` 内部复用它。

5. **旧只读组件是「按 panel.id 特判」挂载的，不走 widget 机制**。widget 上位后必须拆掉
   `settings-shell.tsx` 的特判并删除 `provider-registry-summary.tsx`，否则面板会同时显示
   两份清单——正是 design「升级而非并列」要避免的。既有 `settings-shell.test.tsx` 的变异
   判据随之从「守特判」改为「守 widget 字段 + renderer 注册」，意图不变。

6. **集成测试落点**：因约束 1，测试放 `packages/core/test/http/provider-visibility-endpoints.test.ts`
   而非 tasks 里写的根 `test/`。

### ★ e2e 抓到的真实缺陷：单向门（单测抓不到）

第一轮 e2e 第二个用例超时失败：隐藏 `newapi` 保存后，**它从面板里也消失了**，无法改回可见。

根因：本控件取数走 `/api/config/models`，而那**正是被可见性过滤的出口**。一旦隐藏，
目录就不再返回它，行也就没了 —— 使用者再也点不回来。design 的 traceability 里写
「面板取数不经过滤器」，这个假设是错的。

单测抓不到的原因很典型：测试里的 fetch 是 stub，恒返回全集，真实数据流的这层反馈回路
在 stub 下根本不存在。**这是 e2e 唯一能抓到的那一类缺陷。**

修法：`mergeHiddenRows()` 据配置把「已隐藏但目录已不再返回」的 provider 补回清单
（无来源徽章、无模型信息，只承担"能点回来"这一件事）。并补组件测试守住，
探针验证：去掉合并 → 该条精确报红。

### 判别探针（先证明判据能报红，再信它报的绿）

- 把「空配置直通」改成返回新对象 → `1 failed | 11 passed`，精确命中零侵入判据。
- 把 widget 取数改成零参数 → 4 条报红，正中「零参数导致清单恒空」这个实测坑。
- 去掉 `mergeHiddenRows` → 单向门守卫精确报红 1 条。

### e2e 真机结果

`npx playwright test provider-visibility --project=fs` → **2 passed**（`E2E_EXIT=0`）：
面板渲染清单与开关；隐藏→保存→目录端点不再列出→改回可见→恢复出现。

### 存量红（对照实验证明与本特性无关）

暂存全部改动后复跑，失败数完全一致：

| | 文件 | 测试 | 失败 |
|---|---|---|---|
| 带本特性（ui 包） | 116 | 968 | 6 文件 / 11 条 |
| 暂存后基线（ui 包） | 115 | 957 | 6 文件 / 11 条 |

差值恰为本特性新增的 11 条（全绿）。`module-roster` 报的 `builtin-prompt-paths 未归类`、
`encapsulation` 报的 `packages/ui/src/chat/*` 领域词命中，两侧一致，均随 origin/main 而来。
`pnpm typecheck` 亦只剩 `test/cli/*` 三个存量文件。

core 侧两条失败(`tiering/module-roster` 与 `tiering/dependency-guard`,后者在 collect 阶段
抛错故显示 0 test)同根因:`builtin-prompt-paths` 模块未登记进 `MODULE_ROSTER`。该文件由提交
`b355709f` 引入,不在本特性改动面内;暂存全部改动后复跑,同样失败、同样错误消息。

★ 核对方法提醒:`pnpm --filter <pkg> test` 会跑**多个 project**,`tail -2` 只能看到最后一个
汇总行 —— 本轮就因此一度误判 core「全绿」,实际前一个 project 是 `2 failed | 1397 passed`。
必须看全部汇总行并核对算术。
