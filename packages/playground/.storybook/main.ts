import type { StorybookConfig } from "@storybook/react-vite";

/** A small Storybook to develop and try the review addon in. */
const config: StorybookConfig = {
	framework: "@storybook/react-vite",
	stories: ["../src/**/*.stories.tsx"],
	addons: ["@pairprog/storybook-addon-review"],
	core: { disableTelemetry: true },
};

export default config;
