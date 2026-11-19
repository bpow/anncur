import { badGateway, notFound } from '../problems.js';
import { UpstreamError } from '../variants/resolver.js';
import type { AppContext, Handlers } from './context.js';

export function variantHandlers(ctx: AppContext): Handlers {
  return {
    async resolveVariant(request, reply) {
      const { q, gene } = request.query as { q: string; gene?: string };
      if (!ctx.variants) throw notFound('variant lookup is turned off on this server');
      try {
        const result = await ctx.variants.resolve(q, gene);
        void reply.header('cache-control', 'private, max-age=3600');
        return result;
      } catch (err) {
        if (err instanceof UpstreamError) throw badGateway(err.message);
        throw err;
      }
    },
  };
}
