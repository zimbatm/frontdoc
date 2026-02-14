export function collectionFromPath(path: string): string {
	return path.split("/")[0] ?? "";
}
