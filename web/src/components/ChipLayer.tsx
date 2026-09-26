import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { openChip, pictureStore } from "../chipActions";
import { chipAction, nameOf } from "../composer/chip";
import { vaultUrl } from "../pages";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";

/** The chip under an event, if it is on one: `data-file-chip` is what the box's chips and a sent message's both wear. */
const chipOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>("[data-file-chip][data-path]") : null);

/**
 * What a file's chip does, for every chip in the window at once: listened for
 * on the document, so a chip in the message box — plain DOM, drawn by
 * ProseMirror (composer/schema.ts) — and one in a message sent (FileChip.tsx)
 * are the same thing to press and to point at, and so is any drawn later.
 *
 * Pressed (or Enter on one that has the focus): opened (chipActions.ts).
 * Pointed at: its path, and a picture given to the box, shown — without
 * taking the focus, which may be in the box, mid-sentence. A picture opened
 * is looked at large over the window, and Escape puts it away.
 */
export function ChipLayer() {
	const [hovered, setHovered] = useState<HTMLElement | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const picture = useSyncExternalStore(pictureStore.subscribe, pictureStore.get);

	useEffect(() => {
		const later = (run: () => void, ms: number) => {
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(run, ms);
		};
		const over = (e: PointerEvent) => {
			const chip = chipOf(e.target);
			if (chip) later(() => setHovered(chip), 250);
		};
		const out = (e: PointerEvent) => {
			if (chipOf(e.target) && !chipOf(e.relatedTarget)) later(() => setHovered(null), 100);
		};
		const click = (e: MouseEvent) => {
			const chip = chipOf(e.target);
			if (!chip || e.button !== 0) return;
			e.preventDefault();
			setHovered(null);
			openChip(chip.dataset.path!);
		};
		const key = (e: KeyboardEvent) => {
			const chip = chipOf(e.target);
			if (!chip || e.key !== "Enter" || e.target !== chip) return;
			e.preventDefault();
			openChip(chip.dataset.path!);
		};
		document.addEventListener("pointerover", over);
		document.addEventListener("pointerout", out);
		document.addEventListener("click", click);
		document.addEventListener("keydown", key);
		return () => {
			if (timer.current) clearTimeout(timer.current);
			document.removeEventListener("pointerover", over);
			document.removeEventListener("pointerout", out);
			document.removeEventListener("click", click);
			document.removeEventListener("keydown", key);
		};
	}, []);

	const path = hovered?.isConnected ? hovered.dataset.path! : null;
	return (
		<>
			<Popover open={path !== null}>
				<PopoverAnchor virtualRef={{ current: hovered! }} />
				{path && (
					<PopoverContent
						id="chip-preview"
						side="top"
						align="start"
						className="pointer-events-none w-auto max-w-80 p-2 text-xs"
						onOpenAutoFocus={(e) => e.preventDefault()}
						onCloseAutoFocus={(e) => e.preventDefault()}
					>
						{chipAction(path) === "picture" && <img src={vaultUrl(path)} alt={nameOf(path)} className="mb-1.5 max-h-64 max-w-72 rounded-sm object-contain" />}
						<p className="break-all text-muted-foreground">{path}</p>
					</PopoverContent>
				)}
			</Popover>
			<Dialog open={picture !== null} onOpenChange={(open) => !open && pictureStore.set(null)}>
				<DialogContent id="chip-picture" className="w-auto max-w-[90vw] p-3 sm:max-w-[90vw]">
					<DialogTitle className="truncate pr-8 text-sm font-normal">{picture && nameOf(picture)}</DialogTitle>
					<DialogDescription className="sr-only">The picture given to the agent, large.</DialogDescription>
					{picture && <img src={vaultUrl(picture)} alt={nameOf(picture)} className="max-h-[80vh] max-w-full rounded-sm object-contain" />}
				</DialogContent>
			</Dialog>
		</>
	);
}
