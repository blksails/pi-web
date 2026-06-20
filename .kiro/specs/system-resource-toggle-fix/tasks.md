# Implementation Plan

- [x] 1. 核心:解析与映射
- [x] 1.1 (P) runner 解析 `--no-skills` / `--no-extensions`
  - 在 runner 参数解析中识别两个布尔开关:裸 flag 视为关闭(true),`=false` 视为开启(false),未出现视为未设(默认载入)。
  - 两开关相互独立,可单独或同时出现。
  - 观察完成:给定带 `--no-skills` 的 argv,解析结果暴露「不载入 skills」意图;带 `--no-extensions` 同理;均不出现时两意图皆为未设。
  - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4_
  - _Boundary: parseRunnerArgs_

- [x] 1.2 (P) 将系统资源开关映射为资源载入覆盖
  - 关闭 skills 时,令会话资源载入产出空 skills 集,且优先于 agent 自声明的 skills(对齐 CLI `--no-skills`)。
  - 关闭 extensions 时,令会话不载入系统/包 extensions,同时保留经强制注入路径提供的扩展(沙箱),使沙箱安全门仍生效。
  - 两开关缺省/开启时不触碰对应载入行为,维持现状。
  - 观察完成:关闭 skills → 资源载入选项含「skills 为空」覆盖;关闭 extensions → 含「不载入 extensions」且强制注入路径仍在;缺省 → 两者皆不设。
  - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_
  - _Boundary: mapResourceLoaderOptions, buildRuntimeFactory_

- [x] 2. 集成:透传开关到运行时
- [x] 2.1 把解析出的系统资源开关贯穿到 agent 载入与运行时装配
  - 将 runner 解析得到的两布尔意图透传给 agent 定义载入与运行时工厂(覆盖 shape a/b 的 `defineAgent` 类 agent);shape (c) 自建运行时不在覆盖范围。
  - 在新建会话装配资源载入选项时应用该意图。
  - 观察完成:以 custom 模式启动并带 `--no-skills` 时,新建会话运行时实际不载入系统 skills(端到端贯通,非仅参数解析)。
  - _Depends: 1.1, 1.2_
  - _Requirements: 1.1, 1.2, 2.1_
  - _Boundary: loadAgentDefinition, startRunner_

- [x] 3. 验证
- [x] 3.1 单元测试:解析与映射四情形矩阵 + 沙箱不变量
  - 覆盖解析:`--no-skills` / `--no-extensions` / 两者 / 全缺省 + `=false` 显式开启。
  - 覆盖映射:关闭 skills 产出空 skills(含覆盖 agent 自声明 skills 的情形);关闭 extensions 设「不载入」且强制注入路径仍保留;两开关独立组合互不牵连;缺省维持现状。
  - 观察完成:新增测试文件运行通过,断言覆盖上述全部情形。
  - _Depends: 1.1, 1.2_
  - _Requirements: 1.4, 2.3, 3.1, 3.2, 3.3, 3.4, 5.1_
  - _Boundary: parseRunnerArgs, mapResourceLoaderOptions_

- [x] 3.2 回归:既有 runner / option-mapper 测试与 CLI 模式不被破坏
  - 运行既有 option-mapper / runner 相关测试套件,确认全绿。
  - 确认 CLI 模式路径未被改动(开关仍由底层 pi CLI 处理),双模式「关闭即不载入」结果一致。
  - 观察完成:既有测试套件全部通过,无回归。
  - _Depends: 2.1_
  - _Requirements: 4.1, 4.2, 5.3_

- [x] 3.3 端到端验收:custom 模式关闭 skills 后 slash 面板无 `/skill:*`
  - dev 下将系统 skills 开关置为关闭并重启 dev;以 custom 模式新建 webext 会话,断言首屏 slash 命令面板不再出现任何 `/skill:*`。
  - 对照:开关开启时 `/skill:*` 仍出现。
  - 观察完成:浏览器实测截图证明关闭态无 `/skill:*`、开启态有,新鲜证据落 `evidence/`。
  - _Depends: 2.1_
  - _Requirements: 1.2, 5.2_

## Implementation Notes

- **无需重启 dev**:本修复全在 runner 子进程侧(`packages/server/src/runner/*`),`runner-bootstrap.mjs` 经 jiti **每会话 spawn 时现载 TS 源**,新建会话即用新代码。注入侧(`system-resource-args.ts`/`pi-handler.ts`)未动,handler 单例无关。任务 3.3 原写「重启 dev」实际可省(仅改 `settings.json` 开关后新建会话即可)。
- **e2e A/B 证据**(同一 custom artifact agent,新建会话):
  - `loadSystemSkills:false`(修复后)→ 9 slash 命令,**无** `/skill:*`(`evidence/fix-skills-off-no-skill-commands.png`)。
  - `loadSystemSkills:true`(对照)→ 12 命令,含 `/skill:agent-browser /skill:find-skills /skill:librarian`(`evidence/control-skills-on-has-skill-commands.png`)。
  - 验证后已还原 `settings.json` 为用户本意的 `false`。
- **测试/类型**:`packages/server` 全套 487 passed / 5 skipped(含既有 option-mapper/runner-args/runner.e2e),`pnpm typecheck` 零错误。新增单测 `test/runner/system-resource-flags.test.ts` 10/10。
- **独立 reviewer**:APPROVED(机械门全绿、边界内、断言对抗性有效、透传链端到端核实)。
