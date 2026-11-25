// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SdkError } from '@/lib/sdk';
import { fakeClient } from '@/test/fakeClient';
import { matchByField, matchByValue, readPage, toFieldContext, type Candidate, type PageContext } from './fieldContext';

const TENANT_A = '11111111-aaaa-4aaa-8aaa-111111111111';
const TENANT_B = '22222222-bbbb-4bbb-8bbb-222222222222';
const PAGE = '7042f745-fe4c-4273-af21-05e034fbc7b8';
const DS1 = '{E650B14E-1111-4222-8333-444455556666}';
const DS2 = 'c49bf206-89f5-4aaa-bbbb-cccc00001111';
const CONFIG = '{"targetField":"items"}';

const resource = (tenantId: string, name: string, preview: string, live: string) => ({
  resourceId: 'xmcloud',
  tenantId,
  tenantDisplayName: name,
  context: { preview, live },
});
const APP_ONE = { resourceAccess: [resource(TENANT_A, 'Org / DEV', 'ctxA', 'liveA')] };
const APP_TWO = { resourceAccess: [resource(TENANT_A, 'Org / DEV', 'ctxA', 'liveA'), resource(TENANT_B, 'Org / QA', 'ctxB', 'liveB')] };

const layout = (...dataSources: unknown[]) =>
  JSON.stringify({ devices: [{ renderings: dataSources.map((dataSource) => ({ dataSource })) }] });

const pagesContext = (presentationDetails: string, pageInfo: Record<string, unknown> = {}) => ({
  siteInfo: { language: 'en', renderingHost: 'https://host.example?bypass=SECRET-TOKEN' },
  pageInfo: { id: PAGE, path: '/sitecore/content/Site/Home', language: 'en', version: 1, presentationDetails, ...pageInfo },
});

// An Authoring reply item: compact IDs, like the API returns them.
const compact = (guid: string) => guid.replace(/[{}-]/g, '').toLowerCase();
const item = (id: string, name: string, path: string, fields: { name: string; value: string }[] = [], version = 1) => ({
  itemId: compact(id),
  name,
  path,
  version,
  template: { templateId: compact('d4f8a4b1-0000-4000-8000-00000000abcd') },
  fields: { nodes: fields },
});

type Setup = {
  app?: unknown;
  host?: () => unknown;
  page?: unknown;
  authoring?: (query: string) => Record<string, unknown>;
  raw?: unknown;
};
function setup({ app = APP_ONE, host, page = pagesContext(layout()), authoring = () => ({}), raw = CONFIG }: Setup = {}) {
  const fake = fakeClient({
    'application.context': () => ({ data: app }),
    'pages.context': () => ({ data: page }),
    ...(host ? { 'host.state': () => ({ data: host() }) } : {}),
    'xmc.authoring.graphql': (params) => ({ data: { data: authoring(params.body.query) } }),
  });
  return { ...fake, client: { ...fake.client, getValue: async () => raw } };
}
const authoringCalls = (calls: { key: string; params: any }[]) => calls.filter((c) => c.key === 'xmc.authoring.graphql');

