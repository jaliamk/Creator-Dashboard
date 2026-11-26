-- Normalize older phase names without rewriting saved templates or deleting tasks.
create function public.studio_stage_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when lower(coalesce(p_name,'')) ~ 'publish|thumbnail|metadata|upload' then 'preparing'
    when lower(p_name) ~ 'edit|post-production' then 'editing'
    when lower(p_name) ~ 'film|rehears|test run|record' then 'filming'
    when lower(p_name) ~ 'script|writ' then 'scriptwriting'
    else 'ideation'
  end
$$;

alter table public.projects add column workflow_stage text not null default 'ideation'
  check (workflow_stage in ('ideation','scriptwriting','filming','editing','preparing','published'));
alter table public.projects disable trigger projects_touch;
update public.projects p set workflow_stage = case
  when p.status='published' or p.actual_publication_date is not null then 'published'
  else public.studio_stage_key((select s.name from public.production_stages s where s.id=p.production_stage_id)) end;
update public.tasks set status='doing' where status='blocked';
alter table public.projects enable trigger projects_touch;
do $$
declare constraint_name text;
begin
  select conname into strict constraint_name from pg_catalog.pg_constraint
  where conrelid='public.tasks'::regclass and contype='c' and pg_get_constraintdef(oid) like '%blocked%';
  execute format('alter table public.tasks drop constraint %I',constraint_name);
end $$;
alter table public.tasks add constraint tasks_workflow_status_check check(status in ('todo','doing','done'));

create table public.publications (
  source_project_id uuid primary key,
  user_id uuid not null references public.profiles on delete cascade,
  title text not null,
  format text not null check (format in ('long','short')),
  published_on date not null
);
alter table public.publications enable row level security;
revoke all on public.publications from public,anon,authenticated;
grant select on public.publications to authenticated;
create policy owner_publications on public.publications for select to authenticated using (user_id = (select auth.uid()));

create function public.studio_record_publication() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workflow_stage='published' or new.status='published' or new.actual_publication_date is not null then
    insert into public.publications(source_project_id,user_id,title,format,published_on)
      select new.id,new.user_id,new.name,
        case when lower(new.content_type) ~ 'short|clip|reel|tiktok' then 'short' else 'long' end,
        coalesce(new.actual_publication_date,(now() at time zone p.timezone)::date)
      from public.profiles p where p.user_id=new.user_id
      on conflict (source_project_id) do update set title=excluded.title,format=excluded.format,
        published_on=coalesce(new.actual_publication_date,publications.published_on);
  end if;
  return new;
end $$;
create trigger record_publication after insert or update of workflow_stage,status,actual_publication_date,content_type,name
  on public.projects for each row execute function public.studio_record_publication();
-- Use the project's historical update date where older records have no explicit publication date.
insert into public.publications
select p.id,p.user_id,p.name,case when lower(p.content_type) ~ 'short|clip|reel|tiktok' then 'short' else 'long' end,
  coalesce(p.actual_publication_date,(p.updated_at at time zone u.timezone)::date)
from public.projects p join public.profiles u on u.user_id=p.user_id where p.workflow_stage='published';

create table public.task_calendar_days (
  user_id uuid not null,
  project_id uuid not null,
  task_id uuid not null,
  day date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  primary key(task_id,day),
  foreign key (user_id,project_id,task_id) references public.tasks(user_id,project_id,id) on delete cascade,
  check ((starts_at is null and ends_at is null and timezone is null) or
    (starts_at is not null and ends_at is not null and timezone is not null and ends_at > starts_at))
);
create index task_calendar_days_owner_day on public.task_calendar_days(user_id,day);
alter table public.task_calendar_days enable row level security;
revoke all on public.task_calendar_days from public,anon,authenticated;
grant select on public.task_calendar_days to authenticated;
create policy owner_calendar_days on public.task_calendar_days for select to authenticated using (user_id = (select auth.uid()));

