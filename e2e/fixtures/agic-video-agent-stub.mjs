#!/usr/bin/env node
/**
 * 无供应商凭据的视频工作室 stub：真实装配 Surface + 本机 FFmpeg 工具。
 * 外部视频供应商仅由 text_to_video 事件模拟，后处理、落库、回流均真实执行。
 */
import process from "node:process";
import { execFile as execFileCallback } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FFMPEG = process.env.PI_WEB_FFMPEG_BIN ?? "ffmpeg";
const TOOLKIT_PATH = path.join(ROOT, "packages", "tool-kit", "src", "runtime.ts");
const MEDIA_RUNTIME_PATH = path.join(ROOT, "examples", "aigc-agent", "media-tools", "src", "runtime.ts");
const SURFACE_PATH = path.join(ROOT, "examples", "aigc-agent", "video-studio", "surface.ts");

const SESSION_ID = process.env.PI_WEB_STUB_SESSION_ID ?? "video-studio-e2e";
const tools = new Map();
const listeners = new Map();
const clipAssets = [];
let audioAsset;
let sourceVideo;
let sourceDir;
let sequence = 0;
let setupPromise;
const DEBUG_LOG = path.join(tmpdir(), "pi-web-agic-video-stub.log");

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function on(event, handler) {
  const current = listeners.get(event) ?? [];
  current.push(handler);
  listeners.set(event, current);
}

function dispatch(event, value) {
  for (const handler of listeners.get(event) ?? []) handler(value);
}

async function load(pathname) {
  return import(pathToFileURL(pathname).href);
}

async function setup() {
  // Keep the RPC handshake cheap. Jiti resolves the workspace TypeScript graph;
  // do it after readiness so the first idle window can absorb the cost.
  await import("jiti/register");
  const serverModule = await import("@blksails/pi-web-server");
  const server = serverModule.default ?? serverModule;
  const toolkitModule = await load(TOOLKIT_PATH);
  const toolkit = toolkitModule.default ?? toolkitModule;
  const mediaModule = await load(MEDIA_RUNTIME_PATH);
  const media = mediaModule.default ?? mediaModule;
  const surfaceModule = await load(SURFACE_PATH);
  const surface = surfaceModule.default ?? surfaceModule;
  const childStore = server.createChildAttachmentStore(process.env);
  const attachmentContext = server.createAttachmentToolContext(childStore, SESSION_ID);
  globalThis[toolkit.SEAM_KEY] = attachmentContext;

  const pi = {
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    registerCommand() {},
    on,
  };
  surface.videoStudioSurfaceExtension(pi);
  media.mediaToolsExtension(pi);
  return { attachmentContext };
}

