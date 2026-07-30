/** boom(GET):handler 抛错(ok:false handler_error 归一化断言)。 */
export const boomRoute = {
  name: "boom",
  methods: ["GET"],
  handler: (): unknown => {
    throw new Error("boom: intentional fixture failure");
  },
};
