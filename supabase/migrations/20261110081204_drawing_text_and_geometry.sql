create table if not exists public.drawing_text_blocks (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.analysis_jobs(id) on delete cascade,
 page_number integer not null default 1 check (page_number > 0),
 text_content text not null,
 confidence numeric(5,4) check (confidence between 0 and 1),
 bbox jsonb,
 source text not null default 'ocr',
 language text,
 created_at timestamptz not null default now()
);
create index if not exists drawing_text_blocks_job_page_idx on public.drawing_text_blocks(job_id,page_number);
alter table public.drawing_text_blocks enable row level security;
drop policy if exists "Owners can read extracted drawing text" on public.drawing_text_blocks;
drop policy if exists "Owners can add extracted drawing text" on public.drawing_text_blocks;
create policy "Owners can read extracted drawing text" on public.drawing_text_blocks for select to authenticated using (exists (select 1 from public.analysis_jobs j where j.id=job_id and j.owner_id=(select auth.uid())));
create policy "Owners can add extracted drawing text" on public.drawing_text_blocks for insert to authenticated with check (exists (select 1 from public.analysis_jobs j where j.id=job_id and j.owner_id=(select auth.uid())));
grant select,insert on public.drawing_text_blocks to authenticated;

create table if not exists public.drawing_geometry (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.analysis_jobs(id) on delete cascade,
 page_number integer not null default 1 check (page_number > 0),
 geometry_type text not null,
 geometry jsonb not null,
 layer_name text,
 source text not null default 'vector',
 created_at timestamptz not null default now()
);
create index if not exists drawing_geometry_job_page_idx on public.drawing_geometry(job_id,page_number);
alter table public.drawing_geometry enable row level security;
drop policy if exists "Owners can read extracted drawing geometry" on public.drawing_geometry;
drop policy if exists "Owners can add extracted drawing geometry" on public.drawing_geometry;
create policy "Owners can read extracted drawing geometry" on public.drawing_geometry for select to authenticated using (exists (select 1 from public.analysis_jobs j where j.id=job_id and j.owner_id=(select auth.uid())));
create policy "Owners can add extracted drawing geometry" on public.drawing_geometry for insert to authenticated with check (exists (select 1 from public.analysis_jobs j where j.id=job_id and j.owner_id=(select auth.uid())));
grant select,insert on public.drawing_geometry to authenticated;
