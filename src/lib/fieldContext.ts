import type { Env } from './sdk';

/** An item on the page that may hold this field: the page itself or one of its layout's datasources. IDs normalized. */
export type Candidate = { itemId: string; name: string; path: string; templateId: string; version?: number; fields: { name: string; value: string }[] };
export type PageContext = { env: Env; language: string; rawConfig: string; candidates: Candidate[] };
export type FieldContext = { env: Env; itemId: string; itemName: string; itemPath: string; templateId: string; language: string; version?: number; rawConfig: string };
