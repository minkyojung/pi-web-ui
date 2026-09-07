import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { dayLabel, host, when, type ListItem } from "@/reader";
import { RowActions, type Flags } from "./RowActions";

type Props = {
  items: ListItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onFlags: (id: number, patch: Flags) => void;
  onSave: (url: string) => Promise<{ created: boolean; row: ListItem }>;
};

/**
 * Three views of one list, not three lists.
 *
 * Inbox hides what has been archived, and that is the whole of archiving —
 * nothing is deleted and the file keeps its line, so a view is all it takes to
 * put something back.
 */
const VIEWS = {
  inbox: { label: "Inbox", keep: (it: ListItem) => !it.archived },
  queue: { label: "Queue", keep: (it: ListItem) => !!it.queued && !it.archived },
  archive: { label: "Archive", keep: (it: ListItem) => !!it.archived },
} as const;

type View = keyof typeof VIEWS;

export function List({ items, selectedId, onSelect, onFlags, onSave }: Props) {
  const [view, setView] = useState<View>("inbox");
  const shown = useMemo(() => items.filter(VIEWS[view].keep), [items, view]);
  const queued = useMemo(() => items.filter(VIEWS.queue.keep).length, [items]);

  // 날짜별로 묶는다. 계층이 아니라 시간 순서라 트리가 아니라 목록이다.
  const days = useMemo(() => {
    const out: { label: string; items: ListItem[] }[] = [];
    for (const it of shown) {
      const label = dayLabel(when(it));
      if (out.at(-1)?.label !== label) out.push({ label, items: [] });
      out.at(-1)!.items.push(it);
    }
    return out;
  }, [shown]);

  return (
    <nav className="flex h-full flex-col border-r">
      {/* The window's own top-left corner: the traffic lights sit in this row,
          which is why it has a fixed height rather than one its buttons decide. */}
      <div className="drag-region titlebar-inset flex h-11 shrink-0 items-center gap-1 border-b px-2">
        {(Object.keys(VIEWS) as View[]).map((key) => (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            data-active={view === key}
            onClick={() => setView(key)}
            className="h-7 px-2 text-xs text-muted-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
          >
            {VIEWS[key].label}
            {key === "queue" && queued > 0 && (
              <span className="ml-1 tabular-nums opacity-70">{queued}</span>
            )}
          </Button>
        ))}
      </div>
      <SaveBox onSave={onSave} />
      <div className="flex-1 overflow-y-auto overscroll-contain">
      {days.map((day) => (
        <section key={day.label}>
          <h2 className="sticky top-0 z-10 bg-background/85 px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground backdrop-blur">
            {day.label}
            <span className="ml-1.5 text-muted-foreground/70">{day.items.length}</span>
          </h2>
          <ul>
            {day.items.map((it) => (
              <Row
                key={it.id}
                item={it}
                selected={it.id === selectedId}
                onSelect={onSelect}
                onFlags={onFlags}
              />
            ))}
          </ul>
        </section>
      ))}
      {shown.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">
          {view === "inbox" ? (
            <>Nothing here yet. <code className="text-xs">npm run fetch</code></>
          ) : view === "queue" ? (
            "The queue is empty."
          ) : (
            "Nothing archived."
          )}
        </p>
      )}
      </div>
    </nav>
  );
}

/**
 * A url in. This is one hand on the door in server.ts; a shortcut that asks
 * the browser for its tab will be another, and both leave this here for the
 * links that arrive from somewhere else.
 *
 * The box is not locked while a save is in flight: the usual case is emptying
 * a row of tabs, and each one is its own request. What is said afterwards is
 * said, not swallowed — this is the one thing here the reader just did.
 */
