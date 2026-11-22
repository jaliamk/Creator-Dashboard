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
