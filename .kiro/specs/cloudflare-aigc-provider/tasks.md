# Implementation Plan

> 本特性净新增仅 1 个 provider 文件，其余为既有接缝的扩展。任务链高度串行——多数任务作用于同一批文件（`types.ts` → `providers/cloudflare.ts` → 路由表 → `model-catalog.ts` → `extension.ts`），故 `(P)` 标记极少。

---

- [x] 1. provider 标识基座

- [x] 1.1 扩展 provider id 联合类型
  - `packages/tool-kit/src/aigc/types.ts` 的 `ImageProviderId` union 增加 `"cloudflare"`
  - `packages/tool-kit/src/aigc/model-catalog.ts` 的 `AigcCatalogEntry.provider` union 同步增加 `"cloudflare"`（两处是各自独立的手写字面量联合，必须同改）
  - 观察性完成条件：`pnpm -r run typecheck` 通过，且全仓 grep `"ai-gateway"` 出现的 provider union 处已全部覆盖，无遗漏第三处
  - _Requirements: 4.1_

---

- [x] 2. Cloudflare provider 工厂

- [x] 2.1 实现路由基底与文生图请求构造
  - 新建 `packages/tool-kit/src/aigc/providers/cloudflare.ts`，结构照 `providers/gemini-relay.ts`（同为非 OpenAI 协议的自有工厂）
  - 定义 `CloudflareConfig` / `CloudflareModelArgs`，导出 `createCloudflareImage`
  - 路由基底：`url` = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run`；`headers` 含 `authorization: Bearer ${CLOUDFLARE_API_TOKEN}` 与 `cf-aig-gateway-id: ${CLOUDFLARE_AIG_GATEWAY_ID}`；`requiredVars` 三项齐全；`provider: "cloudflare"`
  - `buildT2IBody` 产出 `{model, input:{prompt, size?, quality?, output_format?, n?}}` —— 参数**嵌在 input 下**，非平铺
  - `negative_prompt` 无原生字段，照既有 provider 惯例并入正文
  - 模块顶层**零 `process.env` 读取**（双入口纪律），配置全部走 `${VAR}` 占位符
  - 观察性完成条件：`typecheck` 通过；单测断言 body 为嵌套形态且 `size`/`quality`/`output_format`/`n` 落在 `input` 下
  - _Requirements: 1.2, 1.4, 5.1, 5.4_

- [x] 2.2 实现双形态结果提取与错误判定
  - `pickResult` 双路探测：先 `result.result.image`（Unified 第三方，值为远程 URL），回落 `result.image`（Workers AI 原生，值为**裸 base64 无 data: 前缀**）
  - base64 分支需嗅探 MIME 后拼成 data URI：`/9j/` → `image/jpeg`，`iVBOR` → `image/png`，其余默认 png
  - 两路均未命中 → 返回 `{kind:"raw", value}`，由上层判失败
  - `detectError`：`success === false` 或 `errors[]` 非空时拼出含 `message` 与 `code` 的可读描述（code 用于区分凭据类与模型类）；`result.state` 存在且 `!== "Completed"` 时以 state 作为失败描述
  - 观察性完成条件：单测覆盖两种响应形态各一例、jpeg/png 嗅探各一例、`raw` 回落一例、`{errors:[{message,code:7003}],success:false}` 一例，全绿
  - _Requirements: 3.1, 3.2, 3.3, 6.1, 6.2, 6.3_
  - _Depends: 2.1_

- [x] 2.3 实现图像编辑请求构造（含静默退化拦截）
  - 导出 `createCloudflareImageEdit`，`buildEditBody` 产出 `{model, input:{prompt, images:[b64…], …}}`
  - 参考图由编排层 `mediaFields` 已解析为 data URI，此处提取**裸 base64**（去掉 `data:*;base64,` 前缀）后放入 `images` **复数数组**
  - ★ 关键：若一张图都未提取到，**抛错且不产出请求体**。CF 对缺图/单数 `image` 字段会静默忽略并退化为文生图返回 HTTP 200 + 无关图片，属伪成功，必须在发请求前拦截
  - 与 `gemini-relay.ts` 的「非 data URI 静默跳过」策略**刻意不同**，需在代码注释中说明原因（Gemini 退化会被模型自身拒答，CF 会返回成功）
  - 观察性完成条件：单测断言 (a) data URI 被正确转为裸 base64 且键名为 `images`；(b) 无可用图时 `buildEditBody` 抛错而非返回 body
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.1_

---

- [x] 3. 路由声明与展示目录

- [x] 3.1 声明 Cloudflare 路由组
  - `packages/tool-kit/src/aigc/tools/image-generation.ts` 新增导出 `CLOUDFLARE_IMAGE_ROUTES`
  - `packages/tool-kit/src/aigc/tools/image-edit.ts` 新增导出 `CLOUDFLARE_IMAGE_EDIT_ROUTES`
  - 首批仅纳入**已真机验证**的 `openai/gpt-image-2`（文生图 + 编辑两组各一条），路由键取 `gpt-image-2-cf`
  - ★ 路由键必须与既有 `gpt-image-2`（NewAPI）、`gpt-image-2-sufy`、`gpt-image-2-ai-gateway` 全部区分
  - 两组路由**不并入**无条件注册的 `ROUTES`，仅作独立导出供 runtime 层条件并入
  - 观察性完成条件：`typecheck` 通过；全仓 model 键无重复（由任务 3.3 的断言钉死）
  - _Requirements: 1.1, 2.4, 4.4, 4.5_
  - _Depends: 2.2, 2.3_

- [x] 3.2 声明展示目录并导出
  - `packages/tool-kit/src/aigc/model-catalog.ts` 新增 `CLOUDFLARE_AIGC_CATALOG`，形态与顺序照既有 `AI_GATEWAY_AIGC_CATALOG`（gen∪edit 并集去重序，生成路由在前）
  - `packages/tool-kit/src/index.ts` 导出该目录（供 server / Next 路由 import 而不拖入 pi SDK）
  - 维持 `model-catalog.ts` 的零 import / 零 env 纪律
  - 观察性完成条件：`typecheck` 通过；从主入口 `import { CLOUDFLARE_AIGC_CATALOG }` 可解析
  - _Requirements: 4.1, 4.2_
  - _Depends: 3.1_

- [x] 3.3 扩充 sync 断言守卫
  - `packages/tool-kit/test/aigc/model-catalog.test.ts` 新增第三组 describe，照既有两组结构断言 `CLOUDFLARE_AIGC_CATALOG` ↔ CF gen∪edit 路由并集：集合相等、label 一致、provider 恒为 `cloudflare`、顺序一致
  - 追加一条**跨 provider 唯一性**断言：CF 路由键与既有全部 provider 的 model 集合无交集
  - 观察性完成条件：`pnpm --filter @blksails/pi-web-tool-kit run test` 中 model-catalog 测试全绿；故意改错一个 label 能让断言失败（守卫有效性自检）
  - _Requirements: 4.4, 7.2_
  - _Depends: 3.2_

---

- [x] 4. 条件注册与降级

- [x] 4.1 接入 extension.ts 条件注册
  - `packages/tool-kit/src/aigc/extension.ts` 新增 `cloudflareEnabled` 判定：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_AIG_GATEWAY_ID`、`CLOUDFLARE_API_TOKEN` 三者**全部**非空才启用
  - 与既有 `aiGatewayEnabled` 并列，两组 `extraRoutes` 按需拼接后一并传入 `registerImageGeneration` / `registerImageEdit` / `publishAigcCatalog`
  - ★ env 命名不得使用 `AI_GATEWAY_API_KEY`（pi SDK 保留名，会劫持全部模型调用去 Vercel 致 401）；在代码注释中标注该约束来源
  - 观察性完成条件：未配置 CF env 时 `extraRoutes` 为 `undefined`，既有工具的 model 枚举逐字节不变
  - _Requirements: 5.1, 5.2, 5.3, 5.5_
  - _Depends: 3.2_

