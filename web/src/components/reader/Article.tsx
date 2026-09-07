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
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Pick something on the left</div>;

  return (
    // overflow-x is clip, not left alone: with only overflow-y set, CSS computes
    // the other axis to auto, and a single wide figure slides the whole article.
    <div ref={box} className="h-full overflow-y-auto overflow-x-clip overscroll-contain">
      <article className="reading-canvas mx-auto max-w-[80rem] px-8 py-10">
        <header className="reading mb-8">
          <h1 className="reading font-serif text-3xl leading-tight font-semibold">{item.title}</h1>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {host(item.url)} ↗
          </a>
          {item.gist && <Gist text={item.gist} />}
        </header>
        <Body item={item} />
      </article>
    </div>
  );
}

/**
 * pi가 남긴 한 줄. 본문 위에 있지만 본문이 아니므로, 저자의 글과 같은 활자로
 * 쓰지 않는다 — 누가 한 말인지가 보여야 무시할지 반박할지 고를 수 있다.
 */
function Gist({ text }: { text: string }) {
  return (
    <p className="mt-5 border-l-2 pl-4 text-sm leading-relaxed text-muted-foreground">
      <span className="mr-2 align-[1px] font-mono text-xs tracking-wide text-muted-foreground/70">
        pi
      </span>
      {text}
    </p>
  );
}

function Body({ item }: { item: FullItem }) {
  if (item.kind === "youtube") return <Transcript text={item.text ?? ""} url={item.url} />;
  if (item.html) return <Html html={item.html} />;

  return (
    <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
      Couldn't get the text ({STATUS_LABEL[item.status] ?? item.status}). Read it at the source.
    </p>
  );
}

/** 읽기 폭에 해당하는 대략의 픽셀. 서버의 spans.ts가 쓰는 기준과 같다. */
const MEASURE_PX = 640;

function Html({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  // Readability가 이미 씻지만 서버가 준 것을 그대로 넣지는 않는다.
  const clean = useMemo(() => DOMPurify.sanitize(html, { FORBID_TAGS: ["style"] }), [html]);

  // 넓은 것에는 서버가 미리 표시를 붙여두지만, 서버는 그리지 않으므로 HTML에
  // 폭이 적혀 있지 않은 이미지의 크기는 모른다. 그건 여기서, 그것도 그림이
  // 도착한 뒤에만 알 수 있다.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const widen = (img: HTMLImageElement) => {
      if (img.naturalWidth > MEASURE_PX)
        (img.closest("figure") ?? img).setAttribute("data-span", "wide");
    };
    for (const img of el.querySelectorAll("img")) {
      if (img.complete) widen(img);
      else img.addEventListener("load", () => widen(img), { once: true });
    }
  }, [clean]);

  return (
    <div
      ref={box}
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
    <div className="reading space-y-5 text-base leading-relaxed">
      {blocks.map((b) => (
        <p key={b.at} className="flex gap-4">
          <a
            href={`${url}${url.includes("?") ? "&" : "?"}t=${b.at}`}
            target="_blank"
            rel="noreferrer"
            className="w-10 shrink-0 pt-1 font-mono text-xs text-muted-foreground tabular-nums hover:text-foreground"
          >
            {b.stamp}
          </a>
          <span>{b.body}</span>
        </p>
      ))}
    </div>
  );
}
