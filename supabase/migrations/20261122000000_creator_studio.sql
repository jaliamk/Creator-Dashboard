create table public.skills (
  id text primary key,
  name text not null,
  color text not null
);
insert into public.skills values
 ('editing','Editing','#558DE4'), ('scriptwriting','Scriptwriting','#AD78DB'),
 ('filming','Filming','#D79A4C'), ('research','Research','#43A69A'),
 ('presentation','Presentation','#D97792'), ('production','Production','#7184C4');

create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  timezone text not null default 'UTC',
  theme text not null default 'system' check (theme in ('system','light','dark')),
  creator_factor integer not null default 50 check (creator_factor > 0),
  skill_factor integer not null default 100 check (skill_factor > 0),
  daily_cap integer not null default 100 check (daily_cap >= 0),
  xp_per_minute integer not null default 1 check (xp_per_minute between 1 and 100),
  default_task_xp integer not null default 10 check (default_task_xp between 0 and 10000)
);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 4000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id,id)
);
create table public.production_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  name text not null,
  position integer not null default 0,
  unique (user_id,project_id,id),
  foreign key (user_id,project_id) references public.projects (user_id,id) on delete cascade
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  parent_id uuid,
  stage_id uuid,
  title text not null check (length(btrim(title)) between 1 and 160),
  skill_id text not null references public.skills,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  priority integer not null default 2 check (priority between 1 and 3),
  position integer not null default 0,
  scheduled_at timestamptz,
  scheduled_until timestamptz,
  bonus integer not null check (bonus between 0 and 10000),
  completion_id uuid unique,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id,project_id,id),
  foreign key (user_id,project_id) references public.projects (user_id,id) on delete cascade,
  foreign key (user_id,project_id,parent_id) references public.tasks (user_id,project_id,id) on delete cascade,
  foreign key (user_id,project_id,stage_id) references public.production_stages (user_id,project_id,id) on delete set null (stage_id),
  check ((status = 'done') = (completion_id is not null and completed_at is not null))
);
create index tasks_owner_queue on public.tasks (user_id,status,priority,position,created_at);

create table public.work_sessions (
  id uuid primary key,
  user_id uuid not null,
  project_id uuid not null,
  task_id uuid,
  skill_id text not null references public.skills,
  started_at timestamptz not null,
  minutes integer not null check (minutes between 1 and 1440),
  timezone text not null,
  local_day date not null,
  created_at timestamptz not null default now(),
  foreign key (user_id,project_id) references public.projects (user_id,id) on delete cascade,
  foreign key (user_id,project_id,task_id) references public.tasks (user_id,project_id,id) on delete set null (task_id)
);
create index sessions_owner_day on public.work_sessions (user_id,local_day,started_at,id);

-- Current effective awards. A completion event and a session each have one stable source key.
create table public.xp_transactions (
  user_id uuid not null references public.profiles on delete cascade,
  source_type text not null check (source_type in ('session','completion')),
  source_id uuid not null,
  skill_id text not null references public.skills,
  xp integer not null check (xp > 0),
  earned_at timestamptz not null,
  primary key (user_id,source_type,source_id)
);

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','projects','production_stages','tasks','work_sessions','xp_transactions'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy owner_read on public.%I for select to authenticated using (user_id = (select auth.uid()))', table_name);
  end loop;
end $$;
alter table public.skills enable row level security;
revoke all on public.skills from public, anon, authenticated;
grant select on public.skills to authenticated;
create policy authenticated_skills on public.skills for select to authenticated using (true);

create function public.studio_owner(p_timezone text default null) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare owner public.profiles;
begin
  if auth.uid() is null then raise exception 'Sign in to continue' using errcode = '42501'; end if;
  insert into public.profiles (user_id,timezone)
    values (auth.uid(),coalesce((select name from pg_catalog.pg_timezone_names where name = p_timezone),'UTC'))
    on conflict do nothing;
  select * into strict owner from public.profiles where user_id = auth.uid() for update;
  return owner;
end $$;