- [x] 4.2 补条件注册集成测试
  - 新增或扩充集成测试，照 `test/aigc/ai-gateway-extension-control.integration.test.ts` 的结构
  - 覆盖三种情形：(a) 三 env 齐备 → CF 路由进入 model 枚举；(b) 任一 env 缺失 → CF 路由不进入枚举**且既有 provider 枚举逐字节不变**；(c) `disabledModels` 含某 CF 模型 → 该模型从枚举移除
  - 观察性完成条件：三条用例全绿；(b) 用例以快照或逐项比对方式实证「不变」，而非仅断言 CF 不在
  - _Requirements: 4.3, 5.2, 5.5, 7.1_
  - _Depends: 4.1_

---

- [x] 5. 全量校验与真机验收

- [x] 5.1 全量测试与类型校验
  - 运行 `pnpm -r run typecheck` 与 tool-kit 包的测试套件，确认无回归
  - 确认 `openai-compat.ts` 与既有 5 个 provider 文件、`engine/` 目录**零改动**（`git diff --stat` 核实）
  - 观察性完成条件：typecheck 退出码 0；tool-kit 测试全绿；改动文件清单与 design.md 的 File Structure Plan 一致，无计划外文件
  - _Requirements: 7.1, 7.3_
  - _Depends: 4.2_

