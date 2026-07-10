/**
 * InstallResultRenderer — `/install` 结果卡片(spec install-host-command,任务 3.2)。
 *
 * 渲染 `data-install-result` data part:头行(action/kind/id/成败)、location、guidance、
 * steps(失败步标红)、items 表(list 子动作)。data 先过 `InstallResultDataSchema.safeParse`,
 * 解析失败降级为 JSON 预格式块(不崩,BashResultRenderer 同型:同步 `<pre>`,不经 streamdown
 * 异步高亮)。
 */
import { InstallResultDataSchema } from "@blksails/pi-web-protocol";
import { useI18n } from "../i18n/index.js";
import { cn } from "../lib/cn.js";
import type { DataPartRenderer } from "../registry/renderer-registry.js";

export const InstallResultRenderer: DataPartRenderer = ({ part }) => {
  const data = "data" in part ? part.data : undefined;
  const t = useI18n();
  if (data === undefined) return null;

  const parsed = InstallResultDataSchema.safeParse(data);
  if (!parsed.success) {
    return (
      <div
        data-pi-install-result=""
        data-pi-install-parse-error=""
        className="my-1 overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--destructive))] text-sm"
      >
        <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1 text-xs text-[hsl(var(--muted-foreground))]">
          {t("installResult.parseError")}
        </div>
        <pre className="pi-scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  const result = parsed.data;
  return (
    <div
      data-pi-install-result=""
      data-pi-install-action={result.action}
      data-pi-install-ok={result.ok ? "true" : "false"}
      {...(result.kind !== undefined ? { "data-pi-install-kind": result.kind } : {})}
      {...(result.id !== undefined ? { "data-pi-install-id": result.id } : {})}
      className={cn(
        "my-1 overflow-hidden rounded-[var(--radius)] border text-sm",
        result.ok
          ? "border-[hsl(var(--border))]"
          : "border-[hsl(var(--destructive))]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1 font-mono">
        <span className="font-semibold">{result.action}</span>
        {result.kind !== undefined ? <span>· {result.kind}</span> : null}
        {result.id !== undefined ? (
          <span className="min-w-0 flex-1 break-all">· {result.id}</span>
        ) : null}
        <span
          className={cn(
            "ml-auto rounded px-1.5 py-0.5 text-xs",
            result.ok
              ? "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
              : "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]",
          )}
        >
          {result.ok ? t("installResult.ok") : t("installResult.failed")}
        </span>
      </div>

      <div className="flex flex-col gap-2 p-2 text-xs">
        {result.location !== undefined ? (
          <p data-pi-install-location>
            <span className="font-medium">{t("installResult.location")}: </span>
            <span className="break-all">{result.location}</span>
          </p>
        ) : null}

        {result.guidance !== undefined ? (
          <p data-pi-install-guidance>
            <span className="font-medium">{t("installResult.guidance")}: </span>
            <span>{result.guidance}</span>
          </p>
        ) : null}

        {result.error !== undefined ? (
          <p data-pi-install-error className="text-[hsl(var(--destructive))]">
            <span className="font-medium">{result.error.code}: </span>
            <span>{result.error.message}</span>
          </p>
        ) : null}

        {result.steps.length > 0 ? (
          <div data-pi-install-steps>
            <p className="font-medium">{t("installResult.steps")}</p>
            <ul className="flex flex-col gap-0.5">
              {result.steps.map((step, i) => (
                <li
                  key={`${step.stage}-${String(i)}`}
                  data-pi-install-step
                  data-status={step.status}
                  className={cn(
                    step.status === "failed"
                      ? "text-[hsl(var(--destructive))]"
                      : "text-[hsl(var(--muted-foreground))]",
                  )}
                >
                  {step.stage}
                  {step.detail !== undefined ? ` — ${step.detail}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {result.items !== undefined && result.items.length > 0 ? (
          <div data-pi-install-items>
            <p className="font-medium">{t("installResult.items")}</p>
            <table className="w-full text-left">
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id} data-pi-install-item data-id={item.id}>
                    <td className="pr-2 align-top break-all">{item.id}</td>
                    <td className="pr-2 align-top">{item.version ?? ""}</td>
                    <td className="pr-2 align-top">{item.kind ?? ""}</td>
                    <td className="align-top">{item.scope ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
};