function SaveBox({ onSave }: { onSave: Props["onSave"] }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(0);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const submit = async () => {
    const value = url.trim();
    if (!value) return;
    setUrl("");
    setBusy((n) => n + 1);
    try {
      const { created, row } = await onSave(value);
      setNote({
        text: !created ? "already saved" : row.has_text ? "saved" : "saved · no text",
      });
    } catch (e) {
      setNote({ text: (e as Error).message || "failed", error: true });
    } finally {
      setBusy((n) => n - 1);
    }
  };

  return (
    <div className="relative shrink-0 border-b px-2 py-1.5">
      <Input
        type="url"
        value={url}
        placeholder="Paste a link"
        aria-label="Save a link"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
        className="h-7 pr-7 text-xs"
      />
      {busy > 0 && (
        <Spinner className="absolute top-1/2 right-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
      )}
      {note && (
        <p
          role="status"
          className={cn("px-1 pt-1 text-xs text-muted-foreground", note.error && "text-destructive")}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

/**
 * Nothing but the title. Domain, score, comment count and the TL;DR all moved
 * out: a row's whole job here is to be skimmed past, and every extra line is
 * one more thing to skim past. What was on them is a click away, where there is
 * room to read it.
 */
function Row({
  item, selected, onSelect, onFlags,
}: { item: ListItem; selected: boolean; onSelect: (id: number) => void; onFlags: (id: number, patch: Flags) => void }) {
  const [hover, setHover] = useState(false);
  // 메뉴가 열려 있는 동안은 포인터가 행 밖으로 나가도 컨트롤이 남아야 한다.
  // 사라지면 메뉴가 딸려 닫힌다.
  const [menu, setMenu] = useState(false);
  const showing = hover || menu;
  const read = !!item.read;

  // 컨트롤이 가리는 폭. 제목은 이만큼 **덜 그려질** 뿐 좁아지지는 않는다 —
  // 폭을 줄이면 딱 맞던 제목이 갑자기 넘쳐서, 볼 것도 없이 앞부분을 흘린다.
  const [reserve, setReserve] = useState(0);
  const actions = useCallback((el: HTMLSpanElement | null) => {
    if (el) setReserve(el.offsetWidth);
  }, []);

  return (
    // 컨트롤은 행 버튼의 형제다. 안에 넣으면 버튼 속의 버튼이 되고,
    // 그러면 클릭이 어느 쪽 것인지 브라우저가 정하게 둬야 한다.
    <li
      className="relative"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <button
        data-slot="reader-row"
        data-active={selected}
        onClick={() => onSelect(item.id)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "block w-full cursor-default px-4 py-2 text-left outline-none transition-colors",
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
          // 행은 서로 맞붙어 있어 바깥으로 나가는 링은 옆 행에 가린다. 안쪽으로 그린다.
          "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
          "data-[active=true]:bg-accent data-[active=true]:text-accent-foreground",
        )}
      >
        <span className="flex items-center gap-2.5">
          <Favicon url={item.url} dim={read && !selected} />
          <Title
            text={item.title}
            slide={hover}
            reserve={showing ? reserve : 0}
            className={cn(
              "reading text-sm leading-snug",
              read && !selected && "text-muted-foreground",
              item.archived && "line-through decoration-1",
            )}
          />
        </span>
      </button>
      {showing && (
        <span ref={actions} className="absolute inset-y-0 right-0 flex items-center">
          <RowActions item={item} at={when(item)} onFlags={onFlags} onMenuChange={setMenu} />
        </span>
      )}
    </li>
  );
}

/**
 * The site's icon, served from this machine.
 *
 * Square, not round: these are wordmarks and letters, and a circle crops them.
 * The fallback is the domain's first letter rather than a broken-image frame —
 * most of a reading list is a handful of sites, so the letter alone comes to
 * identify the ones whose icon never resolves.
 */
function Favicon({ url, dim }: { url: string; dim: boolean }) {
  const site = host(url);
  return (
    <Avatar
      size="sm"
      className={cn(
        "size-4 rounded-[3px] bg-muted transition-opacity",
        dim && "opacity-50",
      )}
    >
      <AvatarImage src={`/api/icon/${encodeURIComponent(site)}`} alt="" />
      <AvatarFallback className="rounded-[3px] text-[9px] font-medium text-muted-foreground uppercase">
        {site[0] ?? "?"}
      </AvatarFallback>
    </Avatar>
  );
}

/** 한 줄에서 잘리는 속도. 긴 제목일수록 오래 걸린다. */
const PIXELS_PER_SECOND = 45;

/**
 * One line, cut off where it runs out of room, and slid over on hover to show
 * the rest.
 *
 * The distance is measured rather than guessed at: a percentage would crawl on
 * a title that only just overflows and fly past one that overflows by a lot,
 * and a title one pixel too long would animate for no reason. Measuring also
 * means a title that fits never moves at all — the pointer crossing the list
 * would otherwise set every row in it twitching.
 */
function Title({
  text, slide, reserve, className,
}: { text: string; slide: boolean; reserve: number; className?: string }) {
  const frame = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState({ text: 0, frame: 0 });

  // 잘리는지는 쉴 때도 알아야 페이드를 칠 수 있고, 칸은 끌어서 넓힐 수 있다.
  // 그래서 한 번 재고 마는 게 아니라 폭이 바뀔 때마다 다시 잰다.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setWidth({ text: el.scrollWidth, frame: el.clientWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  // 보이는 폭은 컨트롤이 덮은 만큼 좁다. 레이아웃이 아니라 칠하는 범위만 줄이므로,
  // 포인터가 얹혔다고 글자가 다시 배치되는 일은 없다.
  const visible = Math.max(0, width.frame - reserve);
  // 미는 건 **쉴 때 이미 잘려 있던** 제목뿐이다. 컨트롤이 덮었다는 이유로 밀면,
  // 방금까지 다 읽히던 제목이 앞부분을 흘리며 사라진다 — 얻는 것 없이.
  const cut = width.text > width.frame;
  const over = cut ? Math.max(0, width.text - visible) : 0;
  const shift = slide ? over : 0;

  // 자른 자리를 딱 끊지 않고 흐린다. 말줄임표는 "여기서 끝"이라고 말하는데,
  // 페이드는 "계속 있다"고 말한다 — 실제로 밀면 나오므로 그쪽이 사실이다.
  const edge = `${visible}px`;
  const fade =
    over || reserve || cut
      ? `linear-gradient(to right,${shift ? " transparent, black 1.5rem," : ""} black calc(${edge} - 1.5rem), transparent ${edge})`
      : undefined;

  return (
    <span
      ref={frame}
      className="min-w-0 flex-1 overflow-hidden"
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      <span
        className={cn("inline-block whitespace-nowrap ease-linear", className)}
        style={{
          transform: `translateX(${-shift}px)`,
          // 돌아올 때는 기다릴 이유가 없다. 나갈 때만 읽는 속도로.
          transitionProperty: "transform",
          transitionDuration: `${shift ? (shift / PIXELS_PER_SECOND) * 1000 : 200}ms`,
        }}
      >
        {text}
      </span>
    </span>
  );
}