- [x] 5.2 真机验收：文生图与图像编辑
  - 配置真实 `CLOUDFLARE_*` 三变量，经 pi-web 实际发起调用（非 curl 复现——须走本特性代码路径）
  - 文生图：验证出图、`size`/`quality`/`output_format` 生效、中文 prompt 正常
  - 图像编辑：给定参考图与编辑指令，验证产出图保持原图构图且按指令修改
  - ★ 编辑退化拦截需实证：构造参考图解析失败的情形，确认**报错**而非返回一张无关新图
  - 观察性完成条件：留存三份证据（文生图产出、编辑前后对比、退化拦截的错误信息）
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.3_
  - _Depends: 5.1_

- [x] 5.3 真机验收：Workers AI 原生模型形态
  - 经本特性代码路径调用一个 `@cf/*` 原生模型（如 `@cf/black-forest-labs/flux-1-schnell`），验证 base64 分支的 MIME 嗅探与 data URI 拼装在真实响应上成立
  - 观察性完成条件：图片正常显示，且与 Unified 模型产出在 UI 上呈现一致
  - _Requirements: 3.2, 3.3_
  - _Depends: 5.1_

- [x] 5.4 模型池探针与目录收敛
  - 逐个真机调用候选模型，确认在本账号网关上实际可出图后再写入路由与目录
  - Unified 候选：`openai/gpt-image-1.5`、`google/imagen-4`、`google/nano-banana-2`、`google/nano-banana-pro`、`black-forest-labs/flux-2-pro-preview`
  - Workers AI 候选：`@cf/black-forest-labs/flux-1-schnell`、`flux-2-dev`、`@cf/leonardo/lucid-origin` 等
  - 编辑路由仅纳入确认支持编辑的模型（文档指向 OpenAI 系）
  - ★ 不得照文档全量写入——未验证的模型会让选择器列出实际不可用项
  - 观察性完成条件：目录中每一条新增模型都有对应的真机调用记录；sync 断言仍全绿
  - _Requirements: 2.4, 4.5_
  - _Depends: 5.2, 5.3_

---

## Implementation Notes

### 真机证据（2026-07-29）

账号 `c1cc6314f2222379ec14714b992ba3df` / 网关 `pi-labs`。

