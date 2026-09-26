import { useSyncExternalStore } from "react";

import { FileCodeIcon, FileIcon, FileTextIcon, FileTypeIcon, ImageIcon, type LucideIcon } from "lucide-react";

import { CHIP_CLASS, CHIP_ICON_CLASS, type FileKind, fileKind, nameOf } from "../composer/chip";
import { CHIP, textToDoc } from "../composer/text";
import { documentsStore, filesStore } from "../serverState";

/** One icon a kind, lucide's, as the message box draws them (composer/schema.ts). */
const ICONS: Record<FileKind, LucideIcon> = { image: ImageIcon, pdf: FileTypeIcon, note: FileTextIcon, code: FileCodeIcon, file: FileIcon };

/** Where the box keeps what was put in it. */
const GIVEN = ".octave/attachments/";

/**
 * A file in a message sent, as it was in the box (composer/schema.ts): its
 * kind's icon and its name. Pointing at it and pressing it are ChipLayer's,
 * for every chip in the window alike; this one can also take the focus, so
 * Enter opens it from the keys.
 */
export function FileChip({ path }: { path: string }) {
	const Icon = ICONS[fileKind(path)];
	return (
		<span data-file-chip="" data-path={path} tabIndex={0} role="button" aria-label={`Open ${nameOf(path)}`} className={CHIP_CLASS}>
			<Icon className={CHIP_ICON_CLASS} />
			<span className="truncate">{nameOf(path)}</span>
		</span>
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
