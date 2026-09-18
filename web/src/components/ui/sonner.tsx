import { useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * shadcn's sonner, with the theme read off <html data-theme> (theme.ts) rather
 * than next-themes, which this app does not have.
 */
function useDark(): boolean {
	const read = () => (document.documentElement.dataset.theme ?? "").includes("dark");
	const [dark, setDark] = useState(read);
	useEffect(() => {
		const watch = new MutationObserver(() => setDark(read()));
		watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		return () => watch.disconnect();
	}, []);
	return dark;
}

export function Toaster(props: ToasterProps) {
	const dark = useDark();
	return (
		<Sonner
			theme={dark ? "dark" : "light"}
			className="toaster group"
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
				} as React.CSSProperties
			}
			{...props}
		/>
	);
}
