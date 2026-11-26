alter table public.tasks add column production_key text check (production_key in ('ideation','scriptwriting','filming','editing','preparing'));
create unique index primary_task_per_stage on public.tasks(project_id,production_key) where production_key is not null;
alter table public.projects add column board_position integer not null default 0;

create function public.studio_workflow_rank(p_key text) returns integer
language sql immutable set search_path='' as $$
  select array_position(array['ideation','scriptwriting','filming','editing','preparing','published'],p_key);
$$;

create function public.studio_ensure_primary(p_project uuid) returns void
language plpgsql set search_path='' as $$
declare project public.projects;
  item record;
  chosen uuid;
  phase uuid;
  first_day date;
  last_day date;
  completed boolean;
begin
  select * into strict project from public.projects where id=p_project;
  for item in select * from (values
    ('ideation','Ideation','research'),('scriptwriting','Scriptwriting','scriptwriting'),
    ('filming','Filming','filming'),('editing','Editing','editing'),('preparing','Preparing to Publish','production')
  ) as stages(key,title,skill) loop
    if exists(select 1 from public.tasks where project_id=p_project and production_key=item.key) then continue; end if;
    select id into phase from public.production_stages
      where project_id=p_project and public.studio_stage_key(name)=item.key
      order by (lower(name)=lower(item.title)) desc,position,id limit 1;
    select t.id into chosen from public.tasks t where t.project_id=p_project and t.production_key is null and t.parent_id is null
      and lower(t.title)=lower(item.title) order by t.created_at,t.id limit 1;
    select min(starts),max(ends) into first_day,last_day from (
      select s.planned_start starts,s.planned_end ends from public.production_stages s
        where s.project_id=p_project and public.studio_stage_key(s.name)=item.key
      union all
      select t.planned_start,t.planned_end from public.tasks t left join public.production_stages s on s.id=t.stage_id
        where t.project_id=p_project and
          (case when s.name is not null then public.studio_stage_key(s.name)
            when t.skill_id in ('editing','filming','scriptwriting') then t.skill_id
            when t.skill_id='production' then 'preparing' when t.skill_id='presentation' then 'filming' else 'ideation' end)=item.key
    ) sources;
    select exists(select 1 from public.tasks t join public.production_stages s on s.id=t.stage_id
      where t.project_id=p_project and public.studio_stage_key(s.name)=item.key group by t.project_id having bool_and(t.status='done'))
      or public.studio_workflow_rank(project.workflow_stage)>public.studio_workflow_rank(item.key) into completed;
    if chosen is null then
      insert into public.tasks(user_id,project_id,title,skill_id,stage_id,position,bonus,production_key,status,completion_id,completed_at,planned_start,planned_end)
      values(project.user_id,p_project,item.title,item.skill,phase,public.studio_workflow_rank(item.key),0,item.key,
        case when completed then 'done' else 'todo' end,case when completed then gen_random_uuid() end,
        case when completed then project.updated_at end,first_day,last_day)
      returning id into chosen;
    else
      update public.tasks set production_key=item.key,planned_start=least(planned_start,first_day),planned_end=greatest(planned_end,last_day),
        status=case when completed then 'done' else status end,
        completion_id=case when completed then coalesce(completion_id,gen_random_uuid()) else completion_id end,
        completed_at=case when completed then coalesce(completed_at,project.updated_at) else completed_at end where id=chosen;
    end if;
    -- Keep one existing assignment per day, preferring any time already on the primary task.
    update public.task_calendar_days d set starts_at=source.starts_at,ends_at=source.ends_at,timezone=source.timezone
    from (
      select distinct on (old.day) old.day,old.starts_at,old.ends_at,old.timezone
      from public.task_calendar_days old join public.tasks t on t.id=old.task_id
      join public.production_stages s on s.id=t.stage_id
      where old.project_id=p_project and old.task_id<>chosen and old.starts_at is not null and public.studio_stage_key(s.name)=item.key
      order by old.day,old.starts_at,old.task_id
    ) source where d.task_id=chosen and d.day=source.day and d.starts_at is null;
  end loop;
