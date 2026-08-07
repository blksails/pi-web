/**
 * 配置域 — providers(自定义 provider,spec: multi-gateway-providers,任务 5.1;
 * Req 7.1, 7.5, 7.6, 7.7)。
 *
 * 落 `<agentDir>/providers.json`:一份可增删的自定义 provider 条目列表,每条承载
 * 标识、显示名、启用开关、访问地址、凭据、输入/输出类型、模型清单(design.md
 * 「providers 配置域」数据模型)。
 *
 * 两侧手写、职责分离(与既有 `mcp.ts` 分工一致):
 *  - {@link createProvidersConfigSchema} —— 服务端 PUT 校验(zod)。
 *  - {@link providersFormSchema}         —— 前端渲染 IR。
 * 之所以不经 `zodToFormSchema` 自动生成:该适配器不支持本域所需的 `objectList`
 * (含**嵌套** objectList:provider 内套 models 列表)与多态形态(design.md §3.1)。
 * 两侧须同步演进。
 *
 * ### 保留名校验:依赖注入,而非第二份清单
 *
 * Req 7.6 要求自定义标识与既有 provider 冲突时拒绝保存。pi SDK 内置 provider 的
 * 保留名清单(`RESERVED_PROVIDER_IDS`)已在 `packages/core/src/model-catalog/
 * provider-identity.ts` 落地为**唯一权威来源** —— 两份保留名清单漂移正是本 spec
 * 要根治的那类问题(见该文件的存量归一部分),故本域**不得**在此重抄一份。
 *
 * 但本包(`@blksails/pi-web-protocol`)是全项目依赖图的最内层("protocol ← 所有":
 * `core` 依赖 `protocol`,反向 import 会成环),不能直接 `import` core 的模块。
 * 解法是依赖注入:{@link createProvidersConfigSchema} 把"哪些 id 是保留名"作为
 * 入参而非闭包常量,真正的保留名集合由**调用方**(core 内的装配层/config-routes,
 * 那里可以同时 import `@blksails/pi-web-protocol` 与 core 自己的
 * `provider-identity.ts`)在构造本域校验 schema 时传入
 * `RESERVED_PROVIDER_IDS`。本文件的单测用自定义的保留名集合验证该机制本身。
 *
 * 存量归一表(`LEGACY_PROVIDER_ID_MAP` / `normalizeLegacyProviderId`)不在本域
 * 校验范围内 —— 它归一的是**已有**标识在系统内的历史别名,与"使用者新填一个自定义
 * 标识是否合法"是两件事,故本文件不引用它们。
 */
import { z } from "zod";
import type { EnumOption, FieldDescriptor, FormSchema } from "../form-schema.js";

/**
 * 输入/输出模态取值域(与 `packages/core/src/model-catalog/modality.ts` 的
 * `Modality` 类型同构)。本产品自维护的固定小词汇表,不是会漂移的外部清单,
 * 故两层各自持有字面量是刻意的,不属于上方"保留名"那类必须依赖注入的情形。
 */
export const PROVIDER_MODALITIES = ["text", "image", "video", "audio"] as const;
export type ProviderModality = (typeof PROVIDER_MODALITIES)[number];

const PROVIDER_MODALITY_OPTIONS: readonly EnumOption[] = [
  { value: "text", label: "文本" },
  { value: "image", label: "图像" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];

/**
 * provider 标识合法形态:小写字母、数字、连字符,不以连字符起止。
 *
 * 与核心的 `provider-identity.ts` 的 `PROVIDER_ID_PATTERN` 逐字符一致——这是一条
 * **形态**规则(正则本身),不是一份需要单一事实源的清单,故在此镜像重写是刻意的,
 * 不同于上方必须依赖注入的保留名集合。
 */
const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── 服务端校验 schema ─────────────────────────────────────────────────────────

const providerModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
  })
  .passthrough();

const providerEntrySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(
        PROVIDER_ID_PATTERN,
        "provider id 只能包含小写字母、数字与连字符,且不能以连字符开头或结尾",
      ),
    displayName: z.string().optional(),
    /** 缺省视为启用。 */
    enabled: z.boolean().default(true),
    /** Req 7.2:访问地址是接入自定义 provider 的必填项。 */
    baseUrl: z.string().url(),
    /** 值一律按 secret 处理(Req 7.3);并非全部自定义 provider 都要求凭据,故可选。 */
    apiKey: z.string().optional(),
    input: z.array(z.enum(PROVIDER_MODALITIES)).optional(),
    output: z.array(z.enum(PROVIDER_MODALITIES)).optional(),
    models: z.array(providerModelSchema).default([]),
  })
  .passthrough();

/**
 * 单个 provider 的展示可见性(provider-visibility-config spec,Req 5.4, 7.5)。
 *
 * ★ 与 `providerEntrySchema.enabled` 是**两回事**:`enabled` 属于自定义 provider 条目,
 * 停用即其模型不再进目录;本结构覆盖**全部**已注册 provider(含部署方经环境变量载入的
 * 内置注册档),且语义只到**展示层**为止 —— 被隐藏的 provider 在清单与选择器里消失,
 * 但已有会话与工具照常可用。彻底禁用仍归 `PI_WEB_HIDE_PROVIDERS`
 * (multi-gateway-providers Req 5)所有。
 *
 * 形态是**稀疏的否定式声明**:只记被隐藏的东西,于是「默认全展示」与「目录新增的
 * 模型自动可见」成为结构性质而非需维护的同步逻辑。
 */
