import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	Markdown,
	sliceByColumn,
	stripTerminalSequences,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { displayBody, type ReaderAnchor, type ReaderDocument } from "./paged-reader-core.ts";

const BODY_WIDTH = 70;

type Fragment = { line: number; column: number; text: string };
export type ReaderPage = {
	anchor: ReaderAnchor;
	sectionIndex: number;
	sectionPage: number;
	sectionPages: number;
	body: string[];
};

function splitLine(line: string, width: number, lineIndex: number): Fragment[] {
	// Markdown pads each rendered row; pagination must not turn that padding into extra pages.
	const plain = stripTerminalSequences(line).trimEnd();
	if (plain === "") {
		return [{ line: lineIndex, column: 0, text: "" }];
	}
	const styled = sliceByColumn(line, 0, visibleWidth(plain), true);
	const fragments: Fragment[] = [];
	let offset = 0;
	for (const text of wrapTextWithAnsi(styled, width)) {
		const visible = stripTerminalSequences(text).trimEnd();
		if (visible === "") {
			continue;
		}
		const start = plain.indexOf(visible, offset);
		if (start < 0) {
			return hardSplitLine(line, width, lineIndex, plain);
		}
		fragments.push({ line: lineIndex, column: visibleWidth(plain.slice(0, start)), text });
		offset = start + visible.length;
	}
	return fragments.length > 0 ? fragments : [{ line: lineIndex, column: 0, text: "" }];
}

function hardSplitLine(line: string, width: number, lineIndex: number, plain: string): Fragment[] {
	const fragments: Fragment[] = [];
	let start = 0;
	let column = 0;
	for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
		plain,
	)) {
		const size = visibleWidth(segment);
		if (column > start && column - start + size > width) {
			fragments.push({
				line: lineIndex,
				column: start,
				text: sliceByColumn(line, start, column - start, true),
			});
			start = column;
		}
		column += size;
	}
	fragments.push({
		line: lineIndex,
		column: start,
		text: sliceByColumn(line, start, column - start, true),
	});
	return fragments;
}

export function paginateDocument(doc: ReaderDocument, width: number, rows: number): ReaderPage[] {
	const pageWidth = Math.max(2, Math.min(BODY_WIDTH, Math.floor(width)));
	const pageRows = Math.max(1, Math.floor(rows));
	const pages: ReaderPage[] = [];
	for (const [sectionIndex, section] of doc.sections.entries()) {
		const rendered = new Markdown(displayBody(section.text), 0, 0, getMarkdownTheme()).render(
			BODY_WIDTH,
		);
		const fragments = (rendered.length > 0 ? rendered : [""]).flatMap((line, index) =>
			splitLine(line, pageWidth, index),
		);
		const sectionPages = Math.ceil(fragments.length / pageRows);
		for (let start = 0; start < fragments.length; start += pageRows) {
			const first = fragments[start];
			if (first === undefined) {
				continue;
			}
			pages.push({
				anchor: { sectionId: section.id, line: first.line, column: first.column },
				sectionIndex,
				sectionPage: Math.floor(start / pageRows) + 1,
				sectionPages,
				body: fragments.slice(start, start + pageRows).map((fragment) => fragment.text),
			});
		}
	}
	return pages;
}

export function pageIndexFor(
	doc: ReaderDocument,
	pages: ReaderPage[],
	anchor: ReaderAnchor,
): number {
	const sectionIndex = Math.max(
		0,
		doc.sections.findIndex((section) => section.id === anchor.sectionId),
	);
	let selected = 0;
	for (const [index, page] of pages.entries()) {
		const at = page.anchor;
		if (
			page.sectionIndex > sectionIndex ||
			(page.sectionIndex === sectionIndex &&
				(at.line > anchor.line || (at.line === anchor.line && at.column > anchor.column)))
		) {
			break;
		}
		selected = index;
	}
	return selected;
}
