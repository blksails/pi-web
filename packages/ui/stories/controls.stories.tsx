import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { PiThinkingLevel } from "../src/controls/pi-thinking-level.js";
import { PiSessionStats } from "../src/controls/pi-session-stats.js";
import { PiCommandPalette } from "../src/controls/pi-command-palette.js";
import { mockControls } from "./_mocks.js";

/**
 * controls 层:思考等级 / 会话统计 / 斜杠命令补全(ui-components 6.x)。
 * 模型选择器不在此层 —— 见 `elements/model-selector`(PiChat 提示词栏所用)。
 */
const meta: Meta = {
  title: "Controls/Overview",
};
export default meta;

type Story = StoryObj;

export const ThinkingLevel: Story = {
  render: () => <PiThinkingLevel controls={mockControls()} />,
};

export const SessionStats: Story = {
  render: () => <PiSessionStats controls={mockControls()} />,
};

export const SessionStatsEmpty: Story = {
  render: () => <PiSessionStats controls={mockControls({ stats: undefined })} />,
};

export const CommandPalette: Story = {
  render: () => {
    const [value, setValue] = React.useState("/");
    return (
      <PiCommandPalette
        controls={mockControls()}
        value={value}
        onChange={setValue}
        onSubmit={(cmd) => setValue(`/${cmd.name} `)}
      />
    );
  },
};
