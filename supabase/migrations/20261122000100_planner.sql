alter table public.projects
  add column content_type text not null default 'Video',
  add column production_stage_id uuid,
  add column priority integer not null default 2 check (priority between 1 and 3),
  add column status text not null default 'active' check (status in ('planned','active','published','paused')),
  add column target_publication_date date,
  add column actual_publication_date date,
  add column notes text not null default '',
  add column script text not null default '',
  add column updated_at timestamptz;
update public.projects set updated_at = created_at;
alter table public.projects alter column updated_at set default now(), alter column updated_at set not null;
alter table public.projects add foreign key (user_id,id,production_stage_id)
  references public.production_stages (user_id,project_id,id) on delete set null (production_stage_id);

alter table public.tasks
  add column description text not null default '',
  add column estimated_minutes integer check (estimated_minutes between 1 and 1440),
  add column due_date date,
  add column updated_at timestamptz;
update public.tasks set updated_at = created_at;
alter table public.tasks alter column updated_at set default now(), alter column updated_at set not null;

alter table public.work_sessions
  alter column project_id drop not null,
  add column ended_at timestamptz check (ended_at > started_at),
  add column entry_method text not null default 'manual' check (entry_method in ('timer','manual')),
  add column notes text not null default '',
  add column updated_at timestamptz,
  add foreign key (user_id) references public.profiles on delete cascade,
  add check (task_id is null or project_id is not null);
update public.work_sessions set ended_at = started_at + minutes * interval '1 minute', updated_at = created_at;
alter table public.work_sessions alter column updated_at set default now(), alter column updated_at set not null;

create function public.studio_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger projects_touch before update on public.projects for each row execute function public.studio_touch();
create trigger tasks_touch before update on public.tasks for each row execute function public.studio_touch();
create trigger sessions_touch before update on public.work_sessions for each row execute function public.studio_touch();

create table public.work_blocks (
  id uuid primary key,
  user_id uuid not null,
  project_id uuid not null,
  task_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  notes text not null default '',
  status text not null default 'planned' check (status in ('planned','completed','cancelled')),
  foreign key (user_id,project_id) references public.projects (user_id,id) on delete cascade,
  foreign key (user_id,project_id,task_id) references public.tasks (user_id,project_id,id) on delete set null (task_id),
  check (isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at)
);
create index work_blocks_owner_start on public.work_blocks (user_id,starts_at);
insert into public.work_blocks (id,user_id,project_id,task_id,starts_at,ends_at,timezone)
  select gen_random_uuid(),t.user_id,t.project_id,t.id,t.scheduled_at,t.scheduled_until,p.timezone
  from public.tasks t join public.profiles p using (user_id)
  where isfinite(t.scheduled_at) and isfinite(t.scheduled_until) and t.scheduled_until > t.scheduled_at;

create table public.planner_templates (
  id uuid primary key,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('project','stage','task','quest')),
  name text not null check (length(btrim(name)) between 1 and 160),
  details jsonb not null check (jsonb_typeof(details) = 'object')
);
create table public.planner_starters (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  name text not null,
  details jsonb not null
);
insert into public.planner_starters (kind,name,details) values
 ('project','Video production','{"content_type":"Video","stages":[{"name":"Idea","tasks":[{"title":"Define the angle","skill":"research","minutes":20,"days_before_publish":7}]},{"name":"Script","tasks":[{"title":"Draft the outline","skill":"scriptwriting","minutes":25,"days_before_publish":6},{"title":"Finish the script","skill":"scriptwriting","minutes":45,"days_before_publish":5}]},{"name":"Film","tasks":[{"title":"Record the main footage","skill":"filming","minutes":60,"days_before_publish":4}]},{"name":"Edit","tasks":[{"title":"Build the rough cut","skill":"editing","minutes":60,"days_before_publish":3},{"title":"Review the final cut","skill":"editing","minutes":25,"days_before_publish":1}]},{"name":"Publish","tasks":[{"title":"Prepare title and thumbnail","skill":"production","minutes":30,"days_before_publish":0}]}]}'),
 ('stage','Post-production','{"tasks":[{"title":"Build the rough cut","skill":"editing","minutes":60},{"title":"Review the final cut","skill":"editing","minutes":25}]}'),
 ('task','Capture B-roll','{"skill":"filming","minutes":25}'),
 ('task','Review the rough cut','{"skill":"editing","minutes":25}'),
 ('quest','10-minute editing session','{"skill":"editing","minutes":10}'),
 ('quest','25-minute editing session','{"skill":"editing","minutes":25}'),
 ('quest','Finish the script','{"skill":"scriptwriting","bonus":10}'),
 ('quest','Finish the rough cut','{"skill":"editing","bonus":10}');

