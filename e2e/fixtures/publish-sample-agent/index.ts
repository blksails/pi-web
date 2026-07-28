/**
 * publish 预览 e2e 的最小 agent 入口(spec publish-host-command,任务 4.1)。
 *
 * ★ 这个夹具**刻意不带 `.pi/web`**:examples 下两个真实 agent 包都带 webext 源,
 *   其 `.pi/web/dist` 是 gitignored 构建产物,在 fresh worktree 里 `compile()` 恒失败于
 *   `WEBEXT_SOURCE_WITHOUT_DIST`。夹具若照抄它们,e2e 会在干净检出上必红。
 */
export default {
  name: "publish-sample",
};
