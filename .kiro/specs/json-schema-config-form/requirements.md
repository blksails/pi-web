# Requirements Document

## Introduction
为扩展的「独立配置文件」(如 `proxy.json`)支持**由其 `$schema`(JSON Schema URL)生成结构化设置表单**,
替代原始 JSON 文本编辑。复用既有 `FormSchema` IR + `SchemaForm` 渲染层,新增「JSON Schema → IR 适配器」、
远端 schema 拉取、以及「对象数组 / oneOf 多态」的 IR 与控件。目标样例:`@aizigao/pi-proxy-fetch` 的
`proxy.json`(version/enabled/profileName + profileConfig:对象数组,含 proxy_server | autoSwitch 的 oneOf,
autoSwitch 内嵌 switchRules 对象数组)。

## Boundary Context
- **In scope**:JSON Schema 子集 → FormSchema IR(object/string+enum/number+const/boolean/数组(标量→stringList、
  对象→objectList)/oneOf-对象-const判别/`$ref` 内部引用/`required`);远端 `$schema` 拉取+缓存(服务端);
  objectList 与 oneOf 控件;独立配置文件在有 schema 时渲染结构化表单、否则回退原始 JSON。
- **Out of scope**:完整 JSON Schema 规范(anyOf/allOf 组合、patternProperties、条件 if/then、format 校验等)
  超出样例所需的部分;扩展自身配置文件位置的发现(沿用 `config-ui-sandbox-extensions` 的扫描)。
- **Adjacent expectations**:依赖既有 `schema-config-ui`(FormSchema IR / SchemaForm / field-registry)与
  `config-ui-sandbox-extensions`(扩展独立配置文件扫描/读写 `files`)。

## Requirements

### Requirement 1: JSON Schema → FormSchema IR 适配器
**Objective:** 作为开发者,我想把 JSON Schema 转为 FormSchema IR,以便复用现有渲染层生成表单。

#### Acceptance Criteria
1. When 传入 `type:"object"` 且含 `properties` 的 schema,the 适配器 shall 产出 `kind:"object"` 且递归映射子字段,并按 `required` 设置字段必填。
2. When 字段为 `string`(含 `enum`)/`number`|`integer`/`boolean`,the 适配器 shall 分别映射为 `string`|`enum`/`number`/`boolean`。
3. When 字段为 `array` 且 `items` 为标量,the 适配器 shall 映射为 `stringList`;当 `items` 为 `enum` 时映射为 `multiEnum`。
4. When 字段为 `array` 且 `items` 为对象(或对象的 `oneOf`),the 适配器 shall 映射为 `objectList`,并携带其 item 字段或 oneOf 变体。
5. When 字段为对象的 `oneOf` 且各分支含 `const` 判别键,the 适配器 shall 产出带 `variants{discriminator,cases}` 的描述。
6. Where schema 使用内部 `$ref`(`#/$defs/...` 或 `#/definitions/...`),the 适配器 shall 解析并内联引用目标。
7. The 适配器 shall 把 `description`/`examples`/`default`/`const` 等映射到 IR 的描述/占位/默认。

### Requirement 2: 远端 schema 拉取与缓存
**Objective:** 作为运维者,我想让带 `$schema` 的配置文件自动拉取其 schema,以便无需手填。

#### Acceptance Criteria
1. When 扫描到的配置文件含 `$schema`(https URL),the 配置服务 shall 拉取该 schema、转为 FormSchema IR,并随扩展配置返回(`fileSchemas[文件名]`)。
2. If 拉取或解析失败,the 配置服务 shall 省略该文件的 schema(前端回退原始 JSON 编辑),不致整体失败。
3. The 配置服务 shall 缓存已拉取的 schema(按 URL),避免重复网络请求。
4. The 配置服务 shall 仅拉取 `https://` 且(默认)host 在允许集合(如 githubusercontent/github)内的 URL,防 SSRF。

### Requirement 3: 对象数组 / oneOf 控件
**Objective:** 作为使用者,我想用结构化控件编辑对象数组与多态项,以便无需手写 JSON。

#### Acceptance Criteria
1. The objectList 控件 shall 支持增/删数组项,每项按其字段渲染子表单。
2. Where item 为 oneOf 变体,the 控件 shall 提供判别键(如 `type`)的选择器,并据所选变体渲染对应字段。
3. When 用户编辑任一子字段,the 控件 shall 维持整体值结构(数组项与判别键)正确回写。
4. The 控件 shall 复用 `FieldRenderer` 递归渲染嵌套(如 autoSwitch 内 switchRules 对象数组)。

### Requirement 4: 独立配置文件的结构化渲染
**Objective:** 作为使用者,我想在有 schema 时看到结构化表单、否则仍能编辑原始 JSON。

#### Acceptance Criteria
1. Where 某配置文件存在生成的 FormSchema,the 配置文件控件 shall 用 `SchemaForm` 渲染结构化表单。
2. Where 无可用 schema,the 配置文件控件 shall 回退为原始 JSON 文本编辑(现状)。
3. When 保存,the 配置服务 shall 将结构化表单值原样写回该 JSON 文件(保留 `$schema` 等键)。

### Requirement 5: 测试覆盖
**Objective:** 作为维护者,我想用测试锁定适配器与控件。

#### Acceptance Criteria
1. The 单测 shall 覆盖适配器对 object/标量/枚举/标量数组/对象数组/oneOf/`$ref` 的映射(以 proxy.json schema 为夹具)。
2. The 单测 shall 覆盖 objectList/oneOf 控件的增删与判别切换、值回写。
3. The node e2e shall 验证带 `$schema` 的配置文件返回 `fileSchemas` 且保存往返保留结构。
4. While 测试运行,the 远端拉取 shall 可注入替身(不真实联网)。
