/** DashScope 视频 / 音频 model id(端口自 pi-labs models.ts 的视频/TTS/数字人子集)。 */
export const DASHSCOPE_VIDEO_MODELS = {
  // text → video
  wanx21T2V: "wanx2.1-t2v-turbo",
  wan26T2V: "wan2.6-t2v",
  wan27T2V: "wan2.7-t2v-2026-04-25",
  // image → video
  wan22I2VPlus: "wan2.2-i2v-plus",
  wan26I2V: "wan2.6-i2v",
  wan27I2V: "wan2.7-i2v-2026-04-25",
  // reference → video
  wan27R2V: "wan2.7-r2v",
  // video edit
  wan27VideoEdit: "wan2.7-videoedit",
  // digital human lip-sync
  wan22S2V: "wan2.2-s2v",
} as const;

/** CosyVoice TTS models。 */
export const DASHSCOPE_TTS_MODELS = {
  cosyvoiceV2: "cosyvoice-v2",
  cosyvoiceV1: "cosyvoice-v1",
} as const;
