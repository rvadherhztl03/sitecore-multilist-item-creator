import { describe, expect, it } from 'vitest';
import { parseConfig, normalizeId } from '@/lib/config';
import { SdkError } from '@/lib/sdk';

const RAW = '1c0685bf-fbf9-447b-8fc9-6758ecae42cd';
const NORM = '{1C0685BF-FBF9-447B-8FC9-6758ECAE42CD}';

describe('parseConfig', () => {
  it.each([[''], ['   '], [null], [undefined]])('reports %j as empty', (raw) => {
    expect(parseConfig(raw)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('reports malformed JSON', () => {
    expect(parseConfig('{nope')).toMatchObject({ ok: false, reason: 'invalid-json' });
  });

  it.each([['[]'], ['null'], ['"x"'], ['5']])('reports %s as invalid, not an object', (raw) => {
    expect(parseConfig(raw)).toMatchObject({ ok: false, reason: 'invalid-json' });
  });

  it('reports a missing or blank target field', () => {
    expect(parseConfig('{"folder":"{…}"}')).toMatchObject({ ok: false, reason: 'missing-target' });
    expect(parseConfig('{"targetField":"  "}')).toMatchObject({ ok: false, reason: 'missing-target' });
    expect(parseConfig('{"targetField":7}')).toMatchObject({ ok: false, reason: 'missing-target' });
  });

  it('reports a folder that is not an ID, naming the setting', () => {
    const res = parseConfig('{"targetField":"Related Items","folder":"abc"}');
    expect(res).toMatchObject({ ok: false, reason: 'bad-guid' });
    expect(res.ok ? '' : res.message).toContain('folder');
  });

  it('reports a template that is not an ID', () => {
    const res = parseConfig(`{"targetField":"X","templates":["${RAW}","local:/Data/x"]}`);
    expect(res).toMatchObject({ ok: false, reason: 'bad-guid' });
    expect(res.ok ? '' : res.message).toContain('templates');
  });

  it.each([
    ['"templates":"a"', 'invalid-json'],
    ['"templates":{}', 'invalid-json'],
    ['"required":"Title"', 'invalid-json'],
    ['"required":[1]', 'invalid-json'],
    ['"nameFrom":3', 'invalid-json'],
    ['"folder":5', 'bad-guid'],
    ['"folder":["x"]', 'bad-guid'],
    ['"templates":[5]', 'bad-guid'],
    ['"templates":[null]', 'bad-guid'],
  ])('reports %s as %s', (body, reason) => {
    expect(parseConfig(`{"targetField":"X",${body}}`)).toMatchObject({ ok: false, reason });
  });

  it('never throws, whatever the runtime input', () => {
    for (const raw of [5, true, {}, [], () => 1]) {
      expect(parseConfig(raw as unknown as string)).toMatchObject({ ok: false, reason: 'empty' });
    }
  });

  it('trims the target field, nameFrom and required entries', () => {
    expect(parseConfig('{"targetField":"  Related Items ","nameFrom":" Title ","required":[" Title ","Summary  "]}')).toStrictEqual({
      ok: true,
      config: { targetField: 'Related Items', nameFrom: 'Title', required: ['Title', 'Summary'] },
    });
  });

  it('drops blank required entries, and the list when none are left', () => {
    expect(parseConfig('{"targetField":"X","required":["Title","",  "  "]}')).toStrictEqual({ ok: true, config: { targetField: 'X', required: ['Title'] } });
    expect(parseConfig('{"targetField":"X","required":["", " "]}')).toStrictEqual({ ok: true, config: { targetField: 'X' } });
  });

  it('removes duplicate templates after normalizing, keeping first-seen order', () => {
    const other = '2c0685bf-fbf9-447b-8fc9-6758ecae42cd';
    const raw = JSON.stringify({ targetField: 'X', templates: [other, RAW, RAW.toUpperCase(), `{${RAW}}`, RAW.replaceAll('-', ''), other] });
    expect(parseConfig(raw)).toStrictEqual({ ok: true, config: { targetField: 'X', templates: ['{2C0685BF-FBF9-447B-8FC9-6758ECAE42CD}', NORM] } });
  });

  it('removes duplicate required fields after trimming', () => {
    expect(parseConfig('{"targetField":"X","required":["a"," a ","b","a"]}')).toStrictEqual({ ok: true, config: { targetField: 'X', required: ['a', 'b'] } });
  });

  it('counts a whitespace-only setting as blank', () => {
    const res = parseConfig('{"targetField":"X","folder":"  ","nameFrom":"  ","templates":" ","required":"  "}');
    expect(res).toStrictEqual({ ok: true, config: { targetField: 'X' } });
  });

  it('accepts only a target field', () => {
    expect(parseConfig('{"targetField":"Related Items"}')).toEqual({ ok: true, config: { targetField: 'Related Items' } });
  });

  it('normalizes the folder', () => {
    expect(parseConfig(`{"targetField":"X","folder":"${RAW}"}`)).toEqual({ ok: true, config: { targetField: 'X', folder: NORM } });
  });

  it('normalizes every template and keeps nameFrom and required', () => {
    const raw = JSON.stringify({
      targetField: 'X',
      folder: `{${RAW.toUpperCase()}}`,
      templates: [RAW, '1c0685bffbf9447b8fc96758ecae42ce'],
      nameFrom: 'Title',
      required: ['Title', 'Summary'],
    });
    expect(parseConfig(raw)).toEqual({
      ok: true,
      config: {
        targetField: 'X',
        folder: NORM,
        templates: [NORM, '{1C0685BF-FBF9-447B-8FC9-6758ECAE42CE}'],
        nameFrom: 'Title',
        required: ['Title', 'Summary'],
      },
    });
  });

  it('leaves out empty or null settings instead of setting them to undefined', () => {
    const res = parseConfig('{"targetField":"X","folder":null,"templates":[],"required":[],"nameFrom":""}');
    expect(res).toStrictEqual({ ok: true, config: { targetField: 'X' } });
  });

  it('ignores unknown keys', () => {
    expect(parseConfig('{"targetField":"X","other":1}')).toStrictEqual({ ok: true, config: { targetField: 'X' } });
  });
});

describe('normalizeId', () => {
  it('accepts a braced dashed GUID in any case', () => {
    expect(normalizeId(`{${RAW}}`)).toBe(NORM);
    expect(normalizeId(`{${RAW.toUpperCase()}}`)).toBe(NORM);
  });

  it('accepts a bare dashed GUID', () => {
    expect(normalizeId(RAW)).toBe(NORM);
    expect(normalizeId(RAW.toUpperCase())).toBe(NORM);
  });

  it('accepts the Authoring API compact form', () => {
    expect(normalizeId('1c0685bffbf9447b8fc96758ecae42cd')).toBe(NORM);
    expect(normalizeId('1C0685BFFBF9447B8FC96758ECAE42CD')).toBe(NORM);
  });

  it('ignores surrounding whitespace', () => {
    expect(normalizeId(` ${RAW}\n`)).toBe(NORM);
  });

  it('throws SdkError, not TypeError, for a non-string', () => {
    for (const id of [5, null, undefined, {}, []]) {
      expect(() => normalizeId(id as unknown as string)).toThrow(SdkError);
    }
  });

  it.each([
    ['local:/Data/x'],
    [''],
    ['abc'],
    [`{${RAW}`],
    [`${RAW}}`],
    ['1c0685bf-fbf9447b-8fc9-6758ecae42cd'],
    ['1c0685bffbf9447b8fc96758ecae42c'],
    ['zc0685bffbf9447b8fc96758ecae42cd'],
    ['{1c0685bffbf9447b8fc96758ecae42cd}'],
  ])('throws SdkError for %j', (id) => {
    expect(() => normalizeId(id)).toThrow(SdkError);
  });
});
