import { Ajv2020 } from 'ajv/dist/2020.js';
import type { JsonValue } from '../annotation/types.js';
import {
  builtinProfiles,
  caseFamilyProfile,
  evidenceExcerptProfile,
  individualProfile,
} from './builtin.js';
import { addProfileKeywords } from './keywords.js';
import { ProfileRegistry, type BodyProfile } from './registry.js';
import { describe, expect, it } from 'vitest';
import { checkItems, replaceLocalIds, type ItemInput } from './batch-items.js';

// A profile pair that can link both ways, to exercise the cycle check.
const ring: BodyProfile = {
  iri: 'https://x.example/profiles/ring/1',
  title: 'Ring',
  schema: {
    type: 'object',
    properties: {
      next: { type: 'string', annotation: { profile: 'https://x.example/profiles/ring/1' } },
    },
  },
};

const registry = new ProfileRegistry(
  addProfileKeywords(new Ajv2020({ strict: true, allErrors: true })),
  [...builtinProfiles, ring],
);

const selector = { type: 'TextQuoteSelector' as const, exact: 'II-1 was a boy' };
const item = (id: string, profile: string, value: JsonValue): ItemInput => ({
  id,
  selector,
  body: { type: 'StructuredBody', profile, value },
});
const messages = (items: ItemInput[]) => checkItems(items, registry).map((i) => i.message);

describe('checkItems', () => {
  it('accepts individuals and facts that link to them or to saved annotations', () => {
    expect(
      checkItems(
        [
          item('_:i1', individualProfile.iri, { case: 'II-1' }),
          item('_:f1', caseFamilyProfile.iri, {
            individuals: ['_:i1', 'https://annotations.test/annotations/1'],
            familyInfo: 'Cousins.',
          }),
        ],
        registry,
      ),
    ).toEqual([]);
  });

  it('names each item that cannot be stored', () => {
    const issues = checkItems(
      [
        item('i1', individualProfile.iri, { case: 'II-1' }),
        item('_:a', individualProfile.iri, { case: 'II-2' }),
        item('_:a', individualProfile.iri, {}),
        item('_:f', caseFamilyProfile.iri, { individuals: ['_:missing'], familyInfo: 'x' }),
        item('_:g', caseFamilyProfile.iri, { individuals: ['_:f'], familyInfo: 'x' }),
        item('_:e', 'https://x.example/profiles/unknown/1', {}),
      ],
      registry,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instancePath: '/items/0/id' }),
        { instancePath: '/items/2/id', message: '_:a is used twice' },
        expect.objectContaining({ instancePath: '/items/2/body/value' }),
        {
          instancePath: '/items/3/body/value/individuals',
          message: 'no item _:missing in this batch',
        },
        {
          instancePath: '/items/4/body/value/individuals',
          message: `_:f is not a ${individualProfile.iri} item`,
        },
        {
          instancePath: '/items/5/body/profile',
          message: 'https://x.example/profiles/unknown/1 is not a registered profile',
        },
      ]),
    );
  });

  it('refuses links that go round in a cycle', () => {
    expect(
      messages([
        item('_:a', ring.iri, { next: '_:b' }),
        item('_:b', ring.iri, { next: '_:c' }),
        item('_:c', ring.iri, { next: '_:a' }),
      ]),
    ).toEqual(['links form a cycle: _:a → _:b → _:c → _:a']);
    expect(messages([item('_:a', ring.iri, { next: '_:b' }), item('_:b', ring.iri, {})])).toEqual(
      [],
    );
  });

  it('checks values that have no links as they are', () => {
    expect(messages([item('_:e', evidenceExcerptProfile.iri, { kind: 'nonsense' })])).toHaveLength(
      1,
    );
  });
});

describe('replaceLocalIds', () => {
  it('replaces local ids in link fields and drops those it cannot', () => {
    const body = item('_:f', caseFamilyProfile.iri, {
      individuals: ['_:i1', '_:i2', 'https://a.test/annotations/9'],
      familyInfo: 'x',
    }).body;
    expect(
      replaceLocalIds(body, registry, (id) =>
        id === '_:i1' ? 'https://a.test/annotations/1' : undefined,
      ).value,
    ).toEqual({
      individuals: ['https://a.test/annotations/1', 'https://a.test/annotations/9'],
      familyInfo: 'x',
    });
    const single = item('_:a', ring.iri, { next: '_:b' }).body;
    expect(replaceLocalIds(single, registry, () => undefined).value).toEqual({});
  });
});
