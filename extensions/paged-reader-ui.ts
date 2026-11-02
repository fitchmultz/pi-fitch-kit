import { type Component, MouseRegion } from "@earendil-works/pi-tui";

export type MouseEvent = {
	type: string;
	button: string;
	x: number;
	y: number;
	width: number;
	height: number;
	screenX: number;
	screenY: number;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
	wheelDelta?: number;
	clickCount?: number;
};
export type MouseResult = {
	handled?: boolean;
	capture?: boolean;
	focus?: boolean;
	render?: boolean;
};

export const mouseRegion = (
	child: Component,
	onMouse: (event: MouseEvent) => MouseResult | undefined,
): Component => new MouseRegion(child, onMouse);

/** A component's normalized mouse handler, when it has one. */
export type MouseHandler = (event: MouseEvent) => MouseResult | undefined;

/** Recognizes a component that handles normalized mouse events. */
export const hasMouseHandler = (value: object): value is object & { handleMouse: MouseHandler } =>
	"handleMouse" in value && typeof value.handleMouse === "function";
