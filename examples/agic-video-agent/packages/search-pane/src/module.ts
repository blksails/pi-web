import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit";

export interface SearchPaneModule {
  readonly id: "search";
  readonly title: string;
  readonly icon: string;
  readonly entry: URL;
  readonly capabilities: NonNullable<PaneDefinitionInput["capabilities"]>;
}

export const searchPaneModule: SearchPaneModule = {
  id: "search",
  title: "搜图",
  icon: "search",
  entry: new URL("./guest.tsx", import.meta.url),
  capabilities: {
    routes: [{ name: "creative-search", methods: ["POST"] }],
  },
};