- **live 套件 12/12 全绿**（`test/aigc/providers/cloudflare.live.test.ts`，总耗时 169s）——全部经 `工厂 → runEndpoint → pickResult` 完整代码路径，非 curl 复现
- 文生图 23.3s（中文 prompt，1024x1536 + quality=low + jpeg → 290KB，JPEG magic 校验通过）
- 图像编辑 35.1s：源图「橘猫坐蓝沙发」→ 指令「沙发改鲜红、猫和构图不变」→ 产出沙发与抱枕变红，猫的姿态/斑纹/白爪/尾巴位置、木腿、构图全部保持
- 退化拦截：非 data URI 参考图 → 抛错未发请求 ✓
- Workers AI `@cf/black-forest-labs/flux-1-schnell` 1.7s，走 base64 → MIME 嗅探 → data URI 路径 ✓
- 目录内 8 个模型逐条复验可出图（2.5s ~ 21.1s）
- 离线全量：typecheck 退出 0；tool-kit 558 passed / 12 skipped（无凭据时 live 套件正确 skip）

### 模型池探针结果（任务 5.4）

**纳入（8 个）**：`gpt-image-2` / `gpt-image-1.5` / `imagen-4` / `nano-banana-2` / `nano-banana-pro` / `flux-2-pro-preview` / `@cf/…flux-1-schnell` / `@cf/leonardo/lucid-origin`

**排除（3 个，附原因）**：
- `@cf/black-forest-labs/flux-2-dev` — HTTP 400 `required properties at '/' are 'multipart'`，入参形态与本 provider 不同
- `@cf/leonardo/phoenix-1.0` — 返回 `{"result":{},"success":true}`：**HTTP 200 且 success 为真，但没有图**
- `@cf/stabilityai/stable-diffusion-xl-base-1.0` — 同上

★ 后两者恰好实证了 Req 6.3 的必要性：若 `pickResult` 只按「取到就返回、取不到返回空」处理，用户会拿到一个静默的空结果。现有实现落到 `kind:"raw"` 由上层判失败。

**编辑路由只放 2 个**（`gpt-image-2` / `gpt-image-1.5`）：文生图有 8 个但编辑仅 OpenAI 系经真机确认；其余未验证编辑语义，放进去会让用户选中后拿到与参考图无关的新图（Req 2.4）。

### 实现期发现

1. **测试夹具应从目录派生而非硬编码模型名** — 集成测试初版把 CF 模型名写死，任务 5.4 扩充目录后「剔除 CF 后应逐项不变」那条立刻假红。改为 `CLOUDFLARE_AIGC_CATALOG.map(...)` 派生。
2. **`disabledModels` 来自 `<agentDir>/aigc.json` 而非 env** — 初版误用 env 造夹具导致用例不通过；改为经 `PI_WEB_AGENT_DIR` 指向临时目录并真写配置文件，让链路完整跑通。
3. **`extraRoutes` 必须保持 `undefined` 而非空数组** — `registerImage*` 对 `extraRoutes !== undefined` 才走拼接分支，两套 provider 都未启用时传空数组会改变既有代码路径（Req 5.5/7.1）。
4. **sync 断言守卫做了有效性自检** — 故意改错一个 label，确认断言精确失败后再恢复，避免写出「永远为真」的假守卫。

---

## 补充任务（重启验证时发现的 design 缺口）

- [x] 6.1 补齐宿主侧 `/aigc/models` 目录装配
  - ★ **这是 design 的真缺口**：File Structure Plan 只覆盖了 tool-kit 内的路由与目录，漏掉宿主装配层。后果是 provider 实现完成、工具侧可用，但 `/settings` 模型开关面板一条 Cloudflare 模型都列不出来 —— Req 4.2 实际未满足，而全部离线测试仍然全绿
  - 暴露方式：重启 dev 后 `curl /api/aigc/models` 返回 17 条、其中 cloudflare **0 条**
  - 改动：`packages/server/src/model-catalog/service.ts` 加 `cloudflareImageCatalog` 槽与 `source: "cloudflare"`；`lib/app/pi-handler.ts` 注入；`packages/tool-kit/src/index.ts` 导出判据
  - 观察性完成条件：`/api/aigc/models` 返回 25 条（self 14 / ai-gateway 3 / cloudflare 8）
  - _Requirements: 4.2_