create function public.studio_reconcile(owner public.profiles) returns void
language sql set search_path = '' as $$
  delete from public.xp_transactions where user_id = owner.user_id;
  insert into public.xp_transactions (user_id,source_type,source_id,skill_id,xp,earned_at)
  select owner.user_id, 'session', id, skill_id, award, started_at
  from (
    select id, skill_id, started_at,
      greatest(0, least(minutes * owner.xp_per_minute, owner.daily_cap -
        coalesce(sum(minutes * owner.xp_per_minute) over (
          partition by local_day order by started_at,id rows between unbounded preceding and 1 preceding
        ),0)))::integer as award
    from public.work_sessions where user_id = owner.user_id
  ) awards where award > 0
  union all
  select owner.user_id, 'completion', completion_id, skill_id, bonus, completed_at
  from public.tasks where user_id = owner.user_id and status = 'done' and bonus > 0;
$$;

create function public.studio_preferences(p_timezone text, p_theme text, p_bonus integer)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a valid IANA time zone';
  end if;
  update public.profiles set timezone = p_timezone, theme = p_theme, default_task_xp = p_bonus
    where user_id = owner.user_id;
end $$;

create function public.studio_project(p_id uuid, p_name text, p_description text, p_archived boolean, p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if p_delete then
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

create function public.studio_task(p_id uuid, p_project uuid, p_title text, p_skill text, p_status text, p_priority integer, p_bonus integer)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if not exists (select 1 from public.projects where id = p_project and user_id = owner.user_id) then
    raise exception 'Project not found';
  end if;
  insert into public.tasks (id,user_id,project_id,title,skill_id,status,priority,bonus,completion_id,completed_at)
  values (p_id,owner.user_id,p_project,btrim(p_title),p_skill,p_status,p_priority,p_bonus,
    case when p_status = 'done' then gen_random_uuid() end,
    case when p_status = 'done' then now() end)
  on conflict (id) do update set title = excluded.title, skill_id = excluded.skill_id,
    status = excluded.status, priority = excluded.priority, bonus = excluded.bonus,
    completion_id = case when excluded.status = 'done' then coalesce(tasks.completion_id,excluded.completion_id) end,
    completed_at = case when excluded.status = 'done' then coalesce(tasks.completed_at,excluded.completed_at) end
  where tasks.user_id = owner.user_id and tasks.project_id = p_project;
  if not found then raise exception 'Task not found in this project'; end if;
  perform public.studio_reconcile(owner);
end $$;

create function public.studio_session(p_id uuid, p_project uuid, p_task uuid, p_skill text,
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
  if not exists (select 1 from public.projects where id = p_project and user_id = owner.user_id) then
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
    skill_id = excluded.skill_id, started_at = excluded.started_at, minutes = excluded.minutes,
    timezone = excluded.timezone, local_day = excluded.local_day
  where work_sessions.user_id = owner.user_id;
  if not found then raise exception 'Session not found'; end if;
  perform public.studio_reconcile(owner);
  return coalesce((select xp from public.xp_transactions where user_id = owner.user_id and source_type = 'session' and source_id = p_id),0);
end $$;

create function public.studio_snapshot(p_timezone text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner(p_timezone);
begin
  return jsonb_build_object(
    'profile', to_jsonb(owner),
    'projects', (select coalesce(jsonb_agg(p order by created_at desc,id),'[]') from public.projects p where user_id = owner.user_id),
    'stages', (select coalesce(jsonb_agg(s order by position,id),'[]') from public.production_stages s where user_id = owner.user_id),
    'tasks', (select coalesce(jsonb_agg(t order by priority,position,created_at,id),'[]') from public.tasks t where user_id = owner.user_id),
    'sessions', (select coalesce(jsonb_agg(w order by started_at desc,id),'[]') from public.work_sessions w where user_id = owner.user_id),
    'ledger', (select coalesce(jsonb_agg(x order by earned_at desc,source_id),'[]') from public.xp_transactions x where user_id = owner.user_id)
  );
end $$;

revoke execute on function public.studio_owner(text), public.studio_reconcile(public.profiles),
  public.studio_snapshot(text), public.studio_preferences(text,text,integer),
  public.studio_project(uuid,text,text,boolean,boolean), public.studio_task(uuid,uuid,text,text,text,integer,integer),
  public.studio_session(uuid,uuid,uuid,text,timestamptz,integer,boolean,boolean) from public, anon, authenticated;
grant execute on function public.studio_snapshot(text), public.studio_preferences(text,text,integer),
  public.studio_project(uuid,text,text,boolean,boolean), public.studio_task(uuid,uuid,text,text,text,integer,integer),
  public.studio_session(uuid,uuid,uuid,text,timestamptz,integer,boolean,boolean) to authenticated;
