import { useLayoutEffect, useRef } from "react";

import type { Item } from "../types";
import { ItemView } from "./Item";

/** Near enough to the bottom that the view should keep following new content. */
const isAtBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;

export function Conversation({ items }: { items: Item[] }) {
	const main = useRef<HTMLElement>(null);
	// Recorded while the user scrolls rather than when content arrives: measured
	// afterwards, a tall new item is already in scrollHeight and the view would
	// read as scrolled away and stop following.
	const following = useRef(true);

	useLayoutEffect(() => {
		const el = main.current;
		if (el && following.current) el.scrollTop = el.scrollHeight;
	}, [items]);

	return (
		<main ref={main} onScroll={(e) => (following.current = isAtBottom(e.currentTarget))}>
			<div id="chat">
				{/* Items are only ever appended, never reordered, so the index is a stable key. */}
				{items.map((item, i) => (
					<ItemView key={i} item={item} />
				))}
			</div>
		</main>
	);
}
