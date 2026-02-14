import { resolveAlias } from "../config/alias.js";
import type { CollectionSchema } from "../config/types.js";
import { processTemplate } from "../document/template-engine.js";
import { byCollection, type Repository } from "../repository/repository.js";

export interface TemplateRecord {
	name: string;
	for: string;
	path: string;
	content: string;
}

export class TemplateService {
	constructor(
		private readonly schemas: Map<string, CollectionSchema>,
		private readonly aliases: Record<string, string>,
		private readonly repository: Repository,
	) {}

	async GetTemplatesForCollection(collectionInput: string): Promise<TemplateRecord[]> {
		if (!this.schemas.has("templates")) {
			return [];
		}
		const collection = this.resolveCollection(collectionInput);
		const templates = await this.FindTemplates();
		return templates.filter((template) => this.resolveCollection(template.for) === collection);
	}

	async FindTemplates(): Promise<TemplateRecord[]> {
		if (!(await this.repository.fileSystem().exists("templates/_schema.yaml"))) {
			return [];
		}
		const docs = await this.repository.collectAll(byCollection("templates"));
		const out: TemplateRecord[] = [];
		for (const doc of docs) {
			const name = doc.document.metadata.name;
			const target = doc.document.metadata.for;
			if (typeof name !== "string" || typeof target !== "string") {
				continue;
			}
			out.push({
				name,
				for: target,
				path: doc.path,
				content: doc.document.content,
			});
		}
		return out;
	}

	ProcessTemplate(template: string, values: Record<string, string>): string {
		return processTemplate(template, values);
	}

	private resolveCollection(nameOrAlias: string): string {
		return resolveAlias(nameOrAlias, this.aliases, new Set(this.schemas.keys()));
	}
}
