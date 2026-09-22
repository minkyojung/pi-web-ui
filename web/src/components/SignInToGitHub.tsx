import { bridge } from "../github";
import { openSettings } from "../settingsOpen";

/**
 * What a dialog says when gh has no one signed in: in the app, `before` is
 * the way to Settings › Accounts, where the sign-in is — the dialog closes
 * first (`onGo`), since Settings is a dialog too; in a browser, where there
 * is no shell to sign in through, the terminal's own command.
 */
export function SignInToGitHub({ before, after, onGo }: { before: string; after: string; onGo: () => void }) {
	if (!bridge) {
		return (
			<>
				Sign in with <code>gh auth login</code>
				{after}
			</>
		);
	}
	return (
		<>
			<button
				type="button"
				className="text-primary underline-offset-2 hover:underline"
				onClick={() => {
					onGo();
					openSettings("Accounts");
				}}
			>
				{before}
			</button>
			{after}
		</>
	);
}
