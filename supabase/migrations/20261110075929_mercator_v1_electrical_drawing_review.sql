create extension if not exists pgcrypto;

create table if not exists public.mercator_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mercator_projects_owner_idx on public.mercator_projects(owner_id, created_at desc);
alter table public.mercator_projects enable row level security;
create policy "Owners can manage their Mercator projects" on public.mercator_projects
  for all to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.mercator_projects to authenticated;

create table if not exists public.drawings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.mercator_projects(id) on delete set null,
  file_name text not null,
  file_type text not null,
  mime_type text,
  file_size bigint not null default 0 check (file_size >= 0),
  storage_bucket text not null default 'mercator-drawings',
  storage_path text not null,
  revision_label text,
  status text not null default 'uploaded' check (status in ('uploaded','queued','processing','completed','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(storage_bucket, storage_path)
);
create index if not exists drawings_owner_created_idx on public.drawings(owner_id, created_at desc);
create index if not exists drawings_project_idx on public.drawings(project_id);
alter table public.drawings enable row level security;
create policy "Owners can manage their drawings" on public.drawings
  for all to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.drawings to authenticated;

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','preprocessing','recognizing','validating','completed','failed','cancelled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  engine_version text,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists analysis_jobs_owner_created_idx on public.analysis_jobs(owner_id, created_at desc);
create index if not exists analysis_jobs_drawing_idx on public.analysis_jobs(drawing_id);
alter table public.analysis_jobs enable row level security;
create policy "Owners can manage their analysis jobs" on public.analysis_jobs
  for all to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.analysis_jobs to authenticated;

create table if not exists public.detected_components (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  component_type text not null,
  tag text,
  label text,
  confidence numeric(5,4) check (confidence between 0 and 1),
  page_number integer not null default 1 check (page_number > 0),
  bbox jsonb,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists detected_components_job_idx on public.detected_components(job_id);
alter table public.detected_components enable row level security;
create policy "Owners can read detected components" on public.detected_components
  for select to authenticated using (
    exists (select 1 from public.analysis_jobs j where j.id = job_id and j.owner_id = (select auth.uid()))
  );
create policy "Owners can add detected components" on public.detected_components
  for insert to authenticated with check (
    exists (select 1 from public.analysis_jobs j where j.id = job_id and j.owner_id = (select auth.uid()))
  );
grant select, insert on public.detected_components to authenticated;

create table if not exists public.review_findings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  category text not null,
  severity text not null default 'info' check (severity in ('critical','high','medium','low','info')),
  rule_code text,
  title text not null,
  description text,
  recommendation text,
  page_number integer not null default 1 check (page_number > 0),
  bbox jsonb,
  evidence jsonb not null default '{}'::jsonb,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','confirmed','false_positive','resolved')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists review_findings_job_idx on public.review_findings(job_id, severity);
alter table public.review_findings enable row level security;
create policy "Owners can manage review findings" on public.review_findings
  for all to authenticated using (
    exists (select 1 from public.analysis_jobs j where j.id = job_id and j.owner_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.analysis_jobs j where j.id = job_id and j.owner_id = (select auth.uid()))
  );
grant select, insert, update, delete on public.review_findings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mercator-drawings','mercator-drawings',false,52428800,
  array['application/pdf','image/png','image/jpeg','image/webp','image/tiff','application/acad','application/dxf','application/octet-stream','text/plain']
)
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "Users can read their Mercator drawing files" on storage.objects
  for select to authenticated using (
    bucket_id='mercator-drawings' and (storage.foldername(name))[1]=(select auth.uid())::text
  );
create policy "Users can upload their Mercator drawing files" on storage.objects
  for insert to authenticated with check (
    bucket_id='mercator-drawings' and (storage.foldername(name))[1]=(select auth.uid())::text
  );
create policy "Users can update their Mercator drawing files" on storage.objects
  for update to authenticated using (
    bucket_id='mercator-drawings' and (storage.foldername(name))[1]=(select auth.uid())::text
  ) with check (
    bucket_id='mercator-drawings' and (storage.foldername(name))[1]=(select auth.uid())::text
  );
create policy "Users can delete their Mercator drawing files" on storage.objects
  for delete to authenticated using (
    bucket_id='mercator-drawings' and (storage.foldername(name))[1]=(select auth.uid())::text
  );
