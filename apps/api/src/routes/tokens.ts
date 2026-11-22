import type { FastifyRequest } from 'fastify';
import type { components } from '@anncur/api-client';
import { isoDate } from '../annotations/serialize.js';
import { requireUser } from '../auth/plugin.js';
import { newSecret } from '../auth/tokens.js';
import { forbidden, notFound } from '../problems.js';
import type { AppContext, Handlers } from './context.js';

type AccessToken = components['schemas']['AccessToken'];
type AccessTokenInput = components['schemas']['AccessTokenInput'];

const DAY_MS = 24 * 60 * 60 * 1000;

export function tokenHandlers(ctx: AppContext): Handlers {
  const { db } = ctx;

  /**
   * The user whose tokens the request is about, and whether the caller is
   * that user. Someone else's tokens are an administrator's business only;
   * to anyone else they do not exist.
   */
  async function owner(request: FastifyRequest) {
    const caller = requireUser(request);
    const { id } = request.params as { id: string };
    const user = await db
      .selectFrom('users')
      .select(['principal_id', 'is_service'])
      .where('principal_id', '=', id)
      .executeTakeFirst();
    const self = caller.userId === id;
    if (!user || (!self && !caller.isAdmin)) throw notFound(`no user ${id}`);
    return { caller, user, self };
  }

  const toToken = (row: {
    id: string;
    name: string;
    scopes: string[];
    created_at: Date;
    expires_at: Date;
    last_used_at: Date | null;
    revoked_at: Date | null;
  }): AccessToken => ({
    id: row.id,
    name: row.name,
    scopes: row.scopes as AccessToken['scopes'],
    created: isoDate(row.created_at),
    expires: isoDate(row.expires_at),
    ...(row.last_used_at !== null ? { lastUsed: isoDate(row.last_used_at) } : {}),
    ...(row.revoked_at !== null ? { revoked: isoDate(row.revoked_at) } : {}),
  });

  const columns = [
    'id',
    'name',
    'scopes',
    'created_at',
    'expires_at',
    'last_used_at',
    'revoked_at',
  ] as const;

  return {
    async listAccessTokens(request) {
      const { user } = await owner(request);
      const rows = await db
        .selectFrom('access_tokens')
        .select(columns)
        .where('principal_id', '=', user.principal_id)
        .orderBy('created_at', 'desc')
        .execute();
      return rows.map(toToken);
    },

    async createAccessToken(request, reply) {
      const { caller, user, self } = await owner(request);
      if (!self && !user.is_service) {
        throw forbidden('administrators make tokens for service accounts only');
      }
      const input = request.body as AccessTokenInput;
      const { secretHash, tokenFor } = newSecret();
      const row = await db
        .insertInto('access_tokens')
        .values({
          principal_id: user.principal_id,
          name: input.name,
          scopes: input.scopes,
          secret_hash: secretHash,
          created_by: caller.userId,
          expires_at: new Date(Date.now() + input.expiresInDays * DAY_MS),
        })
        .returning(columns)
        .executeTakeFirstOrThrow();
      reply.code(201);
      return { ...toToken(row), token: tokenFor(row.id) };
    },

    async revokeAccessToken(request, reply) {
      const { user } = await owner(request);
      const { tokenId } = request.params as { tokenId: string };
      const result = await db
        .updateTable('access_tokens')
        .set({ revoked_at: new Date() })
        .where('id', '=', tokenId)
        .where('principal_id', '=', user.principal_id)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) {
        const exists = await db
          .selectFrom('access_tokens')
          .select('id')
          .where('id', '=', tokenId)
          .where('principal_id', '=', user.principal_id)
          .executeTakeFirst();
        if (!exists) throw notFound(`no token ${tokenId}`);
      }
      return reply.code(204).send();
    },
  };
}
