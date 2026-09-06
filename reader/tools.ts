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
 * What it deliberately does *not* do is judge the sentence. No schema can tell
 * a claim from an opinion — that is the prompt's job, and the guidelines below
 * are where it is said.
 */
const PARAMS = Type.Object({
  id: Type.Number({
    description: "The item's id, from its frontmatter or its file name.",
  }),
  gist: Type.String({
    description:
      "One line saying what the piece claims. State it, do not rate it. No line break.",
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
        "Record, on one item in the reading library, a single line saying what that " +
        "piece claims. Read the item first: the library is " +
        LIBRARY_DIR +
        ", one " +
        "markdown file per item, named `date-id-slug.md`. An item that already has a " +
        "gist carries it as a `> ` line under the frontmatter, so the ones still " +
        "missing one are `grep -L '^> ' <files>`.",
      promptSnippet: "Leave a one-line claim on an item in the reading library",
      promptGuidelines: [
        "A gist states what the piece claims, in the reader's own terms, so that " +
          "reading the line is enough to decide whether to open the piece.",
        'Write the claim, never a verdict on it. "Moved off Kubernetes to one ' +
          'server and cut cost to an eighth" is a gist; "an interesting take on ' +
          'infrastructure" is not, and neither is "explains this well".',
        "The title is already on screen next to the gist. A line that could be " +
          "reconstructed from the title is worth nothing — say the thing the title " +
          "leaves out: the number, the reversal, the specific case, the cost. For " +
          '"Falsehoods Programmers Believe About LANs", listing the topics is a ' +
          "restatement; naming the two or three assumptions that actually bite is not.",
        "If a piece argues nothing — it announces, or it is a list — say what it " +
          "announces, concretely. Do not manufacture a thesis it does not have.",
        "One line, and short enough to take in at a glance — around 120 characters. " +
          "If it needs two, the second one is usually the opinion.",
        "Write it in English, whatever language the piece is in.",
      ],

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
