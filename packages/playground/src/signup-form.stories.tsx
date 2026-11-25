import type { Meta, StoryObj } from "@storybook/react-vite";

/** A sign-up form with deliberate UI flaws, for trying out reviews. */
function SignupForm({ showErrors }: { readonly showErrors: boolean }) {
	const input = {
		width: "100%",
		padding: "8px 10px",
		border: "1px solid #ccc",
		borderRadius: 4,
		fontSize: 14,
		boxSizing: "border-box",
	} as const;

	return (
		<form
			data-testid="signup-form"
			onSubmit={(e) => e.preventDefault()}
			style={{
				width: 360,
				padding: 24,
				border: "1px solid #e5e5e5",
				borderRadius: 8,
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<h2 style={{ margin: "0 0 4px", fontSize: 22 }}>Create your account</h2>
			<p style={{ margin: "0 0 24px", fontSize: 13, color: "#aaa" }}>
				Start your 14-day free trial. No credit card required.
			</p>

			<div style={{ display: "flex", gap: 12 }}>
				<label style={{ flex: 1, fontSize: 13 }}>
					First name
					<input name="firstName" style={{ ...input, marginTop: 4 }} />
				</label>
				<label style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>
					Last name
					<input name="lastName" style={{ ...input, marginTop: 8 }} />
				</label>
			</div>

			<label style={{ display: "block", fontSize: 13, marginTop: 16 }}>
				Email
				<input
					name="email"
					type="email"
					defaultValue={showErrors ? "jane@example" : ""}
					style={{ ...input, marginTop: 4, ...(showErrors && { borderColor: "#e53935" }) }}
				/>
			</label>
			{showErrors && (
				<span style={{ fontSize: 12, color: "#999" }}>Please enter a valid email address</span>
			)}

			<div style={{ marginTop: 16 }}>
				<span style={{ fontSize: 13 }}>Password</span>
				<input
					name="password"
					type="password"
					placeholder="At least 8 characters"
					style={{ ...input, marginTop: 4, borderRadius: 12 }}
				/>
			</div>

			<label style={{ display: "block", fontSize: 13, marginTop: 16 }}>
				Country
				<select name="country" style={{ ...input, width: "80%", marginTop: 4 }}>
					<option>France</option>
					<option>United States</option>
				</select>
			</label>

			<label style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 20, fontSize: 12 }}>
				<input type="checkbox" name="terms" style={{ marginTop: 6 }} />I agree to the Terms of
				Service and Privacy Policy
			</label>

			<div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
				<button
					type="button"
					style={{
						padding: "10px 16px",
						background: "#2563eb",
						color: "#fff",
						border: "none",
						borderRadius: 6,
					}}
				>
					Cancel
				</button>
				<button
					type="submit"
					data-testid="submit"
					style={{
						padding: "8px 14px",
						background: "#f3f4f6",
						color: "#666",
						border: "1px solid #ddd",
						borderRadius: 6,
					}}
				>
					Create account
				</button>
			</div>
		</form>
	);
}

const meta = {
	title: "Example/SignupForm",
	component: SignupForm,
	args: { showErrors: false },
} satisfies Meta<typeof SignupForm>;

export default meta;

export const Empty: StoryObj<typeof meta> = {};

export const WithErrors: StoryObj<typeof meta> = {
	args: { showErrors: true },
};
