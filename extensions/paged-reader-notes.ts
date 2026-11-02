import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Editor, Key, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { noteKey, type ReaderController, type Section } from "./paged-reader-core.ts";
import { noteEditor, noteStatus, sendStatus } from "./paged-reader-panel.ts";

/** Wiring the note editor needs from its host overlay. */
export type NoteHost = {
	tui: TUI;
	theme: Theme;
	controller: ReaderController;
	isAgentIdle: () => boolean;
	isFocused: () => boolean;
	currentKey: () => string | undefined;
	currentSectionId: () => string | undefined;
	setStatus: (line: string) => void;
	requestRender: () => void;
};

/** Owns the note editor state and actions for one overlay run. */
export class NoteSession {
	private readonly host: NoteHost;
	private key?: string | undefined;
	editor?: Editor | undefined;
	private sectionId?: string | undefined;
	active = false;

	constructor(host: NoteHost) {
		this.host = host;
	}

	/** Opens the editor for a section. */
	open(key: string, section: Section): void {
		this.active = true;
		this.key = key;
		this.sectionId = section.id;
		this.editor = noteEditor({
			tui: this.host.tui,
			theme: this.host.theme,
			controller: this.host.controller,
			key,
			sectionId: section.id,
			onDraft: () => this.host.setStatus("Draft autosaved locally"),
		});
		this.editor.focused = this.host.isFocused();
		const state = this.host.controller.state();
		const draft = state.drafts.get(noteKey(key, section.id)) ?? "";
		const previous = state.latestFeedback(key, section.id);
		this.host.setStatus(
			noteStatus(
				draft,
				previous,
				state.statuses.get(previous?.id ?? ""),
				previous === undefined ? 0 : state.replies(previous.id).length,
			),
		);
		this.host.requestRender();
	}

	/** Saves the current draft locally without calling the agent. */
	save(): void {
		if (this.key === undefined || this.editor === undefined || this.sectionId === undefined) {
			return;
		}
		this.host.controller.persist({
			kind: "draft",
			key: this.key,
			sectionId: this.sectionId,
			text: this.editor.getText(),
		});
		this.host.setStatus("Saved locally · no agent call");
		this.host.requestRender();
	}

	/** Closes the editor, saving any unsaved draft. */
	leave(): void {
		if (this.key === undefined || this.editor === undefined || this.sectionId === undefined) {
			return;
		}
		const text = this.editor.getText();
		if (this.host.controller.state().drafts.get(noteKey(this.key, this.sectionId)) !== text) {
			this.save();
		}
		this.close();
		this.host.setStatus("");
		this.host.requestRender();
	}

	/** Drops the editor without saving. */
	private close(): void {
		this.editor = undefined;
		this.sectionId = undefined;
		this.active = false;
	}

	/** Sends the current note, or retries the latest note for the section. */
	send(retry: boolean): void {
		const note = this.noteFor(retry);
		if (note === undefined) {
			return;
		}
		const outcome = this.host.controller.send({
			...note,
			retry,
			agentIdle: this.host.isAgentIdle(),
		});
		this.host.setStatus(sendStatus(outcome));
		if ((outcome === "requested" || outcome === "queued") && this.active) {
			this.close();
		}
		this.host.requestRender();
	}

	/** The send payload for one attempt. */
	private noteFor(retry: boolean): { key: string; sectionId: string; text: string } | undefined {
		if (retry) {
			return this.retryNote();
		}
		if (this.key === undefined || this.editor === undefined || this.sectionId === undefined) {
			return undefined;
		}
		return { key: this.key, sectionId: this.sectionId, text: this.editor.getText() };
	}

	/** The latest note for the reading cursor's document and section, for a retry. */
	private retryNote(): { key: string; sectionId: string; text: string } | undefined {
		const key = this.host.currentKey();
		const sectionId = this.host.currentSectionId();
		if (key === undefined || sectionId === undefined) {
			return undefined;
		}
		const text = this.host.controller.state().latestFeedback(key, sectionId)?.note ?? "";
		return { key, sectionId, text };
	}

	/** Handles a keypress while the editor is focused. */
	input(data: string): void {
		if (matchesKey(data, Key.ctrl("enter")) || data === "\x1b[13;5~") {
			this.send(false);
		} else if (matchesKey(data, Key.ctrl("s"))) {
			this.save();
		} else if (matchesKey(data, Key.escape)) {
			this.leave();
		} else if (matchesKey(data, Key.enter)) {
			this.editor?.insertTextAtCursor("\n");
		} else {
			this.editor?.handleInput(data);
		}
		this.host.tui.requestRender();
	}

	/** Focus passthrough for the embedded editor. */
	setFocused(value: boolean): void {
		if (this.editor !== undefined) {
			this.editor.focused = value;
		}
	}

	invalidate(): void {
		this.editor?.invalidate();
	}

	/** Clears editor state when the branch changes. */
	reset(): void {
		this.editor = undefined;
		this.sectionId = undefined;
		this.active = false;
	}
}