create table public.skill_milestones (
  skill_id text not null references public.skills,
  branch text not null,
  title text not null,
  xp integer not null check (xp > 0),
  primary key (skill_id,branch,xp)
);
insert into public.skill_milestones values
 ('editing','Cutting','Build an editing routine',100), ('editing','Cutting','Develop a sustained editing practice',300),
 ('scriptwriting','Story','Build a writing routine',100), ('scriptwriting','Story','Develop a sustained writing practice',300),
 ('filming','Camera','Build a filming routine',100), ('filming','Camera','Develop a sustained filming practice',300),
 ('research','Discovery','Build a research routine',100), ('research','Discovery','Develop a sustained research practice',300),
 ('presentation','Delivery','Build a presentation routine',100), ('presentation','Delivery','Develop a sustained delivery practice',300),
 ('production','Workflow','Build a production routine',100), ('production','Workflow','Develop a sustained production practice',300),
 ('editing','Finishing','Build post-production experience',200), ('scriptwriting','Structure','Build script development experience',200),
 ('filming','Coverage','Build camera practice',200), ('research','Synthesis','Build research experience',200),
 ('presentation','On camera','Build delivery experience',200), ('production','Publishing','Build publishing experience',200);

alter table public.profiles add column planner_seeded boolean not null default false;
alter table public.work_blocks enable row level security;
alter table public.planner_templates enable row level security;
alter table public.planner_starters enable row level security;
alter table public.skill_milestones enable row level security;
revoke all on public.work_blocks,public.planner_templates,public.planner_starters,public.skill_milestones from public,anon,authenticated;
grant select on public.work_blocks,public.planner_templates,public.skill_milestones to authenticated;
create policy owner_blocks on public.work_blocks for select to authenticated using (user_id = (select auth.uid()));
create policy owner_templates on public.planner_templates for select to authenticated using (user_id = (select auth.uid()));
create policy read_milestones on public.skill_milestones for select to authenticated using (true);

