import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function setupModels(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "fitch_setup_models",
		label: "Fitch Setup Models",
		description: "Check requested model routes in this Pi session without starting another Pi process.",
		parameters: Type.Object({
			routes: Type.Array(Type.String({ description: "Provider/model routes from setup-manifest.json" })),
		}),
		async execute(_toolCallId, { routes }, _signal, _onUpdate, ctx) {
			const known = new Set(ctx.modelRegistry.getAll().map((model) => `${model.provider}/${model.id}`));
			const available = new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`));
			const results = routes.map((route) => ({ route, known: known.has(route), available: available.has(route) }));
			const status = { projectTrusted: ctx.isProjectTrusted(), routes: results };
			return {
				content: [{ type: "text", text: JSON.stringify(status) }],
				details: status,
			};
		},
	});
}
