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
import { Switch } from "@/components/ui/switch";
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
import { applySettings, configStore, providersStore, settingsStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import type { Settings, SettingsMsg } from "../types";
import { send } from "../ws";
import { settingsOpenStore } from "../settingsOpen";
import { bridge, updateStore } from "../update";

const SECTIONS = ["Accounts", "Appearance", "Agent", "Loadout", "Keys", "About"] as const;
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

  const updateReady = useSyncExternalStore(updateStore.subscribe, updateStore.get)?.phase === "ready";

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
    // In the app the middle column says it, and has the button (Watermark.tsx):
    // a dialog over a window that has just been opened is one thing too many.
    if (bridge()) return;
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
              className="relative shrink-0 text-muted-foreground"
            >
              <SettingsIcon className="size-3.5" />
              {/* A new version is ready and the offer was waved away: what is
                  left of it, until the restart. */}
              {updateReady && <span aria-label="An update is ready" className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />}
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
  // What the server last said, which every window hears whenever any of them
  // changes something — so this screen never edits a copy it read when it
  // opened. See SettingsMsg.
  const stored = useSyncExternalStore(settingsStore.subscribe, settingsStore.get)?.settings;
  // Changes sent and not yet answered, shown over it. The loadout is a whole
  // list written at once, and a second edit made inside one round trip has to
  // start from the first, not from the copy the server has not replaced yet.
  const [pending, setPending] = useState<Partial<Settings> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saves = useRef(0);
  const settings = stored && { ...stored, ...pending };
  const connection = useSyncExternalStore(subscribe, getConnection);

  /**
   * Only the change, which the server lays over what is on disk; what comes
   * back is what is shown, since the server decides what it will keep.
   *
   * Shown at once rather than after the answer. When the last save is answered
   * the change stops being laid over — replaced by what was kept, or, if it
   * could not be written, taken back, so the screen never shows a setting the
   * next session will not have. An earlier save's answer is not the last word
   * while a later one is on its way.
   */
  const save = useCallback(async (patch: Partial<Settings>) => {
    setError(null);
    setPending((was) => ({ ...was, ...patch }));
    const mine = ++saves.current;
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      // Kept only if nothing newer has been heard meanwhile — see applySettings.
      applySettings((await r.json()) as SettingsMsg);
      if (mine !== saves.current) return;
      setPending(null);
    } catch {
      if (mine !== saves.current) return;
      setPending(null);
      setError("could not save");
    }
  }, []);

  return (
    <section className="flex flex-col gap-4">
      {section === "Appearance" && <Appearance />}

      {section === "Keys" && <Keys />}

      {section === "Accounts" && <Accounts />}

      {section === "About" && <About />}

      {/* The settings come on the socket, as the server says them on connecting;
          until they have, the sections made of them say why they are empty
          rather than showing nothing, which reads as a setting lost. */}
      {!settings && (section === "Loadout" || section === "Agent") && (
        <p role="status" className="text-xs text-muted-foreground">
          {connection === "open" ? "Reading settings…" : "Not connected — settings show once the window reconnects."}
        </p>
      )}

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
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="loadExtensions">Load the extensions installed for pi&apos;s terminal</Label>
              <p className="text-xs text-muted-foreground">
                Their tools and commands appear here as they do there. Applies when the next session starts. One of
                them registering a tool Octave has — ask_user, the note tools — keeps Octave&apos;s.
              </p>
            </div>
            <Switch
              id="loadExtensions"
              disabled={!settings}
              checked={settings?.loadExtensions ?? true}
              onCheckedChange={(v) => void save({ loadExtensions: v === true })}
            />
          </div>
          <PiSwitches />
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

/** Thousands, the way pi's own screen says token counts: 16384 → "16k". */
const k = (n: number) => `${Math.round(n / 1000)}k`;

/**
 * pi's own settings, each behind a switch that calls pi's setter for it —
 * pi's settings.json is the one store, so the terminal sees the same value.
 * What pi has no setter for is said rather than offered: the two compaction
 * thresholds, which pi's own screen does not offer either.
 */
function PiSwitches() {
  const pi = useSyncExternalStore(configStore.subscribe, configStore.get)?.pi;
  if (!pi) return null;
  return (
    <div className="flex flex-col gap-3">
      <Heading title="pi">What pi does on its own. Kept in pi&apos;s own settings, shared with its terminal.</Heading>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="compaction">Compact the conversation automatically</Label>
          <p className="text-xs text-muted-foreground">
            When {k(pi.compaction.reserveTokens)} tokens of the context window are left, keeping the last{" "}
            {k(pi.compaction.keepRecentTokens)}. Those two are pi&apos;s to change, in ~/.pi/agent/settings.json.
          </p>
        </div>
        <Switch
          id="compaction"
          checked={pi.compaction.enabled}
          onCheckedChange={(v) => send({ type: "set_setting", setting: "compaction.enabled", value: v === true })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="retry">Retry a failed call on its own</Label>
          <p className="text-xs text-muted-foreground">
            A few times, with growing waits, before giving up. Each attempt is said in the conversation.
          </p>
        </div>
        <Switch
          id="retry"
          checked={pi.retryEnabled}
          onCheckedChange={(v) => send({ type: "set_setting", setting: "retry.enabled", value: v === true })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="hideThinking">Hide the model&apos;s thinking</Label>
          <p className="text-xs text-muted-foreground">The thinking rows are left out of the conversation; the answers stay.</p>
        </div>
        <Switch
          id="hideThinking"
          checked={pi.hideThinkingBlock}
          onCheckedChange={(v) => send({ type: "set_setting", setting: "hideThinkingBlock", value: v === true })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="askBranchSummary">Ask to summarize when leaving a branch</Label>
          <p className="text-xs text-muted-foreground">
            Stepping to another answer with the arrows asks first whether to keep a summary of the one left. Off, it moves without one.
          </p>
        </div>
        <Switch
          id="askBranchSummary"
          checked={pi.askBranchSummary}
          onCheckedChange={(v) => send({ type: "set_setting", setting: "branchSummary.skipPrompt", value: v !== true })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="projectTrust">Let pi read this folder&apos;s own .pi</Label>
          <p className="text-xs text-muted-foreground">
            {pi.projectTrust === "nothing"
              ? "This folder has no .pi settings, skills, prompts or SYSTEM.md of its own to read."
              : "Its settings, skills, prompt templates and SYSTEM.md, as pi reads a trusted project's. Remembered in pi's trust.json, where pi's terminal keeps its /trust answer."}
          </p>
        </div>
        <Switch
          id="projectTrust"
          checked={pi.projectTrust === "trusted"}
          disabled={pi.projectTrust === "nothing"}
          onCheckedChange={(v) => send({ type: "set_setting", setting: "projectTrust", value: v === true })}
        />
      </div>
    </div>
  );
}

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
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

/**
 * The version this is, and where the updater is — the one place the answer
 * to a check is given, since a check that finds nothing is not worth a
 * toast. Only a check asked for from here or the menu gets its "latest" or
 * "could not"; one that ran on its own says nothing and tries again later.
 */
function About() {
  const update = useSyncExternalStore(updateStore.subscribe, updateStore.get);
  const [asked, setAsked] = useState(false);
  const pi = bridge();
  const check = () => {
    setAsked(true);
    void pi?.check();
  };
  let status: React.ReactNode = null;
  if (update) {
    if (update.phase === "checking") status = "Checking…";
    else if (update.phase === "downloading") status = `Downloading ${update.version ?? ""}${update.progress !== null ? ` — ${update.progress}%` : ""}`;
    else if (update.phase === "ready") status = (
      <>
        {update.version} is ready.{" "}
        <button type="button" className="underline underline-offset-2" onClick={() => void pi?.restart()}>
          Restart
        </button>
      </>
    );
    else if (asked && update.error) status = "Could not check right now.";
    else if (asked) status = `${update.current} is the latest.`;
  }
  return (
    <>
      <Heading title="About">{update ? `Octave ${update.current}` : "Octave, from the dev server — nothing here updates."}</Heading>
      {update && (
        <div className="flex flex-col gap-2 text-xs">
          <div>
            <Button variant="outline" size="sm" onClick={check} disabled={update.phase === "checking"}>
              Check for Updates
            </Button>
          </div>
          <p role="status" className="text-muted-foreground">
            {status ?? "Octave looks for a new version when it starts and every four hours, and downloads it quietly."}
          </p>
        </div>
      )}
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

