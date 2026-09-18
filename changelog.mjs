/**
 * The shape of CHANGELOG.md, as the release script writes it and the server
 * reads it. Nothing else here: scripts/release.mjs runs its own main() when
 * it is the script, and the server bundles what it imports — a module that
 * runs on import would run at the server's start.
 */
export const REPO = "https://github.com/minkyojung/pi-web-ui";

/** What is under [Unreleased]: the text between its heading and the next `## `, or the link block. */
export function unreleased(changelog) {
	const m = changelog.match(/^## \[Unreleased\]\n([\s\S]*?)(?=^## |^\[Unreleased\]:|(?![\s\S]))/m);
	return m ? m[1].trim() : "";
}

/**
 * The changelog with [Unreleased] closed as `version` on `date`: the section
 * becomes the version's, a fresh empty [Unreleased] goes above it, and the
 * reference links at the bottom are redone — Unreleased compares from the
 * new tag, the version compares from the previous tag or, for the first,
 * links to its own tag.
 */
export function cut(changelog, version, date, previousTag) {
	const tag = `v${version}`;
	const body = changelog.replace(/^## \[Unreleased\]\n/m, `## [Unreleased]\n\n## [${version}] - ${date}\n`);
	const versionLink = previousTag
		? `[${version}]: ${REPO}/compare/${previousTag}...${tag}`
		: `[${version}]: ${REPO}/releases/tag/${tag}`;
	const withoutLinks = body.replace(/^\[Unreleased\]: .*\n?/m, "");
	const links = `[Unreleased]: ${REPO}/compare/${tag}...HEAD\n${versionLink}\n`;
	// The links sit under the last section: after the first old version link, or at the end.
	const at = withoutLinks.search(/^\[\d+\.\d+\.\d+\]: /m);
	return at === -1 ? `${withoutLinks.trimEnd()}\n\n${links}` : `${withoutLinks.slice(0, at)}${links}${withoutLinks.slice(at)}`;
}

/** The section for a version, if the changelog has one. */
export function sectionFor(changelog, version) {
	const m = changelog.match(new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}\\n([\\s\\S]*?)(?=^## |^\\[Unreleased\\]:|(?![\\s\\S]))`, "m"));
	return m ? m[1].trim() : null;
}
