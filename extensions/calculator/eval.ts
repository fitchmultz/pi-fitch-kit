import { Parser } from "expr-eval-fork";
import { Decimal } from "decimal.js";
import { formatDecimal, isDecVal, toDec, toNum, wrap, wrapNumericLiterals } from "./decimal.ts";

const decimalUnary: Record<string, (x: Decimal) => Decimal> = {
	sin: (x) => Decimal.sin(x),
	cos: (x) => Decimal.cos(x),
	tan: (x) => Decimal.tan(x),
	asin: (x) => Decimal.asin(x),
	acos: (x) => Decimal.acos(x),
	atan: (x) => Decimal.atan(x),
	sqrt: (x) => Decimal.sqrt(x),
	abs: (x) => Decimal.abs(x),
	ln: (x) => Decimal.ln(x),
	log: (x) => Decimal.ln(x),
	log10: (x) => Decimal.log10(x),
	log2: (x) => Decimal.log2(x),
	exp: (x) => Decimal.exp(x),
	ceil: (x) => Decimal.ceil(x),
	floor: (x) => Decimal.floor(x),
	round: (x) => Decimal.round(x),
	cbrt: (x) => Decimal.cbrt(x),
};

const MAX_EXPRESSION_LENGTH = 4096;
const MAX_FACTORIAL = new Decimal(1000);
const MAX_EXPONENT = new Decimal(10_000);
const MAX_DECIMAL_PLACES = 1000;

const parser = new Parser({
	allowMemberAccess: false,
	operators: {
		add: true,
		divide: true,
		factorial: true,
		multiply: true,
		power: true,
		remainder: true,
		subtract: true,
		sin: true,
		cos: true,
		tan: true,
		asin: true,
		acos: true,
		atan: true,
		sqrt: true,
		log: true,
		ln: true,
		log10: true,
		log2: true,
		abs: true,
		ceil: true,
		floor: true,
		round: true,
		exp: true,
		cbrt: true,
		min: true,
		max: true,
		comparison: false,
		concatenate: false,
		conditional: false,
		logical: false,
		sinh: false,
		cosh: false,
		tanh: false,
		asinh: false,
		acosh: false,
		atanh: false,
		lg: false,
		trunc: false,
		length: false,
		in: false,
		random: false,
		assignment: false,
		fndef: false,
		expm1: false,
		log1p: false,
		sign: false,
	},
}) as Parser & {
	binaryOps: Record<string, (a: unknown, b: unknown) => unknown>;
	ternaryOps: Record<string, (...args: unknown[]) => unknown>;
};
for (const name of Object.keys(parser.functions)) delete parser.functions[name];
for (const name of Object.keys(parser.unaryOps)) delete parser.unaryOps[name];
for (const name of Object.keys(parser.binaryOps)) delete parser.binaryOps[name];
for (const name of Object.keys(parser.ternaryOps)) delete parser.ternaryOps[name];
for (const name of Object.keys(parser.consts)) delete parser.consts[name];

parser.functions.d = (literal: unknown) => {
	if (typeof literal !== "string") throw new Error("invalid decimal literal");
	return wrap(new Decimal(literal));
};

parser.consts.PI = wrap(new Decimal("3.141592653589793238462643383279502884197"));
parser.consts.E = wrap(new Decimal("2.718281828459045235360287471352662497"));

parser.binaryOps["+"] = (a, b) => wrap(toDec(a).plus(toDec(b)));
parser.binaryOps["-"] = (a, b) => wrap(toDec(a).minus(toDec(b)));
parser.binaryOps["*"] = (a, b) => wrap(toDec(a).times(toDec(b)));
parser.binaryOps["/"] = (a, b) => wrap(toDec(a).div(toDec(b)));
parser.binaryOps["%"] = (a, b) => wrap(toDec(a).mod(toDec(b)));
parser.binaryOps["^"] = (a, b) => {
	const exponent = toDec(b);
	if (exponent.abs().gt(MAX_EXPONENT)) throw new Error(`exponent magnitude must not exceed ${MAX_EXPONENT}`);
	return wrap(toDec(a).pow(exponent));
};

parser.unaryOps["!"] = (a: unknown) => {
	const n = toDec(a);
	if (!n.isInteger() || n.isNegative()) throw new Error("factorial needs a non-negative integer");
	if (n.gt(MAX_FACTORIAL)) throw new Error(`factorial input must not exceed ${MAX_FACTORIAL}`);
	let result = new Decimal(1);
	for (let i = new Decimal(2); i.lte(n); i = i.plus(1)) result = result.mul(i);
	return wrap(result);
};