function ensureSetup() {
  setupPromise ??= setup().catch((error) => {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${error instanceof Error ? error.stack : String(error)}\n`, "utf8");
    throw error;
  });
  return setupPromise;
}

async function makeSourceVideo() {
  if (sourceVideo !== undefined) return sourceVideo;
  sourceDir = await mkdtemp(path.join(tmpdir(), "pi-web-video-stub-"));
  sourceVideo = path.join(sourceDir, "source.mp4");
  await execFile(FFMPEG, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100",
    "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourceVideo,
  ]);
  return sourceVideo;
}

function partial() {
  return {
    role: "assistant", content: [], api: "stub", provider: "stub", model: "stub-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: 0,
  };
}

function emitText(text) {
  const message = partial();
  write({ type: "message_update", message, assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: message } });
  write({ type: "message_update", message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text, partial: message } });
  write({ type: "message_update", message, assistantMessageEvent: { type: "text_end", contentIndex: 0, content: text, partial: message } });
}

async function runRegistered(name, args) {
  const tool = tools.get(name);
  const toolCallId = `video-e2e-${++sequence}`;
  const start = { toolName: name, toolCallId, args };
  write({ type: "tool_execution_start", ...start });
  dispatch("tool_execution_start", start);
  let result;
  let isError = false;
  try {
    if (tool === undefined) throw new Error(`missing tool: ${name}`);
    result = await tool.execute(toolCallId, args, undefined, undefined, undefined);
    isError = result?.details?.ok === false;
  } catch (error) {
    isError = true;
    const message = error instanceof Error ? error.message : String(error);
    result = { content: [{ type: "text", text: message }], details: { ok: false, error: message } };
  }
  const end = { toolName: name, toolCallId, args, result, isError };
  write({ type: "tool_execution_end", ...end });
  dispatch("tool_execution_end", end);
  if (isError) throw new Error(result?.details?.error ?? `tool failed: ${name}`);
  return result;
}

function emitVirtual(name, args, result, phase) {
  const event = { toolName: name, toolCallId: `video-e2e-${++sequence}`, args, result, isError: false };
  write({ type: phase === "start" ? "tool_execution_start" : "tool_execution_end", ...event });
  dispatch(phase === "start" ? "tool_execution_start" : "tool_execution_end", event);
}

function assets(result) {
  return result?.details?.assets ?? [];
}

async function runPlan() {
  await runRegistered("video_plan", {
    title: "FFmpeg 实机验收短片",
    brief: "两镜头展示清晨海边咖啡店，验证视频工作室方案、历史与轨道合成。",
    aspect_ratio: "16:9",
    target_duration_sec: 6,
    shots: [
      { title: "海边建立镜头", prompt: "清晨海边咖啡店，橘猫追纸飞机，缓慢推镜，金色逆光，保持角色连续，负向：无文字水印。", duration_sec: 3 },
      { title: "咖啡桌近景", prompt: "橘猫跳上木桌接住纸飞机，轻微环绕，暖色自然光，延续同一海边咖啡店，负向：无闪烁。", duration_sec: 3 },
    ],
  });
  await runRegistered("video_shot_prompt", {
    shot_id: "shot-01",
    prompt: "清晨海边咖啡店，橘猫追纸飞机后停在门边，缓慢推镜，金色逆光，保持角色与色调连续，负向：无文字水印。",
  });
}

async function runShot(shotId, index) {
  const input = await makeSourceVideo();
  emitVirtual("text_to_video", { shot_id: shotId }, undefined, "start");
  const result = await runRegistered("video_clip", {
    video_url: input,
    start_seconds: index === 0 ? 0 : 1,
    duration_seconds: 1,
  });
  const asset = assets(result)[0];
  if (asset === undefined) throw new Error(`video_clip produced no asset for ${shotId}`);
  clipAssets[index] = asset;
  emitVirtual("text_to_video", { shot_id: shotId }, result, "end");
}

async function runMediaShots() {
  await runShot("shot-01", 0);
  await runShot("shot-02", 1);
  const result = await runRegistered("audio_extract", { video_url: await makeSourceVideo(), format: "mp3", clip_seconds: 2 });
  audioAsset = assets(result)[0];
  if (audioAsset === undefined) throw new Error("audio_extract produced no asset");
}

async function runFinal() {
  if (clipAssets.length !== 2 || audioAsset?.attachmentId === undefined) await runMediaShots();
  const concat = await runRegistered("video_concat", {
    video_urls: clipAssets.map((asset) => asset.attachmentId),
  });
  const concatAsset = assets(concat)[0];
  if (concatAsset?.attachmentId === undefined) throw new Error("video_concat produced no asset");
  await runRegistered("video_with_audio", {
    video_url: concatAsset.attachmentId,
    audio_url: audioAsset.attachmentId,
    mode: "replace",
    audio_trim_start_seconds: 0.25,
    audio_duration_seconds: 1,
    audio_start_seconds: 0.5,
    audio_volume: 0.7,
  });
}

async function handlePrompt(cmd) {
  const message = typeof cmd.message === "string" ? cmd.message : "";
  await ensureSetup();
  write({ type: "agent_start" });
  write({ type: "turn_start" });
  try {
    if (message.includes("video_plan")) {
      await runPlan();
      emitText("已生成结构化视频方案，并保留镜头提示词历史。");
    } else if (message.includes("video_concat") && message.includes("video_with_audio")) {
      await runFinal();
      emitText("已用本机 FFmpeg 完成视频拼接与音轨合成。");
    } else {
      const shotId = message.match(/shot-\d{2}/)?.[0] ?? "shot-01";
      if (clipAssets.length === 0) await runMediaShots();
      else if (clipAssets[shotId === "shot-02" ? 1 : 0] === undefined) {
        await runShot(shotId, shotId === "shot-02" ? 1 : 0);
      }
      emitText(`已完成 ${shotId} 的实机媒体生成验证。`);
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    emitText(`媒体验收失败：${text}`);
  }
  const messageFrame = partial();
  write({ type: "turn_end", message: messageFrame, toolResults: [] });
  write({ type: "agent_end", messages: [], willRetry: false });
  write({ type: "response", id: cmd.id, command: "prompt", success: true });
}

async function handle(cmd) {
  if (cmd.type === "prompt") return handlePrompt(cmd);
  if (cmd.type === "get_messages") return write({ type: "response", id: cmd.id, command: "get_messages", success: true, data: { messages: [] } });
  if (cmd.type === "get_available_models") return write({ type: "response", id: cmd.id, command: "get_available_models", success: true, data: { models: [{ id: "stub-model", name: "Stub Model", api: "stub", provider: "stub", input: ["text"], contextWindow: 200000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } });
  if (cmd.type === "set_model" || cmd.type === "setModel") return write({ type: "response", id: cmd.id, command: "set_model", success: true });
  if (cmd.type === "get_commands") return write({ type: "response", id: cmd.id, command: "get_commands", success: true, data: { commands: [] } });
  return write({ type: "response", id: cmd.id, command: cmd.type, success: true });
}

let chain = Promise.resolve();
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (line === "") continue;
    let command;
    try { command = JSON.parse(line); } catch { continue; }
    chain = chain.then(() => handle(command)).catch((error) => process.stderr.write(`agic-video-stub: ${String(error)}\n`));
  }
});
process.stdin.on("end", () => { void chain.finally(() => process.exit(0)); });
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

// Custom agents must announce readiness independently of get_commands. This
// frame lets the host finish its handshake while the implementation warms up.
write({ type: "runner_ready" });

// Warm the agent during the first idle window. A prompt still awaits the same
// promise, so a cold first request remains correct if warmup has not finished.
setTimeout(() => { void ensureSetup().catch(() => {}); }, 0);
