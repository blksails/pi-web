import type { Meta, StoryObj } from "@storybook/react-vite";
import { PiReasoning, type ReasoningPart } from "../src/parts/pi-reasoning.js";

/**
 * 可折叠思考块:折叠 / 展开 / 流式进行中(ui-components 4.2)。
 */
const meta: Meta<typeof PiReasoning> = {
  title: "Parts/PiReasoning",
  component: PiReasoning,
};
export default meta;

type Story = StoryObj<typeof PiReasoning>;

const donePart = {
  type: "reasoning",
  text: "先分解问题,再逐步推导得到答案。",
  state: "done",
} as unknown as ReasoningPart;

const streamingPart = {
  type: "reasoning",
  text: "正在思考",
  state: "streaming",
} as unknown as ReasoningPart;

export const Collapsed: Story = { args: { part: donePart, defaultOpen: false } };
export const Expanded: Story = { args: { part: donePart, defaultOpen: true } };
export const Streaming: Story = {
  args: { part: streamingPart, defaultOpen: true },
};
