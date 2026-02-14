export function normalizeDateInput(value: string): string {
	const trimmed = value.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return trimmed;
	}
	const lower = trimmed.toLowerCase();
	if (lower === "today") return dateOffsetISO(0);
	if (lower === "yesterday") return dateOffsetISO(-1);
	if (lower === "tomorrow") return dateOffsetISO(1);
	if (/^[+-]\d+$/.test(lower)) {
		return dateOffsetISO(Number.parseInt(lower, 10));
	}
	throw new Error(`invalid date input: ${value}`);
}

export function normalizeDatetimeInput(value: string): string {
	const trimmed = value.trim();
	if (isRFC3339(trimmed)) {
		return trimmed;
	}
	const date = normalizeDateInput(trimmed);
	return `${date}T00:00:00Z`;
}

function dateOffsetISO(offsetDays: number): string {
	const now = new Date();
	const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const shifted = new Date(utcMidnight + offsetDays * 24 * 60 * 60 * 1000);
	return shifted.toISOString().slice(0, 10);
}

function isRFC3339(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
		return false;
	}
	return !Number.isNaN(Date.parse(value));
}
