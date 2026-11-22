alter table public.projects add column start_date date, add column cover_url text not null default '';
update public.projects p set start_date = (p.created_at at time zone u.timezone)::date
from public.profiles u where p.user_id = u.user_id;
alter table public.production_stages add column planned_start date, add column planned_end date,
  add check ((planned_start is null and planned_end is null) or
    (planned_start is not null and planned_end is not null and planned_end >= planned_start));
alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks add check (status in ('todo','doing','blocked','done'));
alter table public.tasks add column planned_start date, add column planned_end date,
  add column depends_on uuid,
  add check ((planned_start is null and planned_end is null) or
    (planned_start is not null and planned_end is not null and planned_end >= planned_start)),
  add foreign key (user_id,project_id,depends_on) references public.tasks (user_id,project_id,id) on delete set null (depends_on);

create table public.topics (
  id uuid primary key,
  user_id uuid not null references public.profiles on delete cascade,
  project_id uuid unique,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '',
  notes text not null default '',
  links text[] not null default '{}',
  category text not null default '',
  content_type text not null default 'Video',
  priority integer not null default 2 check (priority between 1 and 3),
  status text not null default 'idea' check (status in ('idea','exploring','ready','converted')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id,project_id) references public.projects (user_id,id) on delete set null (project_id)
);
create index topics_owner on public.topics (user_id,archived,status,priority);
create trigger topics_touch before update on public.topics for each row execute function public.studio_touch();

create table public.achievements (
  id text primary key,
  title text not null,
  description text not null,
  metric text not null check (metric in ('projects','tasks','minutes','xp')),
  threshold integer not null check (threshold > 0)
);
insert into public.achievements values
 ('first-project','In Production','Create your first project.','projects',1),
 ('ten-tasks','Making Progress','Complete ten production tasks.','tasks',10),
 ('first-hour','Focused Hour','Log sixty minutes of creative work.','minutes',60),
 ('creator-500','Creative Practice','Earn five hundred Creator XP.','xp',500);

alter table public.profiles add column working_days integer[] not null default '{1,2,3,4,5}'
  check (cardinality(working_days) between 1 and 7 and working_days <@ array[1,2,3,4,5,6,7]);
alter table public.topics enable row level security;
alter table public.achievements enable row level security;
revoke all on public.topics,public.achievements from public,anon,authenticated;
grant select on public.topics,public.achievements to authenticated;
create policy owner_topics on public.topics for select to authenticated using (user_id = (select auth.uid()));
create policy read_achievements on public.achievements for select to authenticated using (true);

