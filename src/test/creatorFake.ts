/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import { fakeClient, type FakeReply } from './fakeClient';

// A fake Sitecore for the creator and setup views: GraphQL replies are keyed on the operation name in the query text.

export const compact = (guid: string) => guid.replace(/[{}-]/g, '').toLowerCase();
export const braced = (guid: string) => `{${guid.toUpperCase()}}`;

export const PAGE = '7042f745-fe4c-4273-af21-05e034fbc7b8';
export const HERO = 'e650b14e-1111-4222-8333-444455556666';
export const TEASER = 'c49bf206-89f5-4aaa-bbbb-cccc00001111';
export const FOLDER = 'a1b2c3d4-0000-4000-8000-000000000001';
export const FOLDER_PATH = '/sitecore/content/Site/Data/Articles';
export const ARTICLE = 'd4f8a4b1-0000-4000-8000-00000000abcd';
export const BLOG = 'd4f8a4b1-0000-4000-8000-00000000beef';
export const NEW_ITEM = '9e8d7c6b-5a49-4382-9172-615049382716';

export type Item = { id: string; name: string; path: string; fields: { name: string; value: string }[] };
export const item = (id: string, name: string, fields: Item['fields']): Item => ({ id, name, path: `/sitecore/content/Site/Home/Data/${name}`, fields });

/** The op name of an Authoring query; the page read has none. */
export const opOf = (query: string) => /^\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? 'ReadPage';

export type Op = (vars: any, query: string) => FakeReply;
type Options = {
  /** What `getValue()` returns: the companion field's config. */
  raw?: unknown;
  /** Datasource items in the layout, after the page itself. */
  items?: Item[];
  /** The multilist's current value on the item. */
  existing?: string;
  /** Replace the default reply of an Authoring operation (ReadPage, ReadFolder, TemplateNames, CreateItem, ReadField, UpdateField) or of `pages.context` etc. */
  ops?: Record<string, Op>;
  reload?: () => unknown;
};

const ok = (data: unknown): FakeReply => ({ data: { data } });
const NAMES: Record<string, string> = { [braced(ARTICLE)]: 'Article', [braced(BLOG)]: 'Blog post' };

export function creatorFake({ raw = '', items = [], existing = '', ops = {}, reload }: Options = {}) {
  const layout = JSON.stringify({ devices: [{ renderings: items.map((i) => ({ dataSource: braced(i.id) })) }] });
  const page = item(PAGE, 'Home', [{ name: 'Title', value: 'Home' }]);
  page.path = '/sitecore/content/Site/Home';
  const asItem = (i: Item) => ({
    itemId: compact(i.id),
    name: i.name,
    path: i.path,
    version: 1,
    template: { templateId: compact(ARTICLE) },
    fields: { nodes: i.fields },
  });
  const defaults: Record<string, Op> = {
    ReadPage: () => ok(Object.fromEntries([page, ...items].map((i, n) => [`i${n}`, asItem(i)]))),
    ReadFolder: () => ok({ item: { itemId: compact(FOLDER), path: FOLDER_PATH, fields: { nodes: [] } } }),
    TemplateNames: (vars) =>
      ok(Object.fromEntries(Object.entries(vars).filter(([k]) => /^t\d+$/.test(k)).map(([k, id]) => [k, { name: NAMES[id as string] }]))),
    CreateItem: (vars) => ok({ createItem: { item: { itemId: compact(NEW_ITEM), name: vars.name, path: `${FOLDER_PATH}/${vars.name}` } } }),
    // version 3 differs from the page item's 1, so a write at the version the read returned is told apart.
    ReadField: () => ok({ item: { version: 3, fields: { nodes: [{ name: 'Related Items', value: existing }] } } }),
    UpdateField: (vars) => ok({ updateItem: { item: { itemId: vars.itemId, name: 'x', path: '/x', version: 1 } } }),
  };

  const { client, calls } = fakeClient({
    'application.context': () => ({ data: { resourceAccess: [{ resourceId: 'xmcloud', tenantId: 'tenant-1', tenantDisplayName: 'Org / DEV', context: { preview: 'ctxA' } }] } }),
    // siteInfo carries a protection-bypass token in real life; nothing may show it.
    'pages.context': () => ({
      data: {
        siteInfo: { language: 'en', renderingHost: 'https://host.example?bypass=SECRET-TOKEN' },
        pageInfo: { id: PAGE, path: page.path, language: 'en', version: 1, presentationDetails: layout },
      },
    }),
    'pages.reloadCanvas': () => ({ data: reload?.() }),
    'xmc.authoring.graphql': ({ body: { query, variables } }) => {
      const op = opOf(query);
      const reply = (ops[op] ?? defaults[op]);
      if (!reply) throw new Error(`unexpected operation ${op}`);
      return reply(variables, query);
    },
  });
  const full = { ...client, getValue: vi.fn(async () => raw), closeApp: vi.fn(async () => {}), setValue: vi.fn(async () => {}) };
  /** Every call in order, by Authoring operation name or SDK key. */
  const names = () => calls.map((c) => (c.key === 'xmc.authoring.graphql' ? opOf(c.params.body.query) : c.key));
  /** The variables of each call to an Authoring operation. */
  const varsOf = (op: string) => calls.filter((c) => c.key === 'xmc.authoring.graphql' && opOf(c.params.body.query) === op).map((c) => c.params.body.variables);
  /** The query text of each call to an Authoring operation. */
  const queryOf = (op: string) => calls.filter((c) => c.key === 'xmc.authoring.graphql' && opOf(c.params.body.query) === op).map((c) => c.params.body.query as string);
  return { client: full, calls, names, varsOf, queryOf };
}

/** A GraphQL error reply. */
export const gqlError = (message: string): FakeReply => ({ data: { errors: [{ message }] } });
