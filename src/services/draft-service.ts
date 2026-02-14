import { dirname } from "node:path";
import type { Repository } from "../repository/repository.js";

export class DraftService {
	constructor(private readonly repository: Repository) {}

	async Read(path: string): Promise<string> {
		return await this.repository.fileSystem().readFile(path);
	}

	async Write(path: string, raw: string): Promise<void> {
		const parent = dirname(path);
		if (parent !== ".") {
			await this.repository.fileSystem().mkdirAll(parent);
		}
		await this.repository.fileSystem().writeFile(path, raw);
	}

	async RemoveIfExists(path: string): Promise<void> {
		if (await this.repository.fileSystem().exists(path)) {
			await this.repository.fileSystem().remove(path);
		}
	}
}
