/**
 * Where "Report a Problem…" sends the person: a new issue on the repository,
 * with what the app knows about itself already written in.
 *
 * Only that. The log is not attached and nothing is sent anywhere by the app —
 * the page is public and the log names the person's notes, so it is theirs to
 * read and to drag in. The boxes are the ids in
 * .github/ISSUE_TEMPLATE/problem.yml.
 */
export const ISSUES = "https://github.com/minkyojung/pi-web-ui/issues/new";

export function reportUrl({ version, macos, arch }) {
	const url = new URL(ISSUES);
	url.searchParams.set("template", "problem.yml");
	url.searchParams.set("version", version);
	url.searchParams.set("macos", macos);
	url.searchParams.set("mac", arch === "arm64" ? "Apple Silicon" : arch === "x64" ? "Intel" : arch);
	return url.toString();
}
