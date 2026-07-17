import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const MAX_FORMATTED_LENGTH = 16_384;

export type DecVal = { readonly __piDec: true; readonly d: Decimal };

export function wrap(d: Decimal): DecVal {
	return { __piDec: true, d };
}

export function isDecVal(value: unknown): value is DecVal {
	return typeof value === "object" && value !== null && "__piDec" in value;
}

export function toDec(value: unknown): Decimal {
	if (isDecVal(value)) return value.d;
	if (value instanceof Decimal) return value;
	if (typeof value === "string") return new Decimal(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("non-finite number");
		return new Decimal(String(value));
	}
	throw new Error(`expected number, got ${typeof value}`);
}

export function toNum(value: unknown): number {
	return toDec(value).toNumber();
}

export function formatDecimal(d: Decimal): string {
	if (!d.isFinite()) throw new Error(d.isNaN() ? "Result is NaN" : d.isPositive() ? "Result is Infinity" : "Result is -Infinity");
	if (d.isInteger()) {
		const length = Math.max(1, d.e + 1) + (d.isNegative() ? 1 : 0);
		if (length > MAX_FORMATTED_LENGTH) throw new Error(`Formatted result exceeds ${MAX_FORMATTED_LENGTH} characters`);
		return d.toFixed(0);
	}
	const raw = d.toString();
	const formatted = raw.includes("e") || raw.includes("E") ? raw : raw.replace(/\.?0+$/, "") || "0";
	if (formatted.length > MAX_FORMATTED_LENGTH) throw new Error(`Formatted result exceeds ${MAX_FORMATTED_LENGTH} characters`);
	return formatted;
}

/** Wrap bare numeric literals as d("…") so parsing never rounds them to float. */
export function wrapNumericLiterals(expression: string): string {
	let result = "";
	let i = 0;

	while (i < expression.length) {
		const ch = expression[i]!;

		if (ch === '"') {
			const end = expression.indexOf('"', i + 1);
			if (end < 0) throw new Error("unclosed string in expression");
			result += expression.slice(i, end + 1);
			i = end + 1;
			continue;
		}

		const rest = expression.slice(i);
		const match = rest.match(/^(?:\d+\.\d+|\d+\.|\.\d+|\d+)(?:[eE][+-]?\d+)?/);
		if (match && (i === 0 || !/[\w.]/.test(expression[i - 1]!))) {
			result += `d("${match[0]}")`;
			i += match[0].length;
			continue;
		}

		result += ch;
		i++;
	}

	return result;
}
