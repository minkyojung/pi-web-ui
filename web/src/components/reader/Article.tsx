import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { host, STATUS_LABEL, type FullItem } from "@/reader";

export function Article({ item }: { item: FullItem | null }) {
  const box = useRef<HTMLDivElement>(null);
  // 읽던 자리를 기억한다. 목록을 오가며 읽으므로 매번 위로 튀면 못 읽는다.
  const offsets = useRef(new Map<number, number>());

  useEffect(() => {
    const el = box.current;
    if (!el || !item) return;
    el.scrollTop = offsets.current.get(item.id) ?? 0;
    const save = () => offsets.current.set(item.id, el.scrollTop);
    el.addEventListener("scroll", save, { passive: true });
    return () => el.removeEventListener("scroll", save);
  }, [item?.id]);

  if (!item)
    return <div className="grid h-full place-items-center text-sm text-neutral-400">왼쪽에서 고르세요</div>;

  return (
    <div ref={box} className="h-full overflow-y-auto overscroll-contain">
      <article className="mx-auto max-w-[68ch] px-8 py-10">
        <header className="mb-8">
          <h1 className="reading font-serif text-[28px] leading-tight font-semibold">{item.title}</h1>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[13px] text-neutral-500 underline-offset-4 hover:underline"
          >
            {host(item.url)} ↗
          </a>
        </header>
        <Body item={item} />
      </article>
    </div>
  );
}

function Body({ item }: { item: FullItem }) {
  if (item.kind === "youtube") return <Transcript text={item.text ?? ""} url={item.url} />;
  if (item.html) return <Html html={item.html} />;

  return (
    <p className="rounded-md bg-neutral-50 p-4 text-sm text-neutral-500 dark:bg-neutral-900">
      본문을 가져오지 못했습니다({STATUS_LABEL[item.status] ?? item.status}). 원문에서 읽어야 합니다.
    </p>
  );
}

function Html({ html }: { html: string }) {
  // Readability가 이미 씻지만 서버가 준 것을 그대로 넣지는 않는다.
  const clean = useMemo(() => DOMPurify.sanitize(html, { FORBID_TAGS: ["style"] }), [html]);
  return (
    <div
      className="reading prose prose-neutral dark:prose-invert max-w-none prose-headings:font-semibold prose-pre:text-[13px]"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

/** 자막은 [12:34] 로 저장돼 있다. 시각을 누르면 영상의 그 지점으로 간다. */
function Transcript({ text, url }: { text: string; url: string }) {
  // 자막은 2~3초마다 끊겨 있어서 그대로 두면 읽을 수가 없다.
  // 대략 30초씩 묶어 문단으로 만들고, 시각은 문단 머리에만 남긴다.
  const blocks = useMemo(() => {
    const GAP = 30;
    const out: { at: number; stamp: string; body: string }[] = [];
    for (const line of text.split("\n")) {
      const m = line.match(/^\[(\d+):(\d+)\]\s*(.*)$/);
      if (!m) continue;
      const at = Number(m[1]) * 60 + Number(m[2]);
      const last = out.at(-1);
      if (last && at - last.at < GAP) last.body += " " + m[3];
      else out.push({ at, stamp: `${m[1]}:${m[2]}`, body: m[3] });
    }
    return out;
  }, [text]);

  return (
    <div className="reading space-y-5 text-[15px] leading-relaxed">
      {blocks.map((b) => (
        <p key={b.at} className="flex gap-4">
          <a
            href={`${url}${url.includes("?") ? "&" : "?"}t=${b.at}`}
            target="_blank"
            rel="noreferrer"
            className="w-10 shrink-0 pt-1 font-mono text-[11px] text-neutral-400 tabular-nums hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            {b.stamp}
          </a>
          <span>{b.body}</span>
        </p>
      ))}
    </div>
  );
}
