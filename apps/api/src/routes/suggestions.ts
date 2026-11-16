import { requireUser } from '../auth/plugin.js';
import { notFound } from '../problems.js';
import type { AppContext, Handlers } from './context.js';
import type { AcceptInput, BatchInput, ListFilters } from '../suggestions/store.js';

export function suggestionHandlers(ctx: AppContext): Handlers {
  const { suggestions, config } = ctx;
  const id = (request: { params: unknown }) => (request.params as { id: string }).id;
  return {
    async createSuggestionBatch(request, reply) {
      const caller = requireUser(request);
      const batch = await suggestions.create(request.body as BatchInput, caller, request.log);
      reply.code(201).header('location', `${config.publicUrl}/x/suggestion-batches/${batch.id}`);
      return batch;
    },

    async listSuggestionBatches(request) {
      return suggestions.list(requireUser(request), request.query as ListFilters);
    },

    async getSuggestionBatch(request) {
      const batch = await suggestions.get(id(request), requireUser(request));
      if (!batch) throw notFound();
      return batch;
    },

    async deleteSuggestionBatch(request, reply) {
      await suggestions.delete(id(request), requireUser(request));
      return reply.code(204).send();
    },

    async acceptSuggestions(request) {
      return suggestions.accept(id(request), request.body as AcceptInput, requireUser(request));
    },

    async rejectSuggestions(request) {
      const { items } = request.body as { items: string[] };
      return suggestions.reject(id(request), items, requireUser(request));
    },
  };
}
