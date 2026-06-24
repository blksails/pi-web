# Requirements — schema-config-ui(由 object schema 生成配置 UI)

## 概述

为 pi-web 提供一套「由对象 schema 生成配置表单 UI」的能力:以 schema 为单一事实源,自动渲染出可校验、可读写的配置界面,首批应用于 `~/.pi/agent/auth.json`(凭证)、`~/.pi/agent/settings.json`(默认偏好),并可扩展到其它配置域(AgentDefinition、扩展白名单、应用 env 等)。

## 术语

- **配置域(Config Domain)**:一组语义内聚、需要用户配置的字段集合(如 auth、settings)。
- **表单 IR(FormSchema/FieldDescriptor)**:与 zod 解耦的归一化字段描述中间表示,渲染器消费它。
- **Schema 适配器(Adapter)**:把某来源(zod schema / JSON Schema)转换为表单 IR。

## 需求(EARS)

### R1 由 schema 渲染表单
- 1.1 WHEN 给定一个配置域的对象 schema,THE 系统 SHALL 渲染出与字段一一对应的表单控件(无需为每个域手写表单)。
- 1.2 THE 系统 SHALL 按字段类型(string/number/boolean/enum/object/array/secret 等)选择默认控件。
- 1.3 WHERE 字段带有 UI 元数据(label/描述/占位/分组/顺序/控件覆盖),THE 系统 SHALL 据其调整渲染。

### R2 校验与错误呈现
- 2.1 WHEN 用户提交,THE 系统 SHALL 用该域 schema 校验全部字段值。
- 2.2 IF 校验失败,THEN THE 系统 SHALL 在对应字段就地显示错误且不提交。

### R3 读写持久化
- 3.1 THE 系统 SHALL 能加载现有配置文件值填充表单,并将合法的修改写回对应文件。
- 3.2 THE 系统 SHALL 对未知/额外字段采取保守策略(默认保留,不静默丢弃)。

### R4 密钥安全(auth.json)
- 4.1 THE 系统 SHALL 将凭证类字段(token/apiKey)作为 secret 处理:输入掩码、列表不回显明文、日志/序列化不含明文。
- 4.2 WHEN 已存在密钥,THE 系统 SHALL 以"已设置(掩码)"占位展示,允许覆盖或清除,但不回传原值到前端。

### R5 可扩展与可覆盖
- 5.1 THE 系统 SHALL 提供字段渲染器注册表(注册/解析/默认回退/按类型或字段键覆盖),复用既有 `renderer-registry` 模式。
- 5.2 THE 系统 SHALL 允许新增配置域而无需改动渲染内核;前端设置系统 SHALL 提供面板注册表,使新增配置域以注册一个面板的方式纳入,设置外壳零改动。

### R6 分层与同构契约
- 6.1 THE 表单 IR 类型与各配置域 schema SHALL 定义在 `@blksails/pi-web-protocol`(零运行时依赖,除 zod),供前后端共用。
- 6.2 THE 渲染层 SHALL 位于 `@blksails/pi-web-ui`,状态/校验 hook 位于 `@blksails/pi-web-react`,持久化端点位于 server/app,遵循 protocol→react→ui→app 单向依赖。

### R7 复用既有先例
- 7.1 THE 设计 SHALL 在结构上复用并推广现有「描述符→UI」先例(`RpcExtensionUIRequest` + `PiPermissionDialog` 按 method 渲染),把"按 method 判别"推广为"按字段类型/描述符判别"。

## 非目标(本期)

- 不实现任意 JSON Schema 全集(仅覆盖配置域所需子集)。
- 不在前端读写 `~/.pi/agent/*` 之外的任意磁盘文件。
- 不引入第三方 schema-form 库(@rjsf 等),保持轻量与契约可控。
