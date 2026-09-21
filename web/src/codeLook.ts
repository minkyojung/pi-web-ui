/**
 * Code, told apart by colour — wherever this window draws it: a file open to
 * read (Code.tsx) and what a commit changed (Commit.tsx). One style, so a
 * line reads the same in the file and in the difference.
 *
 * The grammar (lezer, picked by the file's name) names each token; this
 * table is the one place a name becomes a look. The hues are the theme's
 * (styles.css), so a keyword reads in every window, light or dark.
 */
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const code = HighlightStyle.define([
	{
		tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.modifier, tags.self],
		color: "var(--code-keyword)",
	},
	{ tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: "var(--code-type)" },
	{ tag: [tags.atom, tags.bool, tags.null, tags.number, tags.literal], color: "var(--code-number)" },
	{ tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character], color: "var(--code-string)" },
	{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.variableName)], color: "var(--code-name)" },
	{ tag: [tags.attributeName, tags.propertyName], color: "var(--code-type)" },
	{ tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: "var(--muted-foreground)", fontStyle: "italic" },
	{ tag: [tags.punctuation, tags.separator, tags.bracket, tags.operator], color: "var(--muted-foreground)" },
	{ tag: [tags.meta, tags.processingInstruction], color: "var(--muted-foreground)" },
	{ tag: tags.link, textDecoration: "underline" },
	{ tag: tags.invalid, color: "var(--destructive)" },
]);
