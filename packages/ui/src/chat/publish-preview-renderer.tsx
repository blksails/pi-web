/**
 * PublishPreviewRenderer — `/agent publish` / `/plugin publish` 的发布前预览卡片
 * (spec publish-host-command,任务 3.3)。
 *
 * 渲染 `data-publish-preview` data part。与安装卡片刻意分开:预览的内容是**文件 + 告警 +
 * 差异声明**,与"装了什么"结构不同,合并渲染会让告警只能寄生在 steps 里而失去语义。
 *
 * 三条渲染约定:
 *  1. **差异声明按布尔位渲染**(`disclaimers.unsigned` / `grantNotChecked`),不做文案匹配 ——
 *     文案会被翻译改写,布尔位不会。
 *  2. **告警是独立区块**,与错误在视觉上可辨:告警不阻断发布,错误阻断,混在一起会误导。
 *  3. **文件清单不截断**:超长时用可滚动容器,总数恒可见 —— 静默截断会让人以为漏了文件。
 */
import { PublishPreviewDataSchema } from "@blksails/pi-web-protocol";
import { cn } from "../lib/cn.js";
import type { DataPartRenderer } from "../registry/renderer-registry.js";

export const PublishPreviewRenderer: DataPartRenderer = ({ part }) => {
  const data = "data" in part ? part.data : undefined;
  if (data === undefined) return null;

  const parsed = PublishPreviewDataSchema.safeParse(data);
  if (!parsed.success) {
    // 与 InstallResultRenderer 同型的降级:不崩,原样给出 JSON 供排障。
    return (
      <div
        data-pi-publish-preview=""
        data-pi-publish-parse-error=""
        className="my-1 overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--destructive))] text-sm"
      >
        <pre className="pi-scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  const r = parsed.data;

  return (
    <div
      data-pi-publish-preview=""
      data-pi-publish-ok={String(r.ok)}
      className={cn(
        "my-1 overflow-hidden rounded-[var(--radius)] border text-sm",
        r.ok ? "border-[hsl(var(--border))]" : "border-[hsl(var(--destructive))]",
      )}
    >
      {/* 头行:包身份 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1 text-xs">
        <span className="font-medium">publish</span>
        {r.package !== undefined ? (
          <>
            <span data-pi-publish-id className="font-mono">
              {r.package.id}@{r.package.version}
            </span>
            <span className="rounded bg-[hsl(var(--background))] px-1">{r.package.kind}</span>
          </>
        ) : null}
        <span className="ml-auto">
          {r.published !== undefined ? (r.published.channelMoved ? "已发布" : "已登记") : r.ok ? "预览通过" : "未通过"}
        </span>
      </div>

      <div className="space-y-2 p-2">
        {/* ★ 差异声明:据布尔位渲染,恒醒目。这是"预览≠发布"的唯一可靠载体。 */}
        {r.disclaimers.unsigned || r.disclaimers.grantNotChecked ? (
          <div
            data-pi-publish-disclaimer=""
            className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1 text-xs"
          >
            <div className="font-medium">这是发布前预览,尚未发布。</div>
            <ul className="mt-1 list-disc pl-4">
              {r.disclaimers.unsigned ? (
                <li data-pi-publish-unsigned>本次未签名,因此不含发布者身份与签名。</li>
              ) : null}
              {r.disclaimers.grantNotChecked ? (
                <li data-pi-publish-grant-unchecked>
                  未校验发布授予与属主关系 —— 那些只有在真正发布时才判定。
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {/* ★ 已发布(spec publish-execution)。发布不可逆,故这里同时承担"告知后果"的职责。 */}
        {r.published !== undefined ? (
          <div
            data-pi-publish-published=""
            data-pi-publish-channel-moved={String(r.published.channelMoved)}
            className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1 text-xs"
          >
            <div className="font-medium">
              已发布到注册表:
              <span data-pi-publish-published-id className="ml-1 font-mono">
                {r.published.sourceId}@{r.published.version}
              </span>
            </div>
            <ul className="mt-1 list-disc pl-4">
              <li data-pi-publish-identity>
                发布者 <span className="font-mono">{r.published.publisherId}</span>,命名空间{" "}
                <span className="font-mono">{r.published.org}</span>
              </li>
              {r.published.channelMoved ? (
                <li data-pi-publish-channel>
                  通道 <span className="font-mono">{r.published.channel}</span> 已指向该版本。
                </li>
              ) : (
                // ★ 部分成功必须能被单独看见:渲染成失败会让人以为可原版本重试(不能,版本号已占用);
                //   渲染成纯成功则会让人以为消费方已能拿到新版本(拿不到)。
                <li data-pi-publish-channel-not-moved className="text-[hsl(var(--destructive))]">
                  版本已登记,但通道 <span className="font-mono">{r.published.channel}</span> 未移过去 ——
                  消费方还取不到这个版本。重试只需移通道,<strong>不要</strong>改版本号。
                </li>
              )}
              <li data-pi-publish-immutable>
                该版本已不可更改、不可删除。后续改动请提<strong>新的版本号</strong>。
              </li>
            </ul>
          </div>
        ) : null}

        {/* 失败 */}
        {r.error !== undefined ? (
          <div className="space-y-1">
            <p data-pi-publish-error className="text-[hsl(var(--destructive))]">
              {r.error.code}: {r.error.message}
            </p>
            {r.error.hint !== undefined ? (
              <p data-pi-publish-hint className="text-xs text-[hsl(var(--muted-foreground))]">
                {r.error.hint}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* 告警:独立区块,与 error 视觉可辨(告警不阻断,错误阻断)。 */}
        {r.warnings.length > 0 ? (
          <div
            data-pi-publish-warnings=""
            className="rounded border border-[hsl(var(--border))] px-2 py-1 text-xs"
          >
            <div className="font-medium">告警 {r.warnings.length} 条</div>
            <ul className="mt-1 list-disc pl-4">
              {r.warnings.map((w, i) => (
                <li key={i} data-pi-publish-warning>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* 文件清单:总数恒可见;长清单滚动而非截断。 */}
        {r.files.length > 0 ? (
          <div className="text-xs">
            <div data-pi-publish-file-count className="mb-1 font-medium">
              {r.published !== undefined ? "已发布的文件" : "将纳入发布的文件"}:{r.files.length} 个
            </div>
            <div className="pi-scrollbar-thin max-h-64 overflow-auto rounded border border-[hsl(var(--border))]">
              <table className="w-full text-left font-mono">
                <tbody>
                  {r.files.map((f) => (
                    <tr key={f.path} data-pi-publish-file className="border-b border-[hsl(var(--border))] last:border-0">
                      <td className="px-2 py-0.5">{f.path}</td>
                      <td className="px-2 py-0.5 text-[hsl(var(--muted-foreground))]">
                        {f.integrity.slice(0, 16)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
