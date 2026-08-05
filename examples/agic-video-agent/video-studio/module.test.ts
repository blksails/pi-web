import test from "node:test";
import assert from "node:assert/strict";
import { VIDEO_STUDIO_PANE_ID, videoStudioPaneModule } from "./module.js";
import { videoStudioStateRoute } from "./routes.js";

test("video studio pane exposes only declared, bounded controls", () => {
  assert.equal(VIDEO_STUDIO_PANE_ID, "video-studio");
  assert.equal(videoStudioPaneModule.title, "视频工作室");
  assert.deepEqual(videoStudioPaneModule.capabilities.surfaceKeys, ["surface:video-studio"]);
  const grants = videoStudioPaneModule.capabilities.surfaceCommands[0]!;
  assert.equal(grants.domain, "video-studio");
  assert.ok(grants.actions.includes("pause-shot"));
  assert.ok(grants.actions.includes("request-export"));
  assert.ok(grants.actions.includes("select-prompt"));
  assert.ok(grants.actions.includes("add-to-timeline"));
  assert.ok(grants.actions.includes("set-audio-track"));
  assert.ok(grants.actions.includes("apply-transaction"));
  assert.ok(grants.actions.includes("run-workflow"));
  assert.equal(videoStudioStateRoute.name, "video-studio-state");
});
