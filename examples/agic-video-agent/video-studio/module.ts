import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit";

export const VIDEO_STUDIO_PANE_ID = "video-studio";

export const videoStudioPaneModule = {
  id: VIDEO_STUDIO_PANE_ID,
  title: "视频工作室",
  icon: "clapperboard",
  entry: new URL("./guest.tsx", import.meta.url),
  capabilities: {
    routes: [{ name: "video-studio-state", methods: ["GET"] }],
    surfaceKeys: ["surface:video-studio"],
    surfaceCommands: [
      {
        domain: "video-studio",
        actions: [
          "create-plan",
          "update-brief",
          "update-shot",
          "queue-shot",
          "queue-all",
          "pause-shot",
          "resume-shot",
          "retry-shot",
          "rollback-shot",
          "select-video",
          "select-prompt",
          "delete-prompt-history",
          "delete-video-history",
          "add-to-timeline",
          "remove-from-timeline",
          "set-audio-track",
          "trim-audio-track",
          "clear-audio-track",
          "clear-timeline",
          "request-export",
          "sync",
          "apply-transaction",
          "run-workflow",
        ],
      },
    ],
    conversation: "submit",
  } satisfies NonNullable<PaneDefinitionInput["capabilities"]>,
} as const;

export type VideoStudioPaneModule = typeof videoStudioPaneModule;
