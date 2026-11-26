import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../supabase/migrations/20261122000000_creator_studio.sql', import.meta.url), 'utf8')
const db = new PGlite()
const owner = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const project = '00000000-0000-4000-8000-000000000010'
const task = '00000000-0000-4000-8000-000000000020'
const a = '00000000-0000-4000-8000-000000000030'
const b = '00000000-0000-4000-8000-000000000031'
const c = '00000000-0000-4000-8000-000000000032'

async function login(user: string) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
  await db.exec('set role authenticated')
}

async function log(id: string, date: string, minutes: number, skill = 'editing', preview = false, remove = false) {
  const { rows } = await db.query<{ xp: number }>(
    'select public.studio_session($1,$2,null,$3,$4,$5,$6,$7) as xp',
    [id, project, skill, date, minutes, remove, preview],
  )
  return rows[0].xp
}

async function setTask(state: string, bonus: number, skill = 'editing') {
  await db.query('select public.studio_task($1,$2,$3,$4,$5,1,$6)', [task, project, 'Edit intro', skill, state, bonus])
}

function ledger() {
  return db.query<{ source_id: string; skill_id: string; xp: number }>(
    'select source_id, skill_id, xp from public.xp_transactions order by source_id',
  ).then(result => result.rows)
}

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${owner}'),('${other}');
  `)
  await db.exec(migration)
})

beforeEach(async () => {
  await db.exec('reset role; truncate public.profiles cascade')
  await login(owner)
  await db.query("select public.studio_snapshot('America/New_York')")
  await db.query("select public.studio_project($1,'Video','',false)", [project])
})

afterAll(async () => { await db.close() })

describe('transactional XP ledger', () => {
  it('applies the cap across skills, buckets by local date, and matches the preview', async () => {
    expect(await log(a, '2026-11-20T22:00:00Z', 80)).toBe(80)
    expect(await log(b, '2026-11-21T02:00:00Z', 60, 'filming', true)).toBe(20)
    expect(await ledger()).toHaveLength(1)
    expect(await log(b, '2026-11-21T02:00:00Z', 60, 'filming')).toBe(20)
    expect(await log(c, '2026-11-21T05:00:00Z', 60, 'research')).toBe(60)
    expect((await ledger()).map(entry => entry.xp)).toEqual([80, 20, 60])
  })

  it('reallocates awards after edits, timezone-crossing corrections, and deletions', async () => {
    await log(a, '2026-11-20T22:00:00Z', 100)
    await log(b, '2026-11-21T02:00:00Z', 80, 'filming')
    expect(await log(a, '2026-11-20T22:00:00Z', 35, 'research')).toBe(35)
    expect(await ledger()).toEqual([
      { source_id: a, xp: 35, skill_id: 'research' },
      { source_id: b, xp: 65, skill_id: 'filming' },
    ])
    await db.query("select public.studio_preferences('UTC','dark',5)")
    expect(await log(a, '2026-11-20T22:00:00Z', 35, 'research')).toBe(35)
    expect((await ledger()).map(entry => entry.xp)).toEqual([35, 65])
    await log(a, '2026-11-21T05:01:00Z', 35, 'research')
    expect((await ledger()).map(entry => entry.xp)).toEqual([35, 80])
    await log(a, '2026-11-21T05:01:00Z', 35, 'research', false, true)
    expect(await ledger()).toEqual([{ source_id: b, xp: 80, skill_id: 'filming' }])
  })

  it('treats duplicate completion calls as one event and corrects edited or reopened tasks', async () => {
    await log(a, '2026-11-20T22:00:00Z', 100)
    await setTask('done', 12)
    const completion = (await ledger()).find(entry => entry.source_id !== a)!
    await setTask('done', 12)
    expect(await ledger()).toContainEqual(completion)
    expect(await ledger()).toHaveLength(2)
    await setTask('done', 4, 'filming')
    expect(await ledger()).toContainEqual({ source_id: completion.source_id, xp: 4, skill_id: 'filming' })
    await setTask('todo', 4, 'filming')
    expect(await ledger()).toHaveLength(1)
    await setTask('done', 4, 'filming')
    expect(await ledger()).toHaveLength(2)
    expect(await ledger()).not.toContainEqual(completion)
    await db.query("select public.studio_project($1,'','',false,true)", [project])
    expect(await ledger()).toEqual([])
  })

  it('isolates owners and rejects direct client ledger writes', async () => {
    await log(a, '2026-11-20T22:00:00Z', 100)
    await expect(db.exec('delete from public.xp_transactions')).rejects.toThrow('permission denied')
    await db.exec('reset role')
    await login(other)
    expect(await ledger()).toEqual([])
    await expect(log(b, '2026-11-20T22:00:00Z', 100)).rejects.toThrow('Project not found')
    await expect(db.query("select public.studio_project($1,'','',false,true)", [project])).rejects.toThrow('Project not found')
    await db.exec('reset role')
    await login(owner)
    expect(await ledger()).toEqual([{ source_id: a, xp: 100, skill_id: 'editing' }])
  })
})

it('upgrades existing awards, instantiates a pipeline, and keeps planned blocks separate from XP', async () => {
  await log(a, '2026-11-20T22:00:00Z', 42)
  await setTask('done', 12)
  const original = await ledger()
  await db.exec('reset role')
  await db.query("update public.tasks set scheduled_at = '2026-11-20T22:00:00Z', scheduled_until = '2026-11-20T22:30:00Z' where id = $1", [task])
  await db.exec(readFileSync(new URL('../supabase/migrations/20261122000100_planner.sql', import.meta.url), 'utf8'))
  await login(owner)
  expect(await ledger()).toEqual(original)
  const snapshot = await db.query<{ data: { blocks: unknown[]; templates: unknown[] } }>('select public.studio_planner_snapshot() as data')
  expect(snapshot.rows[0].data.blocks).toHaveLength(1)
  expect(snapshot.rows[0].data.templates).toHaveLength(8)
  await db.query("select public.studio_block($1,$2,$3,'2026-11-21T20:00:00Z','2026-11-21T20:30:00Z','America/New_York','','completed')", [b, project, task])
  expect((await db.query('select id from public.work_blocks where task_id = $1', [task])).rows).toHaveLength(2)
  expect(await ledger()).toEqual(original)
  await db.query("select public.studio_project_plan($1,'Video','',false,$2)", [project, {
    type: 'Video', priority: 2, status: 'active', target: '2026-12-10', notes: '', script: '',
  }])
  await db.query("select public.studio_apply_template($1,id) from public.planner_templates where kind = 'project'", [project])
  expect((await db.query("select due_date::text from public.tasks where title = 'Finish the script'")).rows).toEqual([{ due_date: '2026-12-05' }])
  expect((await db.query('select id from public.production_stages')).rows).toHaveLength(5)
  expect((await db.query('select id from public.tasks')).rows).toHaveLength(8)
  const matchingTask = await db.query<{ id: string }>("select id from public.tasks where title = 'Finish the script'")
  for (let retry = 0; retry < 2; retry++) {
    await db.query("select public.studio_quest_complete($1,id) from public.planner_templates where kind = 'quest' and name = 'Finish the script'", [project])
  }
  expect((await db.query("select id from public.tasks where title = 'Finish the script' and status = 'done'")).rows).toEqual(matchingTask.rows)
  expect(await ledger()).toHaveLength(original.length + 1)
  const result = await db.query<{ xp: number }>("select public.studio_log_session($1,null,null,'editing','2026-11-20T23:00:00Z',80,'timer','Focus',null,false) as xp", [c])
  expect(result.rows[0].xp).toBe(58)
  expect((await db.query('select project_id,entry_method,notes from public.work_sessions where id = $1', [c])).rows).toEqual([{ project_id: null, entry_method: 'timer', notes: 'Focus' }])
  await db.exec('reset role')
  await login(other)
  expect((await db.query('select id from public.work_blocks')).rows).toEqual([])
  expect((await db.query('select id from public.planner_templates')).rows).toEqual([])
})

it('converts an idea into an owned schedule and synchronizes board completion with one effective award', async () => {
  await log(a, '2026-11-20T22:00:00Z', 42)
  const original = await ledger()
  await db.exec('reset role')
  const plannerExists = await db.query<{ present:boolean }>("select to_regclass('public.work_blocks') is not null as present")
  if (!plannerExists.rows[0].present) {
    await db.exec(readFileSync(new URL('../supabase/migrations/20261122000100_planner.sql', import.meta.url), 'utf8'))
  }
  await db.exec(readFileSync(new URL('../supabase/migrations/20261122000200_project_centric.sql', import.meta.url), 'utf8'))
  await login(owner)
  expect(await ledger()).toEqual(original)
  await db.query('select public.studio_production_snapshot()')
  const template = (await db.query<{ id: string }>("select id from public.planner_templates where name='Long-form video'")).rows[0].id
  await db.query('select public.studio_topic($1,$2)',[b,{title:'Video idea',description:'',notes:'',links:[],category:'',type:'Video',priority:2,status:'ready',archived:false}])
  const meta={type:'Video',priority:2,status:'planned',notes:'',script:''}
  const args=[c,'Video idea','',meta,template,'2026-11-21',true,false,b,[1,2,3,4,5],null]
  await db.query('select public.studio_create_production($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',args)
  await db.query('select public.studio_create_production($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',args)
  const phases=(await db.query<{ name:string; id:string; planned_start:string; planned_end:string }>('select name,id,planned_start::text,planned_end::text from public.production_stages where project_id=$1 order by position',[c])).rows
  expect(phases).toHaveLength(8)
  expect(phases[0].planned_start).toBe('2026-11-23')
  const found=(await db.query<{id:string}>("select id from public.tasks where project_id=$1 and title='Finish script'",[c])).rows[0].id
  for(const state of ['done','blocked','done','done']) await db.query('select public.studio_board_task($1,$2,$3)',[c,found,state])
  expect((await ledger()).filter(item=>item.skill_id==='scriptwriting')).toHaveLength(1)
  expect((await ledger()).find(item=>item.skill_id==='scriptwriting')?.xp).toBe(100)
  await db.query("select public.studio_quest_complete($1,id) from public.planner_templates where name='Finish the script'",[c])
  expect((await db.query("select id from public.tasks where project_id=$1 and skill_id='scriptwriting' and status='done'",[c])).rows)
    .toEqual([{id:found}])

  const edit=phases.find(phase=>phase.name==='Editing')!
  await db.query("select public.studio_schedule_span($1,'stage',$2,$3,$4,$5,$6)",[c,edit.id,'2026-12-01','2026-12-07',edit.planned_start,edit.planned_end])
  expect((await db.query('select status from public.tasks where id=$1',[found])).rows[0]).toEqual({status:'done'})
  const editedTemplate=(await db.query<{ name:string; details:unknown }>(
    "select name,jsonb_set(details,'{stages,5,duration_days}','9') as details from public.planner_templates where id=$1",[template],
  )).rows[0]
  await db.query("select public.studio_template($1,'project',$2,$3)",[template,editedTemplate.name,editedTemplate.details])
  const fresh = '00000000-0000-4000-8000-000000000099'
  await db.query('select public.studio_create_production($1,$2,$3,$4,$5,$6,$7,$8)',[fresh,'New edition','',meta,template,'2026-12-01',true,false])
  expect((await db.query("select planned_end-planned_start+1 as duration from public.production_stages where project_id=$1 and name='Editing'",[fresh])).rows).toEqual([{duration:9}])
  expect((await db.query('select planned_start::text,planned_end::text from public.production_stages where id=$1',[edit.id])).rows)
    .toEqual([{planned_start:'2026-12-01',planned_end:'2026-12-07'}])
  await expect(db.query('select public.studio_create_production($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    ['00000000-0000-4000-8000-000000000098','Duplicate','',meta,template,'2026-12-01',true,false,b])).rejects.toThrow('already has a project')

  await db.exec('reset role')
  await login(other)
  expect((await db.query('select id from public.topics')).rows).toEqual([])
  await expect(db.query('select public.studio_board_task($1,$2,$3)',[c,found,'todo'])).rejects.toThrow()
})

it('synchronizes daily scheduling while retaining sessions and published statistics', async () => {
  await log(a, '2026-11-26T17:00:00Z', 42)
  await db.exec('reset role')
  for (const [table, migration] of [
    ['work_blocks','20261122000100_planner.sql'],
    ['topics','20261122000200_project_centric.sql'],
  ]) {
    const result = await db.query<{ exists: boolean }>("select to_regclass($1) is not null as exists",[`public.${table}`])
    if (!result.rows[0].exists) await db.exec(readFileSync(new URL(`../supabase/migrations/${migration}`,import.meta.url),'utf8'))
  }
  await login(owner)
  await setTask('blocked',12)
  await db.exec('reset role')
  await db.exec(readFileSync(new URL('../supabase/migrations/20261126000000_workflow.sql',import.meta.url),'utf8'))
  await login(owner)
  expect((await db.query('select status from public.tasks where id=$1',[task])).rows).toEqual([{status:'doing'}])
  expect((await ledger()).find(award => award.source_id===a)?.xp).toBe(42)
  await db.query('select public.studio_journey_snapshot()')
  const template = (await db.query<{ id: string }>("select id from public.planner_templates where name='Studio workflow'")).rows[0].id
  const meta = {type:'Short-form video',priority:2,status:'active',notes:'',script:''}
  await db.query('select public.studio_create_production($1,$2,$3,$4,$5,$6,$7,$8)',[c,'Short film','',meta,template,'2026-11-26',true,false])
  expect((await db.query('select id from public.tasks where project_id=$1',[c])).rows).toHaveLength(5)
  const edit = (await db.query<{ id: string; start: string; stop: string }>("select id,planned_start::text as start,planned_end::text as stop from public.tasks where project_id=$1 and title='Editing'",[c])).rows[0]
  const schedule = (start: string,end: string,oldStart: string,oldEnd: string) =>
    db.query("select public.studio_schedule_span($1,'task',$2,$3,$4,$5,$6)",[c,edit.id,start,end,oldStart,oldEnd])
  await schedule('2026-11-28','2026-11-29',edit.start,edit.stop)
  await db.query("select public.studio_time_task_day($1,'2026-11-29','2026-11-29T14:00:00Z','2026-11-29T15:00:00Z','America/New_York')",[edit.id])
  await expect(db.query("select public.studio_time_task_day($1,'2026-11-29','2026-11-30T14:00:00Z','2026-11-30T15:00:00Z','America/New_York')",[edit.id])).rejects.toThrow('within this calendar day')
  await schedule('2026-11-29','2026-11-30','2026-11-28','2026-11-29')
  const entries = await db.query('select day::text,starts_at is not null as timed from public.task_calendar_days where task_id=$1 order by day',[edit.id])
  expect(entries.rows).toEqual([{day:'2026-11-29',timed:true},{day:'2026-11-30',timed:false}])
  await db.query("select public.studio_block($1,$2,$3,'2026-11-29T16:00:00Z','2026-11-29T17:00:00Z','America/New_York','','planned')",[b,c,edit.id])
  for (const stage of ['published','editing','published']) await db.query('select public.studio_move_project($1,$2)',[c,stage])
  await db.query("select public.studio_move_project($1,'published')",[project])
  await db.query('select public.studio_archive_project($1,true)',[c])
  expect((await db.query('select archived from public.projects where id=$1',[c])).rows).toEqual([{archived:true}])
  expect((await db.query('select count(*)::integer from public.task_calendar_days where task_id=$1',[edit.id])).rows).toEqual([{count:2}])
  await db.query('select public.studio_delete_project_keep_history($1)',[c])
  await db.query('select public.studio_delete_project_keep_history($1)',[project])
  expect((await db.query('select id from public.work_blocks')).rows).toEqual([])
  expect((await db.query('select day from public.task_calendar_days')).rows).toEqual([])
  expect((await db.query('select id,project_id,minutes from public.work_sessions where id=$1',[a])).rows).toEqual([{id:a,project_id:null,minutes:42}])
  expect((await db.query('select format from public.publications order by format')).rows).toEqual([{format:'long'},{format:'short'}])
})
