-- Dental clinic plugin: its own tables (plg_dental_*). Moved out of the core baseline in W9 (ADR-032), unchanged.
-- Sensitive health data is stored encrypted (columns ending in _enc, app-side AES-GCM). The migrator adds row level
-- security (tenant_isolation) to every plg_dental_ table after this file runs.

create table plg_dental_medical_history (
  tenant_id uuid not null references tenant (id),
  customer_id uuid not null,
  data_enc text not null,
  alerts_enc text,
  has_alerts boolean not null default false,
  reviewed_at timestamptz,
  review_due_at timestamptz,
  source_submission_id uuid,
  updated_by text,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, customer_id),
  foreign key (tenant_id, customer_id) references customer (tenant_id, id) on delete cascade
);

create table plg_dental_insurance (
  tenant_id uuid not null references tenant (id),
  id uuid not null default uuidv7(),
  customer_id uuid not null,
  carrier text not null,
  member_id_enc text,
  group_number text,
  subscriber_name text,
  subscriber_relationship text,
  is_primary boolean not null default true,
  valid_to date,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references customer (tenant_id, id) on delete cascade
);

create table plg_dental_procedure (
  tenant_id uuid not null references tenant (id),
  id uuid not null default uuidv7(),
  code text,
  name text not null,
  category text,
  default_price_minor bigint,
  currency char(3),
  service_id uuid,
  active boolean not null default true,
  sort int not null default 0,
  version int not null default 1,
  primary key (tenant_id, id)
);

create table plg_dental_treatment_plan (
  tenant_id uuid not null references tenant (id),
  id uuid not null default uuidv7(),
  customer_id uuid not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'proposed', 'accepted', 'in_progress', 'completed', 'cancelled')),
  currency char(3),
  estimate_minor bigint not null default 0,
  insurance_estimate_minor bigint not null default 0,
  notes_enc text,
  accepted_at timestamptz,
  acceptance_file_id uuid,
  series_id uuid,
  created_by text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references customer (tenant_id, id)
);
create index plg_dental_plan_customer_idx on plg_dental_treatment_plan (tenant_id, customer_id);

create table plg_dental_plan_item (
  tenant_id uuid not null references tenant (id),
  id uuid not null default uuidv7(),
  plan_id uuid not null,
  seq int not null,
  service_id uuid,
  procedure_id uuid,
  tooth text,
  surfaces text[] not null default '{}',
  min_gap_days int not null default 0,
  max_gap_days int,
  price_minor bigint not null default 0,
  booking_id uuid,
  status text not null default 'planned' check (status in ('planned', 'booked', 'done', 'cancelled')),
  primary key (tenant_id, id),
  foreign key (tenant_id, plan_id) references plg_dental_treatment_plan (tenant_id, id) on delete cascade
);

create table plg_dental_chart_entry (
  tenant_id uuid not null references tenant (id),
  id uuid not null default uuidv7(),
  customer_id uuid not null,
  tooth text not null,
  surfaces text[] not null default '{}',
  kind text not null check (kind in ('condition', 'existing', 'planned', 'completed')),
  condition text,
  procedure_id uuid,
  plan_item_id uuid,
  notes_enc text,
  status text not null default 'active' check (status in ('active', 'resolved', 'void')),
  recorded_by text,
  recorded_at timestamptz not null default now(),
  version int not null default 1,
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references customer (tenant_id, id) on delete cascade
);
create index plg_dental_chart_customer_idx on plg_dental_chart_entry (tenant_id, customer_id, tooth);

create table plg_dental_recall_rule (
  tenant_id uuid not null references tenant (id),
  id uuid not null default uuidv7(),
  name text not null,
  service_id uuid not null,
  interval_months int not null check (interval_months between 1 and 60),
  lead_days int not null default 14,
  active boolean not null default true,
  version int not null default 1,
  primary key (tenant_id, id)
);

create table plg_dental_recall (
  tenant_id uuid not null references tenant (id),
  customer_id uuid not null,
  rule_id uuid not null,
  due_on date not null,
  last_visit_at timestamptz,
  status text not null default 'due' check (status in ('upcoming', 'due', 'reminded', 'scheduled', 'snoozed', 'done')),
  booking_id uuid,
  last_reminded_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, customer_id, rule_id),
  foreign key (tenant_id, customer_id) references customer (tenant_id, id) on delete cascade,
  foreign key (tenant_id, rule_id) references plg_dental_recall_rule (tenant_id, id) on delete cascade
);
create index plg_dental_recall_due_idx on plg_dental_recall (tenant_id, status, due_on);

create trigger plg_dental_medical_history_set_updated_at before update on plg_dental_medical_history for each row execute function set_updated_at();
create trigger plg_dental_insurance_set_updated_at before update on plg_dental_insurance for each row execute function set_updated_at();
create trigger plg_dental_treatment_plan_set_updated_at before update on plg_dental_treatment_plan for each row execute function set_updated_at();
create trigger plg_dental_recall_set_updated_at before update on plg_dental_recall for each row execute function set_updated_at();
