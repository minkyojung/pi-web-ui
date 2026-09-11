import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import { MODE_IDS, describeMode, type ToolModeId } from "../../../toolModes";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { readTheme, setTheme, type Theme } from "@/theme";

/** settings.ts, as it arrives. Declared again rather than imported: that module reads files. */
type Settings = {
  toolMode: ToolModeId;
};

const SECTIONS = ["Appearance", "Agent", "Keys"] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Everything that used to be a constant in a file.
 *
 * A column of sections rather than tabs, because the list will keep growing and
 * a row of tabs stops fitting long before a column stops scrolling.
 *
 * Nothing here is saved behind a button. Each setting is a single value that
 * stands on its own — there is no state where two of them have to agree — so a
 * Save would only ever confirm what the screen already showed, and the price of
 * forgetting to press it is an edit that silently did not happen.
 */
export function Settings() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("Appearance");

  // ⌘, is where every mac app keeps this. The button is a small grey icon in a
  // corner, which is the right size for how often it is needed and the wrong
  // size for finding it the first time; the shortcut and the tooltip are how it
  // is found.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent side="bottom">Settings ⌘,</TooltipContent>
      </Tooltip>
      <DialogContent className="grid-cols-[10rem_1fr] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogDescription className="sr-only">
          Settings for how this window is drawn and what the agent may do.
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
   * The whole object every time, and whatever comes back is what is shown: the
   * server decides what it will keep, and the screen says what it kept.
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
      {section === "Appearance" && <Appearance />}

      {section === "Keys" && <Keys />}

      {section === "Agent" && (
        <>
          <Heading title="Agent">What pi may do.</Heading>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="toolMode" className="text-xs text-muted-foreground">
              New sessions open on
            </Label>
            {/* NativeSelect's chevron is placed against its own wrapper, and the
                wrapper stretches to the column. Narrowing has to happen outside
                it, or the arrow ends up a panel's width from the box. */}
            <div className="w-48">
              <NativeSelect
                id="toolMode"
                className="text-sm"
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
            </div>
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

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/**
 * The one setting that is about this window rather than about the agent, and
 * the only one that does not go to the server — see theme.ts. Which is also why
 * it applies as it is clicked: there is nothing to wait for, and the answer to
 * "what does dark look like" is the screen.
 */
function Appearance() {
  const [theme, setCurrent] = useState<Theme>(readTheme);

  return (
    <>
      <Heading title="Appearance">How this window is drawn.</Heading>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Theme</Label>
        <ButtonGroup>
          {THEMES.map(({ id, label }) => (
            <Button
              key={id}
              variant="outline"
              size="sm"
              data-active={theme === id}
              aria-pressed={theme === id}
              onClick={() => {
                setTheme(id);
                setCurrent(id);
              }}
              className="h-8 px-3 text-xs data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
            >
              {label}
            </Button>
          ))}
        </ButtonGroup>
        <p className="text-xs text-muted-foreground">
          Kept in this browser, not with the rest — the same window at a desk and in bed wants
          two answers.
        </p>
      </div>
    </>
  );
}

const MOD = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";

/** Every key the app answers to, in one place — the shortcuts are how the app is found, and this is how they are. */
const KEYS: [string, string][] = [
  [`${MOD}N`, "New note"],
  [`${MOD}P`, "Open a note by name, or make one"],
  [`${MOD}S`, "Save now (typing is saved on its own when it pauses)"],
  [`${MOD}F`, "Find and replace in the note"],
  [`${MOD}↵`, "Accept pi's words under the cursor"],
  [`${MOD}⌫`, "Put back what pi replaced under the cursor"],
  [`${MOD}↵ in the message box`, "Steer the run in progress"],
  [`${MOD}\\`, "Show or hide pi's column"],
  [`${MOD},`, "Settings"],
  [`${MOD}⇧D`, "Raw events, for debugging"],
];

function Keys() {
  return (
    <>
      <Heading title="Keys">What the app answers to.</Heading>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        {KEYS.map(([key, what]) => (
          <div key={key} className="contents">
            <dt className="whitespace-nowrap font-medium tabular-nums">{key}</dt>
            <dd className="text-muted-foreground">{what}</dd>
          </div>
        ))}
      </dl>
    </>
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

