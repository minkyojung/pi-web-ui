import { memo } from "react";

import type { Item } from "../types";

/**
 * One conversation item. Memoized on the item object, which the store replaces
 * only when the reducer says that item changed — so a delta re-renders the one
 * row it landed in.
 */
export const ItemView = memo(function ItemView({ item }: { item: Item }) {
	if (item.kind === "tool") {
		return (
			<div className="item tool">
				<span className="name">{item.name}</span> {JSON.stringify(item.args)}
				<pre hidden={item.result == null} className={item.isError ? "error" : ""}>
					{item.result}
				</pre>
			</div>
		);
	}
	return <div className={`item ${item.kind}`}>{item.kind === "done" ? "— 완료 —" : item.text}</div>;
});
