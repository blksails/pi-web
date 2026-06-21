# Implementation Plan

## 1. Foundation(契约/工具/夹具)

- [x] 1.1 定义共享补全契约类型与校验 schema
  - 在协议层定义候选项、补全响应、活跃触发符响应的结构与校验
  - 提供候选项必备字段(来源、类型、唯一 id、展示文本、可选 detail/insertText/score/sortText)
  - 导出供前端与服务端共用,避免两侧各自定义漂移
  - 观察完成:协议包构建通过,服务端与前端均可 import 该类型且类型检查无 any
  - _Requirements: 1.1, 3.2_

- [x] 1.2 实现触发符归一化与 token 文法工具
  - 把等价触发符形态(全角 ＠/￥ 等)规约为规范符,未知符原样返回
  - 提供带类型回环的 token 序列化/解析(如 `@file:<id>`),无法识别的普通 `@word` 不误判为 token
  - 观察完成:对照用例 ＠→@、￥→$、`@file:a/b.ts` 可往返、`@someone` 不被当 token,单测通过
  - _Requirements: 2.3, 1.1_

- [x] 1.3 准备补全 e2e 夹具目录
  - 构造含若干常规文件 + `.gitignore` + 一个被忽略目录 + 一个指向外部的符号链接/`..` 逃逸用例的固定目录
  - 供 node e2e(枚举/穿越拒绝)与浏览器 e2e(`@` 候选)共用
  - 观察完成:夹具目录入库,列目录可见预期文件且含越界用例条目
  - _Requirements: 10.1, 10.2_

## 2. Core(注册表/算法/provider/前端)

- [x] 2.1 实现 CompletionProvider 契约与注册表 (P)
  - 定义 provider 契约(单一触发符、可选 kind/priority、complete、可选 resolve)与服务端注册接口
  - 注册时校验触发符为单字符;同 id 覆盖并告警
  - 暴露"活跃触发符并集";按归一化触发符选出匹配 provider 并发调用 complete,带 per-provider 超时
  - 观察完成:注册两个不同触发符的桩 provider 后,触发符并集含两者;查询某符仅命中对应 provider;某 provider 超时被跳过而整体返回
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 4.3, 9.1, 9.3_
  - _Boundary: CompletionRegistry_

- [x] 2.2 实现候选合并、优先级、去重与截断 (P)
  - 按统一排序键(priority 降序、score 降序、label 升序)排序并按 kind 分组
  - 同 kind+id 去重,保留 priority 较高者;对总量设上限截断
  - 观察完成:针对构造数据的单测验证排序顺序、去重保高优、limit 截断、空输入返回空
  - _Requirements: 4.1, 4.2, 4.4_
  - _Boundary: mergeCompletions_

- [x] 2.3 实现 file provider 的文件枚举与模糊匹配
  - 以 `@`/kind=file 提供候选;枚举会话工作目录文件,尊重 `.gitignore`,跳过 `node_modules/.git` 等
  - 按查询模糊匹配排序、限量返回;对工作目录文件清单加 TTL 内存缓存;超遍历上限时截断并标示
  - 观察完成:对夹具目录查询返回预期相对路径、被忽略项不出现、重复查询命中缓存、超大目录截断标示可见
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: file-provider_

- [x] 2.4 实现 file provider 的安全边界与提交期 resolve
  - 解析路径经 realpath 后必须落在工作目录 realpath 前缀内,否则排除候选/拒绝解析;阻断 `../` 与符号链接逃逸
  - 实现 v1 resolve:把 `@file:<相对路径>` 规约为可读的 `@<相对路径>`(不读取文件内容)
  - 观察完成:对夹具中越界路径,候选不含且 resolve 返回拒绝;对合法路径 resolve 输出 `@<path>`;安全单测通过
  - _Requirements: 6.1, 6.2, 6.3, 8.2_
  - _Boundary: file-provider_
  - _Depends: 2.3_

