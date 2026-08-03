/**
 * `panes/generated.ts` 的类型垫片(spec host-builtin-panes,任务 1.1)。
 *
 * 真产物由 `scripts/build-builtin-panes.ts` 生成、被 gitignore、**不入库**。有了这份 `.d.ts`,
 * `tsc --noEmit` 在产物缺席时依然通过 —— 从而「本地类型检查绿」不再可能是因为工作树里
 * 恰好躺着一份没人生成的产物(本仓已三次踩到该陷阱)。
 *
 * 键是 pane 目录名(即 paneId 的后缀部分,不含 `host:` 前缀),值是自足 HTML 文档。
 * 故意用 `string` 索引而非字面量联合:内置 pane 清单会随下游 spec 增长,写死联合类型会让
 * 每加一个 pane 都要同步改垫片,而漏改的表现是类型错误 —— 噪音大于收益。
 */
export const builtinPaneDocuments: Readonly<Record<string, string>>;
