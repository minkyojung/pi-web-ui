import { Archive, ArchiveRestore, Copy, ExternalLink, ListPlus, ListX, MoreHorizontal, PanelRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { restoredStore } from "@/serverState";
import type { ListItem } from "@/reader";

/** `09:14`. The list is already grouped by day, so the day is the one thing not worth repeating. */
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export type Flags = { read?: boolean; queued?: boolean; archived?: boolean };

type Props = {
  item: ListItem;
  at: number;
  onFlags: (id: number, patch: Flags) => void;
  onMenuChange: (open: boolean) => void;
};

/**
 * What a row can do, held back until the pointer is on it.
 *
 * Only archiving gets a button of its own. Everything else is behind the `…`
 * because it is reached once a week, and a row that carries five controls is a
 * row you read instead of skim — which is the thing the list just stopped
 * doing.
 */
export function RowActions({ item, at, onFlags, onMenuChange }: Props) {
  const archived = !!item.archived;

  return (
    <span className="flex items-center gap-0.5 pr-2">
      <time
        dateTime={new Date(at).toISOString()}
        className="mr-1 font-mono text-[11px] text-muted-foreground tabular-nums"
      >
        {clock(at)}
      </time>

      <DropdownMenu onOpenChange={onMenuChange}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label="More">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => window.open(item.url, "_blank", "noopener")}>
            <ExternalLink />
            Open original
          </DropdownMenuItem>
          <DropdownMenuItem
            // pi에게 시키지 않고 입력창에 놓아둔다. 대신 물어보면 그건 다시
            // "부르면 답하는 어시스턴트"고, 이 칸은 그러라고 만든 자리가 아니다.
            onSelect={() => restoredStore.set(`${item.title}\n${item.url}`)}
          >
            <PanelRight />
            Send to pi
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigator.clipboard?.writeText(item.url)}>
            <Copy />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onFlags(item.id, { queued: !item.queued })}>
            {item.queued ? <ListX /> : <ListPlus />}
            {item.queued ? "Remove from queue" : "Add to queue"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onFlags(item.id, { archived: !archived })}>
            {archived ? <ArchiveRestore /> : <Archive />}
            {archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon"
        className={cn("size-6 text-muted-foreground", archived && "text-foreground")}
        aria-label={archived ? "Unarchive" : "Archive"}
        onClick={() => onFlags(item.id, { archived: !archived })}
      >
        {archived ? <ArchiveRestore /> : <Archive />}
      </Button>
    </span>
  );
}
