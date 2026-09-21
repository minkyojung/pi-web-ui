import { cn } from "cn";

/** A row of the left column: a note, a folder, a repository, a workspace. */
export const row = cn(
	"h-8 w-full cursor-default justify-start px-2 font-normal",
	// A row at rest is second-rank text; the pointer and the open note raise it
	// to first. Twenty notes all at the window's brightest is twenty notes
	// shouting, and the one you are in has only its background left to say so.
	// The step is the one the window already declares — Apple's secondaryLabel,
	// Radix's step 11, Linear's tertiary — not a colour invented for this
	// column. --muted-foreground is held against the darkest surface it lands
	// on, --sidebar-accent among them, so it clears AA on both the column and a
	// hovered row in all four themes (4.65 at the tightest).
	"text-muted-foreground",
	// The dark hover ghost carries is the page's accent at half alpha, under a
	// modifier tailwind-merge cannot line up with the one above it, so it is
	// named again here.
	"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent",
	// Inside the row: the list scrolls, and a ring drawn outside the top row
	// would be cut off by the edge it scrolls under.
	"focus-visible:ring-sidebar-ring/50 focus-visible:ring-inset",
);