- [x] 2.5 实现前端 token 提取器与补全 hook (P)
  - 实现按触发符的提取规则(`@`/`$` 词尾非空白、`/` 行首)得出查询串与替换区间
  - hook 负责:挂载时获取活跃触发符、键入时按规则判定是否进入补全、防抖后查端点、失败/空安全收敛
  - 观察完成:模拟输入下 hook 正确给出 query 与区间、不同触发符浮层互斥、请求失败不抛错不阻塞
  - _Requirements: 2.4, 7.2, 7.5, 7.6_
  - _Boundary: useCompletion, extractors_

- [x] 2.6 实现分区补全浮层与 token 插入
  - 按 kind 分区渲染候选并标示来源;支持键盘导航与选中
  - 选中后用带类型回环 token 替换触发起始区间并补尾随分隔
  - 观察完成:给定分组候选可渲染分区、键盘可选、选中后受控输入值被替换为 `@file:<path> `
  - _Requirements: 7.3, 7.4_
  - _Depends: 2.5_

## 3. Integration(端点/装配/路由接缝)

- [x] 3.1 暴露通用补全端点并装配补全上下文
  - 新增"候选查询"与"活跃触发符"两个会话级只读端点,经会话鉴权解析,用响应 schema 校验输出
  - 从会话记录解析工作目录、从鉴权上下文取用户标识,组装注入给 provider 的补全上下文
  - 未知触发符返回空集不报错;会话不存在/越权返回未找到或未授权且不泄露文件信息
  - 观察完成:对真实 handler 建会话后,触发符端点含 `@`、候选端点对 `@` 返回夹具文件;越权请求被拒
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 2.1, 6.4_
  - _Depends: 1.1, 2.1, 2.3_

- [x] 3.2 在 handler 装配期注册内置 file provider
  - 在服务端 handler 构造时创建注册表并注册 file provider,使其经通用端点对外可用
  - 观察完成:不另写端点,候选端点即可返回 file 类候选
  - _Requirements: 5.1, 9.1_
  - _Depends: 2.4, 3.1_

- [x] 3.3 在输入界面挂载 core 补全浮层并处理触发符让位
  - pi-chat 默认(知道会话 id)挂载 core 补全浮层,不再仅依赖 agent 声明的 mention 贡献
  - 当 core 已接管某触发符时,抑制同符的既有 webext mention 浮层,避免双浮层
  - 观察完成:任意会话输入 `@` 即弹 core 文件候选;非 core 接管的触发符仍走原有行为
  - _Requirements: 7.1_
  - _Depends: 2.6, 3.1_

- [x] 3.4 在消息发送链接入提交期 token 解析
  - 在转发用户消息给 agent 之前扫描补全 token,按 kind 分发对应 provider 的 resolve 并重写文本
  - 无 token 的消息保持原行为;单 token 解析失败保留原文本且不阻断发送
  - 对未实现 resolve 的 provider,其 token 文本原样保留且不报错
  - 观察完成:含 `@file:<path>` 的消息被规约为 `@<path>` 后转发;不含 token 的消息逐字节不变;构造解析失败用例仍能发送
  - _Requirements: 1.5, 8.1, 8.3, 8.4_
  - _Depends: 2.4, 1.2_

- [x] 3.5 提供可扩展性示例 provider 验证零端点扩展
  - 注册一个 mock 资源 provider(如 `@user` 或 `$env`),证明仅经注册即在通用端点与前端浮层生效
  - 与 file provider 同/异触发符下共存并按优先级排序
  - 观察完成:注册后候选端点对该触发符返回 mock 候选,且未改动端点/前端分发代码
  - _Requirements: 9.1, 9.2, 9.3_
  - _Depends: 3.1_

## 4. Validation(单测/e2e/回归)

- [x] 4.1 补齐核心算法与安全单元测试
  - 覆盖合并/优先级/去重/截断、触发符归一化、file 枚举(gitignore/缓存/截断)、提交期 resolve、路径穿越拒绝
  - 观察完成:单测套件运行全绿,含越界路径与 symlink 逃逸断言
  - _Requirements: 4.1, 4.2, 5.3, 5.4, 6.1, 6.2, 8.3_

