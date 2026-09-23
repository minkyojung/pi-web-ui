/**
 * What every theme promises, checked.
 *
 * styles.css says of its palettes that "every pair below was measured against
 * the neutral theme it mirrors and clears AA, which a palette dropped in whole
 * would not have." This is the measuring, so that the claim is a test and not
 * a memory — and so the surfaces can be moved (see .context/plans/
 * surface-elevation.md) without the promise quietly lapsing.
 *
 * Reads the two :root blocks straight out of styles.css. No dependencies:
 * oklch to sRGB is forty lines, and a colour library would be a second place
 * for the truth to live.
 *
 *   node scripts/contrast.mjs          the table, and a non-zero exit if a pair fails
 *   node scripts/contrast.mjs --quiet  only the failures
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = fileURLToPath(new URL("../web/src/styles.css", import.meta.url));

/* ── colour ─────────────────────────────────────────────────────────────── */

const clamp = (n) => Math.min(1, Math.max(0, n));

/** oklch to linear sRGB. Björn Ottosson's matrices, unchanged. */
function oklchToLinear(L, C, H) {
	const h = (H * Math.PI) / 180;
	const a = C * Math.cos(h);
	const b = C * Math.sin(h);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
	];
}

/** The lightness oklch would call this linear-sRGB colour. For the elevation report. */
function okL([r, g, b]) {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const contrast = (fg, bg) => {
	const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
	return (hi + 0.05) / (lo + 0.05);
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * src over dst, where a browser does it: on the gamma-encoded sRGB values, not
 * on the light they stand for. Black at half alpha over white is #808080 on a
 * screen and #bcbcbc if the arithmetic is done in linear light, and the whole
 * point of this file is to say what is on the screen.
 */
const over = (src, alpha, dst) =>
	src.map((c, i) => toLinear(toGamma(c) * alpha + toGamma(dst[i]) * (1 - alpha)));

/* ── the stylesheet ─────────────────────────────────────────────────────── */

const THEMES = {
	"neutral light": /^:root \{$/m,
	"neutral dark": /^:root\[data-theme="dark"\] \{$/m,
};

/** The declarations of one :root block, comments and all the rest dropped. */
function block(css, open) {
	const start = css.search(open);
	if (start < 0) throw new Error(`no block for ${open}`);
	const body = css.slice(start, start + css.slice(start).indexOf("\n}"));
	const out = {};
	for (const [, name, value] of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) out[name] = value.trim();
	return out;
}

/**
 * A token as a colour: linear sRGB, plus the alpha it asked to be drawn at.
 * Handles what the stylesheet actually uses — oklch with and without an alpha,
 * a color-mix down to transparent, a plain var(), and currentColor, which in
 * every place it appears means the text colour.
 */
function resolve(vars, name, seen = new Set()) {
	if (seen.has(name)) throw new Error(`--${name} refers to itself`);
	seen.add(name);
	const raw = vars[name];
	if (raw === undefined) throw new Error(`no --${name}`);

	if (raw === "currentColor") return resolve(vars, "--foreground", seen);

	const plain = raw.match(/^var\((--[\w-]+)\)$/);
	if (plain) return resolve(vars, plain[1], seen);

	// color-mix(in oklab, var(--x) N%, transparent) — the mix is a wash of x.
	const mix = raw.match(/^color-mix\(in oklab,\s*var\((--[\w-]+)\)\s*([\d.]+)%,\s*transparent\)$/);
	if (mix) {
		const base = resolve(vars, mix[1], seen);
		return { rgb: base.rgb, alpha: base.alpha * (Number(mix[2]) / 100) };
	}

	const ok = raw.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%)?\)$/);
	if (ok) {
		const [, L, C, H, A] = ok;
		return { rgb: oklchToLinear(Number(L), Number(C), Number(H)), alpha: A === undefined ? 1 : Number(A) / 100 };
	}
	throw new Error(`cannot read --${name}: ${raw}`);
}

/** A token flattened against the surface it is drawn on. */
const flat = (vars, name, under) => {
	const { rgb, alpha } = resolve(vars, name);
	return alpha === 1 ? rgb : over(rgb, alpha, under);
};

/* ── what is drawn on what ──────────────────────────────────────────────── */

/** Text. AA wants 4.5 for body text, which everything here is. */
const TEXT = [
	["--foreground", "--background", "note and page"],
	["--foreground", "--card", "loadout row, prompt card"],
	["--foreground", "--popover", "menu, dialog"],
	["--foreground", "--muted", "editor conflict banner"],
	["--foreground", "--accent", "hovered row"],
	["--foreground", "--secondary", "secondary button"],
	["--card-foreground", "--card", "card"],
	["--popover-foreground", "--popover", "popover"],
	["--muted-foreground", "--background", "backlinks, tags, empty states"],
	["--muted-foreground", "--card", "second-rank on a card"],
	["--muted-foreground", "--popover", "menu shortcut, tooltip"],
	["--muted-foreground", "--muted", "banner, code block header"],
	["--muted-foreground", "--accent", "second-rank on a hover"],
	["--muted-foreground", "--sidebar", "sidebar, unselected"],
	["--foreground", "--panel", "pi's conversation"],
	["--muted-foreground", "--panel", "a timestamp, a tool's name"],
	["--foreground", "--panel-muted", "a tool's output, a queued message"],
	["--muted-foreground", "--panel-muted", "second-rank on pi's wash"],
	["--primary-foreground", "--primary", "default button"],
	["--secondary-foreground", "--secondary", "secondary button"],
	["--accent-foreground", "--accent", "selected menu row"],
	["--sidebar-foreground", "--sidebar", "the column's own text"],
	["--sidebar-accent-foreground", "--sidebar-accent", "selected note"],
	["--muted-foreground", "--sidebar-accent", "a hovered row on the frame"],
	["--foreground", "--sidebar-accent", "a hovered row on the frame"],
	["--sidebar-primary-foreground", "--sidebar-primary", "sidebar primary"],
	["--destructive", "--background", "error text"],
	["--destructive", "--card", "error on a card"],
	["--destructive", "--popover", "destructive menu row"],
];

/**
 * The washes CodeMirror derives from --foreground, and the text read on them.
 * They are written as percentages in Editor.tsx rather than as tokens, so they
 * are listed here by hand — if those numbers move, these do.
 *
 * Every one that is left carries --foreground on a wash of --foreground, which
 * stays safe however dark the wash is made: both ends move together. A tag was
 * here too and took an opaque token pair instead, which the rows above cover —
 * it put --muted-foreground on a wash of --foreground, two colours derived
 * apart and met only on the screen, and that is the shape to avoid.
 */
const WASHES = [
	["--foreground", 0.12, "--background", "--foreground", ".cm-highlight"],
	["--foreground", 0.14, "--background", "--foreground", ".cm-searchMatch"],
	["--foreground", 0.28, "--background", "--foreground", ".cm-searchMatch-selected"],
	["--foreground", 0.1, "--background", "--foreground", ".cm-selectionMatch"],
];

/** Focus rings are UI, not text: WCAG 1.4.11 asks 3.0. */
const UI = [
	["--ring", "--background", "focus ring on the page"],
	["--ring", "--card", "focus ring on a card"],
	["--ring", "--popover", "focus ring in a menu"],
	["--ring", "--panel", "focus ring in the composer"],
];

/** Not pass or fail — the elevation the surfaces actually have, which is the thing being redesigned. */
const STEPS = [
	["--sidebar", "--background", "frame against content"],
	["--card", "--background", "card against content"],
	["--popover", "--background", "popover against content"],
	["--muted", "--background", "muted fill against content"],
	["--panel", "--background", "pi against content"],
	["--panel-muted", "--background", "pi's wash against content"],
];
const RIMS = [
	["--border", "--background", "rim on content"],
	["--border", "--card", "rim on a card"],
	["--border", "--popover", "rim on a popover"],
	["--sidebar-border", "--sidebar", "rim in the sidebar"],
	["--border", "--panel", "rim round pi"],
];

/* ── run ────────────────────────────────────────────────────────────────── */

/**
 * Every pair in every theme: what contrast it has, and what it needs.
 * Exported so the test can assert on it and the CLI can print it — one
 * measurement, read two ways.
 */
export function measure() {
	const css = readFileSync(CSS, "utf8");
	const base = block(css, THEMES["neutral light"]);
	return Object.entries(THEMES).map(([theme, open]) => {
		// A theme overrides the base; what it does not name, it keeps.
		const vars = { ...base, ...block(css, open) };
		const page = flat(vars, "--background", [1, 1, 1]);
		const rows = [];

		for (const [fg, bg, where] of TEXT) {
			const under = flat(vars, bg, page);
			rows.push({ pair: `${fg} on ${bg}`, where, ratio: contrast(flat(vars, fg, under), under), wants: 4.5 });
		}
		for (const [wash, pct, on, fg, where] of WASHES) {
			const filled = over(resolve(vars, wash).rgb, pct, flat(vars, on, page));
			rows.push({ pair: `${fg} on ${where}`, where: `${+(pct * 100).toFixed(0)}% wash`, ratio: contrast(flat(vars, fg, filled), filled), wants: 4.5 });
		}
		const sel = flat(vars, "--selection", page);
		rows.push({ pair: "--selection-foreground on --selection", where: "selected text", ratio: contrast(flat(vars, "--selection-foreground", sel), sel), wants: 4.5 });

		for (const [fg, bg, where] of UI) {
			const under = flat(vars, bg, page);
			rows.push({ pair: `${fg} on ${bg}`, where, ratio: contrast(flat(vars, fg, under), under), wants: 3.0 });
		}

		const steps = STEPS.map(([a, b, where]) => ({ token: a, where, delta: okL(flat(vars, a, page)) - okL(flat(vars, b, page)) }));
		const rims = RIMS.map(([rim, on, where]) => {
			const surface = flat(vars, on, page);
			return { token: rim, where, delta: okL(flat(vars, rim, surface)) - okL(surface) };
		});
		return { theme, rows, steps, rims };
	});
}

/**
 * The ladder the surfaces stand on.
 *
 * Nothing here is about whether a word can be read, so none of it is an AA
 * matter — and it is the one thing shadcn's tokens leave open. Its --sidebar
 * is a second knob for a second colour, not a rung, and its own defaults put
 * the sidebar above the content in the dark theme and below it in the light
 * one. An inset layout cannot be built on that: it rests on the frame being
 * the lowest surface, so that the edge where the content meets it is two
 * fills meeting and not a line somebody drew.
 *
 * So the ladder is declared here, where it can be contradicted. The figures
 * come from .context/plans/surface-elevation.md, read off Linear's window.
 */
export function ladder() {
	const out = [];
	for (const { theme, steps, rims } of measure()) {
		const step = (token) => steps.find((s) => s.token === token).delta;
		const rim = (token, where) => rims.find((r) => r.token === token && r.where === where).delta;

		// The frame is the lowest surface there is, in every theme.
		if (step("--sidebar") > -0.02) out.push(`${theme}: the frame is not below the content — --sidebar ${step("--sidebar").toFixed(3)}, wants -0.02 or less`);

		// White is the ceiling in a light window, so a card is allowed to be
		// level with the page it is on. Never under it: that is a hole.
		for (const token of ["--card", "--popover"]) {
			if (step(token) < 0) out.push(`${theme}: ${token} is sunk into the content — ${step(token).toFixed(3)}, wants 0 or more`);
		}

		// pi is not the note, and the eye should not have to be told twice.
		// Which way it steps is the theme's: a light window has nowhere to go
		// but down, a dark one nowhere but up. Far enough to be seen, near
		// enough that it is still the same window.
		const up = theme.includes("dark") ? 1 : -1;
		const panel = step("--panel") * up;
		if (panel < 0.02 || panel > 0.04) {
			out.push(`${theme}: --panel ${panel < 0.02 ? "is not a floor of its own" : "has left the window"} — ${step("--panel").toFixed(3)}, wants ${up > 0 ? "+" : "-"}0.02 to ${up > 0 ? "+" : "-"}0.04`);
		}

		// And what is laid on pi's floor goes on past it, never back toward
		// the note: a wash that crosses its own surface is a hole.
		const wash = (step("--panel-muted") - step("--panel")) * up;
		if (wash < 0.01) out.push(`${theme}: --panel-muted does not read on --panel — ${(wash * up).toFixed(3)}, wants ${up > 0 ? "+0.01 or more" : "-0.01 or less"}`);

		// A rim is one distance from its own surface, and which side of it
		// depends only on where the light is. Too far and it is a line again.
		for (const [token, where] of [
			["--border", "rim on content"],
			["--sidebar-border", "rim in the sidebar"],
		]) {
			const d = Math.abs(rim(token, where));
			if (d < 0.035 || d > 0.065) out.push(`${theme}: ${token} is ${d < 0.035 ? "too faint to be an edge" : "drawn as a line, not a rim"} — ${rim(token, where).toFixed(3)}, wants 0.035 to 0.065`);
		}
	}
	return out;
}

/** Only what is under AA. Empty is the stylesheet's promise, kept. */
export const check = () =>
	measure().flatMap(({ theme, rows }) =>
		rows.filter((r) => r.ratio < r.wants).map((r) => `${theme}: ${r.pair} (${r.where}) — ${r.ratio.toFixed(2)}, wants ${r.wants}`),
	);

/* ── the table, when run by hand ────────────────────────────────────────── */

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const quiet = process.argv.includes("--quiet");
	const fail = [];
	for (const { theme, rows, steps, rims } of measure()) {
		const bad = rows.filter((r) => r.ratio < r.wants);
		bad.forEach((r) => fail.push(`${theme}: ${r.pair} (${r.where}) — ${r.ratio.toFixed(2)}, wants ${r.wants}`));
		if (quiet) continue;

		console.log(`\n\x1b[1m${theme}\x1b[0m  ${rows.length} pairs, ${bad.length ? `\x1b[31m${bad.length} under AA\x1b[0m` : "\x1b[32mall clear\x1b[0m"}`);
		for (const { pair, where, ratio, wants } of rows) {
			// The comfortable ones are noise until something nearby fails.
			if (ratio >= wants && bad.length === 0 && ratio > wants * 1.15) continue;
			const mark = ratio >= wants ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
			console.log(`  ${mark} ${ratio.toFixed(2).padStart(5)} / ${wants}  ${pair.padEnd(52)} ${where}`);
		}
		console.log("  \x1b[2melevation (oklch L, signed against content)\x1b[0m");
		for (const { token, where, delta } of [...steps, ...rims]) {
			console.log(`    \x1b[2m${delta >= 0 ? "+" : ""}${delta.toFixed(3)}  ${token.padEnd(18)} ${where}\x1b[0m`);
		}
	}
	const off = ladder();
	if (off.length && !quiet) {
		console.log(`\n\x1b[1mladder\x1b[0m  \x1b[31m${off.length} off\x1b[0m`);
	}
	off.forEach((o) => fail.push(o));
	if (fail.length) {
		console.error(`\n\x1b[31m${fail.length} pair${fail.length > 1 ? "s" : ""} under AA\x1b[0m`);
		fail.forEach((f) => console.error(`  ${f}`));
		process.exit(1);
	}
	console.log("\n\x1b[32mevery pair clears AA in both themes\x1b[0m");
}
