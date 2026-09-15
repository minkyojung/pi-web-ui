import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

import { Button } from "./ui/button";

/**
 * A column that breaks does not take the window with it.
 *
 * React unmounts the whole tree when a render throws and nothing catches it —
 * every column, not the one at fault. A slip in pi's conversation would take
 * the note being typed in with it, and the window would go white with no word
 * about why. So each column gets one of these, the way VS Code and Zed contain
 * a broken panel rather than the window.
 *
 * What it does not have to do is save. The editor writes down what is unsaved
 * in its own cleanup, and React runs cleanups for the subtree it is throwing
 * away, so a note goes to disk on this path as it does on any other. Saying so
 * is still worth a line on screen: the first thing anyone wants to know is
 * whether they have lost what they wrote.
 *
 * Trying again remounts the children rather than reloading the window: what
 * broke is often the state that arrived rather than the component, and by the
 * time someone reaches for the button there is usually a newer one. The key is
 * what does it — a fragment's key, so nothing is added to the layout, which in
 * a window of three resizable columns is not a free thing to do.
 */
export class Boundary extends Component<{ name: string; hint?: string; children: ReactNode }, { failed: Error | null; tries: number }> {
	state = { failed: null as Error | null, tries: 0 };

	static getDerivedStateFromError(failed: Error) {
		return { failed };
	}

	componentDidCatch(failed: Error, info: ErrorInfo) {
		// The only record of a render that threw: nothing else is watching it.
		console.error(`[${this.props.name}]`, failed, info.componentStack);
	}

	render() {
		const { failed } = this.state;
		if (!failed) return <Fragment key={this.state.tries}>{this.props.children}</Fragment>;
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
				<p className="text-foreground">The {this.props.name} stopped drawing.</p>
				{this.props.hint ? <p>{this.props.hint}</p> : null}
				<p className="max-w-sm break-words font-mono text-xs">{failed.message}</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-1"
					onClick={() => this.setState((was) => ({ failed: null, tries: was.tries + 1 }))}
				>
					Try again
				</Button>
			</div>
		);
	}
}
