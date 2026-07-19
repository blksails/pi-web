/**
 * FormSchema 的 zod 校验器(spec: source-settings-and-slots,任务 2.2 地基)。
 *
 * `form-schema.ts` 里的 `FieldDescriptor`/`FormSchema` 目前只是 TS interface,没有运行期
 * 校验 —— `resolve-plugin.ts` 对清单 settings 段引用的 schema 文件只校验「合法 JSON」,
 * 不校验是否符合 FormSchema 的字段种类/结构契约(Req 3.1 要求服务端下发「已 zod 校验的
 * FormSchema」)。本文件补上这道校验,与 `zod-to-form-schema.ts`(zod → FormSchema 方向)
 * 互为反方向:那边是「zod schema 推导 FormSchema」,这里是「校验一段已写好的 FormSchema
 * JSON 是否形状合法」。
 *
 * 递归结构(`FieldDescriptor.fields`/`itemFields`/`variants.cases[].fields`)用 `z.lazy`
 * 表达;字段种类覆盖 `FIELD_KINDS` 全量,不重新枚举字符串字面量(单一事实来源)。
 */
import { z } from "zod";
import { FIELD_KINDS } from "./form-schema.js";
import type {
  FieldDescriptor,
  FieldGroup,
  FieldKind,
  FieldVariants,
  FormSchema,
} from "./form-schema.js";

/** `FieldKind` 的 zod 校验(复用 `FIELD_KINDS` 单一事实来源,非重复枚举)。 */
const FieldKindZod: z.ZodType<FieldKind> = z.enum(
  FIELD_KINDS as [FieldKind, ...FieldKind[]],
);

const EnumOptionZod = z.object({
  value: z.string(),
  label: z.string().optional(),
});

const FieldGroupZod: z.ZodType<FieldGroup> = z.object({
  id: z.string(),
  title: z.string(),
  order: z.number().optional(),
});

/**
 * 互递归:`FieldDescriptorZod` 引用 `FieldVariantsZod`(variants 分支的 fields),
 * `FieldVariantsZod` 引用 `FieldDescriptorZod`(cases[].fields)。均以 `z.lazy` 延迟求值,
 * 模块顶层按声明顺序执行完毕后二者互相可见,运行期调用时(`.parse`)才真正解引用,
 * 与 TS 的 `const` TDZ 不冲突(标准 zod 递归 schema 写法)。
 */
const FieldDescriptorZod: z.ZodType<FieldDescriptor> = z.lazy(() =>
  z.object({
    key: z.string(),
    kind: FieldKindZod,
    label: z.string(),
    description: z.string().optional(),
    placeholder: z.string().optional(),
    required: z.boolean(),
    default: z.unknown().optional(),
    group: z.string().optional(),
    order: z.number().optional(),
    enumOptions: z.array(EnumOptionZod).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    fields: z.array(FieldDescriptorZod).optional(),
    itemFields: z.array(FieldDescriptorZod).optional(),
    variants: FieldVariantsZod.optional(),
    itemKind: FieldKindZod.optional(),
    widget: z.string().optional(),
    secret: z.boolean().optional(),
    readOnly: z.boolean().optional(),
    liveReload: z.boolean().optional(),
  }),
);

const FieldVariantsZod: z.ZodType<FieldVariants> = z.lazy(() =>
  z.object({
    discriminator: z.string(),
    cases: z.array(
      z.object({
        value: z.string(),
        label: z.string().optional(),
        fields: z.array(FieldDescriptorZod),
      }),
    ),
  }),
);

/** `FormSchema` 顶层校验:供「读文件 → JSON.parse → safeParse」这类装配期用法。 */
export const FormSchemaZodSchema: z.ZodType<FormSchema> = z.object({
  domain: z.string(),
  title: z.string().optional(),
  fields: z.array(FieldDescriptorZod),
  groups: z.array(FieldGroupZod).optional(),
});