const providerVisibilitySchema = z
  .object({
    /** true = 从展示清单中隐藏该 provider。 */
    hidden: z.boolean().optional(),
    /** 被勾掉的模型 id;不在此列的一律展示。 */
    hiddenModels: z.array(z.string()).optional(),
  })
  .passthrough();

const providersConfigBaseSchema = z
  .object({
    providers: z.array(providerEntrySchema).default([]),
    /** 以 provider 标识为键;缺省为空 = 全部可见(Req 7.1 零侵入)。 */
    visibility: z.record(providerVisibilitySchema).default({}),
  })
  .passthrough();

export type ProviderModelEntry = z.infer<typeof providerModelSchema>;
export type ProviderEntry = z.infer<typeof providerEntrySchema>;
export type ProviderVisibilityEntry = z.infer<typeof providerVisibilitySchema>;
export type ProvidersConfig = z.infer<typeof providersConfigBaseSchema>;

/**
 * 构造 providers 配置根 schema。
 *
 * 两条业务规则以 `superRefine` 表达,issue 的 `path` 精确指向出错条目下标
 * (`["providers", index, "id"]`,仿 `mcp.ts:83-104`,使 422 能定位具体字段):
 *  - **标识重复**(Req 7.6 的一半):本次提交的列表内两条以上条目同 id。
 *  - **标识与保留名冲突**(Req 7.6 的另一半):id 落在调用方传入的 `reservedProviderIds`
 *    集合中(该集合的唯一权威来源见本文件头注释)。
 *
 * @param reservedProviderIds 不得使用的 provider 标识集合(通常是 core 的
 *   `RESERVED_PROVIDER_IDS`)。必填,不设默认值——避免调用方忘记传入而静默放行
 *   本应拒绝的保留名冲突。
 */
export function createProvidersConfigSchema(reservedProviderIds: ReadonlySet<string>) {
  return providersConfigBaseSchema.superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.providers.forEach((provider, index) => {
      const { id } = provider;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["providers", index, "id"],
          message: `duplicate provider id: ${id}`,
        });
        return;
      }
      seen.add(id);

      if (reservedProviderIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["providers", index, "id"],
          message: `provider id "${id}" 与既有 provider 冲突,请改用其他标识`,
        });
      }
    });
  });
}

// ── 前端渲染 IR ───────────────────────────────────────────────────────────────

/**
 * providers 配置表单 IR。
 *
 * 全程复用**现有**表单能力,不扩展 IR:
 *  - `objectList`(可增删,含**嵌套** objectList:provider 内套 models 列表,Req 7.1)
 *  - `multiEnum`  —— input/output 类型声明(Req 7.7)
 *  - `kind:"secret"` —— apiKey 一律掩码(Req 7.3)
 */
export const providersFormSchema: FormSchema = {
  domain: "providers",
  title: "自定义 Provider",
  fields: [
    {
      // provider-visibility-config spec 任务 1.2/3.1:清单与逐模型勾选都是**运行时**
      // 数据,而本仓配置 UI 是「静态 schema + 动态 values」—— 前端只 fetch values,
      // **不消费**后端返回的 formSchema。故此处保持静态、只打 widget 标记,由前端
      // renderer 自己去统一目录端点取数。★ 在后端 enrich 本字段的 enumOptions 是
      // 无效的(本仓已实测踩过)。
      key: "visibility",
      kind: "record",
      widget: "providerVisibility",
      label: "Provider 与模型展示",
      description:
        "控制清单里出现哪些 provider 与模型;仅影响展示,不影响已有会话与工具的可用性。",
      required: false,
    },
    {
      key: "providers",
      kind: "objectList",
      label: "自定义 Provider",
      description:
        "接入自己的服务;新增后其模型出现在模型目录中,停用后消失但保留配置。",
      required: false,
      itemFields: [
        {
          key: "id",
          kind: "string",
          label: "标识",
          description:
            "小写字母、数字、连字符;全局唯一,不得与既有 provider 同名。",
          placeholder: "my-provider",
          required: true,
        },
        {
          key: "displayName",
          kind: "string",
          label: "显示名",
          required: false,
        },
        {
          key: "enabled",
          kind: "boolean",
          label: "启用",
          description: "停用后其模型从目录中消失,配置仍保留以便再次启用。",
          required: false,
          default: true,
        },
        {
          key: "baseUrl",
          kind: "string",
          label: "访问地址",
          placeholder: "https://api.example.com/v1",
          required: true,
        },
        {
          key: "apiKey",
          kind: "secret",
          label: "凭据",
          description: "以掩码保存与显示,不会回读明文;重新填写以覆盖旧值。",
          required: false,
        },
        {
          key: "input",
          kind: "multiEnum",
          label: "输入类型",
          description: "使其模型能被类型筛选正确命中。",
          enumOptions: PROVIDER_MODALITY_OPTIONS,
          required: false,
        },
        {
          key: "output",
          kind: "multiEnum",
          label: "输出类型",
          enumOptions: PROVIDER_MODALITY_OPTIONS,
          required: false,
        },
        {
          key: "models",
          kind: "objectList",
          label: "模型清单",
          required: false,
          itemFields: [
            {
              key: "id",
              kind: "string",
              label: "模型 id",
              required: true,
            },
            {
              key: "name",
              kind: "string",
              label: "模型名称",
              required: false,
            },
          ] as readonly FieldDescriptor[],
        },
      ],
    },
  ],
};