create function public.studio_planner_snapshot(p_timezone text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner(p_timezone);
begin
  if not owner.planner_seeded then
    insert into public.planner_templates select gen_random_uuid(),owner.user_id,kind,name,details from public.planner_starters;
    update public.profiles set planner_seeded = true where user_id = owner.user_id;
  end if;
  return public.studio_snapshot() || jsonb_build_object(
    'blocks',(select coalesce(jsonb_agg(b order by starts_at,id),'[]') from public.work_blocks b where user_id = owner.user_id),
    'templates',(select coalesce(jsonb_agg(t order by name,id),'[]') from public.planner_templates t where user_id = owner.user_id),
    'milestones',(select coalesce(jsonb_agg(m order by skill_id,branch,xp),'[]') from public.skill_milestones m)
  );
end $$;

create function public.studio_block(p_id uuid,p_project uuid,p_task uuid,p_start timestamptz,p_end timestamptz,p_timezone text,p_notes text,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'Invalid time zone'; end if;
  insert into public.work_blocks values (p_id,owner.user_id,p_project,p_task,p_start,p_end,p_timezone,p_notes,p_status)
  on conflict (id) do update set project_id = excluded.project_id,task_id = excluded.task_id,
    starts_at = excluded.starts_at,ends_at = excluded.ends_at,timezone = excluded.timezone,notes = excluded.notes,status = excluded.status
  where work_blocks.user_id = owner.user_id;
  if not found then raise exception 'Work block not found'; end if;
end $$;

create function public.studio_template(p_id uuid,p_kind text,p_name text,p_details jsonb,p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if p_delete then
    delete from public.planner_templates where id = p_id and user_id = owner.user_id;
  else
    insert into public.planner_templates values (p_id,owner.user_id,p_kind,btrim(p_name),p_details)
    on conflict (id) do update set kind = excluded.kind,name = excluded.name,details = excluded.details
      where planner_templates.user_id = owner.user_id;
  end if;
  if not found then raise exception 'Template not found'; end if;
end $$;

create function public.studio_apply_template(p_project uuid,p_template uuid,p_stage uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  template public.planner_templates;
  stage jsonb;
  item jsonb;
  target_stage uuid;
  stages jsonb;
  publication date;
begin
  select * into strict template from public.planner_templates where id = p_template and user_id = owner.user_id;
  if not exists (select 1 from public.projects where id = p_project and user_id = owner.user_id and not archived) then
    raise exception 'Choose an active project';
  end if;
  select target_publication_date into publication from public.projects where id = p_project;
  if template.kind = 'quest' then raise exception 'Choose a production template'; end if;
  stages := case template.kind
    when 'project' then template.details->'stages'
    when 'stage' then jsonb_build_array(jsonb_build_object('name',template.name,'tasks',template.details->'tasks'))
    else jsonb_build_array(jsonb_build_object('tasks',jsonb_build_array(template.details || jsonb_build_object('title',template.name))))
  end;
  for stage in select value from jsonb_array_elements(stages) loop
    target_stage := p_stage;
    if stage ? 'name' then
      insert into public.production_stages (user_id,project_id,name,position)
      select owner.user_id,p_project,stage->>'name',coalesce(max(position)+1,0) from public.production_stages
        where user_id = owner.user_id and project_id = p_project returning id into target_stage;
      update public.projects set production_stage_id = target_stage where id = p_project and production_stage_id is null;
    end if;
    for item in select value from jsonb_array_elements(stage->'tasks') loop
      insert into public.tasks (user_id,project_id,stage_id,title,skill_id,estimated_minutes,due_date,bonus,position)
      select owner.user_id,p_project,target_stage,item->>'title',item->>'skill',(item->>'minutes')::integer, publication - (item->>'days_before_publish')::integer,
        owner.default_task_xp,coalesce(max(position)+1,0) from public.tasks where user_id = owner.user_id and project_id = p_project;
    end loop;
  end loop;
end $$;

create function public.studio_project_plan(p_id uuid,p_name text,p_description text,p_archived boolean,p_meta jsonb,p_template uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  is_new boolean := not exists (select 1 from public.projects where id = p_id and user_id = owner.user_id);
begin
  perform public.studio_project(p_id,p_name,p_description,p_archived);
  update public.projects set content_type = p_meta->>'type',production_stage_id = (p_meta->>'stage')::uuid,
    priority = (p_meta->>'priority')::integer,status = p_meta->>'status',
    target_publication_date = (p_meta->>'target')::date,actual_publication_date = (p_meta->>'actual')::date,
    notes = p_meta->>'notes',script = p_meta->>'script' where id = p_id and user_id = owner.user_id;
  if is_new and p_template is not null then perform public.studio_apply_template(p_id,p_template); end if;
end $$;

create function public.studio_task_plan(p_id uuid,p_project uuid,p_title text,p_skill text,p_status text,p_priority integer,p_bonus integer,p_meta jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  parent uuid := (p_meta->>'parent')::uuid;
  is_new boolean := not exists (select 1 from public.tasks where id = p_id and user_id = owner.user_id);
begin
  if exists (
    with recursive ancestors as (
      select id,parent_id from public.tasks where user_id = owner.user_id and project_id = p_project and id = parent
      union
      select t.id,t.parent_id from public.tasks t join ancestors a on t.id = a.parent_id
        where t.user_id = owner.user_id and t.project_id = p_project
    ) select 1 from ancestors where id = p_id
  ) or parent = p_id then raise exception 'A task cannot be its own ancestor'; end if;
  perform public.studio_task(p_id,p_project,p_title,p_skill,p_status,p_priority,p_bonus);
  update public.tasks set parent_id = parent,stage_id = (p_meta->>'stage')::uuid,description = p_meta->>'description',
    due_date = (p_meta->>'due')::date,estimated_minutes = (p_meta->>'minutes')::integer,
    position = case when is_new then (select coalesce(max(t.position),-1)+1 from public.tasks t
      where t.user_id = owner.user_id and t.project_id = p_project and t.id <> p_id) else position end
    where id = p_id and user_id = owner.user_id;
end $$;

create function public.studio_order_tasks(p_project uuid,p_parent uuid,p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if cardinality(p_ids) <> (select count(*) from public.tasks where user_id = owner.user_id and project_id = p_project and parent_id is not distinct from p_parent)
    or cardinality(p_ids) <> (select count(*) from public.tasks where user_id = owner.user_id and project_id = p_project
      and parent_id is not distinct from p_parent and id = any(p_ids))
  then raise exception 'Task list changed. Refresh and try again'; end if;
  update public.tasks t set position = ordering.ordinal - 1
    from unnest(p_ids) with ordinality as ordering(id,ordinal)
    where t.id = ordering.id and t.user_id = owner.user_id and t.project_id = p_project;
end $$;

create or replace function public.studio_session(p_id uuid, p_project uuid, p_task uuid, p_skill text,
  p_started timestamptz, p_minutes integer, p_delete boolean default false, p_preview boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  session_zone text;
  session_day date;
  award integer;
begin
  if p_delete then
    delete from public.work_sessions where id = p_id and user_id = owner.user_id;
    if not found then raise exception 'Session not found'; end if;
    perform public.studio_reconcile(owner);
    return 0;
  end if;

  if p_minutes is null or p_minutes not between 1 and 1440 or p_started is null or not isfinite(p_started) then
    raise exception 'Enter a valid start time and 1 to 1440 minutes';
  end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project and user_id = owner.user_id) then
    raise exception 'Project not found';
  end if;
  if p_task is not null and not exists (select 1 from public.tasks where id = p_task and project_id = p_project and user_id = owner.user_id) then
    raise exception 'Choose a task from the selected project';
  end if;

  select timezone into session_zone from public.work_sessions where id = p_id and user_id = owner.user_id;
  session_zone := coalesce(session_zone, owner.timezone);
  session_day := (p_started at time zone session_zone)::date;
  if p_preview then
    select greatest(0, least(p_minutes * owner.xp_per_minute, owner.daily_cap - coalesce(sum(minutes * owner.xp_per_minute),0)))::integer
      into award from public.work_sessions
      where user_id = owner.user_id and local_day = session_day and id <> p_id and (started_at,id) < (p_started,p_id);
    return award;
  end if;

  insert into public.work_sessions (id,user_id,project_id,task_id,skill_id,started_at,minutes,timezone,local_day)
  values (p_id,owner.user_id,p_project,p_task,p_skill,p_started,p_minutes,session_zone,session_day)
  on conflict (id) do update set project_id = excluded.project_id, task_id = excluded.task_id,
    skill_id = excluded.skill_id, started_at = excluded.started_at, minutes = excluded.minutes, ended_at = excluded.started_at + excluded.minutes * interval '1 minute',
    timezone = excluded.timezone, local_day = excluded.local_day
  where work_sessions.user_id = owner.user_id;
  if not found then raise exception 'Session not found'; end if;
  perform public.studio_reconcile(owner);
  return coalesce((select xp from public.xp_transactions where user_id = owner.user_id and source_type = 'session' and source_id = p_id),0);
end $$;

create function public.studio_log_session(p_id uuid,p_project uuid,p_task uuid,p_skill text,p_started timestamptz,p_minutes integer,
  p_method text,p_notes text,p_ended timestamptz default null,p_preview boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  award integer;
begin
  award := public.studio_session(p_id,p_project,p_task,p_skill,p_started,p_minutes,false,p_preview);
  if not p_preview then
    update public.work_sessions set entry_method = p_method, notes = p_notes,
      ended_at = coalesce(p_ended,p_started + p_minutes * interval '1 minute')
      where user_id = owner.user_id and id = p_id;
  end if;
  return award;
end $$;

revoke execute on function public.studio_touch(),public.studio_planner_snapshot(text),
 public.studio_block(uuid,uuid,uuid,timestamptz,timestamptz,text,text,text),
 public.studio_template(uuid,text,text,jsonb,boolean),public.studio_apply_template(uuid,uuid,uuid),
 public.studio_project_plan(uuid,text,text,boolean,jsonb,uuid),public.studio_task_plan(uuid,uuid,text,text,text,integer,integer,jsonb),
 public.studio_order_tasks(uuid,uuid,uuid[]),public.studio_log_session(uuid,uuid,uuid,text,timestamptz,integer,text,text,timestamptz,boolean)
 from public,anon,authenticated;
grant execute on function public.studio_planner_snapshot(text),
 public.studio_block(uuid,uuid,uuid,timestamptz,timestamptz,text,text,text),
 public.studio_template(uuid,text,text,jsonb,boolean),public.studio_apply_template(uuid,uuid,uuid),
 public.studio_project_plan(uuid,text,text,boolean,jsonb,uuid),public.studio_task_plan(uuid,uuid,text,text,text,integer,integer,jsonb),
 public.studio_order_tasks(uuid,uuid,uuid[]),public.studio_log_session(uuid,uuid,uuid,text,timestamptz,integer,text,text,timestamptz,boolean)
 to authenticated;

create function public.studio_quest_complete(p_project uuid,p_template uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  quest public.planner_templates;
  matched public.tasks;
begin
  select * into strict quest from public.planner_templates where id = p_template and user_id = owner.user_id and kind = 'quest';
  if quest.details ? 'minutes' then raise exception 'Start this quest with the timer'; end if;
  if not exists (select 1 from public.projects where id = p_project and user_id = owner.user_id and not archived) then
    raise exception 'Choose an active project';
  end if;
  select * into matched from public.tasks where user_id = owner.user_id and project_id = p_project
    and lower(title) = lower(quest.name) and skill_id = quest.details->>'skill'
    order by position,created_at,id limit 1;
  perform public.studio_task(coalesce(matched.id,gen_random_uuid()),p_project,coalesce(matched.title,quest.name),
    quest.details->>'skill','done',coalesce(matched.priority,2),coalesce(matched.bonus,(quest.details->>'bonus')::integer,owner.default_task_xp));
end $$;
revoke execute on function public.studio_quest_complete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_quest_complete(uuid,uuid) to authenticated;
