import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	CURSOR_MARKER,
	type Editor,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { displayLabel, type ReaderDocument, type ReaderState } from "./paged-reader-core.ts";
import {
	hasMouseHandler,
	mouseRegion,
	type MouseEvent,
	type MouseResult,
} from "./paged-reader-ui.ts";

/** Marker for reply and unlinked documents in the library list. */
const docMarker = (doc: ReaderDocument): string => {
	if (doc.replyToFeedbackId !== undefined) {
		return "↳ ";
	}
	if (doc.unlinkedFeedbackIds !== undefined) {
		return "? ";
	}
	return "";
};

/** One library row's full label, empty when the row is past the last document. */
const libraryLabel = (
	index: number,
	selection: number,
	doc: ReaderDocument | undefined,
): string => {
	if (doc === undefined) {
		return "";
	}
	const prefix = index === selection ? "› " : "  ";
	return `${prefix}${docMarker(doc)}${displayLabel(doc.title)} · r${doc.revision}`;
};

/** A row that renders blank, keeping library rows aligned. */
const blankRow = (): Component => ({
	render: (width: number) => [" ".repeat(width)],
	invalidate(): void {
		// Nothing to invalidate: the blank row always renders the same output.
	},
});

/** Inputs for one rendered library-list body. */
export type ListBodyOptions = {
	state: ReaderState;
	theme: Theme;
	selection: number;
	width: number;
	rows: number;
	onPick: (index: number, key: string) => void;
};

/** One clickable library row. */
const listRow = (options: {
	index: number;
	key: string;
	label: string;
	selected: boolean;
	theme: Theme;
	width: number;
	onPick: (index: number, key: string) => void;
}): Component => {
	const { index, key, label, selected, theme, width, onPick } = options;
	const clipped = truncateToWidth(label, width);
	const text = new Text(selected ? theme.fg("accent", clipped) : clipped, 0, 0);
	return mouseRegion(text, (event: MouseEvent) => {
		if (event.type !== "click" || event.button !== "left" || event.x >= visibleWidth(clipped)) {
			return;
		}
		onPick(index, key);
		return { handled: true };
	});
};

/** Renders the document library rows, clickable to select. */
export function listBody(options: ListBodyOptions): Component {
	const body = new Container();
	const { state, theme, selection, width, rows, onPick } = options;
	const start = Math.max(0, Math.min(selection - rows + 1, state.order.length - rows));
	for (let row = 0; row < rows; row++) {
		const index = start + row;
		const key = state.order[index] ?? "";
		const doc = key !== "" ? state.documents.get(key) : undefined;
		const label = libraryLabel(index, selection, doc);
		const selected = index === selection;
		body.addChild(listRow({ index, key, label, selected, theme, width, onPick }));
		if (label === "") {
			body.addChild(blankRow());
		}
	}
	return body;
}

/** Maps a note-body mouse position to the editor row it displays. */
const noteMouseY = (
	rows: number,
	at: { y: number; cursorRow: number; start: number; lastRow: number },
): number => {
	if (rows < 3) {
		return at.y === 0 ? at.cursorRow : at.lastRow;
	}
	if (at.y === 0) {
		return 0;
	}
	if (at.y === rows - 1) {
		return at.lastRow;
	}
	return at.y + at.start;
};

/** Renders the note editor with its border rows and cursor-following viewport. */
export function noteBody(editor: Editor, width: number, rows: number): Component {
	const all = editor.render(width);
	const capacity = Math.max(1, rows - 2);
	const cursor = all.findIndex((line) => line.includes(CURSOR_MARKER));
	const start = Math.max(
		0,
		Math.min(Math.max(0, cursor - 1) - capacity + 1, all.length - 2 - capacity),
	);
	const cursorRow = Math.max(1, cursor);
	const visible: Array<string | undefined> =
		rows < 3
			? [all[cursorRow] ?? all[1] ?? all[0], ...(rows === 2 ? [all.at(-1) ?? ""] : [])]
			: [
					all[0],
					...all.slice(1 + start, Math.min(all.length - 1, 1 + start + capacity)),
					all.at(-1) ?? "",
				];
	return {
		render: (renderWidth: number) =>
			Array.from({ length: rows }, (_, index) => {
				const line = visible[index] ?? "";
				return truncateToWidth(line, renderWidth, "", true);
			}),
		invalidate: (): void => editor.invalidate(),
		handleMouse: (event: MouseEvent): MouseResult | undefined => {
			if (!hasMouseHandler(editor)) {
				return;
			}
			const y = noteMouseY(rows, { y: event.y, cursorRow, start, lastRow: all.length - 1 });
			const result = editor.handleMouse({ ...event, y });
			return result !== undefined ? { handled: true } : undefined;
		},
	};
}
