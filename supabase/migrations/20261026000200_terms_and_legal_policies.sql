-- AeroValet & Parking Hub — Increment 3 / Phase 2: Terms and Legal Policies Versioning
-- Incremental migration applied on top of 20261026000100_pricing_rules_and_extras.sql

-- 1. Create Enums for Legal Documents
do $$ begin
  if not exists (select 1 from pg_type where typname = 'legal_document_scope') then
    create type public.legal_document_scope as enum ('platform', 'operator');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'legal_document_type') then
    create type public.legal_document_type as enum (
      'platform_terms',       -- Términos y Condiciones Generales de Uso de AeroValet
      'privacy_policy',       -- Política de Privacidad y Protección de Datos
      'operator_terms',       -- Condiciones Generales de Contratación del Operador
      'cancellation_policy'   -- Política Específica de Cancelación y Reembolso
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'legal_document_status') then
    create type public.legal_document_status as enum ('draft', 'published', 'archived');
  end if;
end $$;

-- 2. Table: legal_documents
-- Published documents are immutable. Revisions generate a new version record.
create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  scope public.legal_document_scope not null,
  operator_id uuid references public.operators(id) on delete cascade,
  document_type public.legal_document_type not null,
  version text not null check (version ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
  language char(2) not null default 'es',
  title text not null check (length(trim(title)) > 0),
  content_markdown text not null check (length(trim(content_markdown)) > 0),
  sha256_hash char(64) not null check (sha256_hash ~ '^[a-f0-9]{64}$'),
  status public.legal_document_status not null default 'draft',
  effective_from timestamptz,
  effective_until timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint legal_documents_operator_scope_chk check (
    (scope = 'platform' and operator_id is null) or
    (scope = 'operator' and operator_id is not null)
  )
);

create unique index if not exists legal_documents_version_uidx
  on public.legal_documents(
    scope,
    coalesce(operator_id, '00000000-0000-0000-0000-000000000000'::uuid),
    document_type,
    version,
    language
  );

create index if not exists legal_documents_lookup_idx
  on public.legal_documents(scope, document_type, status, language);

-- 3. Table: cancellation_policy_rules
create table if not exists public.cancellation_policy_rules (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  legal_document_id uuid not null references public.legal_documents(id) on delete restrict,
  free_cancellation_window_hours integer not null default 24 check (free_cancellation_window_hours >= 0),
  late_cancellation_fee_bps integer not null default 5000 check (late_cancellation_fee_bps between 0 and 10000),
  no_show_fee_bps integer not null default 10000 check (no_show_fee_bps between 0 and 10000),
  allow_modifications boolean not null default true,
  modification_window_hours integer not null default 2 check (modification_window_hours >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists cancellation_policy_rules_operator_idx
  on public.cancellation_policy_rules(operator_id, active);

-- 4. Table: booking_terms_snapshots
-- Captures the exact version and SHA-256 hash of documents applicable to a hold
create table if not exists public.booking_terms_snapshots (
  hold_id uuid primary key references public.booking_holds(id) on delete cascade,
  platform_terms_id uuid not null references public.legal_documents(id) on delete restrict,
  platform_terms_version text not null,
  platform_terms_hash char(64) not null,
  privacy_policy_id uuid not null references public.legal_documents(id) on delete restrict,
  privacy_policy_version text not null,
  privacy_policy_hash char(64) not null,
  operator_terms_id uuid references public.legal_documents(id) on delete restrict,
  operator_terms_version text,
  operator_terms_hash char(64),
  cancellation_policy_rule_id uuid references public.cancellation_policy_rules(id) on delete restrict,
  cancellation_policy_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

-- 5. Table: booking_acceptances
-- Cryptographic audit trail of explicit consumer acceptance
create table if not exists public.booking_acceptances (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references public.booking_holds(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete restrict,
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  document_version text not null,
  document_hash char(64) not null,
  accepted_at timestamptz not null default now(),
  ip_address_hash char(64),
  user_agent_summary text,
  created_at timestamptz not null default now()
);

create index if not exists booking_acceptances_hold_idx
  on public.booking_acceptances(hold_id);

-- 6. Enable RLS
alter table public.legal_documents enable row level security;
alter table public.cancellation_policy_rules enable row level security;
alter table public.booking_terms_snapshots enable row level security;
alter table public.booking_acceptances enable row level security;

-- Read policies: Published documents are publicly readable
create policy "Anyone can read published legal documents"
  on public.legal_documents for select
  using (status = 'published');

create policy "Anyone can read active cancellation policies"
  on public.cancellation_policy_rules for select
  using (active = true);

create policy "Users can read their own acceptances"
  on public.booking_acceptances for select
  using (
    customer_id = auth.uid() or
    exists (
      select 1 from public.booking_holds h
      where h.id = booking_acceptances.hold_id and (h.customer_id = auth.uid() or h.customer_id is null)
    )
  );

-- 7. RPC: record_booking_acceptances
-- Atomically registers explicit consent for the documents snapshot
create or replace function public.record_booking_acceptances(
  p_hold_id uuid,
  p_acceptances jsonb, -- Array of { document_id, version, hash }
  p_ip_address_hash text default null,
  p_user_agent_summary text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_doc public.legal_documents%rowtype;
  v_inserted_count integer := 0;
  v_hold public.booking_holds%rowtype;
begin
  select * into v_hold
  from public.booking_holds
  where id = p_hold_id and status = 'active';

  if not found then
    raise exception 'HOLD_NOT_FOUND_OR_EXPIRED' using errcode = 'P0002';
  end if;

  if p_acceptances is null or jsonb_array_length(p_acceptances) = 0 then
    raise exception 'NO_ACCEPTANCES_PROVIDED' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_acceptances)
  loop
    select * into v_doc
    from public.legal_documents
    where id = (v_item->>'document_id')::uuid
      and version = (v_item->>'version')
      and sha256_hash = (v_item->>'hash')
      and status = 'published';

    if not found then
      raise exception 'DOCUMENT_VERSION_OR_HASH_MISMATCH' using errcode = '22023';
    end if;

    insert into public.booking_acceptances (
      hold_id, customer_id, document_id, document_version, document_hash,
      ip_address_hash, user_agent_summary
    ) values (
      p_hold_id, v_hold.customer_id, v_doc.id, v_doc.version, v_doc.sha256_hash,
      p_ip_address_hash, p_user_agent_summary
    );

    v_inserted_count := v_inserted_count + 1;
  end loop;

  return v_inserted_count;
end;
$$;

grant execute on function public.record_booking_acceptances(uuid, jsonb, text, text) to anon, authenticated, service_role;
