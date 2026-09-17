import { useEffect, useState, useSyncExternalStore } from "react";

import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckIcon, GripVerticalIcon, XIcon } from "lucide-react";

import { LOADOUT_SLOTS, placesOf, providersOf } from "../../../models";
import { configStore } from "../serverState";
import type { ModelInfo } from "../types";
import { levelLabel } from "./ModelPicker";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Which models the composer's picker offers, and in what order.
 *
 * Two halves. Above, the places — as many as the picker has digits for, in the
 * order the digits go, dragged by the handle to reorder. Below, every model pi
 * can reach, to put in them.
 *
 * Dragging up from the catalogue would be the obvious gesture and is the wrong
 * one here: there are fifty-odd models in a panel that scrolls, so the model
 * being dragged and the place it is going are rarely on screen together, and
 * the drag turns into holding the button while the panel creeps. Reordering
 * five things that are all in view is a drag; reaching into a long list is a
 * click.
 *
 * Nothing is saved behind a button, as everywhere else in settings — each
 * change is a whole list, written as it is made.
 */
export function Loadout({ chosen, onChange }: { chosen: string[]; onChange: (next: string[]) => void }) {
	const [catalogue, setCatalogue] = useState<ModelInfo[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [query, setQuery] = useState("");
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

	useEffect(() => {
		fetch("/api/models")
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then(setCatalogue)
			.catch(() => setFailed(true));
	}, []);

	if (failed) return <p className="text-xs text-destructive">could not read the models</p>;
	if (!catalogue) return <p className="text-xs text-muted-foreground">Reading the models…</p>;

	const byKey = new Map(catalogue.map((m) => [m.key, m]));
	// The seed while nothing has been chosen — so this screen opens on the same
	// list the composer has, and the first edit is an edit of what was there
	// rather than of an empty row. Otherwise everything chosen, offered now or
	// not: every edit below is written whole, and one made on the shorter list
	// would take the missing models out of the file. See placesOf.
	const places = placesOf(chosen, [...byKey.keys()]);
	const full = places.length >= LOADOUT_SLOTS;
	// An empty list is how "nobody has chosen" is written, so emptying the last
	// place would bring the seed back rather than leave nothing. One model is
	// also the fewest a picker can be made of.
	const canRemove = places.length > 1;

	const hit = query.trim().toLowerCase();
	const shown = hit ? catalogue.filter((m) => `${m.name} ${m.key}`.toLowerCase().includes(hit)) : catalogue;
	const groups = providersOf(shown.map((m) => m.key)).map(
		(provider) => [provider, shown.filter((m) => m.key.startsWith(`${provider}/`))] as const,
	);

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = places.indexOf(String(active.id));
		const to = places.indexOf(String(over.id));
		if (from < 0 || to < 0) return;
		onChange(arrayMove(places, from, to));
	};

	return (
		<>
			<header className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold">Loadout</h2>
				<p className="text-xs text-muted-foreground">
					The models the composer offers, in the order it offers them. {MOD}1 to {MOD}
					{LOADOUT_SLOTS} there.
				</p>
			</header>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[restrictToVerticalAxis]}
				onDragEnd={onDragEnd}
			>
				<SortableContext items={places} strategy={verticalListSortingStrategy}>
					<ol className="flex flex-col gap-1">
						{places.map((key, i) => (
							<Place
								key={key}
								id={key}
								place={i + 1}
								model={byKey.get(key)}
								inUse={config?.model === key}
								canRemove={canRemove}
								onRemove={() => onChange(places.filter((k) => k !== key))}
							/>
						))}
						{Array.from({ length: LOADOUT_SLOTS - places.length }, (_, i) => (
							<li
								key={`empty-${i}`}
								className="flex h-8 items-center gap-2 rounded-md border border-dashed px-2 text-xs text-muted-foreground"
							>
								<span className="w-3.5" />
								<span className="w-3 text-center tabular-nums">{places.length + i + 1}</span>
								<span>Empty</span>
							</li>
						))}
					</ol>
				</SortableContext>
			</DndContext>

			<div className="flex flex-col gap-2">
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={`Search ${catalogue.length} models`}
					className="h-8 text-xs"
					aria-label="Search models"
				/>
				{full && (
					<p className="text-xs text-muted-foreground">
						All {LOADOUT_SLOTS} places are taken — take one out to put another in.
					</p>
				)}
				{groups.length === 0 && <p className="text-xs text-muted-foreground">No model by that name.</p>}
				{groups.map(([provider, models]) => (
					<div key={provider} className="flex flex-col gap-1">
						<h3 className="pt-1 text-xs font-medium text-muted-foreground">{provider}</h3>
						{models.map((m) => {
							const taken = places.includes(m.key);
							return (
								<Button
									key={m.key}
									type="button"
									variant="ghost"
									size="sm"
									disabled={taken ? !canRemove : full}
									onClick={() => onChange(taken ? places.filter((k) => k !== m.key) : [...places, m.key])}
									className="h-7 justify-start gap-2 px-2 text-xs font-normal"
								>
									<CheckIcon className={taken ? "opacity-100" : "opacity-0"} />
									<span className="min-w-0 truncate">{m.name}</span>
									<span className="ml-auto text-muted-foreground">{levelLabel(m.level)}</span>
								</Button>
							);
						})}
					</div>
				))}
			</div>
		</>
	);
}

const MOD = navigator.userAgent.includes("Mac") ? "⌃⌘" : "Ctrl+Alt+";

/**
 * One place in the loadout, with the model in it. Dragged by the handle only, so the × stays clickable.
 *
 * A model pi does not offer just now keeps its place, named by its key since
 * pi gave no name for it, and says so; the picker leaves it out until pi
 * offers it again.
 */
function Place({
	id,
	place,
	model,
	inUse,
	canRemove,
	onRemove,
}: {
	id: string;
	place: number;
	model: ModelInfo | undefined;
	inUse: boolean;
	canRemove: boolean;
	onRemove: () => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
	const name = model?.name ?? id;

	return (
		<li
			ref={setNodeRef}
			data-dragging={isDragging || undefined}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className="flex h-8 items-center gap-2 rounded-md border bg-card px-2 text-xs data-[dragging]:z-10 data-[dragging]:opacity-60"
		>
			<button
				type="button"
				aria-label={`Move ${name}`}
				className="cursor-grab text-muted-foreground focus-visible:outline-none"
				style={{ touchAction: "none" }}
				{...attributes}
				{...listeners}
			>
				<GripVerticalIcon className="size-3.5" />
			</button>
			<span className="w-3 text-center tabular-nums text-muted-foreground">{place}</span>
			<span className={model ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 truncate text-muted-foreground"}>{name}</span>
			{inUse && (
				<Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
					In use
				</Badge>
			)}
			{model ? (
				<span className="text-muted-foreground">{levelLabel(model.level)}</span>
			) : (
				<span
					className="text-muted-foreground"
					title="Signed out of its provider, or no longer offered. The composer leaves it out until pi offers it again."
				>
					Not available
				</span>
			)}
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				disabled={!canRemove}
				onClick={onRemove}
				aria-label={`Take out ${name}`}
				title={canRemove ? undefined : "The loadout keeps at least one model"}
			>
				<XIcon />
			</Button>
		</li>
	);
}