describe('readPage', () => {
  it('lists the page, then each datasource in layout order, de-duplicated, with local: resolved and IDs normalized', async () => {
    const { client, calls } = setup({
      page: pagesContext(layout(DS1, DS2, '', DS2.toUpperCase(), DS1.toLowerCase(), 'local:/Data/Text 1', '/sitecore/content/Shared/Footer', 'whatever')),
      authoring: () => ({
        i0: item(PAGE, 'Home', '/sitecore/content/Site/Home', [{ name: 'Title', value: 'Home' }]),
        i1: item(DS1, 'Hero', '/sitecore/content/Site/Home/Data/Hero', [{ name: 'items', value: '' }], 3),
        i2: item(DS2, 'Teaser', '/sitecore/content/Site/Home/Data/Teaser'),
        i3: item('33333333-3333-4333-8333-333333333333', 'Text 1', '/sitecore/content/Site/Home/Data/Text 1'),
        i4: item('44444444-4444-4444-8444-444444444444', 'Footer', '/sitecore/content/Shared/Footer'),
      }),
    });

    const page = await readPage(client);

    expect(page.candidates.map((c) => [c.itemId, c.name])).toEqual([
      ['{7042F745-FE4C-4273-AF21-05E034FBC7B8}', 'Home'],
      ['{E650B14E-1111-4222-8333-444455556666}', 'Hero'],
      ['{C49BF206-89F5-4AAA-BBBB-CCCC00001111}', 'Teaser'],
      ['{33333333-3333-4333-8333-333333333333}', 'Text 1'],
      ['{44444444-4444-4444-8444-444444444444}', 'Footer'],
    ]);
    expect(page.candidates[0]).toEqual({
      itemId: '{7042F745-FE4C-4273-AF21-05E034FBC7B8}',
      name: 'Home',
      path: '/sitecore/content/Site/Home',
      templateId: '{D4F8A4B1-0000-4000-8000-00000000ABCD}',
      version: 1,
      fields: [{ name: 'Title', value: 'Home' }],
    });
    expect(page.candidates[1].version).toBe(3);

    // One round trip, as the signed-in user, in the preview context.
    const [only, ...more] = authoringCalls(calls);
    expect(more).toEqual([]);
    expect(only.params.query.sitecoreContextId).toBe('ctxA');
    const q: string = only.params.body.query;
    expect(q).toContain(`i0: item(where: { database: "master", language: "en", itemId: "{7042F745-FE4C-4273-AF21-05E034FBC7B8}" })`);
    expect(q).toContain(`i1: item(where: { database: "master", language: "en", itemId: "{E650B14E-1111-4222-8333-444455556666}" })`);
    expect(q).toContain(`i2: item(where: { database: "master", language: "en", itemId: "{C49BF206-89F5-4AAA-BBBB-CCCC00001111}" })`);
    expect(q).toContain(`i3: item(where: { database: "master", language: "en", path: "/sitecore/content/Site/Home/Data/Text 1" })`);
    expect(q).toContain(`i4: item(where: { database: "master", language: "en", path: "/sitecore/content/Shared/Footer" })`);
    expect(q).not.toContain('i5:'); // blank, repeated and unrecognised sources add no alias
    expect(q).toContain('fields(ownFields: false, excludeStandardFields: true) { nodes { name value } }');
    expect(q).toContain('version');
    expect(q).toContain('template { templateId }');
  });

  it('returns the env, language and raw config, and keeps nothing from siteInfo', async () => {
    const { client } = setup({ authoring: () => ({ i0: item(PAGE, 'Home', '/sitecore/content/Site/Home') }) });
    const page = await readPage(client);
    expect(page).toMatchObject({
      env: { id: TENANT_A, name: 'Org / DEV', contextId: 'ctxA', liveContextId: 'liveA' },
      language: 'en',
      rawConfig: CONFIG,
    });
    expect(JSON.stringify(page)).not.toContain('SECRET-TOKEN');
  });

  it('drops aliases that come back null', async () => {
    const { client } = setup({
      page: pagesContext(layout(DS1, DS2)),
      authoring: () => ({ i0: item(PAGE, 'Home', '/sitecore/content/Site/Home'), i1: null, i2: item(DS2, 'Teaser', '/x/Teaser') }),
    });
    const page = await readPage(client);
    expect(page.candidates.map((c) => c.name)).toEqual(['Home', 'Teaser']);
  });

  it('drops a datasource that resolves to an item already listed', async () => {
    const { client } = setup({
      page: pagesContext(layout('local:/', PAGE)),
      authoring: () => ({ i0: item(PAGE, 'Home', '/sitecore/content/Site/Home'), i1: item(PAGE, 'Home', '/sitecore/content/Site/Home') }),
    });
    expect((await readPage(client)).candidates).toHaveLength(1);
  });

  it('reads the page alone when the layout is missing or not JSON', async () => {
    const { client, calls } = setup({
      page: pagesContext('not json'),
      authoring: () => ({ i0: item(PAGE, 'Home', '/sitecore/content/Site/Home') }),
    });
    expect((await readPage(client)).candidates.map((c) => c.name)).toEqual(['Home']);
    expect(authoringCalls(calls)[0].params.body.query).not.toContain('i1:');
  });

  it('picks the env that the host says the page is in, out of two', async () => {
    const { client, calls } = setup({
      app: APP_TWO,
      host: () => ({ xmCloudTenantInfo: { id: TENANT_B } }),
      authoring: () => ({ i0: item(PAGE, 'Home', '/sitecore/content/Site/Home') }),
    });
    const page = await readPage(client);
    expect(page.env).toMatchObject({ id: TENANT_B, contextId: 'ctxB' });
    expect(authoringCalls(calls)[0].params.query.sitecoreContextId).toBe('ctxB');
  });

  it('uses the only env without asking the host', async () => {
    const { client, calls } = setup({ authoring: () => ({ i0: item(PAGE, 'Home', '/x') }) });
    expect((await readPage(client)).env.id).toBe(TENANT_A);
    expect(calls.map((c) => c.key)).not.toContain('host.state');
  });

  it.each([
    ['the host does not say', () => ({})],
    ['the host names an unknown tenant', () => ({ xmCloudTenantInfo: { id: 'other' } })],
    ['the host query fails', () => { throw new Error('nope'); }],
  ])('cannot choose between two envs when %s', async (_why, host) => {
    const { client, calls } = setup({ app: APP_TWO, host });
    await expect(readPage(client)).rejects.toThrow(new SdkError("Couldn't tell which environment this page is in."));
    expect(authoringCalls(calls)).toEqual([]);
  });

  it('cannot find an env when the app has no access to any', async () => {
    const { client } = setup({ app: { resourceAccess: [] } });
    await expect(readPage(client)).rejects.toThrow("Couldn't tell which environment this page is in.");
  });

  it("fails with the page message when the SDK has no page ID", async () => {
    const { client, calls } = setup({ page: pagesContext(layout(), { id: undefined }) });
    await expect(readPage(client)).rejects.toThrow(new SdkError("Couldn't tell which page this is."));
    await expect(readPage(setup({ page: {} }).client)).rejects.toThrow("Couldn't tell which page this is.");
    expect(authoringCalls(calls)).toEqual([]);
  });

  it('falls back to the site language when the page has none', async () => {
    const { client } = setup({
      page: { ...pagesContext(layout(), { language: undefined }), siteInfo: { language: 'de' } },
      authoring: (q) => {
        expect(q).toContain('language: "de"');
        return { i0: item(PAGE, 'Home', '/x') };
      },
    });
    expect((await readPage(client)).language).toBe('de');
  });

  it('treats a getValue that is not a string as no config', async () => {
    const s = setup({ authoring: () => ({ i0: item(PAGE, 'Home', '/x') }) });
    const page = await readPage({ ...s.client, getValue: async () => undefined });
    expect(page.rawConfig).toBe('');
  });

  it('turns a plain query that resolves with isError into an SdkError', async () => {
    const s = setup();
    const failing = {
      ...s.client,
      query: async (key: string, o?: { params?: unknown }) =>
        key === 'pages.context' ? { data: undefined, status: 'error', isError: true, error: { code: 'EXECUTION_ERROR' } } : s.client.query(key, o),
    };
    const err = await readPage(failing).catch((e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect(err.message).toMatch(/page/);
    expect(authoringCalls(s.calls)).toEqual([]);
  });

  it('turns a plain query that throws inside the fake into an SdkError', async () => {
    const fake = fakeClient({ 'application.context': () => { throw new Error('boom'); } });
    await expect(readPage({ ...fake.client, getValue: async () => CONFIG })).rejects.toBeInstanceOf(SdkError);
  });

  it('passes on a GraphQL error from the Authoring API', async () => {
    const fake = fakeClient({
      'application.context': () => ({ data: APP_ONE }),
      'pages.context': () => ({ data: pagesContext(layout()) }),
      'xmc.authoring.graphql': () => ({ data: { errors: [{ message: 'Item lookup failed' }] } }),
    });
    await expect(readPage({ ...fake.client, getValue: async () => CONFIG })).rejects.toThrow('Item lookup failed');
  });
});

const cand = (name: string, fields: { name: string; value: string }[]): Candidate => ({
  itemId: `{${name}}`,
  name,
  path: `/p/${name}`,
  templateId: '{T}',
  fields,
});
const A = cand('A', [{ name: 'Title', value: 'x' }, { name: 'Config', value: CONFIG }]);
const B = cand('B', [{ name: 'Items', value: '' }]);
const C = cand('C', [{ name: 'items', value: CONFIG }]);

describe('matchByValue', () => {
  it('returns the candidates holding a field with exactly that value', () => {
    expect(matchByValue([A, B], CONFIG)).toEqual([A]);
  });
  it('returns every candidate that matches', () => {
    expect(matchByValue([A, B, C], CONFIG)).toEqual([A, C]);
  });
  it('matches exactly, not loosely', () => {
    expect(matchByValue([A], CONFIG.toUpperCase())).toEqual([]);
    expect(matchByValue([A], ` ${CONFIG}`)).toEqual([]);
  });
  it('returns nothing for a blank value, which would match every empty field', () => {
    expect(matchByValue([A, B, C], '')).toEqual([]);
    expect(matchByValue([A, B, C], '  ')).toEqual([]);
  });
});

describe('matchByField', () => {
  it('ignores case', () => {
    expect(matchByField([A, B, C], 'items')).toEqual([B, C]);
    expect(matchByField([A, B, C], 'CONFIG')).toEqual([A]);
  });
  it('returns nothing when no candidate has the field', () => {
    expect(matchByField([A, B, C], 'Missing')).toEqual([]);
  });
});

describe('toFieldContext', () => {
  it('joins the page and the chosen candidate', () => {
    const page: PageContext = {
      env: { id: TENANT_A, name: 'Org / DEV', contextId: 'ctxA' },
      language: 'da',
      rawConfig: CONFIG,
      candidates: [A],
    };
    expect(toFieldContext(page, { ...A, version: 4 })).toEqual({
      env: page.env,
      itemId: '{A}',
      itemName: 'A',
      itemPath: '/p/A',
      templateId: '{T}',
      language: 'da',
      version: 4,
      rawConfig: CONFIG,
    });
  });
});
