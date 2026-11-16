/* Text formatting shared by every view. No DOM, no state. */
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Every view builds HTML strings, so anything a player typed goes through this. */
export const esc = (s: unknown): string => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const money = (n: number | null | undefined): string => '$' + Number(n || 0).toLocaleString('en-NZ');
export const UP = (s: unknown): string => String(s || '').toUpperCase();
