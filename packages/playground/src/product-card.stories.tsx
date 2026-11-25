import type { Meta, StoryObj } from "@storybook/react-vite";

/** A product card with deliberate UI flaws, for trying out reviews. */
function ProductCard({
	name,
	price,
	originalPrice,
	rating,
	reviews,
	inStock,
}: {
	readonly name: string;
	readonly price: number;
	readonly originalPrice?: number;
	readonly rating: number;
	readonly reviews: number;
	readonly inStock: boolean;
}) {
	return (
		<article
			data-testid="product-card"
			style={{
				width: 280,
				border: "1px solid #ddd",
				borderRadius: 16,
				fontFamily: "system-ui, sans-serif",
				overflow: "hidden",
				background: "#fff",
			}}
		>
			<div style={{ position: "relative" }}>
				<img
					src="https://picsum.photos/seed/headphones/560/400"
					style={{ width: "100%", height: 220, display: "block" }}
				/>
				{originalPrice !== undefined && (
					<span
						style={{
							position: "absolute",
							top: 8,
							right: 4,
							background: "#ffcc00",
							color: "#fff",
							fontSize: 11,
							padding: "2px 6px",
							borderRadius: 2,
						}}
					>
						SALE
					</span>
				)}
			</div>
			<div style={{ padding: "12px 20px 20px 14px" }}>
				<h3
					style={{
						margin: 0,
						fontSize: 17,
						whiteSpace: "nowrap",
					}}
				>
					{name}
				</h3>
				<div style={{ color: "#bbb", fontSize: 12, marginTop: 6 }}>
					{"★".repeat(Math.round(rating))}
					{"☆".repeat(5 - Math.round(rating))} ({reviews} reviews)
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "flex-start",
						gap: 8,
						marginTop: 14,
					}}
				>
					<span style={{ fontSize: 24, fontWeight: 700 }}>${price}</span>
					{originalPrice !== undefined && (
						<span style={{ fontSize: 13, color: "#999" }}>${originalPrice}</span>
					)}
				</div>
				<p style={{ fontSize: 12, color: inStock ? "#2e7d32" : "#2e7d32", margin: "4px 0 0" }}>
					{inStock ? "In stock" : "Out of stock"}
				</p>
				<div style={{ display: "flex", gap: 6, marginTop: 18 }}>
					<button
						type="button"
						data-testid="add-to-cart"
						style={{
							flex: 1,
							padding: "10px 0",
							background: "#2563eb",
							color: "#fff",
							border: "none",
							borderRadius: 6,
							fontSize: 14,
						}}
					>
						Add to cart
					</button>
					<button
						type="button"
						style={{
							width: 30,
							padding: 0,
							background: "#fff",
							border: "1px solid #ccc",
							borderRadius: 999,
						}}
					>
						♡
					</button>
				</div>
			</div>
		</article>
	);
}

const meta = {
	title: "Example/ProductCard",
	component: ProductCard,
	args: {
		name: "Aurora Wireless Noise-Cancelling Over-Ear Headphones",
		price: 149.9,
		originalPrice: 199.99,
		rating: 4.4,
		reviews: 1287,
		inStock: true,
	},
} satisfies Meta<typeof ProductCard>;

export default meta;

export const OnSale: StoryObj<typeof meta> = {};

export const OutOfStock: StoryObj<typeof meta> = {
	args: { originalPrice: undefined, inStock: false, price: 89 },
};
