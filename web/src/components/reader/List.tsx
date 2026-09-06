import { useMemo } from "react";
import { dayLabel, host, when, STATUS_LABEL, type ListItem } from "@/reader";

type Props = {
  items: ListItem[];
  selectedId: number | null;
  readIds: Set<number>;
  onSelect: (id: number) => void;
};

export function List({ items, selectedId, readIds, onSelect }: Props) {
  // 날짜별로 묶는다. 계층이 아니라 시간 순서라 트리가 아니라 목록이다.
  const days = useMemo(() => {
    const out: { label: string; items: ListItem[] }[] = [];
    for (const it of items) {
      const label = dayLabel(when(it));
      if (out.at(-1)?.label !== label) out.push({ label, items: [] });
      out.at(-1)!.items.push(it);
    }
    return out;
  }, [items]);

  return (
    <nav className="h-full overflow-y-auto overscroll-contain border-r border-neutral-200 dark:border-neutral-800">
      {days.map((day) => (
        <section key={day.label}>
          <h2 className="sticky top-0 z-10 bg-white/85 px-4 py-1.5 text-[11px] font-medium tracking-wide text-neutral-500 backdrop-blur dark:bg-neutral-950/85">
            {day.label}
            <span className="ml-1.5 text-neutral-400 dark:text-neutral-600">{day.items.length}</span>
          </h2>
          <ul>
            {day.items.map((it) => (
              <Row
                key={it.id}
                item={it}
                selected={it.id === selectedId}
                read={readIds.has(it.id)}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      ))}
      {items.length === 0 && (
        <p className="p-4 text-sm text-neutral-500">
          아직 아무것도 없습니다. <code className="text-xs">npm run fetch</code>
        </p>
      )}
    </nav>
  );
}

function Row({
  item, selected, read, onSelect,
}: { item: ListItem; selected: boolean; read: boolean; onSelect: (id: number) => void }) {
  const note = STATUS_LABEL[item.status];
  return (
    <li>
      <button
        onClick={() => onSelect(item.id)}
        aria-current={selected ? "true" : undefined}
        className={[
          "block w-full cursor-default px-4 py-2 text-left transition-colors",
          selected
            ? "bg-neutral-100 dark:bg-neutral-800/70"
            : "hover:bg-neutral-50 dark:hover:bg-neutral-900",
        ].join(" ")}
      >
        <span
          className={[
            "reading block text-[13px] leading-snug",
            read && !selected ? "text-neutral-400 dark:text-neutral-600" : "",
          ].join(" ")}
        >
          {item.title}
        </span>
        {item.gist && (
          // 3단계. 제목 낚시에 매번 속지 않으려면, 열기 전에 주장을 봐야 한다.
          // 두 줄에서 자른다. 한 줄이 길어져도 목록의 리듬이 안 깨지도록.
          <span className="reading mt-1 line-clamp-2 block text-[12px] leading-snug text-neutral-500 dark:text-neutral-400">
            {item.gist}
          </span>
        )}
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-400 dark:text-neutral-600">
          <span className="truncate">{host(item.url)}</span>
          {item.score != null && item.score > 0 && <span>· {item.score}↑</span>}
          {item.comments != null && item.comments > 0 && <span>· {item.comments}💬</span>}
          {note && <span className="text-amber-600 dark:text-amber-500">· {note}</span>}
        </span>
      </button>
    </li>
  );
}