function decimals(values: unknown, name: string, minLength = 1): Decimal[] {
	if (!Array.isArray(values) || values.length < minLength) {
		const need = minLength === 1 ? "a non-empty number array" : `at least ${minLength} numbers`;
		throw new Error(`${name}() needs ${need}`);
	}
	return values.map((value, index) => {
		try {
			return toDec(value);
		} catch {
			throw new Error(`${name}(): invalid number at index ${index}`);
		}
	});
}

function variance(xs: Decimal[], sample: boolean): Decimal {
	const mean = xs.reduce((sum, x) => sum.plus(x), new Decimal(0)).div(xs.length);
	const sumSq = xs.reduce((sum, x) => sum.plus(x.minus(mean).pow(2)), new Decimal(0));
	return sumSq.div(sample ? xs.length - 1 : xs.length);
}

parser.functions.mean = (values: unknown) => {
	const xs = decimals(values, "mean");
	return wrap(xs.reduce((sum, x) => sum.plus(x), new Decimal(0)).div(xs.length));
};

parser.functions.median = (values: unknown) => {
	const xs = decimals(values, "median").sort((a, b) => a.comparedTo(b));
	const mid = Math.floor(xs.length / 2);
	const result = xs.length % 2 === 0 ? xs[mid - 1]!.plus(xs[mid]!).div(2) : xs[mid]!;
	return wrap(result);
};

parser.functions.stdev = (values: unknown) => wrap(variance(decimals(values, "stdev"), false).sqrt());
parser.functions.stdevs = (values: unknown) => wrap(variance(decimals(values, "stdevs", 2), true).sqrt());

parser.functions.percent = (value: unknown, of: unknown) => wrap(toDec(of).times(toDec(value)).div(100));

parser.functions.deg = (degrees: unknown) => wrap(toDec(degrees).times(new Decimal("3.141592653589793238462643383279502884197")).div(180));
parser.functions.rad = (radians: unknown) => wrap(toDec(radians).times(180).div(new Decimal("3.141592653589793238462643383279502884197")));

parser.unaryOps["+"] = (a: unknown) => wrap(toDec(a));
parser.unaryOps["-"] = (a: unknown) => wrap(toDec(a).negated());

for (const [name, fn] of Object.entries(decimalUnary)) {
	parser.unaryOps[name] = (a: unknown) => wrap(fn(toDec(a)));
}

parser.functions.min = (...args: unknown[]) => wrap(Decimal.min(...decimals(args, "min")));
parser.functions.max = (...args: unknown[]) => wrap(Decimal.max(...decimals(args, "max")));
parser.functions.hypot = (...args: unknown[]) => {
	const xs = decimals(args, "hypot");
	const sumSq = xs.reduce((sum, x) => sum.plus(x.pow(2)), new Decimal(0));
	return wrap(Decimal.sqrt(sumSq));
};
parser.functions.roundTo = (value: unknown, digits: unknown) => {
	const places = toNum(digits);
	if (!Number.isInteger(places) || places < 0 || places > MAX_DECIMAL_PLACES) {
		throw new Error(`roundTo() digits must be an integer from 0 to ${MAX_DECIMAL_PLACES}`);
	}
	return wrap(toDec(value).toDecimalPlaces(places));
};

export function normalizeExpression(expression: string): string {
	const trimmed = expression.trim();
	if (!trimmed) throw new Error("Expression is empty");
	if (trimmed.includes(";")) throw new Error("Multiple statements are not supported");
	if (trimmed.length > MAX_EXPRESSION_LENGTH) {
		throw new Error(`Expression too long (max ${MAX_EXPRESSION_LENGTH} chars)`);
	}
	return trimmed.replace(/\*\*/g, "^");
}

export function evaluateExpression(expression: string): {
	expression: string;
	normalized: string;
	decimalized: string;
	result: number | null;
	exact: string;
	formatted: string;
} {
	const normalized = normalizeExpression(expression);
	const decimalized = wrapNumericLiterals(normalized);

	let value: unknown;
	try {
		value = parser.evaluate(decimalized);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid expression: ${message}`);
	}

	if (typeof value === "number") value = wrap(new Decimal(String(value)));
	if (!isDecVal(value)) {
		throw new Error(`Expression did not evaluate to a number (got ${typeof value})`);
	}

	if (!value.d.isFinite()) {
		if (value.d.isNaN()) throw new Error("Result is NaN");
		throw new Error(value.d.isPositive() ? "Result is Infinity" : "Result is -Infinity");
	}
	const exact = formatDecimal(value.d);
	const numeric = value.d.toNumber();
	const result = Number.isFinite(numeric) ? numeric : null;

	return {
		expression: expression.trim(),
		normalized,
		decimalized,
		result,
		exact,
		formatted: exact,
	};
}
