'use client'

import { useState, type FormEvent } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { Sparkles } from 'lucide-react'
import { StudioDialog } from '@/components/ui/dialog'
import { localInput, rpc, skills, type Project, type Snapshot, type Task, type WorkSession } from '@/lib/studio'

type Args = Record<string, unknown>
type Editor = { busy: boolean; error: string; close: () => void }

function SkillField({ initial, value, onChange }: { initial?: string; value?: string; onChange?: (value: string) => void }) {
  return <label>Skill<select name="skill" defaultValue={value === undefined ? initial ?? skills[0].id : undefined}
    value={value} onChange={onChange ? event => onChange(event.target.value) : undefined}>
    {skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
  </select></label>
}

export function ProjectEditor({ project, busy, error, close, save, remove }: Editor & {
  project?: Project; save: (args: Args, id: string) => void; remove: (project: Project) => void
}) {
  const [id] = useState(() => project?.id ?? crypto.randomUUID())
  return <StudioDialog title={project ? 'Edit project' : 'New project'} description="Give your creative work a place to take shape." close={() => { if (!busy) close() }}>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      save({ p_id: id, p_name: data.get('name'), p_description: data.get('description'), p_archived: data.has('archived') }, id)
    }}>
      <label>Project name<input name="name" autoFocus required maxLength={120} defaultValue={project?.name} /></label>
      <label>Description<textarea name="description" maxLength={4000} rows={4} defaultValue={project?.description} /></label>
      {project && <label className="checkbox"><input type="checkbox" name="archived" defaultChecked={project.archived} /> Archive project</label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        {project && <button className="text-button danger-text push" type="button" disabled={busy} onClick={() => remove(project)}>Delete project</button>}
        <button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy ? 'Saving…' : project ? 'Save project' : 'Create project'}</button>
      </div>
    </form>
  </StudioDialog>
}

export function TaskEditor({ project, task, defaultBonus, busy, error, close, save }: Editor & {
  project: Project; task?: Task; defaultBonus: number; save: (args: Args) => void
}) {
  const [id] = useState(() => task?.id ?? crypto.randomUUID())
  return <StudioDialog title={task ? 'Edit task' : 'New task'} description={project.name} close={() => { if (!busy) close() }}>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      save({ p_id: id, p_project: project.id, p_title: data.get('title'), p_skill: data.get('skill'),
        p_status: data.get('status'), p_priority: Number(data.get('priority')), p_bonus: Number(data.get('bonus')) })
    }}>
      <label>Task title<input name="title" required maxLength={160} defaultValue={task?.title} autoFocus /></label>
      <div className="form-grid"><SkillField initial={task?.skill_id} />
        <label>Priority<select name="priority" defaultValue={task?.priority ?? 2}>
          <option value={1}>High</option><option value={2}>Medium</option><option value={3}>Low</option>
        </select></label>
        <label>Status<select name="status" defaultValue={task?.status ?? 'todo'}>
          <option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option>
        </select></label>
        <label>Completion XP<input name="bonus" type="number" min={0} max={10000} step={1} required defaultValue={task?.bonus ?? defaultBonus} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy ? 'Saving…' : task ? 'Save task' : 'Create task'}</button>
      </div>
    </form>
  </StudioDialog>
}

export function SessionEditor({ snapshot, session, draft, busy, error, close, save, remove }: Editor & {
  snapshot: Snapshot; session?: WorkSession; draft?: { started: string; minutes: number }; save: (args: Args) => void; remove: (session: WorkSession) => void
}) {
  const [id] = useState(() => session?.id ?? crypto.randomUUID())
  const available = snapshot.projects.filter(project => !project.archived || project.id === session?.project_id)
  const [project, setProject] = useState(session?.project_id ?? available[0]?.id ?? '')
  const [task, setTask] = useState(session?.task_id ?? '')
  const [skill, setSkill] = useState<string>(session?.skill_id ?? skills[0].id)
  const [preview, setPreview] = useState<{ args: Args; xp: number }>()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const timezone = session?.timezone ?? snapshot.profile.timezone
  const sourceTime = session?.started_at ?? draft?.started
  const [defaultStart] = useState(() => localInput(sourceTime ?? new Date().toISOString(), timezone))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (preview) { save(preview.args); return }
    const data = new FormData(event.currentTarget)
    setPending(true)
    setFailure('')
    try {
      const entered = String(data.get('started'))
      const start = entered === defaultStart && sourceTime
        ? sourceTime
        : Temporal.PlainDateTime.from(entered).toZonedDateTime(timezone, { disambiguation: 'reject' }).toInstant().toString()
      const args = { p_id: id, p_project: project, p_task: task || null, p_skill: skill, p_started: start, p_minutes: Number(data.get('minutes')) }
      const xp = await rpc<number>('studio_session', { ...args, p_preview: true })
      setPreview({ args, xp })
    } catch (exception) {
      setFailure(exception instanceof RangeError ? 'Choose an unambiguous local start time outside the daylight-saving transition.' : (exception as Error).message)
    } finally { setPending(false) }
  }

  return <StudioDialog title={session ? 'Edit work session' : 'Log work session'}
    description={available.length ? `Session times use ${timezone}. Preview XP before saving.` : 'Create an active project before logging a work session.'}
    close={() => { if (!busy) close() }}>
    {available.length > 0 && <form className="form" onSubmit={submit} onChange={() => { setPreview(undefined); setFailure('') }}>
      <fieldset disabled={busy || pending} className="form">
        <label>Project<select name="project" value={project} onChange={event => { setProject(event.target.value); setTask('') }}>
          {available.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Task<select name="task" value={task} onChange={event => {
          const id = event.target.value
          setTask(id)
          const selected = snapshot.tasks.find(item => item.id === id)
          if (selected) setSkill(selected.skill_id)
        }}>
          <option value="">No task</option>
          {snapshot.tasks.filter(item => item.project_id === project).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        <SkillField value={skill} onChange={setSkill} />
        <div className="form-grid">
          <label>Started at<input name="started" type="datetime-local" required defaultValue={defaultStart} /></label>
          <label>Whole minutes<input name="minutes" type="number" required min={1} max={1440} step={1}
            defaultValue={session?.minutes ?? (draft ? draft.minutes || '' : 25)} /></label>
        </div>
      </fieldset>
      {draft?.minutes === 0 && <p className="muted">The timer ran for less than a minute. Enter a duration if you have additional work to log.</p>}
      {preview && <div className="preview-xp" role="status"><Sparkles size={19} /><div>
        <strong>+{preview.xp} Creator XP · +{preview.xp} {skills.find(item => item.id === skill)?.name} XP</strong>
        <p>Earlier sessions use the daily cap first. Changes can update later awards.</p>
      </div></div>}
      {(failure || error) && <p className="form-error" role="alert">{failure || error}</p>}
      <div className="form-actions">
        {session && <button type="button" className="text-button danger-text push" disabled={busy} onClick={() => remove(session)}>Delete session</button>}
        <button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy || pending}>
          {busy ? 'Saving…' : pending ? 'Calculating…' : preview ? 'Save session' : 'Preview XP'}
        </button>
      </div>
    </form>}
  </StudioDialog>
}
