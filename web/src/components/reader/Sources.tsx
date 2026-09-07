import { useCallback, useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { host } from "@/reader";

/** One line of subscriptions.json, as the server describes it. */
type Source = { key: string; kind: "hn" | "rss"; label: string; items: number };

async function api(path: string, init?: RequestInit): Promise<Source[]> {
  const r = await fetch(path, init);
  const body = (await r.json().catch(() => ({}))) as { error?: string; subscriptions?: Source[] };
  if (!r.ok) throw new Error(body.error || `${r.status}`);
  return body.subscriptions ?? [];
}

/**
 * Where the list comes from. Until now this was subscriptions.json and a text
 * editor, which is a strange thing to need for the one setting that decides
 * what the whole app is about.
 *
 * It saves as you go rather than behind a button: adding and removing a feed
 * are both single acts with nothing to confirm, and a Save that only ever
 * agreed with what was already on screen would be furniture.
 */
export function Sources() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [url, setUrl] = useState("");
  // One request at a time. Each write is a read of the file, a change, and a
  // write back, so two in flight would have the second one overwrite the first.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (work: Promise<Source[]>) => {
    setBusy(true);
    setError(null);
    try {
      setSources(await work);
      return true;
    } catch (e) {
      setError((e as Error).message || "failed");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run(api("/api/subscriptions"));
  }, [run]);

  // The server reads the feed before it writes it down, and keeps whatever it
  // finds, so this waits on a fetch pass rather than on a line in a file. That
  // is the slow part, and why the box is locked while it runs.
  const add = async (body: { url?: string }) => {
    const ok = await run(
      api("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    if (ok) setUrl("");
  };

  const submit = () => {
    const value = url.trim();
    if (value && !busy) void add({ url: value });
  };

  const hn = sources?.some((s) => s.kind === "hn");

  return (
    <>
      <ul className="-mx-1">
        {sources?.map((s) => (
          <li key={s.key} className="group flex items-center gap-2 rounded px-1 py-1.5 hover:bg-accent/50">
            <span className="min-w-0 flex-1 truncate text-sm" title={s.key}>
              {s.kind === "hn" ? "Hacker News" : host(s.key)}
            </span>
            {/* How much of the library came from here. A feed that is quietly
                bringing in nothing looks exactly like a working one otherwise. */}
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.items}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${s.kind === "hn" ? "Hacker News" : s.key}`}
              disabled={busy}
              onClick={() =>
                void run(api(`/api/subscriptions?key=${encodeURIComponent(s.key)}`, { method: "DELETE" }))
              }
              className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <XIcon className="size-3.5" />
            </Button>
          </li>
        ))}
        {sources?.length === 0 && (
          <li className="px-1 py-1.5 text-sm text-muted-foreground">Nothing subscribed.</li>
        )}
        {sources === null && <li className="px-1 py-1.5 text-sm text-muted-foreground">…</li>}
      </ul>

      <div className="relative">
        <Input
          type="url"
          value={url}
          placeholder="Feed URL"
          aria-label="Add a feed"
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          className="h-8 pr-8 text-sm"
        />
        {busy && (
          <Spinner className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>

      {/* Hacker News has no address to paste, so getting it back after a
          removal needs a door of its own. */}
      {sources && !hn && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void add({})}
          className="h-7 self-start text-xs"
        >
          Add Hacker News
        </Button>
      )}

      {error && (
        <p role="status" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
