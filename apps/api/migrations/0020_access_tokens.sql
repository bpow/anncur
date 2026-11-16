-- Access tokens the API issues, service accounts, and the suggester group
-- role (ADR 0038).

-- A service account cannot sign in and cannot be an administrator.
alter table users add column is_service boolean not null default false;
alter table users add constraint users_service_not_admin check (not (is_service and is_admin));

-- A suggester posts suggestion batches for the group without being a member of it.
alter table group_memberships drop constraint group_memberships_role_check;
alter table group_memberships
  add constraint group_memberships_role_check check (role in ('member', 'admin', 'suggester'));

create table access_tokens (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references users (principal_id) on delete cascade,
  name text not null,
  scopes text[] not null,
  -- SHA-256 of the secret, in hex. The secret has 256 bits, so no slow hash is needed.
  secret_hash text not null,
  created_by uuid references users (principal_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index access_tokens_principal_idx on access_tokens (principal_id, created_at desc);
