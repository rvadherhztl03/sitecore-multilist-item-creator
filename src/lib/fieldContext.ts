/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizeId } from './config';
import { SdkError, graphql, toEnvs, type Env, type SdkClient } from './sdk';

/** An item on the page that may hold this field: the page itself or one of its layout's datasources. IDs normalized. */
export type Candidate = { itemId: string; name: string; path: string; templateId: string; version?: number; fields: { name: string; value: string }[] };
export type PageContext = { env: Env; language: string; rawConfig: string; candidates: Candidate[] };
export type FieldContext = { env: Env; itemId: string; itemName: string; itemPath: string; templateId: string; language: string; version?: number; rawConfig: string };

// query() doesn't throw on failure: it resolves { isError, error }.
async function plain(client: SdkClient, key: string, what: string): Promise<any> {
  const fail = () => new SdkError(`Couldn't read ${what} from Sitecore.`);
  const res = await client.query(key).catch(() => { throw fail(); });
  if (res?.isError || res?.error) throw fail();
  return res?.data;
}

/** Every rendering's dataSource in the page's layout (the JSON string in `pageInfo.presentationDetails`), in layout order. */
function dataSources(details: unknown): string[] {
  try {
    const { devices } = JSON.parse(String(details));
    return (devices as any[]).flatMap((d) => d.renderings ?? []).map((r) => r?.dataSource).filter((s) => typeof s === 'string');
  } catch {
    return [];
  }
}

/** The `where` for one datasource: a GUID by ID, `local:/x` and `/sitecore/…` by path, anything else not at all. */
function whereOf(source: string, pagePath: string): string | undefined {
  const byPath = (path: string) => `path: ${JSON.stringify(path.replace(/\/+$/, ''))}`;
  if (/^local:/i.test(source)) return byPath(`${pagePath}/${source.slice(6).replace(/^\/+/, '')}`);
  if (/^\/sitecore\//i.test(source)) return byPath(source);
  try {
    return `itemId: ${JSON.stringify(normalizeId(source))}`;
  } catch {
    return undefined;
  }
}

const ITEM = '{ itemId name path version template { templateId } fields(ownFields: false, excludeStandardFields: true) { nodes { name value } } }';

/** Reads the page and every datasource in its layout in one Authoring query; the field's item is one of the candidates. */
export async function readPage(client: SdkClient & { getValue(): Promise<unknown> }): Promise<PageContext> {
  const value = await client.getValue().catch(() => {
    throw new SdkError("Couldn't read this field's value from Sitecore.");
  });
  const rawConfig = typeof value === 'string' ? value : '';

  const envs = toEnvs(await plain(client, 'application.context', 'the environments'));
  let env = envs.length === 1 ? envs[0] : undefined;
  if (envs.length > 1) {
    const host = await plain(client, 'host.state', 'the host').catch(() => undefined);
    const tenant = String(host?.xmCloudTenantInfo?.id ?? '').toLowerCase();
    env = tenant ? envs.find((e) => e.id.toLowerCase() === tenant) : undefined;
  }
  if (!env) throw new SdkError("Couldn't tell which environment this page is in.");

  // Only language and the page are read: siteInfo can carry protection-bypass tokens and is never kept.
  const { siteInfo, pageInfo } = (await plain(client, 'pages.context', 'the page')) ?? {};
  if (!pageInfo?.id) throw new SdkError("Couldn't tell which page this is.");
  const language: string = pageInfo.language || siteInfo?.language || 'en';

  // A Set, so a datasource used twice (in any GUID form) is asked for once.
  let pageId: string;
  try {
    pageId = normalizeId(pageInfo.id);
  } catch {
    throw new SdkError("Couldn't tell which page this is.");
  }
  const wheres = new Set([`itemId: ${JSON.stringify(pageId)}`]);
  for (const source of dataSources(pageInfo.presentationDetails)) {
    const where = whereOf(source.trim(), pageInfo.path ?? '');
    if (where) wheres.add(where);
  }
  const aliases = [...wheres].map(
    (where, i) => `  i${i}: item(where: { database: "master", language: ${JSON.stringify(language)}, ${where} }) ${ITEM}`,
  );
  const data = await graphql(client, env, `query {\n${aliases.join('\n')}\n}`, {});

  // Keyed by ID: a path can resolve to an item already listed. Map keeps layout order.
  const found = new Map<string, Candidate>();
  aliases.forEach((_, i) => {
    const item = data?.[`i${i}`];
    if (!item?.template?.templateId) return; // an item without a template can't be a candidate
    const itemId = normalizeId(item.itemId);
    if (found.has(itemId)) return;
    found.set(itemId, {
      itemId,
      name: item.name,
      path: item.path,
      templateId: normalizeId(item.template.templateId),
      version: item.version ?? undefined,
      fields: (item.fields?.nodes ?? []).map((f: any) => ({ name: f.name, value: f.value ?? '' })),
    });
  });
  return { env, language, rawConfig, candidates: [...found.values()] };
}

/** Candidates with a field whose value is exactly `raw`. A blank `raw` matches nothing (it would match every empty field). */
export function matchByValue(candidates: Candidate[], raw: string): Candidate[] {
  return raw.trim() ? candidates.filter((c) => c.fields.some((f) => f.value === raw)) : [];
}

/** Candidates with a field of that name, ignoring case. Setup uses it before a config exists. */
export function matchByField(candidates: Candidate[], fieldName: string): Candidate[] {
  const name = fieldName.trim().toLowerCase();
  return candidates.filter((c) => c.fields.some((f) => f.name.toLowerCase() === name));
}

export function toFieldContext(page: PageContext, c: Candidate): FieldContext {
  return {
    env: page.env,
    itemId: c.itemId,
    itemName: c.name,
    itemPath: c.path,
    templateId: c.templateId,
    language: page.language,
    version: c.version,
    rawConfig: page.rawConfig,
  };
}
