# Implementation Plan

> 分波：任务 1（基础：签名机制与门控）+ 任务 2.1-2.3、3、4.1 构成 **Step 2 代码 webext** 主线；其中纯声明（Step 1）所需仅 2.3 + 3.2 + 4.1 的 declarative 分支，可最先打通可见。

- [x] 1. 基础：签名机制迁移与门控语义

- [x] 1.1 安全门增 signaturePreVerified 选项并将签名校验迁至 Ed25519
  - 在安全门中新增「签名已由服务端预先校验」选项：开启时跳过签名分支但**仍执行 SRI 校验**
  - 将发布者签名校验从对称密钥改为非对称（Ed25519）公钥校验
  - 保持纯声明扩展跳过 SRI/签名、仅校验版本兼容的既有行为
  - 完成态：单测显示「预校验开启→签名跳过且 SRI 仍生效」「Ed25519 正确签名通过、伪造/篡改字节被拒」
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.4, 10.1, 10.2, 10.4_
  - _Boundary: extension-gate_

- [x] 1.2 (P) 构建侧签名迁移到 Ed25519 并重签既有示例
  - 构建产物 manifest 的签名由对称改为 Ed25519 私钥签名，覆盖完整性摘要
  - 重新签名仓库内既有已签 webext 示例，使其与新校验一致
  - 完成态：示例重新构建后其 manifest 签名可被服务端 Ed25519 公钥验证通过
  - _Requirements: 5.1, 5.4_
  - _Boundary: manifest-emit_

- [x] 1.3 (P) 门控配置语义改为发布者公钥且验签机密不下发浏览器
  - 受信白名单由「共享密钥」语义改为「发布者公钥」语义
  - 确保任何验签所需机密不随页面下发到浏览器
  - 默认要求签名（默认非免签模式）
  - 完成态：检视下发到客户端的配置中不含任何验签机密；默认 requireSignature 为真
  - _Requirements: 5.2, 6.1, 6.4, 10.4_
  - _Boundary: web-ext-gate-config_

- [x] 2. 核心：服务端信任与发现

- [x] 2.1 可信发布者注册表（中心列表 + 出厂快照 + 根验签 + 合并 + fail-safe）
  - 提供出厂钉死的根公钥，用其验证下载的中心可信发布者列表签名，验证失败则不采信
  - 中心列表只登记发布者标识与公钥（非扩展目录）
  - 合并优先级：运营者本地（吊销/追加/固定版本/整体停用）高于中心列表
  - 拉取失败回退缓存→出厂快照；信任空集表示拒绝所有代码扩展（绝不 fail-open）
  - 剔除已过期或被吊销的发布者；终端用户/扩展尝试变更白名单一律拒绝
  - 随产品提供可离线使用的出厂快照文件
  - 完成态：单测覆盖「根验签失败不采信并回退快照」「过期/吊销剔除」「本地覆盖优先」「拉取失败不 fail-open」
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - _Boundary: TrustedPublisherRegistry_

- [x] 2.2 服务端发布者签名校验服务
  - 用注册表提供的受信公钥在服务端校验 manifest 签名
  - 通过后产出可安全下发浏览器的「已背书 manifest」：去除签名字段、标记签名已预校验、保留完整性摘要
  - 多用户/托管下经授权管理员变更白名单并记审计；生产模式不得跳过签名
  - 免签（dev）模式加载时产出明确的不安全提示
  - 完成态：受信签名→已背书 manifest（无机密、含完整性摘要）；缺签/不受信→拒绝并附原因
  - _Requirements: 5.1, 5.2, 5.3, 5.5, 6.3, 10.2, 10.3_
  - _Boundary: WebextTrustService_
  - _Depends: 2.1, 1.1_

- [x] 2.3 webext 解析端点与已装包产物静态托管
  - 按源定位已安装包内的 webext 产物目录并读取清单（自描述发现，无中心目录/全局注册表）
  - 代码扩展先经签名校验服务产出已背书清单再返回；返回基址用于浏览器获取产物
  - 缺产物→标记未找到回退默认 UI；清单非法/不受信→返回拒绝原因
  - 产物目录只读托管并防目录穿越
  - 完成态：纯声明源返回 declarative 清单+基址；受信代码源返回已背书清单+基址；无 webext 源返回未找到
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 9.1, 9.2_
  - _Boundary: WebextResolveRoute, WebextDistStatic_
  - _Depends: 2.2_

