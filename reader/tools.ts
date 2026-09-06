import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LIBRARY_DIR, type Library } from "./store.ts";

/**
 * The agent's one way to write in the library.
 *
 * Reading needs no tool of its own: the library is files, so `ls`, `read` and
 * `grep` already reach it. Writing could have gone the same way — a gist is a
 * line in a markdown file, and `edit` can put it there. The reason it does not
 * is capability, not rules. Handing over `edit` to leave one line grants the
 * run of every file on disk; this grants that line. It is the argument
 * toolModes.ts makes about bash, one rung down.
 *
 * What it deliberately does *not* do is judge the sentence. Six written rules
 * were tried and dropped: against a plain "Write a TL;DR." they bought shorter
 * lines that held their numbers, and lost the closing clause that says what the
 * piece is *for* — which turned out to be the half worth reading.
 */
const PARAMS = Type.Object({
  id: Type.Number({
    description: "The item's id, from its frontmatter or its file name.",
  }),
  gist: Type.String({
    description: "Write a TL;DR.",
  }),
});

export const readerExtension = (library: Library) => {
  // Registration happens while the first session is built, which is earlier in
  // server.ts than it looks. Failing here is loud; failing inside execute() is
  // a tool that reports an error the model then works around by reaching for
  // `edit` — which is the one thing this tool exists to avoid.
  if (!library) throw new Error("readerExtension: the library is not open yet");

  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "set_gist",
      label: "gist",
      parameters: PARAMS,
      description:
        "Record a TL;DR on one item in the reading library. Read the item first: " +
        "the library is " +
        LIBRARY_DIR +
        ", one markdown file per item, named " +
        "`date-id-slug.md`. An item that already has one carries it as a `> ` line " +
        "under the frontmatter, so the ones still missing it are " +
        "`grep -L '^> ' <files>`.",
      promptSnippet: "Leave a TL;DR on an item in the reading library",

      async execute(_toolCallId, params) {
        try {
          const { id, title, gist } = library.setGist(params.id, params.gist);
          return {
            content: [{ type: "text", text: `${id} · ${title}\n> ${gist}` }],
            details: { id, gist },
          };
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: (e as Error).message }],
            details: undefined,
          };
        }
      },
    });
  };
};
