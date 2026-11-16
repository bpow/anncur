/**
 * Suggestion batches (ADR 0037). Every read filters by the caller's group
 * principals, as reads of annotations filter by their ACL (ADR 0006), or
 * by the caller having posted the batch as the group's suggester (ADR 0038).
 * Decisions on a batch lock its row, so two reviewers cannot decide the
 * same item at once.
 */
import { sql, type Kysely } from 'kysely';
import {
  isStructuredBody,
  linkFieldsOf,
  linkedIris,
  type AnnotationInput,
  type ProfileRegistry,
  type StructuredBody,
} from '@curanno/model';
import type { components } from '@curanno/api-client';
import type { UserCaller } from '../auth/caller.js';
import type { Database, SuggestionStatus } from '../db/index.js';
import { parseAnnotationInput } from '../annotations/input.js';
import { annotationIdFromIri, annotationIri, isoDate } from '../annotations/serialize.js';
import type { AnnotationStore } from '../annotations/store.js';
import {
  normalizeLinks,
  resolveDocumentForUris,
  findDocumentIdByUri,
  type DocumentMetadata,
  type WarnLogger,
} from '../documents/service.js';
import type { ProfileService } from '../profiles/service.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../problems.js';
import { checkItems, localLinks, replaceLocalIds, type ItemInput } from './items.js';

/** The request bodies, as the OpenAPI schema has already checked them, in the model's types. */
export interface BatchInput {
  group: string;
  document: DocumentMetadata;
  engine: { name: string; version: string; nickname?: string };
  key?: string;
  items: ItemInput[];
}
export interface AcceptInput {
  items: ({ id: string; annotation: AnnotationInput } | { id: string; existing: string })[];
}
type Batch = components['schemas']['SuggestionBatch'];
type BatchSummary = components['schemas']['SuggestionBatchSummary'];
type Item = components['schemas']['SuggestionItem'];
type Decisions = components['schemas']['SuggestionDecisions'];

export interface ListFilters {
  group?: string | undefined;
  document?: string | undefined;
  uri?: string | undefined;
  pending?: boolean | undefined;
  limit: number;
  offset: number;
}

// A caller's principals include their groups; a batch's group is never a user or pseudo-principal.
const groupsOf = (caller: UserCaller) => caller.principalIds;

