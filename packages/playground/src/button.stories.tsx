import type { Meta, StoryObj } from "@storybook/react-vite";

function Button({ label }: { readonly label: string }) {
	return (
		<button type="button" data-testid="button">
			{label}
		</button>
	);
}

const meta = {
	title: "Example/Button",
	component: Button,
	args: { label: "Save" },
} satisfies Meta<typeof Button>;

export default meta;

export const Primary: StoryObj<typeof meta> = {};
