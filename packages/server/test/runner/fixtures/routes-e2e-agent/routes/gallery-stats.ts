/**
 * gallery-stats(GET):定值 JSON + query 回显(闭环 + 入参透传断言)。
 *
 * fixture 刻意用 plain 对象、**不** import agent-kit(server 包不依赖 agent-kit,fixture 落在
 * server tsconfig 内);loader 经 duck-type 接受。文件组织按声明式路由标准:一路由一文件。
 */
export const galleryStatsRoute = {
  name: "gallery-stats",
  methods: ["GET"],
  description: "Gallery statistics (fixture)",
  handler: (req: { query: Record<string, string> }): unknown => ({
    images: 3,
    source: "routes-e2e-agent",
    query: req.query,
  }),
};