- [x] 6.2 启用判据收敛为单一事实源
  - 新增 `isCloudflareConfigured(env)` 与 `CLOUDFLARE_REQUIRED_ENV`（`providers/cloudflare.ts`，纯函数、显式收 env，不破双入口纪律）
  - `extension.ts`（决定是否注册工具路由）与 `pi-handler.ts`（决定目录是否含 CF 条目）改为共用同一函数
  - ★ 两处若各写一份判据，漂移时会出现「设置页列得出模型但工具里选不到」或反之的错位
  - 观察性完成条件：新增 5 条单测，含「`CLOUDFLARE_REQUIRED_ENV` 与路由 `requiredVars` 是同一组名字」的防漂移断言
  - _Requirements: 5.1, 5.2_

### 教训

**离线测试全绿 ≠ 特性可用。** 本 spec 的单测、集成测试、sync 断言、甚至经完整代码路径的真机 live 套件（12/12）**全部通过**，缺口依然存在 —— 因为所有这些都在验证「工具侧」，而设置页走的是另一条装配链。缺口只在重启服务后打真实 HTTP 端点时才暴露。

设计阶段的教训：新增 provider 时，「哪些地方会列举 provider」需要**顺着每一条消费链各查一次**，不能只查生产侧。本例的消费链有两条：runner 侧 `aigcExtension`（工具枚举）与宿主侧 `ModelCatalogService`（设置页目录）。

- [x] 6.3 补齐 provider 徽章（第三条消费链）
  - ★ 又一条被 design 漏掉的消费链：`packages/canvas-ui/src/aigc-model-meta.tsx` 的 `PROVIDER_META` 是徽章准入闸门，`ProviderBadge` 对表中没有的 provider 直接返回 `null`
  - 暴露方式：用户截图 —— 选择器里 ai-gateway 3 条 + Cloudflare 8 条全是纯文字、无色块，且保留冗余的 ` · ai-gateway` / ` · Cloudflare` 后缀（`displayNameOf` 依赖同一张表）
  - ⚠ **ai-gateway 也一直缺徽章**，不是本 spec 引入的，属顺手补齐
  - 改动：登记 `ai-gateway`（G / #8b5cf6）与 `cloudflare`（C / #f6821f 官方橙）；`displayNameOf` 的后缀匹配改为归一化并接受 provider **id**（label 后缀有的写展示名 `· NewAPI`、有的写 id `· ai-gateway`，后者原先匹配不上 name `AI Gateway`）
  - 观察性完成条件：11 条全部渲染出徽章且后缀剥离；覆盖率断言在摘掉任一 provider 时变红（已自检）
  - _Requirements: 4.1_

- [x] 6.4 加徽章覆盖率交叉断言
  - 新增 `packages/canvas-ui/test/aigc-model-meta.test.ts`（10 条）
  - 核心是把「三份目录里出现的 provider」与「PROVIDER_META 登记的 provider」绑定：下次新增 provider 漏登记即红，并直接报出缺哪个
  - 自检：临时摘掉 `cloudflare` → 4 条精确变红（含预期报错文案）
  - _Requirements: 4.1, 7.2_

### 待你决定（本次未改）

后缀剥离后 `GPT Image 2` 在选择器里出现 **4 次**（NewAPI / sufy / ai-gateway / Cloudflare），仅靠徽章字母区分。这是既有设计的一致行为（`newapi`/`sufy` 原本就剥离），但同名项从 2 个变 4 个后辨识度可能不足。若要改，两条路：(a) 同名冲突时保留 provider 后缀；(b) 徽章旁并列显示 provider 短名。

### 消费链清单（本 spec 累计踩到 3 条）

