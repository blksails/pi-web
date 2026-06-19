# Research Log — config-ui-sandbox-extensions

## 发现范围
扩展型特性(brownfield):在既有 `schema-config-ui` 配置 UI 栈与会话装配链路上增量。轻量集成发现。

## 关键发现
1. **配置 UI 栈可直接复用**:`zodToFormSchema` 已支持 `object`(嵌套)、`stringList`、`record`、`boolean`;
   `field-registry` 按 `widget` key 解析 → 自定义 `extensionsKv` 控件可经 `registerFieldRendererByKey` 注入。
   缺失的 `boolean/stringList/object` 控件本特性已补齐。
2. **沙箱配置文件路径恰好与 pi-sandbox 一致**:配置域 id `sandbox` → `ConfigCodec` 写 `<agentDir>/sandbox.json`
   = pi-sandbox 全局配置;项目 `<cwd>/.pi/sandbox.json` 由 `sandbox-project-routes` 直写。零胶水。
3. **强制注入两模式**:cli 用 pi 真实 flag `--extension, -e <path>`(已核实);custom 用 SDK
   `additionalExtensionPaths`(`resource-loader.js:263` 证明 noExtensions 下仍加载),白名单经
   `extensionsOverride` 豁免 basename。经验性冒烟(`pi --mode rpc -e <pi-sandbox>`)证实扩展在 rpc 加载、
   初始化成功并应用了严格全局配置(`🔒 Sandbox: 0 domains, 1 write paths`)。
4. **settings.json 互映是扩展域的核心难点**:pi 从 `settings.json` **顶层** `<extId>` 键读取 per-扩展 KV
   (实例:`@alexgorbatchev/pi-env`);故表单 `extensions` 记录需在路由层与顶层键互映,并以保留键集区分
   非扩展键(packages/provider/theme/...)。`commands` 为 pi-web 自有命名键,pi 忽略。
5. **可见性隔离免费**:严格 `allowRead:["."]`(`.` 按各 agent cwd 解析)使 agent 读不到全局/他源配置;
   依赖 allowRead 保持项目作用域(放宽即失效,文档已警示)。

## 设计决策
- 扩展域用**自定义路由**(非通用 `/config/:domain`):因表单 ↔ settings.json 顶层键的互映非平凡,
  通用 codec 的 deepMerge 无法表达"把记录展开到顶层 + 保留键非破坏"。
- 互映抽为纯函数(`settingsToForm`/`applyFormToSettings`)便于单测。
- 沿用 sandbox-project 的 `cwd` 根校验(403)防越权写。

## 风险
- per-扩展 KV 写回采用「按出现的 extId 整体替换、未出现的不动」(非破坏但不跨条目删除);文档说明。
- browser e2e 需隔离 build,避免污染共享 `.next`(见记忆 `pi-web-e2e-isolated-build`)。
- rpc 下越权 read 的最终表现(硬拦截 vs 交互提示)依赖 pi SDK ui 桥接,留活体确认(见研究文档 §12)。
