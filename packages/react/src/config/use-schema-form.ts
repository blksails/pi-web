/**
 * useSchemaForm — 受控配置表单状态 + 校验 + 错误映射(框架层,无 React UI)。
 *
 * 持有 values(整域对象);`setValues` 全量替换(配 <SchemaForm> onChange);`setValue`
 * 支持点路径嵌套写;`submit()` 用注入的校验器(zod 结构化)校验,将 issue 路径映射为
 * 点路径 errors;非法不产出值。校验器与 zod 解耦(只要求 safeParse 形状)。
 */
import { useCallback, useMemo, useState } from "react";

export type FormValues = Record<string, unknown>;

/** 校验结果:成功带规整后的值,失败带"点路径 → 消息"。 */
export type ValidationResult =
  | { readonly ok: true; readonly values: FormValues }
  | { readonly ok: false; readonly errors: Readonly<Record<string, string>> };

export type Validator = (values: FormValues) => ValidationResult;

/** zod 结构(鸭子类型,避免硬依赖 zod)。 */
export interface ZodLike {
  safeParse(input: unknown):
    | { success: true; data: unknown }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }> };
      };
}

/** 由 zod 结构 schema 构造校验器:issue.path 连为点路径。 */
export function zodValidator(schema: ZodLike): Validator {
  return (values) => {
    const r = schema.safeParse(values);
    if (r.success) return { ok: true, values: r.data as FormValues };
    const errors: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join(".");
      if (errors[key] === undefined) errors[key] = issue.message;
    }
    return { ok: false, errors };
  };
}

export interface UseSchemaFormOptions {
  readonly initialValues?: FormValues;
  readonly validate?: Validator;
}

export interface UseSchemaFormResult {
  readonly values: FormValues;
  readonly setValues: (next: FormValues) => void;
  readonly setValue: (path: ReadonlyArray<string>, value: unknown) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly dirty: boolean;
  readonly reset: (next?: FormValues) => void;
  readonly submit: () => ValidationResult;
}

function setIn(obj: FormValues, path: ReadonlyArray<string>, value: unknown): FormValues {
  if (path.length === 0) return obj;
  const [head, ...rest] = path as [string, ...string[]];
  const child =
    typeof obj[head] === "object" && obj[head] !== null
      ? (obj[head] as FormValues)
      : {};
  return {
    ...obj,
    [head]: rest.length === 0 ? value : setIn(child, rest, value),
  };
}

export function useSchemaForm(
  opts: UseSchemaFormOptions = {},
): UseSchemaFormResult {
  const initial = opts.initialValues ?? {};
  const [values, setValuesState] = useState<FormValues>(initial);
  const [initialSnapshot, setInitialSnapshot] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const setValues = useCallback((next: FormValues) => {
    setValuesState(next);
  }, []);

  const setValue = useCallback(
    (path: ReadonlyArray<string>, value: unknown) => {
      setValuesState((prev) => setIn(prev, path, value));
    },
    [],
  );

  const reset = useCallback((next?: FormValues) => {
    const base = next ?? initialSnapshot;
    setValuesState(base);
    if (next !== undefined) setInitialSnapshot(next);
    setErrors({});
  }, [initialSnapshot]);

  const submit = useCallback((): ValidationResult => {
    if (opts.validate === undefined) {
      setErrors({});
      return { ok: true, values };
    }
    const result = opts.validate(values);
    setErrors(result.ok ? {} : result.errors);
    return result;
  }, [opts, values]);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initialSnapshot),
    [values, initialSnapshot],
  );

  return { values, setValues, setValue, errors, dirty, reset, submit };
}
