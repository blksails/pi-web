/**
 * pane 声明模块(spec cli-agent-build 任务 5.1)——由 `pi-web build` 的 pane-discovery 经
 * `--panes panes-modules.ts` 显式求值(server/cli/build/pane-discovery.ts)。
 */
export default {
  id: "state-bridge",
  modules: [
    {
      id: "count",
      title: "共享状态",
      entry: "./web/panes/count.tsx",
      capabilities: {
        // ★ 读写分离在这里第一次被真实使用:该 pane 既读也写同一个键,
        // 故两张表都要列上(见旧 web/panes/index.ts 头注,已迁移保留)。
        state: { read: ["count"], write: ["count"] },
      },
    },
  ],
  panelConfig: { initialPaneIds: ["count"] },
};
