/**
 * lucide-react's modules of one icon each, which export the icon's shapes as
 * data beside the component. The box's chips are plain DOM (schema.ts), not
 * React, and draw the same icons from these.
 */
declare module "lucide-react/dist/esm/icons/*.mjs" {
	export const __iconNode: [tag: string, attrs: Record<string, string>][];
}