- [x] 4.2 编写通用补全端点的 node e2e
  - 经真实 handler 建会话(工作目录=夹具),验证触发符端点含 `@`、候选端点对 `@` 返回夹具文件并按查询收敛
  - 包含路径穿越被拒用例与越权访问被拒用例
  - 观察完成:node e2e 通过,穿越/越权断言成立(仿既有 ui-rpc node e2e 风格)
  - _Requirements: 10.1, 3.3, 6.1, 6.2_
  - _Depends: 3.2_

- [x]* 4.3 编写 `@` 引文件的浏览器 e2e
  - 进入会话输入框键入 `@` → 出现按 kind 分区的文件候选浮层 → 选中后输入框被插入 `@file:<相对路径>`
  - 观察完成:浏览器 e2e 通过(隔离 build),浮层与插入断言成立(仿既有 webext-full e2e 风格)
  - _Requirements: 10.2_
  - _Depends: 3.3_

- [x] 4.4 回归验证不破坏既有行为
  - 验证既有 slash(`/` 命令)、webext mention(非 core 接管触发符)与无 token 普通消息发送均不受影响
  - 观察完成:相关既有测试与新增回归断言全绿
  - _Requirements: 8.4, 10.3, 10.4_
  - _Depends: 3.3, 3.4_

## Implementation Notes(独立评审后记录,供后续迭代)

- **安全门已验证**:file provider 的 realpath 前缀断言用 `targetReal === cwdReal || targetReal.startsWith(cwdReal + path.sep)`,可挡前缀混淆(`/cwd-evil` 不被误判为 `/cwd/` 子路径)、`../` 与 symlink 逃逸;鉴权复用 router 既有 401→404→403 链。
- **.gitignore 为近似实现**:支持注释/空行/目录名/`*.ext`/根锚定 `/x`;不支持否定 `!`、`a/**/b`、`**`、字符类、嵌套 glob。依赖这些的仓库会"少忽略"(多列候选),但绝不"过忽略"破坏安全(realpath 门独立)。后续如遇真实仓库命中再增强。
- **resolve 已改位置式重写**:避免「短 token 是长 token 前缀」时全局替换互污(已加回归用例)。
- **cursor 限制(v1)**:`PromptInput` 不暴露光标,core 浮层用 `cursor=input.length`,故仅光标在末尾时触发;规格验收流均在末尾输入,v1 可接受;后续若要中段编辑需让 PromptInput 暴露 selection。
- **onCaptureChange 共享**:命令面板/补全浮层/webext mention 共用 `setCommandCapturing`;默认单 `@` provider 不冲突,但将来注册重叠触发符(如 `/` provider)需改为合并/OR 的捕获信号以防竞态。
- **e2e 跑法**:浏览器 e2e 用外部 server 模式避免 webServer 双实例 120s 超时——`NEXT_DIST_DIR=.next-e2e pnpm build` 后,自起 `next start -p 3100`(stub env + SESSION_STORE=fs),再 `PI_WEB_E2E_EXTERNAL_SERVER=1 PI_WEB_E2E_FS_ROOT=$root pnpm exec playwright test ... --project=fs`。

## 5. 增强(file provider includes/excludes/glob;root 已评估去除)

- [x] 5.1 零依赖 glob 匹配器 + file provider includes/excludes/respectGitignore/override
  - `completion/glob.ts`(`compileGlobs`:glob→RegExp,支持 `**`/`*`/`?`/`{a,b}`)
  - `FileProviderOptions` 加 includes/excludes/respectGitignore + id/trigger/kind 覆盖;过滤管线
    重目录跳过 > excludes(dir 级剪枝) > .gitignore(可关) > includes;路径恒 cwd 相对;安全门不变
  - 决策:不引入 root(子目录用 includes 表达且性能等价;root 唯一独有=指向 cwd 外=高危)
  - 观察完成:glob 单测 5 + file provider 选项单测 4 通过;server 全套 519 通过,默认行为零回归
  - _Requirements: 5.2, 5.3, 9.2_
