import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import * as React from "react";

/**
 * A native <select> wearing shadcn's chrome.
 *
 * Not the Radix Select: the model list runs to dozens of entries across
 * provider groups and the session list is unbounded, and picking out of either
 * is done by typing the first few characters — which a portalled listbox does
 * not do. Native also gets a real picker on a phone.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
	return (
		<div className="relative inline-flex items-center">
			<select
				data-slot="native-select"
				className={cn(
					"h-8 w-full appearance-none rounded-md border border-input bg-transparent py-1 pr-7 pl-2.5 text-xs shadow-xs outline-none transition-[color,box-shadow]",
					"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
					"disabled:cursor-not-allowed disabled:opacity-50",
					"dark:bg-input/30",
					className,
				)}
				{...props}
			>
				{children}
			</select>
			<ChevronDownIcon className="pointer-events-none absolute right-2 size-3.5 opacity-50" />
		</div>
	);
}

export { NativeSelect };
