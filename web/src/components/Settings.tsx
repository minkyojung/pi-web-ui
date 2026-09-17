import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SettingsIcon } from "lucide-react";
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
import { Accounts } from "@/components/Accounts";
import { Loadout } from "@/components/Loadout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { readTheme, setTheme, type Theme } from "@/theme";
import { configStore, providersStore } from "../serverState";
import { settingsOpenStore } from "../settingsOpen";

/** settings.ts, as it arrives. Declared again rather than imported: that module reads files. */
type Settings = {
  toolMode: ToolModeId;
  loadout: string[];
};

const SECTIONS = ["Accounts", "Appearance", "Agent", "Loadout", "Keys"] as const;
type Section = (typeof SECTIONS)[number];
const isSection = (name: string): name is Section => (SECTIONS as readonly string[]).includes(name);

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
  const [section, setSection] = useState<Section>("Accounts");

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

  // Asked for from elsewhere — the picker's last item — on a section by name.
  const wanted = useSyncExternalStore(settingsOpenStore.subscribe, settingsOpenStore.get);
  useEffect(() => {
    if (!wanted) return;
    if (isSection(wanted)) {
      setSection(wanted);
      setOpen(true);
    }
    settingsOpenStore.set(null);
  }, [wanted]);

  // A first run: no model, because nobody is signed in anywhere. The one thing
  // to do is here, so it is opened rather than left to be found behind a small
  // grey icon. Once per page load — closing it is an answer too.
  const config = useSyncExternalStore(configStore.subscribe, configStore.get);
  const providers = useSyncExternalStore(providersStore.subscribe, providersStore.get);
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || !config || !providers) return;
    if (config.model !== null || providers.some((p) => p.signedIn)) return;
    offered.current = true;
    setSection("Accounts");
    setOpen(true);
  }, [config, providers]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              className="shrink-0 text-muted-foreground"
            >
              <SettingsIcon className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Settings ⌘,</TooltipContent>
      </Tooltip>
      <DialogContent className="h-[72vh] max-h-[44rem] min-h-[28rem] w-[72vw] max-w-[64rem] min-w-[40rem] grid-cols-[13rem_1fr] grid-rows-1 gap-0 overflow-hidden p-0 sm:max-w-[64rem]">
        <DialogDescription className="sr-only">
          Settings for how this window is drawn and what the agent may do.
        </DialogDescription>
        <nav className="flex flex-col gap-0.5 bg-muted/30 p-3">
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
        <div className="min-w-0 overflow-y-auto p-6">
          <Panel section={section} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Panel({ section }: { section: Section }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What is on screen, readable without waiting for a render — see save.
  const showing = useRef<Settings | null>(null);
  const saves = useRef(0);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        showing.current = s;
        setSettings(s);
      })
      .catch(() => setError("could not read settings"));
  }, []);

  /**
   * The whole object every time, and whatever comes back is what is shown: the
   * server decides what it will keep, and the screen says what it kept.
   *
   * Built on what is on screen rather than on what the server last confirmed,
   * and the answer to a save that another has overtaken is dropped. The loadout
   * is a whole list written at once, so two edits made inside one round trip
   * would otherwise each start from the saved copy and the first would be lost.
   */
  const save = useCallback(async (patch: Partial<Settings>) => {
    if (!showing.current) return;
    setError(null);
    const next = { ...showing.current, ...patch };
    showing.current = next;
    setSettings(next);
    const mine = ++saves.current;
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const kept = await r.json();
      if (mine !== saves.current) return;
      showing.current = kept;
      setSettings(kept);
    } catch {
      setError("could not save");
    }
  }, []);

  return (
    <section className="flex flex-col gap-4">
      {section === "Appearance" && <Appearance />}

      {section === "Keys" && <Keys />}

      {section === "Accounts" && <Accounts />}

      {section === "Loadout" && settings && (
        <Loadout chosen={settings.loadout} onChange={(loadout) => void save({ loadout })} />
      )}

      {section === "Agent" && (
        <>
          <Heading title="Agent">What the agent may do.</Heading>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="toolMode" className="text-xs text-muted-foreground">
              New sessions open on
            </Label>
            {/* The native select was for the lists that are picked by typing —
                fifty models, an unbounded session list. This one is three
                rungs, so it can be the app's own listbox and be drawn in the
                app's chrome rather than the system's. */}
            <Select
              disabled={!settings}
              value={settings?.toolMode ?? ""}
              onValueChange={(v) => void save({ toolMode: v as ToolModeId })}
            >
              <SelectTrigger id="toolMode" size="sm" className="w-48">
                <SelectValue placeholder="…" />
              </SelectTrigger>
              <SelectContent>
                {MODE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {describeMode(id).name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
  { id: "perplexity-light", label: "Perplexity Light" },
  { id: "perplexity-dark", label: "Perplexity Dark" },
];

/**
 * The settings that are about this window rather than about the agent, and
 * the only ones that do not go to the server — see theme.ts.
 * Which is also why they apply as they are clicked: there is nothing to wait
 * for, and the answer to "what does dark look like" is the screen.
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
  [`${MOD}⇧F`, "Search the text of every note"],
  [`${MOD}S`, "Save now (typing is saved on its own when it pauses)"],
  [`${MOD}F`, "Find and replace in the note"],
  [`${MOD}↵`, "Accept the agent's words under the cursor"],
  [`${MOD}⌫`, "Put back what the agent replaced under the cursor"],
  [`${MOD}↵ in the message box`, "Steer the run in progress"],
  [`${MOD}\\`, "Show or hide the agent"],
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