create function public.studio_sync_task_days() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' and old.planned_start is not distinct from new.planned_start
    and old.planned_end is not distinct from new.planned_end then return new; end if;
  delete from public.task_calendar_days where task_id=new.id and
    (new.planned_start is null or day<new.planned_start or day>new.planned_end);
  if new.planned_start is not null then
    if new.planned_end-new.planned_start > 3660 then raise exception 'A task may span at most about ten years'; end if;
    insert into public.task_calendar_days(user_id,project_id,task_id,day)
      select new.user_id,new.project_id,new.id,new.planned_start+i
      from generate_series(0,new.planned_end-new.planned_start) as series(i)
      on conflict (task_id,day) do nothing;
  end if;
  return new;
end $$;
create trigger sync_task_days after insert or update of planned_start,planned_end
  on public.tasks for each row execute function public.studio_sync_task_days();
insert into public.task_calendar_days(user_id,project_id,task_id,day)
  select t.user_id,t.project_id,t.id,t.planned_start+i from public.tasks t
  cross join lateral generate_series(0,t.planned_end-t.planned_start) as series(i);

create function public.studio_time_task_day(p_task uuid,p_day date,p_start timestamptz,p_end timestamptz,p_timezone text)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if p_start is null and p_end is null then p_timezone:=null;
  elsif p_start is null or p_end is null or p_timezone is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=p_start or (p_start at time zone p_timezone)::date<>p_day
    or ((p_end - interval '1 microsecond') at time zone p_timezone)::date<>p_day then
    raise exception 'Choose times within this calendar day';
  end if;
  update public.task_calendar_days set starts_at=p_start,ends_at=p_end,timezone=p_timezone
    where task_id=p_task and day=p_day and user_id=owner.user_id;
  if not found then raise exception 'This day is no longer on the task timeline'; end if;
end $$;

-- A phase named like its single workflow task follows the phase until independently rescheduled.
create function public.studio_sync_workflow_phase() returns trigger language plpgsql set search_path = '' as $$
begin
  update public.tasks set planned_start=new.planned_start,planned_end=new.planned_end
    where stage_id=new.id and user_id=new.user_id and project_id=new.project_id
    and lower(title)=lower(new.name) and planned_start is not distinct from old.planned_start
    and planned_end is not distinct from old.planned_end;
  return new;
end $$;
create trigger sync_workflow_phase after update of planned_start,planned_end
  on public.production_stages for each row execute function public.studio_sync_workflow_phase();

create function public.studio_move_project(p_id uuid,p_stage text)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  update public.projects p set workflow_stage=p_stage,
    production_stage_id=(select s.id from public.production_stages s where s.user_id=owner.user_id and s.project_id=p_id
      and public.studio_stage_key(s.name)=p_stage order by s.position,s.id limit 1),
    status=case when p_stage='published' then 'published' when p.status='published' then 'active' else p.status end,
    actual_publication_date=case when p_stage='published' then coalesce(p.actual_publication_date,
      (select published_on from public.publications where source_project_id=p.id),(now() at time zone owner.timezone)::date)
      else p.actual_publication_date end
    where p.id=p_id and p.user_id=owner.user_id;
  if not found then raise exception 'Project not found'; end if;
end $$;

