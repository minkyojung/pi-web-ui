import { useSyncExternalStore } from "react";

import { FileCodeIcon, FileIcon, FileTextIcon, FileTypeIcon, ImageIcon, type LucideIcon } from "lucide-react";

import { CHIP_CLASS, CHIP_ICON_CLASS, type FileKind, fileKind, nameOf } from "../composer/chip";
import { CHIP, textToDoc } from "../composer/text";
import { vaultUrl } from "../pages";
import { documentsStore, filesStore } from "../serverState";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

/** One icon a kind, lucide's, as the message box draws them (composer/schema.ts). */
const ICONS: Record<FileKind, LucideIcon> = { image: ImageIcon, pdf: FileTypeIcon, note: FileTextIcon, code: FileCodeIcon, file: FileIcon };

/** Where the box keeps what was put in it; a picture from there is served (pictures.ts messagePictureAt). */
const GIVEN = ".octave/attachments/";

/**
 * A file in a message sent, as it was in the box: its kind's icon and its
 * name, the path on hover — and a picture given to the box, shown on hover.
 */
export function FileChip({ path }: { path: string }) {
	const Icon = ICONS[fileKind(path)];
	const chip = (
		<span data-file-chip="" data-path={path} tabIndex={0} title={path} className={CHIP_CLASS}>
			<Icon className={CHIP_ICON_CLASS} />
			<span className="truncate">{nameOf(path)}</span>
		</span>
	);
	if (fileKind(path) !== "image" || !path.startsWith(GIVEN) || path.endsWith(".svg")) return chip;
	return (
		<HoverCard openDelay={250} closeDelay={100}>
			<HoverCardTrigger asChild>{chip}</HoverCardTrigger>
			<HoverCardContent side="top" align="end" className="w-auto max-w-80 p-2">
				<img src={vaultUrl(path)} alt={nameOf(path)} className="max-h-64 max-w-72 rounded-sm object-contain" />
			</HoverCardContent>
		</HoverCard>
	);
}

/**
 * What the person wrote, with the files it names drawn as the chips they
 * were in the box: `@path` or `@"path"` of a note or a document the window
 * knows, or of a file given to the box. Anything else is the text it is.
 */
export function MessageText({ text }: { text: string }) {
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);
	const documents = useSyncExternalStore(documentsStore.subscribe, documentsStore.get);
	const known = new Set([...files.map((f) => f.path), ...documents]);
	const doc = textToDoc(text, (path) => known.has(path) || path.startsWith(GIVEN));
	return (
		<>
			{(doc.content ?? []).map((line, i) => (
				<span key={i}>
					{i > 0 && "\n"}
					{(line.content ?? []).map((node, j) => (node.type === CHIP ? <FileChip key={j} path={String(node.attrs?.path)} /> : <span key={j}>{node.text}</span>))}
				</span>
			))}
		</>
	);
}
