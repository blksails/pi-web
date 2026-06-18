import type { Meta, StoryObj } from "@storybook/react-vite";
import { PiToolPart, type ToolPart } from "../src/parts/pi-tool-part.js";

/**
 * 工具卡 start → update → end → error 四态(ui-components 4.1)。
 */
const meta: Meta<typeof PiToolPart> = {
  title: "Parts/PiToolPart",
  component: PiToolPart,
};
export default meta;

type Story = StoryObj<typeof PiToolPart>;

const startPart = {
  type: "tool-search",
  toolCallId: "call-search",
  state: "input-available",
  input: { q: "pi" },
} as unknown as ToolPart;

const updatePart = {
  type: "tool-search",
  toolCallId: "call-search",
  state: "output-available",
  input: { q: "pi" },
  output: { hits: 1, partial: true },
  preliminary: true,
} as unknown as ToolPart;

const endPart = {
  type: "tool-search",
  toolCallId: "call-search",
  state: "output-available",
  input: { q: "pi" },
  output: { hits: 3, items: ["a", "b", "c"] },
} as unknown as ToolPart;

const errorPart = {
  type: "tool-search",
  toolCallId: "call-search",
  state: "output-error",
  input: { q: "pi" },
  errorText: "search backend unavailable",
} as unknown as ToolPart;

export const Start: Story = { args: { part: startPart, defaultOpen: true } };
export const Update: Story = { args: { part: updatePart, defaultOpen: true } };
export const End: Story = { args: { part: endPart, defaultOpen: true } };
export const ErrorState: Story = { args: { part: errorPart, defaultOpen: true } };