新增图像 provider 时需要逐条检查，缺任一条都不会被离线测试发现：
1. runner 侧 `aigcExtension` → 工具 model 枚举（tool-kit）
2. 宿主侧 `pi-handler.ts` → `ModelCatalogService` → `/aigc/models` → 设置页模型开关
3. 前端 `PROVIDER_META` → 选择器徽章与显示名（canvas-ui）

### 已知 pre-existing 失败（非本 spec 引入）

`packages/canvas-ui/test/encapsulation.test.ts` 的「豁免锚总数恰为 2」期望 2 实得 3 —— 第三个锚在 `packages/ui/src/config/fields/vision-model-select-field.tsx`，已在 HEAD 中（`packages/ui/` 相对 HEAD 零改动），是该测试的硬编码计数未随记档更新。本 spec 不处理。

---

## 补充任务（新 key 真机测试暴露）

- [x] 7.1 修复「provider 请求走代理、产出图下载不走代理」的割裂
  - ★ **根因**：`persistPicked` 二次下载产出图时恒用裸 `globalThis.fetch`，无视 `route.proxy`。表现为「CF 后台有 HTTP 200 成功记录、工具却报 `fetch failed`」——失败发生在取图那一跳，极易被误判成响应格式不匹配
  - 触发条件：`api.cloudflare.com` 与 `*.r2.cloudflarestorage.com` 在本网络直连超时（`connect ETIMEDOUT 172.64.66.1:443`）。curl 能通是因为它读 `HTTPS_PROXY`，而 node 的 undici fetch **默认不读**
  - 改动：(a) CF 路由声明 `proxy: "${CLOUDFLARE_PROXY}"`（与 openrouter 的 `${OPENROUTER_PROXY}` 同款，不进 `requiredVars`）；(b) `run-image-tool.ts` 的落盘下载改用 `proxyFetch` 并传入同一个解析后的代理
  - ⚠ (b) 是**既有架构缺口，不止影响 Cloudflare**：任何 `pickResult` 返回远程 URL 的 provider（openrouter 同样）都存在这个割裂。未配代理时 `resolveVarsOptional` 得 `undefined` → 直连，行为与既有一致
  - 观察性完成条件：新 key + 代理下 gpt-image-2 文生图（294KB/27.4s）与图像编辑（57.3s，沙发变红、猫与构图保持）双通；新增 3 条测试钉死取图跳走代理
  - _Requirements: 1.1, 2.1_

- [x] 7.2 Workers AI 原生模型摘出目录
  - ★ 摘出原因：`@cf/*` 模型不走 Unified 统一计费，吃账号**每日 10,000 neurons 免费额度**，耗尽后恒 `429 code 4006`。留在目录里会让用户选中后**随机**失败（额度何时耗尽不可预期），体验差于「不提供」
  - 改动：两条路由移入 `CLOUDFLARE_WORKERS_AI_ROUTES` 常量（不并入注册路由与目录）；对应目录条目移除；live 套件该组改为 `CF_TEST_WORKERS_AI=1` 显式门控，避免额度耗尽后变成常红噪声
  - ★ **能力未删**：`pickResult` 的裸 base64 → MIME 嗅探 → data URI 分支仍由单测完整守卫（Req 3.2/3.3 的离线保障不变）。开通 Workers Paid 后把该常量并入 `CLOUDFLARE_IMAGE_ROUTES` 即可恢复，无需改 provider 实现
  - 新增 3 条隔离断言：常量非空（证明是摘出而非删除）+ 不得出现在任何目录 + 不得出现在条件注册路由组
  - 观察性完成条件：`/api/aigc/models` 返回 23 条，cloudflare 6 条，两个 Workers AI 模型无残留
  - _Requirements: 4.5_

### 教训补充

「网关后台显示成功」不等于「特性成功」——一次图像生成至少跨两跳出网（provider 请求 + 产出图下载），两跳可以走不同路径。排查时要先确定失败发生在哪一跳，否则容易把网络问题误判为协议/格式问题。