export class SuggestionStore {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly annotations: AnnotationStore,
    private readonly profiles: ProfileService,
    private readonly publicUrl: string,
  ) {}

  private summaries(db: Kysely<Database>, caller: UserCaller) {
    const count = (status: SuggestionStatus) =>
      sql<string>`(select count(*) from suggestion_items i where i.batch_id = suggestion_batches.id and i.status = ${status})`;
    return (
      db
        .selectFrom('suggestion_batches')
        // Members see the group's batches; a suggester sees those it posted (ADR 0038).
        .where((eb) =>
          eb.or([
            eb('suggestion_batches.group_id', 'in', groupsOf(caller)),
            eb('suggestion_batches.created_by', '=', caller.userId),
          ]),
        )
        .select([
          'suggestion_batches.id',
          'suggestion_batches.group_id',
          'suggestion_batches.document_id',
          'suggestion_batches.engine_name',
          'suggestion_batches.engine_version',
          'suggestion_batches.engine_nickname',
          'suggestion_batches.rerun_key',
          'suggestion_batches.created_by',
          'suggestion_batches.created_at',
          count('pending').as('pending'),
          count('accepted').as('accepted'),
          count('rejected').as('rejected'),
        ])
    );
  }

  private toSummary(
    row: Awaited<ReturnType<ReturnType<SuggestionStore['summaries']>['execute']>>[number],
  ): BatchSummary {
    return {
      id: row.id,
      group: row.group_id,
      document: row.document_id,
      engine: {
        name: row.engine_name,
        version: row.engine_version,
        ...(row.engine_nickname !== null ? { nickname: row.engine_nickname } : {}),
      },
      ...(row.rerun_key !== null ? { key: row.rerun_key } : {}),
      creator: row.created_by,
      created: isoDate(row.created_at),
      counts: {
        pending: Number(row.pending),
        accepted: Number(row.accepted),
        rejected: Number(row.rejected),
      },
    };
  }

  async create(input: BatchInput, caller: UserCaller, log: WarnLogger): Promise<Batch> {
    if (!caller.principalIds.includes(input.group)) {
      const group = await this.db
        .selectFrom('groups')
        .leftJoin('group_memberships', (join) =>
          join
            .onRef('group_memberships.group_id', '=', 'groups.principal_id')
            .on('group_memberships.user_id', '=', caller.userId),
        )
        .select('group_memberships.role')
        .where('groups.principal_id', '=', input.group)
        .executeTakeFirst();
      if (!group) throw notFound(`no group ${input.group}`);
      if (group.role !== 'suggester') throw forbidden('members and suggesters of the group only');
    }
    const registry = await this.profiles.registry();
    const issues = checkItems(input.items, registry);
    if (issues.length) throw unprocessable('the batch cannot be stored', issues);
    const uris = normalizeLinks(input.document);
    if (uris.length === 0) throw badRequest('none of the reported URIs identifies a document');

    const id = await this.db.transaction().execute(async (trx) => {
      const { documentId } = await resolveDocumentForUris(
        trx,
        uris,
        input.document.title,
        caller.userId,
        log,
      );
      if (input.key !== undefined) await this.dropRerun(trx, input, documentId);
      const batch = await trx
        .insertInto('suggestion_batches')
        .values({
          group_id: input.group,
          document_id: documentId,
          engine_name: input.engine.name,
          engine_version: input.engine.version,
          engine_nickname: input.engine.nickname ?? null,
          rerun_key: input.key ?? null,
          created_by: caller.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('suggestion_items')
        .values(
          input.items.map((item, position) => ({
            batch_id: batch.id,
            local_id: item.id,
            position,
            selector: JSON.stringify(item.selector),
            body: JSON.stringify(item.body),
          })),
        )
        .execute();
      return batch.id;
    });
    return (await this.get(id, caller)) as Batch;
  }

  /** Earlier runs with the same key lose their pending items, and go when nothing is left. */
  private async dropRerun(
    trx: Kysely<Database>,
    input: BatchInput,
    documentId: string,
  ): Promise<void> {
    const earlier = trx
      .selectFrom('suggestion_batches')
      .select('id')
      .where('group_id', '=', input.group)
      .where('document_id', '=', documentId)
      .where('engine_name', '=', input.engine.name)
      .where('rerun_key', '=', input.key ?? null);
    await trx
      .deleteFrom('suggestion_items')
      .where('batch_id', 'in', earlier)
      .where('status', '=', 'pending')
      .execute();
    await trx
      .deleteFrom('suggestion_batches')
      .where('id', 'in', earlier)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('suggestion_items')
              .select('batch_id')
              .whereRef('suggestion_items.batch_id', '=', 'suggestion_batches.id'),
          ),
        ),
      )
      .execute();
  }

  async list(
    caller: UserCaller,
    f: ListFilters,
  ): Promise<{ total: number; items: BatchSummary[] }> {
    let documentId = f.document;
    if (f.uri !== undefined) {
      const found = await findDocumentIdByUri(this.db, f.uri);
      if (found === undefined || (documentId !== undefined && documentId !== found)) {
        return { total: 0, items: [] };
      }
      documentId = found;
    }
    let query = this.summaries(this.db, caller);
    if (f.group !== undefined) query = query.where('suggestion_batches.group_id', '=', f.group);
    if (documentId !== undefined) {
      query = query.where('suggestion_batches.document_id', '=', documentId);
    }
    if (f.pending) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('suggestion_items')
            .select('batch_id')
            .whereRef('suggestion_items.batch_id', '=', 'suggestion_batches.id')
            .where('suggestion_items.status', '=', 'pending'),
        ),
      );
    }
    const { total } = await query
      .clearSelect()
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirstOrThrow();
    const rows = await query
      .orderBy('suggestion_batches.created_at', 'desc')
      .orderBy('suggestion_batches.id', 'desc')
      .limit(f.limit)
      .offset(f.offset)
      .execute();
    return { total: Number(total), items: rows.map((r) => this.toSummary(r)) };
  }

  async get(id: string, caller: UserCaller): Promise<Batch | undefined> {
    const row = await this.summaries(this.db, caller)
      .where('suggestion_batches.id', '=', id)
      .executeTakeFirst();
    if (!row) return undefined;
    const items = await this.db
      .selectFrom('suggestion_items')
      .selectAll()
      .where('batch_id', '=', id)
      .orderBy('position')
      .execute();
    return {
      ...this.toSummary(row),
      items: items.map((i): Item => ({
        id: i.local_id,
        selector: i.selector as Item['selector'],
        body: i.body as Item['body'],
        status: i.status,
        ...(i.annotation_id !== null
          ? { annotation: annotationIri(this.publicUrl, i.annotation_id) }
          : {}),
        ...(i.decided_by !== null ? { decidedBy: i.decided_by } : {}),
        ...(i.decided_at !== null ? { decided: isoDate(i.decided_at) } : {}),
      })),
    };
  }

  async delete(id: string, caller: UserCaller): Promise<void> {
    const result = await this.db
      .deleteFrom('suggestion_batches')
      .where('id', '=', id)
      .where('group_id', 'in', groupsOf(caller))
      .executeTakeFirst();
    if (result.numDeletedRows === 0n) throw notFound();
  }

  /** The batch's items, with its row locked until the transaction ends; 404 for a batch the caller cannot see. */
  private async lock(trx: Kysely<Database>, id: string, caller: UserCaller) {
    const batch = await trx
      .selectFrom('suggestion_batches')
      .select('id')
      .where('id', '=', id)
      .where('group_id', 'in', groupsOf(caller))
      .forUpdate()
      .executeTakeFirst();
    if (!batch) throw notFound();
    const rows = await trx
      .selectFrom('suggestion_items')
      .select(['local_id', 'body', 'status', 'annotation_id'])
      .where('batch_id', '=', id)
      .execute();
    return new Map(rows.map((r) => [r.local_id, r]));
  }

  async accept(id: string, input: AcceptInput, caller: UserCaller): Promise<Decisions> {
    const registry = await this.profiles.registry();
    const decided: Decisions['items'] = [];
    await this.db.transaction().execute(async (trx) => {
      const items = await this.lock(trx, id, caller);
      const accepted = new Map<string, string>();
      for (const [localId, row] of items) {
        if (row.status === 'accepted' && row.annotation_id !== null) {
          accepted.set(localId, annotationIri(this.publicUrl, row.annotation_id));
        }
      }
      for (const [i, entry] of input.items.entries()) {
        const row = items.get(entry.id);
        if (!row) throw notFound(`no item ${entry.id} in this batch`);
        if (row.status !== 'pending' || accepted.has(entry.id)) {
          throw conflict(`${entry.id} is already ${row.status}`);
        }
        const annotationId =
          'existing' in entry
            ? await this.checkExisting(trx, entry.existing, row.body.profile, caller, i)
            : await this.createFrom(trx, entry.annotation, registry, accepted, caller, i);
        await trx
          .updateTable('suggestion_items')
          .set({
            status: 'accepted',
            annotation_id: annotationId,
            decided_by: caller.userId,
            decided_at: sql`now()`,
          })
          .where('batch_id', '=', id)
          .where('local_id', '=', entry.id)
          .execute();
        const iri = annotationIri(this.publicUrl, annotationId);
        accepted.set(entry.id, iri);
        decided.push({ id: entry.id, annotation: iri });
      }
    });
    return { items: decided };
  }

  private async checkExisting(
    trx: Kysely<Database>,
    iri: string,
    profile: string,
    caller: UserCaller,
    i: number,
  ): Promise<string> {
    const annotationId = annotationIdFromIri(this.publicUrl, iri);
    const found =
      annotationId &&
      (await trx
        .selectFrom('annotations')
        .innerJoin('bodies', 'bodies.annotation_id', 'annotations.id')
        .select('annotations.id')
        .where('annotations.id', '=', annotationId)
        .where('annotations.deleted_at', 'is', null)
        .where('bodies.profile', '=', profile)
        .executeTakeFirst());
    if (!found || !(await this.annotations.canRead(found.id, caller))) {
      throw unprocessable(
        `/items/${i}/existing is not a readable annotation with a ${profile} body`,
      );
    }
    return found.id;
  }

  private async createFrom(
    trx: Kysely<Database>,
    annotation: AnnotationInput,
    registry: ProfileRegistry,
    accepted: Map<string, string>,
    caller: UserCaller,
    i: number,
  ): Promise<string> {
    const parsed = parseAnnotationInput(annotation);
    parsed.bodies = parsed.bodies.map((body) => {
      if (!isStructuredBody(body)) return body;
      return replaceLocalIds(body, registry, (local) => {
        const iri = accepted.get(local);
        if (!iri) throw conflict(`/items/${i} links to ${local}, which is not accepted`);
        return iri;
      });
    });
    await this.profiles.validateBodies(parsed.bodies);
    return this.annotations.createIn(trx, parsed, caller);
  }

  /**
   * Rejects the items, takes them out of pending items' link fields, and
   * rejects any pending item that is left without a link its profile
   * requires, until no more change.
   */
  async reject(id: string, ids: string[], caller: UserCaller): Promise<Batch> {
    const registry = await this.profiles.registry();
    await this.db.transaction().execute(async (trx) => {
      const items = await this.lock(trx, id, caller);
      const rejected = new Set<string>();
      for (const local of ids) {
        const row = items.get(local);
        if (!row) throw notFound(`no item ${local} in this batch`);
        if (row.status !== 'pending') throw conflict(`${local} is already ${row.status}`);
        rejected.add(local);
      }
      const changed = new Map<string, StructuredBody>();
      for (let grew = true; grew;) {
        grew = false;
        for (const [local, row] of items) {
          if (row.status !== 'pending' || rejected.has(local)) continue;
          const body = changed.get(local) ?? row.body;
          if (!localLinks(body, registry).some((l) => l.ids.some((x) => rejected.has(x)))) continue;
          const next = replaceLocalIds(body, registry, (x) => (rejected.has(x) ? undefined : x));
          changed.set(local, next);
          if (missesRequiredLink(next, registry)) {
            rejected.add(local);
            grew = true;
          }
        }
      }
      if (rejected.size) {
        await trx
          .updateTable('suggestion_items')
          .set({ status: 'rejected', decided_by: caller.userId, decided_at: sql`now()` })
          .where('batch_id', '=', id)
          .where('local_id', 'in', [...rejected])
          .execute();
      }
      for (const [local, body] of changed) {
        if (rejected.has(local)) continue;
        await trx
          .updateTable('suggestion_items')
          .set({ body: JSON.stringify(body) })
          .where('batch_id', '=', id)
          .where('local_id', '=', local)
          .execute();
      }
    });
    return (await this.get(id, caller)) as Batch;
  }
}

function missesRequiredLink(body: StructuredBody, registry: ProfileRegistry): boolean {
  const schema = registry.get(body.profile)?.schema;
  const value = body.value;
  if (!schema || typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const required = new Set((schema['required'] as string[] | undefined) ?? []);
  return linkFieldsOf(schema).some(
    ({ field }) => required.has(field) && linkedIris(value[field]).length === 0,
  );
}
