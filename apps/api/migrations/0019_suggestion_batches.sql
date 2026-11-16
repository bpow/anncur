-- Suggested annotations waiting for review (ADR 0037). A batch belongs to a
-- group and a document; its items are draft annotations, not annotations,
-- so nothing that reads annotations has to skip them.

create table suggestion_batches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (principal_id) on delete cascade,
  -- Documents are only deleted when merged into another; the merge moves batches first.
  document_id uuid not null references documents (id) on delete cascade,
  engine_name text not null,
  engine_version text not null,
  engine_nickname text,
  -- A later batch with the same group, document, engine and key replaces this one's pending items.
  rerun_key text,
  created_by uuid not null references users (principal_id) on delete restrict,
  created_at timestamptz not null default now()
);

create index suggestion_batches_group_idx on suggestion_batches (group_id, document_id, created_at desc);
create index suggestion_batches_rerun_idx on suggestion_batches (group_id, document_id, engine_name, rerun_key)
  where rerun_key is not null;

create table suggestion_items (
  batch_id uuid not null references suggestion_batches (id) on delete cascade,
  -- '_:i1': what links between items of the batch name.
  local_id text not null,
  position integer not null,
  selector jsonb not null,
  -- One StructuredBody, as the engine sent it.
  body jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  -- The annotation an accepted item became, or stands for.
  annotation_id uuid references annotations (id) on delete set null,
  decided_by uuid references users (principal_id) on delete set null,
  decided_at timestamptz,
  primary key (batch_id, local_id)
);
