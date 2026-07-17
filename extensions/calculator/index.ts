import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { evaluateExpression } from "./eval.ts";

const calculatorTool = defineTool({
	name: "calculator",
	label: "Calculator",
	description: "Evaluate numeric and scientific expressions deterministically.",
	promptSnippet: "Evaluate arithmetic, percentages, roots, logs, trig, and simple stats",
	promptGuidelines: [
		"Use calculator for any non-trivial math instead of computing in prose.",
		"All math uses decimal.js (40-digit precision): arithmetic, trig, logs, roots, stats.",
		"Powers: `^` or `**`. Constants: PI, E. Natural log: log() or ln(). Base 10: log10().",
		"Trig uses radians. Convert with deg(90) or multiply degrees by PI/180.",
		"Percent of a value: `200 * 15 / 100` or `percent(15, 200)`.",
		"Stats: mean([...]), median([...]), stdev([...]) population, stdevs([...]) sample.",
	],
	parameters: Type.Object({
		expression: Type.String({
			minLength: 1,
			description: "Math expression, e.g. '(12.5 * 1.0825) ^ 3', 'sqrt(144)', 'sin(PI/4)', 'mean([2,4,6,8])'",
		}),
	}),
	async execute(_toolCallId, params) {
		const { expression } = params;
		const evaluated = evaluateExpression(expression);
		return {
			content: [{ type: "text", text: `${evaluated.expression} = ${evaluated.formatted}` }],
			details: evaluated,
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(calculatorTool);
}
