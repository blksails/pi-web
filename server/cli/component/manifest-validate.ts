/**
 * manifest-validate — 组件清单业务校验(spec cli-component-add,任务 2.2,
 * Req 1.2–1.7, 2.5)。
 *
 * 前置:清单已过 protocol 的 zod parse(结构合法)。本文件裁决**跨字段业务规则**
 * —— 这是 protocol(zero-runtime 纯契约)与 CLI(业务裁决)的分层线(design §protocol):
 *   - kind 必须是 `component` 且 `component` 字段组必备(1.2);
 *   - files 拒绝绝对路径与 normalize 后逃出包根的相对路径(1.3);
 *   - files 必含至少一个测试文件,判据 = basename 含 `.test.`(1.4);
 *   - wiring.point v1 只认 `canvasPlugins`(1.5;schema 预留 renderers/slots);
 *   - registryDeps 必须为空(1.6);
 *   - target 声明值必须等于约定落点 `.pi/web/components/<id>`(1.7)。
 * 一次校验**聚合全部问题**(不首错即返),使作者一轮看清所有修点。
 */
import path from "node:path";
import type { ComponentSpec, PiWebManifest } from "@blksails/pi-web-protocol";

export type ComponentManifestIssue = {
  readonly code:
    | "component_spec_missing"
    | "component_files_invalid"
    | "component_tests_missing"
    | "wiring_point_unsupported"
    | "wiring_slot_missing"
    | "registry_deps_unsupported"
    | "target_mismatch";
  readonly message: string;
  /** 出问题的字段定位(如 `component.files[2]`)。 */
  readonly field?: string;
};

export type ValidatedComponent = {
  readonly manifest: PiWebManifest;
  readonly spec: ComponentSpec;
  /** 约定落点(相对目标 source 根,POSIX 分隔)。 */
  readonly targetRel: string;
};

export type ValidateResult =
  | { readonly ok: true; readonly value: ValidatedComponent }
  | { readonly ok: false; readonly issues: readonly ComponentManifestIssue[] };

/** 约定落点(Req 1.7 / 3.3 的锚点;唯一权威,禁在别处手拼)。 */
export function componentTargetRel(id: string): string {
  return `.pi/web/components/${id}`;
}

/** 单个 file 声明是否路径安全:相对、normalize 后不以 `..` 逃出包根。 */
function isSafeRelativeFile(file: string): boolean {
  if (path.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file)) return false;
  const normalized = path.posix.normalize(file.replaceAll("\\", "/"));
  return normalized !== ".." && !normalized.startsWith("../") && normalized !== ".";
}

export function validateComponentManifest(manifest: PiWebManifest): ValidateResult {
  const issues: ComponentManifestIssue[] = [];
  const spec = manifest.component;
  if (manifest.kind !== "component" || spec === undefined) {
    return {
      ok: false,
      issues: [
        {
          code: "component_spec_missing",
          message:
            manifest.kind !== "component"
              ? `清单 kind 为 "${manifest.kind}",不是可安装的组件包(需要 kind:"component")`
              : `kind:"component" 的清单缺少 component 字段组(files/wiring 必备)`,
          field: manifest.kind !== "component" ? "kind" : "component",
        },
      ],
    };
  }

  spec.files.forEach((file, i) => {
    if (!isSafeRelativeFile(file)) {
      issues.push({
        code: "component_files_invalid",
        message: `files 只接受包内相对路径(拒绝绝对路径与 ".." 逃逸): ${file}`,
        field: `component.files[${i}]`,
      });
    }
  });

  if (!spec.files.some((f) => path.posix.basename(f.replaceAll("\\", "/")).includes(".test."))) {
    issues.push({
      code: "component_tests_missing",
      message: "组件包必须随源分发测试:files 需至少包含一个文件名含 `.test.` 的文件",
      field: "component.files",
    });
  }

  if (spec.wiring.point === "renderers") {
    issues.push({
      code: "wiring_point_unsupported",
      message: `暂支持接线到 canvasPlugins 与 slots;"renderers" 是预留枚举值,尚未实现`,
      field: "component.wiring.point",
    });
  }
  // slots 点(v1.1):具名槽对象键挂载,必须声明挂到哪个槽。
  if (spec.wiring.point === "slots" && (spec.wiring.slot === undefined || spec.wiring.slot.length === 0)) {
    issues.push({
      code: "wiring_slot_missing",
      message: `point:"slots" 必须声明具名槽 key(component.wiring.slot,如 "panelRight")`,
      field: "component.wiring.slot",
    });
  }

  if (spec.registryDeps.length > 0) {
    issues.push({
      code: "registry_deps_unsupported",
      message: `v1 不支持组件间依赖(registryDeps 必须为空,当前 ${spec.registryDeps.length} 项)`,
      field: "component.registryDeps",
    });
  }

  const targetRel = componentTargetRel(manifest.id);
  if (spec.target !== undefined && path.posix.normalize(spec.target.replaceAll("\\", "/")) !== targetRel) {
    issues.push({
      code: "target_mismatch",
      message: `target 声明值必须等于约定落点 "${targetRel}"(或直接省略),当前为 "${spec.target}"`,
      field: "component.target",
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { manifest, spec, targetRel } };
}
