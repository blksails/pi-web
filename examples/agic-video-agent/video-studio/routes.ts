import { getSessionState } from "@blksails/pi-web-tool-kit";
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";
import { emptyVideoStudioState, VIDEO_STUDIO_STATE_KEY, type VideoStudioState } from "./model.js";

export const videoStudioStateRoute = {
  name: "video-studio-state",
  handler: async () => {
    const state = getSessionState().get<VideoStudioState>(VIDEO_STUDIO_STATE_KEY);
    return state ?? emptyVideoStudioState();
  },
} satisfies AgentRouteDecl;
