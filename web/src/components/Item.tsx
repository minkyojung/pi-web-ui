import { memo } from "react";

import type { Item } from "../types";

/**
 * One conversation item. Memoized on the item object, which the store replaces
 * only when the reducer says that item changed — so a delta re-renders the one
 * row it landed in.
 */
export const ItemView = memo(function ItemView({ item }: { item: Item }) {
	switch (item.kind) {
		case "tool":
			return (
				<div className="mb-3 border-l-2 pl-2 font-mono text-xs text-muted-foreground">
					<span className="font-semibold">{item.name}</span> {JSON.stringify(item.args)}
					{item.result != null && (
						<pre className={`mt-1 max-h-48 overflow-auto whitespace-pre-wrap ${item.isError ? "text-destructive" : ""}`}>
							{item.result}
						</pre>
					)}
				</div>
			);
		case "user":
			return (
				<div className="mb-3 font-semibold whitespace-pre-wrap">
					<span className="text-muted-foreground">› </span>
					{item.text}
				</div>
			);
		case "error":
			return <div className="mb-3 whitespace-pre-wrap text-destructive">{item.text}</div>;
		case "done":
			return <div className="mb-3 text-xs text-muted-foreground">— 완료 —</div>;
		case "notice":
			return <div className="mb-3 text-xs text-amber-600 dark:text-amber-500">{item.text}</div>;
		default:
			return <div className="mb-3 whitespace-pre-wrap">{item.text}</div>;
	}
});
