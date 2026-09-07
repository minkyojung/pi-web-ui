import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import { cn } from "cn";
import { MODE_IDS, describeMode, type ToolModeId } from "../../../../toolModes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sources } from "./Sources";

/** settings.ts, as it arrives. Declared again rather than imported: that module reads files. */
type Settings = {
  feedDays: number;
  briefHours: number;
  briefChars: number;
  toolMode: ToolModeId;
};

type NumericKey = "feedDays" | "briefHours" | "briefChars";

const SECTIONS = ["Sources", "Brief", "Agent"] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Everything that used to be a constant in a file.
 *
 * A column of sections rather than tabs, because the list will keep growing and
 * a row of tabs stops fitting long before a column stops scrolling. Sources is
 * first: it is the one people came here for.
 *
 * Nothing here is saved behind a button. Each setting is a single value that
 * stands on its own — there is no state where two of them have to agree — so a
 * Save would only ever confirm what the screen already showed, and the price of
 * forgetting to press it is an edit that silently did not happen.
 */
export function Settings() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("Sources");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Settings"
          className="h-7 w-7 shrink-0 p-0 text-muted-foreground"
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="grid-cols-[10rem_1fr] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogDescription className="sr-only">
          Settings for what is collected, what the briefing reads, and what the agent may do.
        </DialogDescription>
        <nav className="flex flex-col gap-0.5 border-r bg-muted/30 p-3">
          <DialogTitle className="px-2 pt-1 pb-2 text-sm font-semibold">Settings</DialogTitle>
          {SECTIONS.map((name) => (
            <Button
              key={name}
              variant="ghost"
              size="sm"
              data-active={section === name}
              onClick={() => setSection(name)}
              className="h-7 justify-start px-2 text-xs text-muted-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
            >
              {name}
            </Button>
          ))}
        </nav>
        {/* Capped rather than grown into: the sources list is as long as someone
            subscribes, and a dialog taller than the window has no way out. */}
        <div className="max-h-[28rem] min-w-0 overflow-y-auto p-5">
          <Panel section={section} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Panel({ section }: { section: Section }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSettings)
      .catch(() => setError("could not read settings"));
  }, []);

  /**
   * The whole object every time, and whatever comes back is what is shown. The
   * server clamps, so a feed window of 900 days lands as 90 and the field says
   * 90 — the alternative is a number on screen that nothing will ever use.
   */
  const save = useCallback(async (patch: Partial<Settings>) => {
    setError(null);
    setSettings((cur) => (cur ? { ...cur, ...patch } : cur));
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, ...patch }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      setSettings(await r.json());
    } catch {
      setError("could not save");
    }
  }, [settings]);

  return (
    <section className="flex flex-col gap-4">
      {section === "Sources" && (
        <>
          <Heading title="Sources">
            What the feed pass collects, and what the briefing is allowed to draw on.
          </Heading>
          <Sources />
          <NumberField
            id="feedDays"
            label="Look back"
            unit="days"
            value={settings?.feedDays}
            onSave={(feedDays) => save({ feedDays })}
          >
            How far into a feed to reach. Some feeds hand over their whole past rather than
            the last few days, and all of it would sit on top of what arrived today.
          </NumberField>
        </>
      )}

      {section === "Brief" && (
        <>
          <Heading title="Brief">What `npm run brief` reads before it writes.</Heading>
          <NumberField
            id="briefHours"
            label="Window"
            unit="hours"
            value={settings?.briefHours}
            onSave={(briefHours) => save({ briefHours })}
          >
            How far back a briefing counts as today.
          </NumberField>
          <NumberField
            id="briefChars"
            label="Per piece"
            unit="characters"
            value={settings?.briefChars}
            onSave={(briefChars) => save({ briefChars })}
          >
            How much of each piece the model is given. Below about a thousand it starts
            guessing at what an article is about from its opening paragraph.
          </NumberField>
        </>
      )}

      {section === "Agent" && (
        <>
          <Heading title="Agent">What pi may do.</Heading>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="toolMode" className="text-xs text-muted-foreground">
              New sessions open on
            </Label>
            <NativeSelect
              id="toolMode"
              className="h-8 max-w-48 text-sm"
              disabled={!settings}
              value={settings?.toolMode ?? ""}
              onChange={(e) => void save({ toolMode: e.target.value as ToolModeId })}
            >
              {MODE_IDS.map((id) => (
                <option key={id} value={id}>
                  {describeMode(id).name}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              {settings ? describeMode(settings.toolMode).can.join(" · ") : " "}
            </p>
            {/* The mode of the session already open is on the composer, and this
                does not reach back and change it — pi does not remember a tool
                change, so every session is set once, when it starts. */}
            <p className="text-xs text-muted-foreground">
              The session already running keeps the mode on its own control.
            </p>
          </div>
        </>
      )}

      {error && (
        <p role="status" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{children}</p>
    </header>
  );
}

/**
 * One number. It is written down when the field is left or Enter is pressed,
 * not on every keystroke: half of "20" is "2", and saving that would set the
 * window to two hours on the way to twenty.
 */
function NumberField({
  id, label, unit, value, onSave, children,
}: {
  id: NumericKey;
  label: string;
  unit: string;
  value: number | undefined;
  onSave: (value: number) => void;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  // The server's answer wins, including when it clamped what was typed.
  useEffect(() => {
    if (value !== undefined) setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n)) return setDraft(String(value ?? ""));
    if (n !== value) onSave(n);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          disabled={value === undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className={cn("h-8 w-24 text-sm")}
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
