import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';
import { buildConfig } from './setup';

const FOLDER = '{A1B2C3D4-0000-4000-8000-000000000001}';
const T1 = '{D4F8A4B1-0000-4000-8000-00000000ABCD}';
const T2 = '{D4F8A4B1-0000-4000-8000-00000000BEEF}';

describe('buildConfig', () => {
  it('is pretty JSON with only targetField when nothing else is set', () => {
    expect(buildConfig({ targetField: 'Related Items' })).toBe('{\n  "targetField": "Related Items"\n}');
  });

  it('leaves out blank, whitespace-only and empty optionals', () => {
    const json = buildConfig({ targetField: 'Related Items', folder: '  ', templates: [], nameFrom: '', required: ['', '   '] });
    expect(JSON.parse(json)).toEqual({ targetField: 'Related Items' });
    expect(json).not.toMatch(/folder|templates|nameFrom|required/);
  });

  it('trims every value, drops blank list entries and keeps the key order', () => {
    const json = buildConfig({ required: [' Title ', '', 'Summary'], nameFrom: ' Title ', templates: [` ${T1} `, '', T2], folder: ` ${FOLDER} `, targetField: ' Related Items ' });
    expect(json).toBe(
      JSON.stringify({ targetField: 'Related Items', folder: FOLDER, templates: [T1, T2], nameFrom: 'Title', required: ['Title', 'Summary'] }, null, 2),
    );
  });

  it('round-trips through parseConfig', () => {
    const form = { targetField: 'Related Items', folder: FOLDER, templates: [T1, T2], nameFrom: 'Title', required: ['Title', 'Summary'] };
    expect(parseConfig(buildConfig(form))).toEqual({ ok: true, config: form });
    expect(parseConfig(buildConfig({ targetField: 'Related Items' }))).toEqual({ ok: true, config: { targetField: 'Related Items' } });
  });

  it('keeps an ID as typed, so parseConfig can say which one is wrong', () => {
    const parsed = parseConfig(buildConfig({ targetField: 'x', folder: 'not-an-id' }));
    expect(parsed).toMatchObject({ ok: false, reason: 'bad-guid' });
  });
});
