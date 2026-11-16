import type { SuggestionItem } from '@curanno/api-client';
import {
  builtinProfiles,
  caseFamilyProfile,
  evidenceExcerptProfile,
  individualProfile,
  type JsonValue,
} from '@curanno/model';
import { describe, expect, it } from 'vitest';
import { groupForReview } from './review-groups';

const profileOf = (iri: string) => builtinProfiles.find((p) => p.iri === iri);
const item = (id: string, profile: string, value: JsonValue) => ({
  item: {
    id,
    selector: { type: 'TextQuoteSelector', exact: id },
    body: { type: 'StructuredBody', profile, value },
    status: 'pending',
  } as SuggestionItem,
});
const ids = (groups: ReturnType<typeof groupForReview>) =>
  groups.map((g) => [g.head?.item.id, g.members.map((m) => m.item.id)]);

describe('groupForReview', () => {
  it('puts each fact under the first individual it names in the batch', () => {
    const groups = groupForReview(
      [
        item('_:i1', individualProfile.iri, { case: 'II-1' }),
        item('_:i2', individualProfile.iri, { case: 'II-2' }),
        item('_:f1', caseFamilyProfile.iri, { individuals: ['_:i2', '_:i1'], familyInfo: 'x' }),
        item('_:f2', caseFamilyProfile.iri, {
          individuals: ['https://a.test/annotations/1'],
          familyInfo: 'y',
        }),
        item('_:e', evidenceExcerptProfile.iri, { kind: 'case' }),
        item('_:i3', individualProfile.iri, { case: 'II-3' }),
      ],
      profileOf,
    );
    expect(ids(groups)).toEqual([
      ['_:i1', []],
      ['_:i2', ['_:f1']],
      [undefined, ['_:f2', '_:e', '_:i3']],
    ]);
  });
});
