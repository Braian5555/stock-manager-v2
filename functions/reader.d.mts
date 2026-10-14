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