- [x] 2.4 (P) 宿主单例 ESM 供给端点
  - 以稳定 URL 暴露宿主的 React / React-DOM / web-kit 单例 ESM 模块
  - 完成态：访问稳定 URL 返回宿主同一单例实例的 ESM，可被 import map 引用
  - _Requirements: 3.2_
  - _Boundary: SingletonEsmRoute_

- [x] 3. 核心：浏览器侧加载

- [x] 3.1 (P) import map 生成与注入
  - 在任何模块加载前于文档头注入单张 import map，把裸 specifier 映射到单例 ESM URL
  - 完成态：页面源含早于 hydration 的单张 import map，代码扩展加载时裸 specifier 解析到宿主单例
  - _Requirements: 3.2_
  - _Boundary: WebextImportMap_
  - _Depends: 2.4_

- [x] 3.2 (P) webext 客户端加载编排
  - 会话激活时调用解析端点，按结果加载：纯声明直接合成并应用配置；代码扩展获取字节后仅做 SRI 校验（签名已服务端预校验）再动态加载
  - 加载结果以扩展标识命名空间化、会话级隔离地应用到当前会话
  - 任一拒绝/失败（含运行环境/内容安全策略不可执行）回退默认 UI 并上报原因，不影响宿主与其他 webext
  - resume 历史会话时按其绑定源重解析恢复
  - 完成态：受信代码源加载后其能力在当前会话生效；篡改字节→SRI 拒、回退默认 UI；坏 webext 不影响宿主
  - _Requirements: 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.3, 3.4, 3.5, 9.1, 9.3, 9.4_
  - _Boundary: WebextLoadClient_
  - _Depends: 2.3, 1.1_

- [ ] 4. 集成：宿主接线与装后反馈

- [x] 4.1 app-shell 接入加载触发与 import map 注入
  - 在 app-shell 会话视图接入客户端加载编排触发点，并注入 import map
  - 加载进行中向用户呈现进行中状态
  - 完成态：从某已装源新建/恢复会话时，其 webext（纯声明或代码）自动加载生效
  - _Requirements: 1.5, 2.3, 3.1, 8.4_
  - _Depends: 3.1, 3.2_

- [ ] 4.2 安装后双路生效反馈接线
  - 经 builtin-plugin-command 的「安装完成」挂点触发 webext 加载；与 pi 资源会话重载两路并行
  - 加载失败向用户呈现明确失败反馈与原因，而非静默无变化
  - 完成态：安装同时含 pi 资源与 webext 的包后，会话重载与 webext 加载两路均发生；webext 失败有明确反馈
  - _Requirements: 8.1, 8.2, 8.3_
  - _Depends: 3.2_

- [ ] 5. 验证

- [x] 5.1 (P) 信任与门控单元测试
  - 注册表：根验签、过期/吊销、本地覆盖优先、拉取失败回退与不 fail-open
  - 签名服务：受信→已背书、缺签/不受信→拒、生产不跳过、dev 不安全提示
  - 安全门：signaturePreVerified 跳签名仍验 SRI、Ed25519 正负例
  - 完成态：上述单测全绿
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 10.2, 10.3, 10.4_
  - _Boundary: TrustedPublisherRegistry, WebextTrustService, extension-gate_

- [ ] 5.2 (P) 解析端点与装后双路集成测试
  - 解析端点：纯声明/受信代码/不受信/无 webext 四种返回
  - 装后双路：含 pi 资源+webext 的包安装后 reload 与 webext load 均触发
  - 完成态：上述集成测试全绿
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.2_
  - _Boundary: WebextResolveRoute, WebextLoadClient_
  - _Depends: 2.3, 4.2_

- [x] 5.3 浏览器端到端验证（隔离构建 external server）
  - Tier5：安装纯声明源→主题/布局/空态可见生效
  - Tier1-4：安装受信代码源→渲染器/插槽生效且使用宿主单例
  - 负路径：篡改字节→SRI 拒回退；不受信签名→拒
  - 完成态：在 NEXT_DIST_DIR=.next-e2e external server 模式下上述 e2e 全绿
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 9.1, 9.3, 9.4, 10.1_
  - _Depends: 4.1, 4.2_
