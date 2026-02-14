const CLI = ["bun", "run", "src/main.ts"];
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname;

export async function runCli(
	args: string[],
	_cwd: string,
	stdinText?: string,
	envOverride?: Record<string, string | undefined>,
): Promise<{ stdout: string; stderr: string; code: number }> {
	const env = {
		...process.env,
		TMDOC_SKIP_EDITOR: "1",
		...envOverride,
	};
	const proc = Bun.spawn([...CLI, ...args], {
		cwd: PROJECT_ROOT,
		stdout: "pipe",
		stderr: "pipe",
		stdin: "pipe",
		env,
	});
	if (stdinText !== undefined) {
		proc.stdin.write(stdinText);
		proc.stdin.end();
	} else {
		proc.stdin.end();
	}
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

export async function runOk(
	args: string[],
	cwd: string,
	stdinText?: string,
	envOverride?: Record<string, string | undefined>,
): Promise<string> {
	const res = await runCli(args, cwd, stdinText, envOverride);
	if (res.code !== 0) {
		throw new Error(
			`command failed (${res.code}): ${args.join(" ")}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
		);
	}
	return res.stdout.trim();
}

export async function runFail(
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string }> {
	const res = await runCli(args, cwd);
	if (res.code === 0) {
		throw new Error(`expected command to fail: ${args.join(" ")}\nstdout:\n${res.stdout}`);
	}
	return { stdout: res.stdout, stderr: res.stderr };
}

export function spawnWebServer(root: string, extraArgs: string[] = []): Bun.Subprocess<"ignore", "pipe", "pipe"> {
	return Bun.spawn(
		[...CLI, "-C", root, "web", "--host", "127.0.0.1", "--port", "0", "--no-open", ...extraArgs],
		{
			cwd: PROJECT_ROOT,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				TMDOC_SKIP_EDITOR: "1",
			},
		},
	);
}

export async function waitForWebUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });
		const match = buffer.match(/http:\/\/[^\s]+/);
		if (match) {
			return match[0];
		}
	}
	throw new Error(`timed out waiting for web URL. output=${buffer}`);
}

export function slugFromPath(collection: string, path: string): string {
	const prefix = `${collection}/`;
	const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
	return relative.endsWith(".md") ? relative.slice(0, -3) : relative;
}
