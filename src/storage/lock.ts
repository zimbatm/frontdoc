import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Advisory file lock on frontdoc.yaml for write operations.
 */
export class FileLock {
	private readonly lockTargetPath: string;
	private process: ChildProcessWithoutNullStreams | null = null;

	constructor(private readonly rootPath: string) {
		this.lockTargetPath = join(this.rootPath, "frontdoc.yaml");
	}

	/**
	 * Acquire an exclusive advisory lock. Blocks until the lock is available.
	 */
	async acquire(): Promise<void> {
		if (this.process !== null) {
			throw new Error("lock already acquired");
		}

		const proc = spawn(
			"flock",
			[
				"--exclusive",
				this.lockTargetPath,
				"sh",
				"-c",
				"printf '__FRONTDOC_LOCKED__\\n'; cat >/dev/null",
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);

		this.process = proc;
		await waitForReady(proc);
	}

	/**
	 * Release the lock.
	 */
	async release(): Promise<void> {
		if (!this.process) {
			return;
		}

		const proc = this.process;
		this.process = null;
		proc.stdin.end();
		await waitForExit(proc);
	}
}

async function waitForReady(proc: ChildProcessWithoutNullStreams): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let settled = false;

		const onStdout = (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			if (!settled && stdout.includes("__FRONTDOC_LOCKED__")) {
				settled = true;
				cleanup();
				resolve();
			}
		};
		const onStderr = (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		};
		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(
				new Error(
					`failed to acquire file lock (code=${code ?? "null"}, signal=${signal ?? "null"}): ${stderr.trim()}`,
				),
			);
		};
		const onError = (err: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(err);
		};
		const cleanup = () => {
			proc.stdout.off("data", onStdout);
			proc.stderr.off("data", onStderr);
			proc.off("exit", onExit);
			proc.off("error", onError);
		};

		proc.stdout.on("data", onStdout);
		proc.stderr.on("data", onStderr);
		proc.once("exit", onExit);
		proc.once("error", onError);
	});
}

async function waitForExit(proc: ChildProcessWithoutNullStreams): Promise<void> {
	await new Promise<void>((resolve) => {
		if (proc.exitCode !== null) {
			resolve();
			return;
		}
		proc.once("exit", () => resolve());
	});
}
