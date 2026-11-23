# AGENTS.md

This file provides guidance to coding agents (Claude Code, Codex and others) when working with code in this repository.

Anncur is a W3C Web Annotation server and client set for curation annotations: a Fastify API, a framework-free in-page guest, a Vue sidebar, a PDF viewer, a browser extension and a Nuxt management site, in one pnpm/TypeScript workspace (`@anncur/*`). `README.md` has the package table and the full script list; `docs/adr/` records why things are the way they are — read the relevant ADR before changing a design, and write a new one first if a change overturns or adds a design decision.

## Commands

Node 24+, pnpm 11, podman compose (this machine has podman, not docker).

```bash
pnpm install
podman compose up -d --wait          # Postgres :5432 + Zitadel :8080, provisions dev users alice/bob
cp .env.example .env                 # sets DATABASE_URL; documents every env var
pnpm --filter @anncur/api migrate
just dev                             # API, sidebar, PDF viewer and site on one origin (:3001)
```

- `pnpm check` — everything CI's main job runs: typecheck, lint, prettier, tests, license check, OpenAPI lint, generated-client drift check.
- `pnpm test` — vitest across the workspace (projects: `node`, plus `apps/sidebar` and `apps/web` with happy-dom).
- Single test file: `pnpm vitest run apps/api/src/routes/search.test.ts`; single test: add `-t "name"`. Single project: `pnpm vitest run --project node`.
- Server suites (`apps/api/src/**/*.test.ts` using `src/test/harness.ts`) need `DATABASE_URL`; each creates and drops a scratch database. **Without `DATABASE_URL` they skip silently** — a green run without it does not cover the server.
- `pnpm build` (`tsc -b`) — workspace packages are consumed through their `dist/`, so rebuild after changing `packages/*` before running dependents outside vitest.
- Browser suites (Playwright, separate from `pnpm check`): `pnpm --filter @anncur/guest test:browser`, `pnpm --filter @anncur/guest trial` (anchoring corpus), `pnpm --filter @anncur/extension test:browser`, `pnpm --filter @anncur/sidebar e2e` / `e2e:guest`, `pnpm --filter @anncur/web e2e`. Set `E2E_AUTH=embedded` to run without Zitadel.
- Without Zitadel: `AUTH_MODE=embedded` (plus `AUTH_SECRET`, `PUBLIC_URL`), then `pnpm --filter @anncur/api account create --login you@example.org --admin` (ADR 0028).

## Architecture

**The OpenAPI document is the contract.** `apps/api/openapi.yaml` is hand-written; the server binds routes to it with `fastify-openapi-glue`, mapping each `operationId` to a handler (`apps/api/src/routes/index.ts` merges the per-area handler maps). Adding an endpoint means: edit `openapi.yaml`, add the handler under that `operationId`, run `pnpm api-client:generate` to regenerate `packages/api-client/src/schema.ts` (CI fails on drift), and cover it in the contract test. Ajv runs with `removeAdditional: false` / `coerceTypes: false` so unknown JSON-LD properties round-trip (ADR 0011).

**Postgres is the only store** (ADR 0004). Migrations are plain SQL in `apps/api/migrations/NNNN_*.sql`, applied in order; Kysely types live in `apps/api/src/db/schema.ts`. Per-annotation ACLs are enforced in SQL, not in application code (ADR 0006) — search and reads must go through the ACL-filtered queries. The event stream is SSE over `LISTEN/NOTIFY`. Requests without a token act as the `public` principal (read-only).

**Auth** is either an external OIDC issuer (Zitadel in dev, `deploy/zitadel/`) or the API acting as its own issuer (`AUTH_MODE=embedded`, `apps/api/src/auth/embedded/`). Dev servers and e2e tests fall back to `deploy/zitadel/.bootstrap/oidc.env` for the client id. Service accounts use access tokens (ADR 0038).

**Guest/sidebar split** (ADR 0007, `docs/guest-sidebar-rpc.md`). `packages/guest` runs inside the host page (framework-free, one per frame, the host frame relays the others), anchors annotations on the text model and draws highlights with the CSS Custom Highlight API. The sidebar (`apps/sidebar`) is a separate-origin iframe that talks to the API and to the guest over postMessage RPC whose message types live in `packages/model/src/rpc`. The bookmarklet, the PDF viewer and the extension are just different ways to load the guest.

**Text model** (`docs/text-model.md`, `packages/model/src/text-model`, fixtures in `packages/model/fixtures`): offsets are code points over normalized text (ADR 0012, 0013). This and the OpenAPI document are versioned contracts with outside implementers — breaking changes need a major version bump and changelog note.

**Structured bodies and suggestions.** Annotation bodies follow body profiles (`docs/body-profiles.md`, `packages/model/src/profiles`) — the ClinGen-style case kinds (individual, variant, phenotypes, family, testing, disease). `packages/extract` turns article text into suggested bodies via an OpenAI-compatible endpoint; both the sidebar and `apps/suggester` (a CLI posting suggestion batches for a group to review, ADR 0037) use it. The `.claude/skills/anncur-suggest` skill produces the same batches by hand.

**Serving.** In production one container serves the API and the static clients (ADR 0015, 0021); the Helm chart is in `deploy/helm/anncur`.

## Conventions (from CONTRIBUTING.md)

- Branches `feat/<slug>`; one logical change per commit; imperative subject under 72 chars; generated output (lockfile, `packages/api-client/src/schema.ts`, bundles) in its own commit after the hand-edited code.
- Server changes come with contract or ACL tests; anchoring changes with cases in the guest trial corpus (`packages/guest/trial`); text-model changes with fixture vectors.
- New dependencies must have a license on the allowed list in `docs/third-party-notices.md` (`pnpm licenses:check`); copied code keeps its notice and is listed there.
