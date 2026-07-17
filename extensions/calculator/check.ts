import { evaluateExpression } from "./eval.ts";

const cases: Array<[string, string]> = [
	["2 + 2", "4"],
	["0.1 + 0.2", "0.3"],
	["2^64", "18446744073709551616"],
	["(12.5 * 1.0825) ^ 3", "2477.500518798828125"],
	["(12.5 * 1.0825) ** 3", "2477.500518798828125"],
	["sqrt(144)", "12"],
	["sin(PI/2)", "1"],
	["sin(deg(90))", "1"],
	["log10(1000)", "3"],
	["5!", "120"],
	["mean([2,4,6,8])", "5"],
	["median([1,9,2,8,3])", "3"],
	["stdev([2,4,4,4,5,5,7,9])", "2"],
	["stdevs([2,4,4,4,5,5,7,9])", "2.138089935299395077476427847038028172432"],
	["percent(15, 200)", "30"],
	["200 * 15 / 100", "30"],
	["roundTo(0.1 + 0.2, 1)", "0.3"],
	["ln(1000)", "6.907755278982137052053974364053092622803"],
	["exp(ln(1000))", "999.9999999999999999999999999999999999997"],
	["median([999999999999999, 1000000000000000, 1000000000000001])", "1000000000000000"],
	["hypot(3, 4)", "5"],
];

for (const [expression, expected] of cases) {
	const { formatted } = evaluateExpression(expression);
	if (formatted !== expected) throw new Error(`expected ${expected} for "${expression}", got ${formatted}`);
}

const rejected = [
	"",
	"({}).constructor",
	"a".repeat(5000),
	"random()",
	"if(1, 2, 3)",
	"1 == 1",
	"[1,2,3].length",
	"\"abc\".length",
	"1;2",
	"a=1",
	"f(x)=x+1",
	"f(2)",
	"lambda_NaN(2)",
	"1001!",
	"2^10001",
	"roundTo(1, 1001)",
	`d("${"9".repeat(2000)}")^10`,
];
for (const expression of rejected) {
	let failed = false;
	try {
		evaluateExpression(expression);
	} catch {
		failed = true;
	}
	if (!failed) throw new Error(`expected failure for: ${expression.slice(0, 40)}`);
}

const large = evaluateExpression("10^400");
if (large.result !== null || large.formatted.length !== 401) throw new Error("large exact integers must not expose Infinity as a numeric result");

console.log(`pi-calculator check ok (${cases.length} exact cases, ${rejected.length} rejection cases)`);
