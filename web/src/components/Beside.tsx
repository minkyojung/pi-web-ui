import { type ReactNode, useSyncExternalStore } from "react";

import { FileCodeIcon, FileDiffIcon, FileTextIcon, FileTypeIcon, GitCommitHorizontalIcon, ListChecksIcon, type LucideIcon, TextQuoteIcon } from "lucide-react";

import { type FrontLabel, frontLabel } from "../frontLabel";
import { specsStore } from "../serverState";
import type { Item } from "../types";
import { Attachment, AttachmentContent, AttachmentMedia, AttachmentTitle } from "./ui/attachment";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

/** One icon a kind, all lucide's, so the row over a message reads as one set. */
const ICONS: Record<FrontLabel["kind"], LucideIcon> = {
	note: FileTextIcon,
	code: FileCodeIcon,
	document: FileTypeIcon,
	task: ListChecksIcon,
	commit: GitCommitHorizontalIcon,
	changes: FileDiffIcon,
};

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** What the chip says of the tab: a file by its name whole, a task or a commit by its number and line. */
function said(label: FrontLabel, front: string): string {
	switch (label.kind) {
		case "note":
		case "code":
		case "document":
			return nameOf(front);
		case "task":
			return `${label.id} ${label.name ?? `Task ${label.id}`}`;
		case "commit":
			return label.name ? `${label.id} ${label.name}` : label.id;
		case "changes":
			return label.name;
	}
}

/** A kind's icon and a name, and what it is in full on hover or focus. */
function Chip({ icon: Icon, text, children, ...data }: { icon: LucideIcon; text: string; children: ReactNode } & Record<`data-${string}`, string | boolean>) {
	return (
		<HoverCard openDelay={250} closeDelay={100}>
			<HoverCardTrigger asChild>
				<Attachment size="xs" tabIndex={0} className="max-w-56 min-w-0" {...data}>
					<AttachmentMedia>
						<Icon />
					</AttachmentMedia>
					<AttachmentContent>
						<AttachmentTitle className="font-normal">{text}</AttachmentTitle>
					</AttachmentContent>
				</Attachment>
			</HoverCardTrigger>
			<HoverCardContent side="top" align="end" className="w-auto max-w-80 p-2 text-xs">
				{children}
			</HoverCardContent>
		</HoverCard>
	);
}

/**
 * What was sent beside a message, over it: the tab that was in front and the
 * words chosen in it, as the strip over the box said them before it went
 * (Composer.tsx Front). Each a kind's icon and a name, with what it is in
 * full on hover. What the agent was given, the person can see after, as they
 * could before. The files given with it are chips in the message itself
 * (FileChip.tsx), as they were in the box.
 */
export function Beside({ beside }: { beside: NonNullable<Item["beside"]> }) {
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const label = beside.front ? frontLabel(specs, beside.front) : null;
	if (!label && !beside.chosen) return null;
	return (
		<div data-beside className="ml-auto flex max-w-full flex-wrap justify-end gap-1 opacity-80">
			{label && beside.front && (
				<Chip icon={ICONS[label.kind]} text={said(label, beside.front)} data-beside-front={beside.front}>
					<span className="break-all text-muted-foreground">{beside.front}</span>
				</Chip>
			)}
			{beside.chosen && (
				<Chip icon={TextQuoteIcon} text={beside.chosen} data-beside-chosen>
					{beside.page && <div className="mb-1 text-muted-foreground">p. {beside.page}</div>}
					<p className="max-h-60 overflow-y-auto whitespace-pre-wrap">{beside.chosen}</p>
				</Chip>
			)}
		</div>
	);
}
