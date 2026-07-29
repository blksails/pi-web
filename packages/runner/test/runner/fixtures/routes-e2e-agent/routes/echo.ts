/** echo(POST):body/method 回显(POST body 过帧断言)。 */
export const echoRoute = {
  name: "echo",
  methods: ["POST"],
  handler: (req: { method: string; body?: unknown }): unknown => ({
    method: req.method,
    received: req.body,
  }),
};
