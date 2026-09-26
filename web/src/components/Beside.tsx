import { useSyncExternalStore } from "react";

import { TextQuoteIcon } from "lucide-react";

import { frontLabel } from "../frontLabel";
import { vaultUrl } from "../pages";
import { specsStore } from "../serverState";
import type { Item } from "../types";
import { FrontMark } from "./FrontMark";
import { Attachment, AttachmentContent, AttachmentMedia, AttachmentTitle } from "./ui/attachment";

/**
 * What was sent beside a message, over it: the tab that was in front and the
 * words chosen in it, as the strip over the box said them before it went
 * (Composer.tsx Front), and the pictures, from the copies kept of them
 * (attach.ts keepPictures). What the agent was given, the person can see
 * after, as they could before. Quiet, since the message is what was said.
 */
export function Beside({ beside }: { beside: NonNullable<Item["beside"]> }) {
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const label = beside.front ? frontLabel(specs, beside.front) : null;
	const pictures = beside.pictures ?? [];
	if (!label && !beside.chosen && pictures.length === 0) return null;
	const name = label ? ("id" in label ? [label.id, label.name ?? (label.kind === "task" ? `Task ${label.id}` : null)].filter(Boolean).join(" ") : label.name) : null;
	return (
		<div data-beside className="ml-auto flex max-w-full flex-wrap justify-end gap-1 opacity-80">
			{label && (
				<Attachment size="xs" className="max-w-56 min-w-0" data-beside-front={beside.front} title={beside.front}>
					<AttachmentMedia>
						<FrontMark label={label} />
					</AttachmentMedia>
					<AttachmentContent>
						<AttachmentTitle className="font-normal">{name}</AttachmentTitle>
					</AttachmentContent>
				</Attachment>
			)}
			{beside.chosen && (
				<Attachment size="xs" className="max-w-56 min-w-0" data-beside-chosen title={beside.chosen}>
					<AttachmentMedia>
						<TextQuoteIcon />
					</AttachmentMedia>
					<AttachmentContent>
						<AttachmentTitle className="font-normal">
							{beside.page && <span className="text-muted-foreground">p. {beside.page} </span>}
							{beside.chosen}
						</AttachmentTitle>
					</AttachmentContent>
				</Attachment>
			)}
			{pictures.map((path) => (
				<Attachment key={path} size="xs" className="min-w-0" data-beside-picture={path} title={path.slice(path.lastIndexOf("/") + 1)}>
					<AttachmentMedia variant="image">
						<img src={vaultUrl(path)} alt={path.slice(path.lastIndexOf("/") + 1)} />
					</AttachmentMedia>
				</Attachment>
			))}
		</div>
	);
}
