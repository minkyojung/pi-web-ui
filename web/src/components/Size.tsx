/**
 * Lines added and taken out, `+12 −3`, in the colours a diff has. Its own
 * file so that the foot of the window can say it without loading the
 * editor that the pages drawing whole diffs bring (Commit.tsx).
 */
export function Size({ added, deleted }: { added: number; deleted: number }) {
	return (
		<span className="shrink-0 tabular-nums">
			<span style={{ color: "var(--code-string)" }}>+{added}</span> <span className="text-destructive">−{deleted}</span>
		</span>
	);
}
