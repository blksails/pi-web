/**
 * pane 声明模块(spec cli-agent-build 任务 5.1)——由 `pi-web build` 的 pane-discovery 经
 * `--panes panes-modules.ts` 显式求值(server/cli/build/pane-discovery.ts)。
 */
export default {
  id: "surface-demo",
  modules: [
    {
      id: "demo",
      title: "Demo Surface",
      entry: "./web/panes/demo.tsx",
      capabilities: {
        // 读该 domain 的权威快照 + 执行 increment 命令。逐项授予,不多给。
        surfaceKeys: ["surface:demo"],
        surfaceCommands: [{ domain: "demo", actions: ["increment"] }],
      },
    },
  ],
  panelConfig: { initialPaneIds: ["demo"] },
};
