// Tipos para usar reader.mjs desde las pruebas (TypeScript).
export const MODEL: string;
export const MAX_IMAGES: number;
export const READING_SCHEMA: Record<string, unknown>;
export const SYSTEM_PROMPT: string;
export interface CatalogItem { ref: string; name: string; unit: string; buy: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildRequest(images: { type: string; data: string }[], catalog: CatalogItem[]): any;
export function validateInput(data: unknown): { wsId: string; images: { type: string; data: string }[]; catalog: CatalogItem[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseReading(text: string, refs: string[]): any;
/** "1,000" (coma decimal) leído como mil: lo corrige si el importe del renglón lo confirma. */
export function fixQuantity(quantity: number, unitPrice?: number | null, lineTotal?: number | null): number;
export const GEMINI_SHAPE: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGeminiRequest(images: { type: string; data: string }[], catalog: CatalogItem[]): any;
export function geminiText(response: unknown): { text: string; truncated: boolean };
