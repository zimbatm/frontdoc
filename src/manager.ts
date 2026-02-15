import { access, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ulid } from "ulidx";
import {
	defaultRepoConfigContent,
	parseRepoConfig,
	serializeRepoConfig,
} from "./config/repo-config.js";
import { findRepositoryRoot } from "./config/root-discovery.js";
import { discoverCollections } from "./config/schema.js";
import type { CollectionSchema, RepoConfig } from "./config/types.js";
import { Repository } from "./repository/repository.js";
import { DocumentService } from "./services/document-service.js";
import { DraftService } from "./services/draft-service.js";
import { RelationshipService } from "./services/relationship-service.js";
import { SchemaService } from "./services/schema-service.js";
import { SearchService } from "./services/search-service.js";
import { TemplateService } from "./services/template-service.js";
import { ValidationService } from "./services/validation-service.js";
import { BoundVFS } from "./storage/bound-vfs.js";

export class Manager {
	private readonly documentService: DocumentService;
	private readonly relationshipService: RelationshipService;
	private readonly schemaService: SchemaService;
	private readonly searchService: SearchService;
	private readonly templateService: TemplateService;
	private readonly validationService: ValidationService;
	private readonly draftService: DraftService;

	private constructor(
		private readonly rootPath: string,
		private readonly repository: Repository,
		private readonly repoConfig: RepoConfig,
		private readonly schemas: Map<string, CollectionSchema>,
	) {
		this.templateService = new TemplateService(
			this.schemas,
			this.repoConfig.aliases,
			this.repository,
		);
		this.validationService = new ValidationService(
			this.schemas,
			this.repoConfig.aliases,
			this.repoConfig.ignore,
			this.repository,
		);
		this.documentService = new DocumentService(
			this.schemas,
			this.repoConfig.aliases,
			this.repository,
			this.validationService,
			this.templateService,
		);
		this.schemaService = new SchemaService(this.schemas, this.repoConfig, this.repository);
		this.searchService = new SearchService(this.repository);
		this.relationshipService = new RelationshipService(this.schemas, this.repository);
		this.draftService = new DraftService(this.repository);
	}

	static async New(workDir: string): Promise<Manager> {
		const rootPath = await findRepositoryRoot(workDir);
		const vfs = new BoundVFS(rootPath);

		const configRaw = await vfs.readFile("frontdoc.yaml");
		const repoConfig = parseRepoConfig(configRaw);
		if (!repoConfig.repository_id) {
			repoConfig.repository_id = ulid().toLowerCase();
			await vfs.writeFile("frontdoc.yaml", serializeRepoConfig(repoConfig));
		}
		const repository = new Repository(vfs, repoConfig.repository_id);
		const schemas = await discoverCollections(vfs);

		validateAliases(repoConfig.aliases, schemas);

		return new Manager(rootPath, repository, repoConfig, schemas);
	}

	static async Init(path: string): Promise<Manager> {
		const initPath = resolve(path);
		await mkdir(initPath, { recursive: true });
		const markerPath = resolve(initPath, "frontdoc.yaml");

		if (await exists(markerPath)) {
			throw new Error("already initialized");
		}

		await fsWriteFile(markerPath, defaultRepoConfigContent(), { mode: 0o644 });
		return await Manager.New(initPath);
	}

	Aliases(): Record<string, string> {
		return this.repoConfig.aliases;
	}

	Schemas(): Map<string, CollectionSchema> {
		return this.schemas;
	}

	Repository(): Repository {
		return this.repository;
	}

	Schema(): SchemaService {
		return this.schemaService;
	}

	Documents(): DocumentService {
		return this.documentService;
	}

	Search(): SearchService {
		return this.searchService;
	}

	Relationships(): RelationshipService {
		return this.relationshipService;
	}

	Templates(): TemplateService {
		return this.templateService;
	}

	Validation(): ValidationService {
		return this.validationService;
	}

	Drafts(): DraftService {
		return this.draftService;
	}

	RootPath(): string {
		return this.rootPath;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function validateAliases(
	aliases: Record<string, string>,
	schemas: Map<string, CollectionSchema>,
): void {
	const seen = new Set<string>();
	const collections = new Set(schemas.keys());

	for (const [prefix] of Object.entries(aliases)) {
		if (seen.has(prefix)) {
			throw new Error(`duplicate alias prefix: ${prefix}`);
		}
		seen.add(prefix);

		if (collections.has(prefix)) {
			throw new Error(`alias prefix collides with collection name: ${prefix}`);
		}
	}
}
