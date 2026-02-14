/**
 * Virtual File System interface.
 * All paths are relative to the VFS root.
 */
export interface FileInfo {
	name: string;
	path: string;
	isDirectory: boolean;
	isFile: boolean;
	isSymlink: boolean;
	size: number;
	modifiedAt: Date;
}

export type WalkFunc = (path: string, info: FileInfo) => void | Promise<void>;

export interface VFS {
	/** Returns the absolute path of the VFS root. */
	root(): string;

	/** Reads entire file contents. */
	readFile(path: string): Promise<string>;

	/** Writes data to a file atomically. */
	writeFile(path: string, data: string): Promise<void>;

	/** Checks if a path exists. */
	exists(path: string): Promise<boolean>;

	/** Checks if a path is a directory. */
	isDir(path: string): Promise<boolean>;

	/** Checks if a path is a regular file. */
	isFile(path: string): Promise<boolean>;

	/** Returns file metadata. */
	stat(path: string): Promise<FileInfo>;

	/** Creates a directory and all parents. */
	mkdirAll(path: string): Promise<void>;

	/** Removes a single file or empty directory. */
	remove(path: string): Promise<void>;

	/** Recursively removes a directory and all contents. */
	removeAll(path: string): Promise<void>;

	/** Atomically renames/moves a file or directory. */
	rename(oldPath: string, newPath: string): Promise<void>;

	/** Walks the file tree depth-first, calling walkFunc for each entry. */
	walk(root: string, walkFunc: WalkFunc): Promise<void>;

	/** Lists directory contents. */
	readDir(path: string): Promise<FileInfo[]>;
}