create function public.studio_production_snapshot(p_timezone text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare base jsonb := public.studio_planner_snapshot(p_timezone);
begin
  return base || jsonb_build_object(
    'topics',(select coalesce(jsonb_agg(t order by created_at desc,id),'[]') from public.topics t where user_id = auth.uid()),
    'achievements',(select coalesce(jsonb_agg(a order by threshold,id),'[]') from public.achievements a)
  );
end $$;

create function public.studio_working_days(p_days integer[]) returns void
language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  update public.profiles set working_days = p_days where user_id = owner.user_id;
end $$;

create function public.studio_topic(p_id uuid,p_data jsonb,p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if p_delete then
    delete from public.topics where user_id = owner.user_id and id = p_id;
  else
    insert into public.topics (id,user_id,title,description,notes,links,category,content_type,priority,status,archived)
    values (p_id,owner.user_id,btrim(p_data->>'title'),p_data->>'description',p_data->>'notes',
      array(select jsonb_array_elements_text(p_data->'links')),p_data->>'category',p_data->>'type',
      (p_data->>'priority')::integer,p_data->>'status',(p_data->>'archived')::boolean)
    on conflict (id) do update set title=excluded.title,description=excluded.description,notes=excluded.notes,links=excluded.links,
      category=excluded.category,content_type=excluded.content_type,priority=excluded.priority,archived=excluded.archived,
      status=case when topics.project_id is null then excluded.status else 'converted' end
      where topics.user_id = owner.user_id;
  end if;
  if not found then raise exception 'Topic not found'; end if;
end $$;

create function public.studio_link_topic(p_id uuid,p_project uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if not exists (select 1 from public.projects where user_id = owner.user_id and id = p_project) then raise exception 'Project not found'; end if;
  update public.topics set project_id = p_project,status = 'converted'
    where id = p_id and user_id = owner.user_id and (project_id is null or project_id = p_project);
  if not found then raise exception 'Topic is missing or already linked'; end if;
end $$;

create function public.studio_schedule_span(p_project uuid,p_kind text,p_id uuid,p_start date,p_end date,
  p_expected_start date,p_expected_end date)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if p_kind = 'stage' then
    update public.production_stages set planned_start=p_start,planned_end=p_end where user_id=owner.user_id and project_id=p_project and id=p_id
      and planned_start is not distinct from p_expected_start and planned_end is not distinct from p_expected_end;
  elsif p_kind = 'task' then
    update public.tasks set planned_start=p_start,planned_end=p_end where user_id=owner.user_id and project_id=p_project and id=p_id
      and planned_start is not distinct from p_expected_start and planned_end is not distinct from p_expected_end;
  else
    raise exception 'Unknown schedule item';
  end if;
  if not found then raise exception 'The schedule has changed. Refresh and try again'; end if;
end $$;

create function public.studio_task_dependency(p_project uuid,p_task uuid,p_dependency uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if exists (
    with recursive deps as (
      select t.id,t.depends_on from public.tasks t where user_id=owner.user_id and project_id=p_project and id=p_dependency
      union
      select t.id,t.depends_on from public.tasks t join deps d on t.id = d.depends_on
        where t.user_id=owner.user_id and t.project_id=p_project
    ) select 1 from deps where id=p_task
  ) then raise exception 'A task cannot depend on itself, directly or indirectly'; end if;
  update public.tasks set depends_on=p_dependency where user_id=owner.user_id and project_id=p_project and id=p_task;
  if not found then raise exception 'Task not found'; end if;
end $$;

create function public.studio_board_task(p_project uuid,p_task uuid,p_status text,p_before uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  item public.tasks;
  ordering uuid[];
  slot integer;
begin
  select * into strict item from public.tasks where user_id=owner.user_id and project_id=p_project and id=p_task;
  if p_before = p_task and p_status = item.status then return; end if;
  if item.status <> p_status then
    perform public.studio_task(item.id,item.project_id,item.title,item.skill_id,p_status,item.priority,item.bonus);
  end if;
  select coalesce(array_agg(id order by position,created_at,id),'{}') into ordering from public.tasks
    where user_id=owner.user_id and project_id=p_project and status=p_status and id<>p_task;
  slot := case when p_before is null then cardinality(ordering)+1 else array_position(ordering,p_before) end;
  if slot is null then raise exception 'The destination card has moved'; end if;
  ordering := ordering[1:slot-1] || p_task || ordering[slot:cardinality(ordering)];
  update public.tasks t set position=n-1 from unnest(ordering) with ordinality as ordered(id,n)
    where t.user_id=owner.user_id and t.project_id=p_project and t.id=ordered.id and t.position<>n-1;
end $$;

create function public.studio_task_action(p_project uuid,p_task uuid,p_action text,p_new_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  item public.tasks;
begin
  select * into strict item from public.tasks where user_id=owner.user_id and project_id=p_project and id=p_task;
  if p_action = 'delete' then
    update public.tasks set parent_id=item.parent_id where user_id=owner.user_id and project_id=p_project and parent_id=item.id;
    delete from public.tasks where id=item.id and user_id=owner.user_id;
    perform public.studio_reconcile(owner);
  elsif p_action = 'duplicate' then
    insert into public.tasks (id,user_id,project_id,parent_id,stage_id,title,skill_id,description,estimated_minutes,bonus,priority,due_date,planned_start,planned_end,depends_on,position)
    values (p_new_id,owner.user_id,p_project,item.parent_id,item.stage_id,left(item.title,153)||' (copy)',item.skill_id,item.description,
      item.estimated_minutes,item.bonus,item.priority,item.due_date,item.planned_start,item.planned_end,item.depends_on,item.position+1)
    on conflict (id) do nothing;
  else raise exception 'Unknown task action';
  end if;
end $$;

create function public.studio_remove_block(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  delete from public.work_blocks where user_id=owner.user_id and id=p_id;
  if not found then raise exception 'Work block not found'; end if;
end $$;

-- Seed additions for existing profiles once. Preserve personalized presets with matching names.
with added as (
  insert into public.planner_starters (kind,name,details) values
 ('project','Long-form video','{"content_type":"Long-form video","stages":[{"name":"Ideation","duration_days":1,"tasks":[{"title":"Define core topic","skill":"research","minutes":10,"bonus":10},{"title":"Define central message","skill":"research","minutes":10,"bonus":10},{"title":"Collect initial ideas","skill":"research","minutes":10,"bonus":10}]},{"name":"Research","duration_days":2,"tasks":[{"title":"Gather references","skill":"research","minutes":25,"bonus":10},{"title":"Organize research notes","skill":"research","minutes":25,"bonus":10},{"title":"Complete research","skill":"research","minutes":25,"bonus":10}]},{"name":"Scriptwriting","duration_days":2,"tasks":[{"title":"Create outline","skill":"scriptwriting","minutes":30,"bonus":10},{"title":"Write first draft","skill":"scriptwriting","minutes":30,"bonus":10},{"title":"Revise structure","skill":"scriptwriting","minutes":30,"bonus":10},{"title":"Finish script","skill":"scriptwriting","minutes":30,"bonus":100}]},{"name":"Test Run","duration_days":1,"tasks":[{"title":"Read or rehearse script","skill":"presentation","minutes":20,"bonus":10},{"title":"Identify difficult sections","skill":"presentation","minutes":20,"bonus":10},{"title":"Finalize talking points","skill":"presentation","minutes":20,"bonus":10}]},{"name":"Filming","duration_days":1,"tasks":[{"title":"Prepare equipment","skill":"filming","minutes":30,"bonus":10},{"title":"Set up camera and lighting","skill":"filming","minutes":30,"bonus":10},{"title":"Record main footage","skill":"filming","minutes":30,"bonus":10},{"title":"Review footage","skill":"filming","minutes":30,"bonus":10},{"title":"Complete filming","skill":"filming","minutes":30,"bonus":10}]},{"name":"Editing","duration_days":5,"tasks":[{"title":"Import and organize footage","skill":"editing","minutes":35,"bonus":10},{"title":"Assemble rough cut","skill":"editing","minutes":35,"bonus":10},{"title":"Review pacing","skill":"editing","minutes":35,"bonus":10},{"title":"Refine narrative structure","skill":"editing","minutes":35,"bonus":10},{"title":"Add supporting visuals","skill":"editing","minutes":35,"bonus":10},{"title":"Review audio","skill":"editing","minutes":35,"bonus":10},{"title":"Complete final edit","skill":"editing","minutes":35,"bonus":10},{"title":"Export video","skill":"editing","minutes":35,"bonus":10}]},{"name":"Thumbnail and Metadata","duration_days":1,"tasks":[{"title":"Create thumbnail","skill":"production","minutes":20,"bonus":10},{"title":"Finalize title","skill":"production","minutes":20,"bonus":10},{"title":"Write description","skill":"production","minutes":20,"bonus":10}]},{"name":"Publishing","duration_days":1,"tasks":[{"title":"Upload video","skill":"production","minutes":15,"bonus":10},{"title":"Check upload settings","skill":"production","minutes":15,"bonus":10},{"title":"Publish video","skill":"production","minutes":15,"bonus":10},{"title":"Complete post-publication checklist","skill":"production","minutes":15,"bonus":10}]}]}'),
 ('project','Conversational / GRWM video','{"content_type":"Conversational / GRWM","stages":[{"name":"Ideation","duration_days":1,"tasks":[{"title":"Define core topic","skill":"research","minutes":10,"bonus":10},{"title":"Define central message","skill":"research","minutes":10,"bonus":10},{"title":"Collect initial ideas","skill":"research","minutes":10,"bonus":10}]},{"name":"Test Run","duration_days":1,"tasks":[{"title":"Read or rehearse script","skill":"presentation","minutes":20,"bonus":10},{"title":"Identify difficult sections","skill":"presentation","minutes":20,"bonus":10},{"title":"Finalize talking points","skill":"presentation","minutes":20,"bonus":10}]},{"name":"Filming","duration_days":1,"tasks":[{"title":"Prepare equipment","skill":"filming","minutes":30,"bonus":10},{"title":"Set up camera and lighting","skill":"filming","minutes":30,"bonus":10},{"title":"Record main footage","skill":"filming","minutes":30,"bonus":10},{"title":"Review footage","skill":"filming","minutes":30,"bonus":10},{"title":"Complete filming","skill":"filming","minutes":30,"bonus":10}]},{"name":"Editing","duration_days":5,"tasks":[{"title":"Import and organize footage","skill":"editing","minutes":35,"bonus":10},{"title":"Assemble rough cut","skill":"editing","minutes":35,"bonus":10},{"title":"Review pacing","skill":"editing","minutes":35,"bonus":10},{"title":"Refine narrative structure","skill":"editing","minutes":35,"bonus":10},{"title":"Add supporting visuals","skill":"editing","minutes":35,"bonus":10},{"title":"Review audio","skill":"editing","minutes":35,"bonus":10},{"title":"Complete final edit","skill":"editing","minutes":35,"bonus":10},{"title":"Export video","skill":"editing","minutes":35,"bonus":10}]},{"name":"Publishing","duration_days":1,"tasks":[{"title":"Upload video","skill":"production","minutes":15,"bonus":10},{"title":"Check upload settings","skill":"production","minutes":15,"bonus":10},{"title":"Publish video","skill":"production","minutes":15,"bonus":10},{"title":"Complete post-publication checklist","skill":"production","minutes":15,"bonus":10}]}]}'),
 ('project','Short-form video','{"content_type":"Short-form video","stages":[{"name":"Ideation","duration_days":1,"tasks":[{"title":"Outline the hook","skill":"research","minutes":10,"bonus":10}]},{"name":"Scriptwriting","duration_days":1,"tasks":[{"title":"Write short script","skill":"scriptwriting","minutes":15,"bonus":10}]},{"name":"Filming","duration_days":1,"tasks":[{"title":"Record the short","skill":"filming","minutes":25,"bonus":10}]},{"name":"Editing","duration_days":1,"tasks":[{"title":"Cut and caption the short","skill":"editing","minutes":25,"bonus":10}]},{"name":"Publishing","duration_days":1,"tasks":[{"title":"Upload video","skill":"production","minutes":15,"bonus":10},{"title":"Check upload settings","skill":"production","minutes":15,"bonus":10},{"title":"Publish video","skill":"production","minutes":15,"bonus":10},{"title":"Complete post-publication checklist","skill":"production","minutes":15,"bonus":10}]}]}'),
 ('project','Short-form clip from existing video','{"content_type":"Short-form clip","stages":[{"name":"Selection","duration_days":1,"tasks":[{"title":"Find a strong moment","skill":"research","minutes":20,"bonus":10},{"title":"Choose the in and out points","skill":"research","minutes":20,"bonus":10}]},{"name":"Editing","duration_days":1,"tasks":[{"title":"Reframe for vertical","skill":"editing","minutes":25,"bonus":10},{"title":"Add captions and review","skill":"editing","minutes":25,"bonus":10},{"title":"Export the clip","skill":"editing","minutes":25,"bonus":10}]},{"name":"Publishing","duration_days":1,"tasks":[{"title":"Upload video","skill":"production","minutes":15,"bonus":10},{"title":"Check upload settings","skill":"production","minutes":15,"bonus":10},{"title":"Publish video","skill":"production","minutes":15,"bonus":10},{"title":"Complete post-publication checklist","skill":"production","minutes":15,"bonus":10}]}]}'),
 ('quest','50-minute editing session','{"skill":"editing","minutes":50}'),
 ('quest','10-minute writing sprint','{"skill":"scriptwriting","minutes":10}'),
 ('quest','25-minute writing session','{"skill":"scriptwriting","minutes":25}'),
 ('quest','25-minute research session','{"skill":"research","minutes":25}'),
 ('quest','30-minute filming session','{"skill":"filming","minutes":30}')
  returning kind,name,details
)
insert into public.planner_templates (id,user_id,kind,name,details)
select gen_random_uuid(),p.user_id,a.kind,a.name,a.details from public.profiles p cross join added a
where p.planner_seeded and not exists (
  select 1 from public.planner_templates t where t.user_id=p.user_id and t.kind=a.kind and t.name=a.name
);

create function public.studio_generate_plan(p_template uuid,p_start date,p_auto boolean,p_simple boolean,p_days integer[] default null,p_durations integer[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  template public.planner_templates;
  phase jsonb;
  item jsonb;
  result jsonb := '[]';
  items jsonb;
  phase_start date;
  phase_end date;
  cursor_day date := p_start;
  active_days date[];
  duration integer;
  phase_index integer := 0;
  task_index integer;
  task_count integer;
  preferred_days integer[] := coalesce(p_days,array[1,2,3,4,5,6,7]);
begin
  if p_start is null or not isfinite(p_start) then raise exception 'Choose a valid project start date'; end if;
  if cardinality(preferred_days) not between 1 and 7 or not (preferred_days <@ array[1,2,3,4,5,6,7]) then
    raise exception 'Choose at least one working day';
  end if;
  if p_template is null then return result; end if;
  select * into strict template from public.planner_templates where id=p_template and user_id=owner.user_id and kind='project';
  for phase in select value from jsonb_array_elements(template.details->'stages') loop
    phase_index := phase_index + 1;
    duration := coalesce(p_durations[phase_index],(phase->>'duration_days')::integer,1);
    if duration not between 1 and 365 then raise exception 'Phase durations must be between 1 and 365 days'; end if;
    phase_start := null;
    phase_end := null;
    active_days := null;
    if p_auto then
      select array_agg(day order by day) into active_days from (
        select cursor_day + offset_day as day
        from generate_series(0,duration*7) as offset_day
        where extract(isodow from cursor_day + offset_day)::integer = any(preferred_days)
        order by offset_day limit duration
      ) usable;
      phase_start := active_days[1];
      phase_end := active_days[duration];
      cursor_day := phase_end + 1;
    end if;
    items := '[]';
    task_count := case when p_simple then least(2,jsonb_array_length(phase->'tasks')) else jsonb_array_length(phase->'tasks') end;
    task_index := 0;
    for item in select value from jsonb_array_elements(phase->'tasks') with ordinality as entry(value,n)
      where n <= task_count order by n
    loop
      items := items || jsonb_build_array(item || jsonb_build_object(
        'bonus',coalesce((item->>'bonus')::integer,owner.default_task_xp),
        'start',active_days[1 + (task_index * duration / task_count)],
        'end',active_days[greatest(1 + (task_index * duration / task_count), (task_index + 1) * duration / task_count)]
      ));
      task_index := task_index + 1;
    end loop;
    result := result || jsonb_build_array(jsonb_build_object('name',phase->>'name','duration',duration,
      'start',phase_start,'end',phase_end,'tasks',items));
  end loop;
  return result;
end $$;

create function public.studio_create_production(p_id uuid,p_name text,p_description text,p_meta jsonb,p_template uuid,
  p_start date,p_auto boolean,p_simple boolean,p_topic uuid default null,p_days integer[] default null,p_durations integer[] default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
  idea public.topics;
  draft jsonb;
  phase jsonb;
  item jsonb;
  phase_id uuid;
  phase_position integer := 0;
  task_position integer := 0;
begin
  if p_topic is not null then
    select * into strict idea from public.topics where id=p_topic and user_id=owner.user_id;
    if idea.project_id = p_id then return p_id; end if;
    if idea.project_id is not null then raise exception 'This topic already has a project'; end if;
  end if;
  if exists (select 1 from public.projects where id=p_id and user_id=owner.user_id) then
    if p_topic is null then return p_id; end if;
    raise exception 'Project already exists';
  end if;
  draft := public.studio_generate_plan(p_template,p_start,p_auto,p_simple,p_days,p_durations);
  perform public.studio_project_plan(p_id,p_name,p_description,false,p_meta,null);
  update public.projects set start_date=p_start,cover_url=coalesce(p_meta->>'cover','') where id=p_id and user_id=owner.user_id;
  for phase in select value from jsonb_array_elements(draft) loop
    insert into public.production_stages (user_id,project_id,name,position,planned_start,planned_end)
      values (owner.user_id,p_id,phase->>'name',phase_position,(phase->>'start')::date,(phase->>'end')::date) returning id into phase_id;
    if phase_position=0 then update public.projects set production_stage_id=phase_id where id=p_id and user_id=owner.user_id; end if;
    for item in select value from jsonb_array_elements(phase->'tasks') loop
      insert into public.tasks (user_id,project_id,stage_id,title,skill_id,estimated_minutes,bonus,position,planned_start,planned_end,due_date)
      values (owner.user_id,p_id,phase_id,item->>'title',item->>'skill',(item->>'minutes')::integer,
        (item->>'bonus')::integer,task_position,(item->>'start')::date,(item->>'end')::date,
        (p_meta->>'target')::date - (item->>'days_before_publish')::integer);
      task_position := task_position+1;
    end loop;
    phase_position := phase_position+1;
  end loop;
  if p_topic is not null then perform public.studio_link_topic(p_topic,p_id); end if;
  return p_id;
end $$;

create function public.studio_edit_production(p_id uuid,p_name text,p_description text,p_archived boolean,p_meta jsonb,p_start date)
returns void language plpgsql security definer set search_path = '' as $$
declare owner public.profiles := public.studio_owner();
begin
  if p_start is null or not isfinite(p_start) then raise exception 'Choose a valid project start date'; end if;
  if not exists (select 1 from public.projects where id=p_id and user_id=owner.user_id) then raise exception 'Project not found'; end if;
  perform public.studio_project_plan(p_id,p_name,p_description,p_archived,p_meta);
  update public.projects set start_date=p_start,cover_url=coalesce(p_meta->>'cover','') where id=p_id and user_id=owner.user_id;
end $$;

revoke execute on function public.studio_production_snapshot(text),public.studio_working_days(integer[]),
 public.studio_topic(uuid,jsonb,boolean),public.studio_link_topic(uuid,uuid),
 public.studio_schedule_span(uuid,text,uuid,date,date,date,date),public.studio_task_dependency(uuid,uuid,uuid),
 public.studio_board_task(uuid,uuid,text,uuid),public.studio_task_action(uuid,uuid,text,uuid),public.studio_remove_block(uuid),
 public.studio_generate_plan(uuid,date,boolean,boolean,integer[],integer[]),
 public.studio_create_production(uuid,text,text,jsonb,uuid,date,boolean,boolean,uuid,integer[],integer[]),
 public.studio_edit_production(uuid,text,text,boolean,jsonb,date) from public,anon,authenticated;
grant execute on function public.studio_production_snapshot(text),public.studio_working_days(integer[]),
 public.studio_topic(uuid,jsonb,boolean),public.studio_link_topic(uuid,uuid),
 public.studio_schedule_span(uuid,text,uuid,date,date,date,date),public.studio_task_dependency(uuid,uuid,uuid),
 public.studio_board_task(uuid,uuid,text,uuid),public.studio_task_action(uuid,uuid,text,uuid),public.studio_remove_block(uuid),
 public.studio_generate_plan(uuid,date,boolean,boolean,integer[],integer[]),
 public.studio_create_production(uuid,text,text,jsonb,uuid,date,boolean,boolean,uuid,integer[],integer[]),
 public.studio_edit_production(uuid,text,text,boolean,jsonb,date) to authenticated;

create function public.studio_edit_board_task(p_id uuid,p_project uuid,p_title text,p_skill text,p_status text,p_priority integer,p_bonus integer,p_meta jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.studio_task_plan(p_id,p_project,p_title,p_skill,p_status,p_priority,p_bonus,p_meta);
  perform public.studio_task_dependency(p_project,p_id,(p_meta->>'dependency')::uuid);
end $$;
revoke execute on function public.studio_edit_board_task(uuid,uuid,text,text,text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.studio_edit_board_task(uuid,uuid,text,text,text,integer,integer,jsonb) to authenticated;

create function public.studio_topic_project_removed() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.project_id is not null and new.project_id is null then new.status := 'ready'; end if;
  return new;
end $$;
create trigger topic_project_removed before update of project_id on public.topics
  for each row execute function public.studio_topic_project_removed();
revoke execute on function public.studio_topic_project_removed() from public,anon,authenticated;

create or replace function public.studio_quest_complete(p_project uuid,p_template uuid)
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
    and regexp_replace(lower(btrim(title)), '(^|[[:space:]])the[[:space:]]+', '\1', 'g') =
      regexp_replace(lower(btrim(quest.name)), '(^|[[:space:]])the[[:space:]]+', '\1', 'g') and skill_id = quest.details->>'skill'
    order by position,created_at,id limit 1;
  perform public.studio_task(coalesce(matched.id,gen_random_uuid()),p_project,coalesce(matched.title,quest.name),
    quest.details->>'skill','done',coalesce(matched.priority,2),coalesce(matched.bonus,(quest.details->>'bonus')::integer,owner.default_task_xp));
end $$;

create or replace function public.studio_apply_template(p_project uuid,p_template uuid,p_stage uuid default null)
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
        coalesce((item->>'bonus')::integer,owner.default_task_xp),coalesce(max(position)+1,0) from public.tasks where user_id = owner.user_id and project_id = p_project;
    end loop;
  end loop;
end $$;

