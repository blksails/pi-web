import type { Preview } from "@storybook/react-vite";
// Tailwind 工具类(经 main.ts 的 PostCSS 管线生成)+ shadcn CSS 变量主题层。
import "./tailwind.css";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: { expanded: true },
  },
};

export default preview;