end $$;
select public.studio_ensure_primary(id) from public.projects;

-- Generated days belong to the canonical production tasks. Legacy timed rows remain stored.
create or replace function public.studio_sync_task_days() returns trigger language plpgsql set search_path='' as $$
begin
  if new.production_key is null then return new; end if;
  if tg_op='UPDATE' and old.production_key is not distinct from new.production_key
    and old.planned_start is not distinct from new.planned_start and old.planned_end is not distinct from new.planned_end then return new; end if;
  delete from public.task_calendar_days where task_id=new.id and (new.planned_start is null or day<new.planned_start or day>new.planned_end);
  if new.planned_start is not null then
    if new.planned_end-new.planned_start>3660 then raise exception 'A task may span at most about ten years'; end if;
    insert into public.task_calendar_days(user_id,project_id,task_id,day)
      select new.user_id,new.project_id,new.id,new.planned_start+i from generate_series(0,new.planned_end-new.planned_start) as series(i)
      on conflict (task_id,day) do nothing;
  end if;
  return new;
end $$;
drop trigger sync_task_days on public.tasks;
create trigger sync_task_days after insert or update of planned_start,planned_end,production_key on public.tasks
  for each row execute function public.studio_sync_task_days();

create function public.studio_create_simple(p_id uuid,p_name text,p_description text,p_meta jsonb,p_template uuid,
  p_start date,p_auto boolean,p_simple boolean,p_topic uuid default null,p_days integer[] default null,p_durations integer[] default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner public.profiles:=public.studio_owner();
  created uuid;
  already_exists boolean;
  phase record;
  cursor_day date:=p_start;
  first_day date;
  last_day date;
  duration integer;
  preferred_days integer[]:=coalesce(p_days,array[1,2,3,4,5,6,7]);
begin
  select exists(select 1 from public.projects where id=p_id and user_id=owner.user_id) into already_exists;
  created:=public.studio_create_production(p_id,p_name,p_description,p_meta,null,p_start,false,false,p_topic);
  if already_exists then return created; end if;
  if cardinality(preferred_days) not between 1 and 7 or not (preferred_days <@ array[1,2,3,4,5,6,7]) then
    raise exception 'Choose at least one working day';
  end if;
  for phase in select * from (values (1,'Ideation',1),(2,'Scriptwriting',2),(3,'Filming',1),
    (4,'Editing',3),(5,'Preparing to Publish',1)) as stages(position,title,default_duration)
  loop
    duration:=coalesce(p_durations[phase.position],phase.default_duration);
    if duration not between 1 and 365 then raise exception 'Phase durations must be between 1 and 365 days'; end if;
    if p_auto then
      select min(day),max(day) into first_day,last_day from (
        select cursor_day+i as day from generate_series(0,duration*7) as offsets(i)
        where extract(isodow from cursor_day+i)::integer=any(preferred_days) order by i limit duration
      ) planned;
      cursor_day:=last_day+1;
    end if;
    insert into public.production_stages(user_id,project_id,name,position,planned_start,planned_end)
      values(owner.user_id,created,phase.title,phase.position,first_day,last_day);
  end loop;
  perform public.studio_ensure_primary(created);
  if (select workflow_stage from public.projects where id=created)='ideation' then
    update public.projects set production_stage_id=(select id from public.production_stages where project_id=created and position=1 limit 1)
      where id=created;
  end if;
  return created;
end $$;

create function public.studio_project_board(p_id uuid,p_stage text,p_before uuid default null,p_reorder boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare owner public.profiles:=public.studio_owner();
  old_stage text;
  ordering uuid[];
  slot integer;
begin
  select workflow_stage into strict old_stage from public.projects where user_id=owner.user_id and id=p_id;
  if p_stage is distinct from old_stage then perform public.studio_move_project(p_id,p_stage); end if;
  if p_reorder or p_stage<>old_stage then
    select coalesce(array_agg(id order by board_position,created_at,id),'{}') into ordering from public.projects
      where user_id=owner.user_id and not archived and workflow_stage=p_stage and id<>p_id;
    slot:=case when p_before is null then cardinality(ordering)+1 else array_position(ordering,p_before) end;
    if slot is null then raise exception 'The destination project has moved'; end if;
    ordering:=ordering[1:slot-1] || p_id || ordering[slot:cardinality(ordering)];
    update public.projects p set board_position=n-1 from unnest(ordering) with ordinality as ranks(id,n)
      where p.user_id=owner.user_id and p.id=ranks.id and p.board_position<>n-1;
  end if;
end $$;

create function public.studio_complete_preceding() returns trigger language plpgsql set search_path='' as $$
begin
  if public.studio_workflow_rank(new.workflow_stage)>public.studio_workflow_rank(old.workflow_stage) then
    update public.tasks set status='done',completion_id=gen_random_uuid(),completed_at=now()
      where user_id=new.user_id and project_id=new.id and status<>'done' and
        public.studio_workflow_rank(coalesce(production_key,(
          select parent.production_key from public.tasks parent where parent.id=tasks.parent_id
        ),(
          select public.studio_stage_key(s.name) from public.production_stages s where s.id=tasks.stage_id
        )))<public.studio_workflow_rank(new.workflow_stage);
    perform public.studio_reconcile((select p from public.profiles p where p.user_id=new.user_id));
  end if;
  return new;
end $$;
create trigger complete_preceding after update of workflow_stage on public.projects
  for each row execute function public.studio_complete_preceding();

create function public.studio_advance_primary(p_project uuid,p_task uuid,p_previous text) returns void
language plpgsql set search_path='' as $$
declare owner_id uuid:=auth.uid();
  current_stage text;
  next_stage text;
begin
  if p_previous='done' or not exists(select 1 from public.tasks where id=p_task and project_id=p_project
    and user_id=owner_id and production_key is not null and status='done') then return; end if;
  select workflow_stage into current_stage from public.projects where id=p_project and user_id=owner_id;
  if current_stage='published' then return; end if;
  select production_key into next_stage from public.tasks where project_id=p_project and user_id=owner_id
    and production_key is not null and status<>'done' order by public.studio_workflow_rank(production_key) limit 1;
  next_stage:=coalesce(next_stage,'preparing');
  if public.studio_workflow_rank(next_stage)>public.studio_workflow_rank(current_stage) then
    perform public.studio_move_project(p_project,next_stage);
  end if;
end $$;

create function public.studio_simple_board_task(p_project uuid,p_task uuid,p_status text,p_before uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare owner public.profiles:=public.studio_owner();
  prior text;
begin
  select status into strict prior from public.tasks where user_id=owner.user_id and project_id=p_project and id=p_task;
  perform public.studio_board_task(p_project,p_task,p_status,p_before);
  perform public.studio_advance_primary(p_project,p_task,prior);
end $$;

create function public.studio_simple_edit_task(p_id uuid,p_project uuid,p_title text,p_skill text,p_status text,p_priority integer,p_bonus integer,p_meta jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare owner public.profiles:=public.studio_owner();
  prior public.tasks;
begin
  select * into prior from public.tasks where user_id=owner.user_id and project_id=p_project and id=p_id;
  perform public.studio_edit_board_task(p_id,p_project,coalesce(case when prior.production_key is not null then prior.title end,p_title),
    p_skill,p_status,p_priority,p_bonus,p_meta);
  perform public.studio_advance_primary(p_project,p_id,prior.status);
end $$;

create function public.studio_move_calendar_day(p_task uuid,p_from date,p_to date)
returns void language plpgsql security definer set search_path='' as $$
declare owner public.profiles:=public.studio_owner();
  item public.tasks;
  saved jsonb;
  delta integer:=p_to-p_from;
begin
  select * into strict item from public.tasks where user_id=owner.user_id and id=p_task and production_key is not null;
  if not exists(select 1 from public.task_calendar_days where user_id=owner.user_id and task_id=p_task and day=p_from) then
    raise exception 'This calendar day changed. Refresh the workspace';
  end if;
  if delta=0 then return; end if;
  select coalesce(jsonb_agg(to_jsonb(d)),'[]') into saved from public.task_calendar_days d where task_id=p_task and starts_at is not null;
  update public.tasks set planned_start=item.planned_start+delta,planned_end=item.planned_end+delta where id=p_task;
  update public.task_calendar_days set starts_at=null,ends_at=null,timezone=null where task_id=p_task;
  update public.task_calendar_days d set starts_at=((prior.starts_at at time zone prior.timezone)+delta*interval '1 day') at time zone prior.timezone,
    ends_at=((prior.ends_at at time zone prior.timezone)+delta*interval '1 day') at time zone prior.timezone, timezone=prior.timezone
    from jsonb_populate_recordset(null::public.task_calendar_days,saved) prior
    where d.task_id=p_task and d.day=prior.day+delta and
      (((prior.ends_at at time zone prior.timezone)+delta*interval '1 day') at time zone prior.timezone)>
      (((prior.starts_at at time zone prior.timezone)+delta*interval '1 day') at time zone prior.timezone);
end $$;

create table public.quest_completions (
  id uuid primary key,
  user_id uuid not null references public.profiles on delete cascade,
  quest_key text not null check (quest_key in ('ideation','scriptwriting','editing','preparing','filming','thumbnail','short','long')),
  completed_at timestamptz not null default now(),
  completed_on date not null
);
create unique index daily_publication_acknowledgement on public.quest_completions(user_id,quest_key,completed_on)
  where quest_key in ('short','long');
alter table public.quest_completions enable row level security;
revoke all on public.quest_completions from public,anon,authenticated;
grant select on public.quest_completions to authenticated;
create policy owner_quest_completions on public.quest_completions for select to authenticated using (user_id=(select auth.uid()));

create function public.studio_one_click_quest(p_id uuid,p_key text,p_undo boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare owner public.profiles:=public.studio_owner();
begin
  if p_undo then delete from public.quest_completions where id=p_id and user_id=owner.user_id;
  else
    insert into public.quest_completions(id,user_id,quest_key,completed_on)
      values(p_id,owner.user_id,p_key,(now() at time zone owner.timezone)::date) on conflict do nothing;
  end if;
end $$;

create function public.studio_simple_snapshot(p_timezone text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare base jsonb:=public.studio_journey_snapshot(p_timezone);
begin
  return base || jsonb_build_object('quest_completions',(select coalesce(jsonb_agg(q order by q.completed_at desc,q.id),'[]')
    from public.quest_completions q where q.user_id=auth.uid()));
end $$;

revoke execute on function public.studio_workflow_rank(text),public.studio_ensure_primary(uuid),public.studio_complete_preceding(),
 public.studio_advance_primary(uuid,uuid,text),public.studio_create_simple(uuid,text,text,jsonb,uuid,date,boolean,boolean,uuid,integer[],integer[]),
 public.studio_project_board(uuid,text,uuid,boolean),public.studio_simple_board_task(uuid,uuid,text,uuid),
 public.studio_simple_edit_task(uuid,uuid,text,text,text,integer,integer,jsonb),public.studio_move_calendar_day(uuid,date,date),
 public.studio_one_click_quest(uuid,text,boolean),public.studio_simple_snapshot(text) from public,anon,authenticated;
grant execute on function public.studio_create_simple(uuid,text,text,jsonb,uuid,date,boolean,boolean,uuid,integer[],integer[]),
 public.studio_project_board(uuid,text,uuid,boolean),public.studio_simple_board_task(uuid,uuid,text,uuid),
 public.studio_simple_edit_task(uuid,uuid,text,text,text,integer,integer,jsonb),public.studio_move_calendar_day(uuid,date,date),
 public.studio_one_click_quest(uuid,text,boolean),public.studio_simple_snapshot(text) to authenticated;
