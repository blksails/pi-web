/** webext-artifact-agent UI 扩展:Tier 4 artifact 声明(宿主用 sandbox iframe 渲染)。 */
import { defineWebExtension } from "@blksails/web-kit";

export default defineWebExtension({
  manifestId: "webext-artifact",
  capabilities: ["artifact"],
  artifact: {
    entry: "artifact.html",
    initialHeight: 240,
  },
});
