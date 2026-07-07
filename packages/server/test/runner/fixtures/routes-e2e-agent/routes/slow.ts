/** slow(GET):按 query.ms 睡后返回(并发独立配对/不排队断言)。 */
export const slowRoute = {
  name: "slow",
  methods: ["GET"],
  handler: async (req: { query: Record<string, string> }): Promise<unknown> => {
    const ms = Number(req.query.ms ?? "300");
    await new Promise((r) => setTimeout(r, ms));
    return { slept: ms };
  },
};