create function public.studio_archive_project(p_id uuid,p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  update public.projects set archived=p_archived where id=p_id and user_id=owner.user_id;
  if not found then raise exception 'Project not found'; end if;
end $$;

create function public.studio_delete_project_keep_history(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  perform public.studio_project(p_id,'','',false,true);
end $$;

create function public.studio_journey_snapshot(p_timezone text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare base jsonb:=public.studio_production_snapshot(p_timezone);
begin
  return base || jsonb_build_object(
    'calendar_days',(select coalesce(jsonb_agg(d order by day,task_id),'[]') from public.task_calendar_days d where user_id=auth.uid()),
    'publications',(select coalesce(jsonb_agg(p order by published_on,source_project_id),'[]') from public.publications p where user_id=auth.uid())
  );
end $$;

with starter as (
  insert into public.planner_starters(kind,name,details) values
    ('project','Studio workflow','{"content_type":"Long-form video","stages":[
      {"name":"Ideation","duration_days":1,"tasks":[{"title":"Ideation","skill":"research","bonus":0}]},
      {"name":"Scriptwriting","duration_days":2,"tasks":[{"title":"Scriptwriting","skill":"scriptwriting","bonus":0}]},
      {"name":"Filming","duration_days":1,"tasks":[{"title":"Filming","skill":"filming","bonus":0}]},
      {"name":"Editing","duration_days":3,"tasks":[{"title":"Editing","skill":"editing","bonus":0}]},
      {"name":"Preparing to Publish","duration_days":1,"tasks":[{"title":"Preparing to Publish","skill":"production","bonus":0}]}
    ]}')
  returning kind,name,details
)
insert into public.planner_templates(id,user_id,kind,name,details)
select gen_random_uuid(),p.user_id,s.kind,s.name,s.details from public.profiles p cross join starter s
where p.planner_seeded and not exists (
  select 1 from public.planner_templates t where t.user_id=p.user_id and t.kind=s.kind and t.name=s.name
);

revoke execute on function public.studio_stage_key(text),public.studio_record_publication(),
  public.studio_sync_task_days(),public.studio_sync_workflow_phase(),public.studio_time_task_day(uuid,date,timestamptz,timestamptz,text),
  public.studio_move_project(uuid,text),public.studio_archive_project(uuid,boolean),public.studio_delete_project_keep_history(uuid),
  public.studio_journey_snapshot(text) from public,anon,authenticated;
grant execute on function public.studio_time_task_day(uuid,date,timestamptz,timestamptz,text),
  public.studio_move_project(uuid,text),public.studio_archive_project(uuid,boolean),public.studio_delete_project_keep_history(uuid),
  public.studio_journey_snapshot(text) to authenticated;

create or replace function public.studio_project(p_id uuid, p_name text, p_description text, p_archived boolean, p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if p_delete then
    update public.work_sessions set task_id=null,project_id=null where project_id=p_id and user_id=owner.user_id;
    delete from public.projects where id = p_id and user_id = owner.user_id;
    if not found then raise exception 'Project not found'; end if;
    perform public.studio_reconcile(owner);
  elsif exists (select 1 from public.projects where id = p_id and user_id = owner.user_id) then
    update public.projects set name = btrim(p_name), description = p_description, archived = p_archived
      where id = p_id and user_id = owner.user_id;
  else
    insert into public.projects (id,user_id,name,description,archived)
      values (p_id,owner.user_id,btrim(p_name),p_description,p_archived);
  end if;
end $$;


create function public.studio_edit_workflow_project(p_id uuid,p_name text,p_description text,p_archived boolean,p_meta jsonb,p_start date)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  prior public.projects;
  desired text := p_meta->>'workflow';
begin
  select * into strict prior from public.projects where id=p_id and user_id=owner.user_id;
  if p_meta->>'actual' is not null and prior.actual_publication_date is null and desired=prior.workflow_stage then
    desired := 'published';
  end if;
  perform public.studio_edit_production(p_id,p_name,p_description,p_archived,p_meta,p_start);
  if desired is distinct from prior.workflow_stage or desired='published' then
    perform public.studio_move_project(p_id,desired);
  end if;
end $$;
revoke execute on function public.studio_edit_workflow_project(uuid,text,text,boolean,jsonb,date) from public,anon,authenticated;
grant execute on function public.studio_edit_workflow_project(uuid,text,text,boolean,jsonb,date) to authenticated;

-- An explicit first publication date or a legacy status edit also enters the final stage.
create function public.studio_normalize_publication() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.actual_publication_date is not null and (tg_op='INSERT' or old.actual_publication_date is null))
    or (new.status='published' and (tg_op='INSERT' or old.status<>'published')) then
    new.workflow_stage := 'published';
    new.status := 'published';
  end if;
  return new;
end $$;
create trigger normalize_publication before insert or update of status,actual_publication_date
  on public.projects for each row execute function public.studio_normalize_publication();
revoke execute on function public.studio_normalize_publication() from public,anon,authenticated;
