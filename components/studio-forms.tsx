'use client'

import { useState, type FormEvent } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { Sparkles } from 'lucide-react'
import { StudioDialog } from '@/components/ui/dialog'
import { localInput, rpc, skills, type Project, type SessionDraft, type Snapshot, type Task, type WorkSession } from '@/lib/studio'

type Args = Record<string, unknown>
type Editor = { busy: boolean; error: string; close: () => void }

function SkillField({ initial, value, onChange }: { initial?: string; value?: string; onChange?: (value: string) => void }) {
  return <label>Skill<select name="skill" defaultValue={value === undefined ? initial ?? skills[0].id : undefined}
    value={value} onChange={onChange ? event => onChange(event.target.value) : undefined}>
    {skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
  </select></label>
}

export function ProjectEditor({ snapshot, project, busy, error, close, save, remove }: Editor & {
  snapshot: Snapshot; project?: Project; save: (args: Args, id: string) => void; remove: (project: Project) => void
}) {
  const [id] = useState(() => project?.id ?? crypto.randomUUID())
  const starter = snapshot.templates.find(item => item.kind === 'project' && item.name === 'Video production')
  const [contentType, setContentType] = useState(project?.content_type ?? starter?.details.content_type ?? 'Video')
  return <StudioDialog title={project ? 'Edit project' : 'New project'} description="Give your creative work a place to take shape." close={() => { if (!busy) close() }}>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      save({ p_id: id, p_name: data.get('name'), p_description: data.get('description'), p_archived: data.has('archived'), p_template: data.get('template') || null,
        p_meta: { type: data.get('type'), stage: data.get('stage') || null, priority: Number(data.get('priority')),
          status: data.get('status'), target: data.get('target') || null, actual: data.get('actual') || null,
          notes: data.get('notes'), script: data.get('script') } }, id)
    }}>
      <label>Project name<input name="name" autoFocus required maxLength={120} defaultValue={project?.name} /></label>
      <label>Description<textarea name="description" maxLength={4000} rows={4} defaultValue={project?.description} /></label>
      {!project && <label>Project template<select name="template" defaultValue={starter?.id ?? ''} onChange={event => {
        const template = snapshot.templates.find(item => item.id === event.target.value)
        if (template?.details.content_type) setContentType(template.details.content_type)
      }}><option value="">Blank project</option>{snapshot.templates.filter(item => item.kind === 'project').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <div className="form-grid">
        <label>Content type<input name="type" required maxLength={80} value={contentType} onChange={event => setContentType(event.target.value)} /></label>
        <label>Production stage<select name="stage" defaultValue={project?.production_stage_id ?? ''}><option value="">No stage</option>{snapshot.stages.filter(stage => stage.project_id === project?.id).map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
        <label>Priority<select name="priority" defaultValue={project?.priority ?? 2}><option value={1}>High</option><option value={2}>Medium</option><option value={3}>Low</option></select></label>
        <label>Status<select name="status" defaultValue={project?.status ?? 'active'}><option value="planned">Planned</option><option value="active">Active</option><option value="paused">Paused</option><option value="published">Published</option></select></label>
        <label>Target publication<input name="target" type="date" defaultValue={project?.target_publication_date ?? ''} /></label>
        <label>Actual publication<input name="actual" type="date" defaultValue={project?.actual_publication_date ?? ''} /></label>
      </div>
      <label>Notes<textarea name="notes" rows={2} defaultValue={project?.notes} /></label>
      <label>Script<textarea name="script" rows={4} defaultValue={project?.script} /></label>
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

export function TaskEditor({ snapshot, project, task, defaultBonus, busy, error, close, save }: Editor & {
  snapshot: Snapshot; project: Project; task?: Task; defaultBonus: number; save: (args: Args) => void
}) {
  const [id] = useState(() => task?.id ?? crypto.randomUUID())
  return <StudioDialog title={task ? 'Edit task' : 'New task'} description={project.name} close={() => { if (!busy) close() }}>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      save({ p_id: id, p_project: project.id, p_title: data.get('title'), p_skill: data.get('skill'),
        p_status: data.get('status'), p_priority: Number(data.get('priority')), p_bonus: Number(data.get('bonus')),
        p_meta: { description: data.get('description'), parent: data.get('parent') || null,
          stage: data.get('stage') || null, due: data.get('due') || null, minutes: data.get('minutes') || null } })
    }}>
      <label>Task title<input name="title" required maxLength={160} defaultValue={task?.title} autoFocus /></label>
      <label>Description<textarea name="description" rows={2} defaultValue={task?.description} /></label>
      <div className="form-grid"><SkillField initial={task?.skill_id} />
        <label>Production stage<select name="stage" defaultValue={task?.stage_id ?? ''}><option value="">No stage</option>{snapshot.stages.filter(stage => stage.project_id === project.id).map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
        <label>Parent task<select name="parent" defaultValue={task?.parent_id ?? ''}><option value="">Top-level task</option>{snapshot.tasks.filter(item => item.project_id === project.id && item.id !== task?.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Estimated minutes<input name="minutes" type="number" min={1} max={1440} defaultValue={task?.estimated_minutes ?? ''} /></label>
        <label>Due date<input name="due" type="date" defaultValue={task?.due_date ?? ''} /></label>
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
  snapshot: Snapshot; session?: WorkSession; draft?: SessionDraft; save: (args: Args) => void; remove: (session: WorkSession) => void
}) {
  const [id] = useState(() => session?.id ?? crypto.randomUUID())
  const available = snapshot.projects.filter(project => !project.archived || project.id === session?.project_id)
  const [project, setProject] = useState(session ? session.project_id ?? '' : draft?.project ?? available[0]?.id ?? '')
  const [task, setTask] = useState(session?.task_id ?? draft?.task ?? '')
  const [skill, setSkill] = useState<string>(session?.skill_id ?? draft?.skill ?? skills[0].id)
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
      const minutes = Number(data.get('minutes'))
      const originalEnd = session?.ended_at ?? draft?.ended
      const unchangedTiming = sourceTime === start && minutes === (session?.minutes ?? draft?.minutes)
      const args = { p_id: id, p_project: project || null, p_task: task || null, p_skill: skill, p_started: start,
        p_minutes: minutes, p_method: session?.entry_method ?? (draft ? 'timer' : 'manual'),
        p_notes: data.get('notes'), p_ended: unchangedTiming ? originalEnd ?? null : null }
      const xp = await rpc<number>('studio_log_session', { ...args, p_preview: true })
      setPreview({ args, xp })
    } catch (exception) {
      setFailure(exception instanceof RangeError ? 'Choose an unambiguous local start time outside the daylight-saving transition.' : (exception as Error).message)
    } finally { setPending(false) }
  }

  return <StudioDialog title={session ? 'Edit work session' : 'Log work session'}
    description={`Session times use ${timezone}. Preview XP before saving.`}
    close={() => { if (!busy) close() }}>
    <form className="form" onSubmit={submit} onChange={() => { setPreview(undefined); setFailure('') }}>
      <fieldset disabled={busy || pending} className="form">
        <label>Project<select name="project" value={project} onChange={event => { setProject(event.target.value); setTask('') }}>
          <option value="">No project</option>
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
        <label>Notes<textarea name="notes" rows={2} defaultValue={session?.notes} /></label>
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
    </form>
  </StudioDialog>
}
