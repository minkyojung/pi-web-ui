/**
 * What this app's markdown is, in one place: CommonMark, GFM as the editor
 * has it, and the note syntax taught here — wikilinks, front matter,
 * highlights.
 *
 * The editor's language (lang-markdown's markdownLanguage) is CommonMark
 * with GFM, subscript, superscript and emoji; the server's parser is built
 * from the same pieces, so the two ends walk one tree. A `#` inside a bare
 * URL is the URL's on both, a `[[link]]` in a property is text on both. Add
 * a syntax here, once, and both ends know it.
 */
import { Emoji, GFM, type MarkdownExtension, parser as commonmark, Subscript, Superscript } from "@lezer/markdown";

import { frontMatter } from "./frontmatter.ts";
import { highlight } from "./highlight.ts";
import { wikiLink } from "./wikilink.ts";

/** The note syntax, for the editor to add to its markdown language. */
export const noteSyntax: MarkdownExtension = [wikiLink, frontMatter, highlight];

/** The whole language, for the server: what the editor parses with, without the editor. */
export const parser = commonmark.configure([GFM, Subscript, Superscript, Emoji, noteSyntax]);
