/**
 * Checks on the items of a suggestion batch (ADR 0037): local ids, links
 * between items, and each value against its profile. Pure, so that the
 * rules can be tested without a database.
 */
import {
  linkFieldsOf,
  linkedIris,
  type JsonValue,
  type ProfileRegistry,
  type Selector,
  type StructuredBody,
} from '@curanno/model';
import type { ValidationIssue } from '../problems.js';

export interface ItemInput {
  id: string;
  selector: Selector | Selector[];
  body: StructuredBody;
}

const LOCAL_ID = /^_:[A-Za-z0-9_-]{1,64}$/;
// Stands in for a local id while a value is validated; it matches the IRI pattern link fields use.
const PLACEHOLDER = 'urn:x-curanno-local:';

export const isLocalId = (value: string): boolean => value.startsWith('_:');

/** The local ids an item's value links to, by field. */
export function localLinks(
  body: StructuredBody,
  registry: ProfileRegistry,
): { field: string; profile: string; ids: string[] }[] {
  const profile = registry.get(body.profile);
  const value = body.value;
  if (!profile || typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return linkFieldsOf(profile.schema).map(({ field, link }) => ({
    field,
    profile: link.profile,
    ids: linkedIris(value[field]).filter(isLocalId),
  }));
}

/** `value` with every local id in its link fields replaced by `replace(id)`, or removed when that gives undefined. */
export function replaceLocalIds(
  body: StructuredBody,
  registry: ProfileRegistry,
  replace: (id: string) => string | undefined,
): StructuredBody {
  const profile = registry.get(body.profile);
  const value = body.value;
  if (!profile || typeof value !== 'object' || value === null || Array.isArray(value)) return body;
  const next: Record<string, JsonValue> = { ...value };
  for (const { field, multiple } of linkFieldsOf(profile.schema)) {
    const current = value[field];
    if (current === undefined) continue;
    const ids = linkedIris(current).flatMap((v) => (isLocalId(v) ? (replace(v) ?? []) : [v]));
    if (multiple) next[field] = ids;
    else if (ids[0] !== undefined) next[field] = ids[0];
    else delete next[field];
  }
  return { ...body, value: next };
}

/** Every problem with a batch's items; empty when they can be stored. */
export function checkItems(items: ItemInput[], registry: ProfileRegistry): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map<string, ItemInput>();
  items.forEach((item, i) => {
    if (!LOCAL_ID.test(item.id)) {
      issues.push({
        instancePath: `/items/${i}/id`,
        message: 'must be _: and 1–64 of A–Z, a–z, 0–9, - or _',
      });
    } else if (byId.has(item.id)) {
      issues.push({ instancePath: `/items/${i}/id`, message: `${item.id} is used twice` });
    }
    byId.set(item.id, item);
  });

  const edges = new Map<string, string[]>();
  items.forEach((item, i) => {
    const path = `/items/${i}/body`;
    if (!registry.get(item.body.profile)) {
      issues.push({
        instancePath: `${path}/profile`,
        message: `${item.body.profile} is not a registered profile`,
      });
      return;
    }
    const targets: string[] = [];
    for (const { field, profile, ids } of localLinks(item.body, registry)) {
      for (const id of ids) {
        const linked = byId.get(id);
        if (!linked) {
          issues.push({
            instancePath: `${path}/value/${field}`,
            message: `no item ${id} in this batch`,
          });
        } else if (linked.body.profile !== profile) {
          issues.push({
            instancePath: `${path}/value/${field}`,
            message: `${id} is not a ${profile} item`,
          });
        } else {
          targets.push(id);
        }
      }
    }
    edges.set(item.id, targets);
    const placeheld = replaceLocalIds(item.body, registry, (id) => `${PLACEHOLDER}${id.slice(2)}`);
    const result = registry.validate(placeheld);
    if (result && !result.ok) {
      for (const e of result.errors) {
        issues.push({ instancePath: `${path}${e.instancePath}`, message: e.message });
      }
    }
  });

  const cycle = findCycle(edges);
  if (cycle)
    issues.push({ instancePath: '/items', message: `links form a cycle: ${cycle.join(' → ')}` });
  return issues;
}

function findCycle(edges: Map<string, string[]>): string[] | undefined {
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    const at = path.indexOf(id);
    if (at >= 0) return [...path.slice(at), id];
    if (done.has(id)) return undefined;
    path.push(id);
    for (const next of edges.get(id) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    done.add(id);
    return undefined;
  };
  for (const id of edges.keys()) {
    const found = visit(id);
    if (found) return found;
  }
  return undefined;
}
