'use client'

import { useState, type FormEvent } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { Sparkles } from 'lucide-react'
import { currentDay } from '@/components/planner'
import { StudioDialog } from '@/components/ui/dialog'
import { localInput, rpc, skills, type PlanPhase, type Project, type SessionDraft, type Snapshot, type Task, type Topic, type WorkSession } from '@/lib/studio'

type Args = Record<string, unknown>
type Editor = { busy: boolean; error: string; close: () => void }

function SkillField({ initial, value, onChange }: { initial?: string; value?: string; onChange?: (value: string) => void }) {
  return <label>Skill<select name="skill" defaultValue={value === undefined ? initial ?? skills[0].id : undefined}
    value={value} onChange={onChange ? event => onChange(event.target.value) : undefined}>
    {skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
  </select></label>
}

export function ProjectEditor({ snapshot, project, topic, busy, error, close, save, remove }: Editor & {
  snapshot: Snapshot; project?: Project; topic?: Topic; save: (args: Args, id: string) => void; remove: (project: Project) => void
}) {
  const [id] = useState(() => project?.id ?? crypto.randomUUID())
  const templates = snapshot.templates.filter(item => item.kind === 'project')
  const starter = templates.find(item => topic?.content_type !== 'Video' && item.details.content_type === topic?.content_type && topic)
    ?? templates.find(item => item.name === 'Long-form video') ?? templates[0]
  const [templateId, setTemplateId] = useState(starter?.id ?? '')
  const [contentType, setContentType] = useState(project?.content_type ?? topic?.content_type ?? starter?.details.content_type ?? 'Video')
  const [start, setStart] = useState(project?.start_date ?? currentDay(snapshot.profile.timezone).toString())
  const [auto, setAuto] = useState(true)
  const [simple, setSimple] = useState(false)
  const [working, setWorking] = useState(false)
  const [days, setDays] = useState(snapshot.profile.working_days)
  const [durations, setDurations] = useState<Record<number, number>>({})
  const [preview, setPreview] = useState<PlanPhase[]>()
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const template = templates.find(item => item.id === templateId)
  const plan = {
    p_template: templateId || null, p_start: start, p_auto: auto, p_simple: simple,
    p_days: working ? days : null,
    p_durations: template?.details.stages?.map((stage, index) => durations[index] ?? stage.duration_days ?? 1) ?? null,
  }
  async function showPreview() {
    setPreviewing(true)
    setPreviewError('')
    try { setPreview(await rpc<PlanPhase[]>('studio_generate_plan', plan)) }
    catch (failure) { setPreviewError((failure as Error).message) }
    finally { setPreviewing(false) }
  }
  return <StudioDialog title={project ? 'Edit project' : topic ? 'Add as Project' : 'New project'}
    description={project ? 'Update the project details. Use the timeline to rearrange existing dates.' : 'Choose a template and preview the production plan.'}
    close={() => { if (!busy) close() }}>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      if (topic && !preview) { void showPreview(); return }
      const args = { p_id: id, p_name: data.get('name'), p_description: data.get('description'), p_start: start,
        p_meta: { type: data.get('type'), stage: data.get('stage') || null, priority: Number(data.get('priority')),
          status: data.get('status'), target: data.get('target') || null, actual: data.get('actual') || null,
          notes: data.get('notes'), script: data.get('script'), cover: data.get('cover') } }
      save(project ? { ...args, p_archived: data.has('archived') } : { ...args, ...plan, p_topic: topic?.id ?? null }, id)
    }}>
      <label>Project name<input name="name" autoFocus required maxLength={120} defaultValue={project?.name ?? topic?.title} /></label>
      <label>Description<textarea name="description" maxLength={4000} rows={2} defaultValue={project?.description ?? topic?.description} /></label>
      <label>Project start date<input type="date" required value={start} onChange={event => { setStart(event.target.value); setPreview(undefined) }} /></label>
      {!project && <>
        <label>Project template<select name="template" required={Boolean(topic)} value={templateId} onChange={event => {
          setTemplateId(event.target.value); setDurations({}); setPreview(undefined)
          const selected = templates.find(item => item.id === event.target.value)
          if (selected?.details.content_type) setContentType(selected.details.content_type)
        }}><option value="">Blank project</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {template && <>
          <label>Workflow<select value={simple ? 'simple' : 'full'} onChange={event => { setSimple(event.target.value === 'simple'); setPreview(undefined) }}>
            <option value="full">Full workflow</option><option value="simple">Simplified workflow</option>
          </select></label>
          <label className="checkbox"><input type="checkbox" checked={auto} onChange={event => { setAuto(event.target.checked); setPreview(undefined) }} /> Generate timeline automatically</label>
          {auto && <>
            <label>Schedule using<select value={working ? 'working' : 'calendar'} onChange={event => { setWorking(event.target.value === 'working'); setPreview(undefined) }}>
              <option value="calendar">Calendar days</option><option value="working">Working days</option>
            </select></label>
            {working && <WorkingDays days={days} change={value => { setDays(value); setPreview(undefined) }} />}
            <details><summary>Adjust durations for this project</summary><div className="form-grid">
              {template.details.stages?.map((stage, index) => <label key={index}>{stage.name} days<input type="number" min={1} max={365}
                value={durations[index] ?? stage.duration_days ?? 1} required onChange={event => {
                  const value = Number(event.target.value)
                  setDurations(previous => ({ ...previous, [index]: value })); setPreview(undefined)
                }} /></label>)}</div></details>
          </>}
          <button type="button" className="button secondary" disabled={previewing || !start || busy}
            onClick={() => void showPreview()}>{previewing ? 'Generating…' : 'Preview workflow'}</button>
          {preview && <section className="plan-preview" aria-label="Generated workflow">
            {preview.map((phase, index) => <details key={index} open={index === 0}>
              <summary>{phase.name} · {phase.tasks.length} tasks{phase.start && ` · ${phase.start} – ${phase.end}`}</summary>
              <ul>{phase.tasks.map((task, n) => <li key={n}>{task.title} · {task.bonus} XP{task.start && ` · ${task.start} – ${task.end}`}</li>)}</ul>
            </details>)}
          </section>}
          {previewError && <p className="form-error" role="alert">{previewError}</p>}
        </>}
      </>}
      <details className="project-edit-metadata" open={Boolean(project) || undefined}><summary>Project details</summary>
      <div className="form-grid">
        <label>Content type<input name="type" required maxLength={80} value={contentType} onChange={event => setContentType(event.target.value)} /></label>
        <label>Production stage<select name="stage" defaultValue={project?.production_stage_id ?? ''}><option value="">No stage</option>{snapshot.stages.filter(stage => stage.project_id === project?.id).map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
        <label>Priority<select name="priority" defaultValue={project?.priority ?? 2}><option value={1}>High</option><option value={2}>Medium</option><option value={3}>Low</option></select></label>
        <label>Status<select name="status" defaultValue={project?.status ?? 'active'}><option value="planned">Planned</option><option value="active">Active</option><option value="paused">Paused</option><option value="published">Published</option></select></label>
        <label>Target publication<input name="target" type="date" defaultValue={project?.target_publication_date ?? ''} /></label>
        <label>Actual publication<input name="actual" type="date" defaultValue={project?.actual_publication_date ?? ''} /></label>
      </div>
      <label>Notes<textarea name="notes" rows={2} defaultValue={project?.notes ?? topic?.notes} /></label>
      <label>Cover image URL<input type="url" name="cover" placeholder="https://…" defaultValue={project?.cover_url} /></label>
      <label>Script<textarea name="script" rows={4} defaultValue={project?.script} /></label>
      {project && <label className="checkbox"><input type="checkbox" name="archived" defaultChecked={project.archived} /> Archive project</label>}
      </details>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        {project && <button className="text-button danger-text push" type="button" disabled={busy} onClick={() => remove(project)}>Delete project</button>}
        <button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy || previewing}>{busy ? 'Saving…' : project ? 'Save project' : topic && !preview ? 'Preview project' : 'Create project'}</button>
      </div>
    </form>
  </StudioDialog>
}

export function WorkingDays({ days, change }: { days: number[]; change: (value: number[]) => void }) {
  return <fieldset className="working-days"><legend>Available days</legend>
    {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day,index) => <label key={day} className="checkbox">
      <input type="checkbox" checked={days.includes(index + 1)} disabled={days.length === 1 && days.includes(index + 1)}
        onChange={() => change(days.includes(index + 1) ? days.filter(value => value !== index + 1) : [...days,index + 1])} />{day}
    </label>)}
  </fieldset>
}

export function TaskEditor({ snapshot, project, task, initialStatus, defaultBonus, busy, error, close, save, action }: Editor & {
  snapshot: Snapshot; project: Project; task?: Task; initialStatus?: Task['status']; defaultBonus: number; save: (args: Args) => void; action: (task: Task, action: 'duplicate' | 'delete') => void
}) {
  const [id] = useState(() => task?.id ?? crypto.randomUUID())
  return <StudioDialog title={task ? 'Edit task' : 'New task'} description={project.name} close={() => { if (!busy) close() }}>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      save({ p_id: id, p_project: project.id, p_title: data.get('title'), p_skill: data.get('skill'),
        p_status: data.get('status'), p_priority: Number(data.get('priority')), p_bonus: Number(data.get('bonus')),
        p_meta: { description: data.get('description'), parent: data.get('parent') || null,
          stage: data.get('stage') || null, dependency: data.get('dependency') || null, due: data.get('due') || null, minutes: data.get('minutes') || null } })
    }}>
      <label>Task title<input name="title" required maxLength={160} defaultValue={task?.title} autoFocus /></label>
      <label>Description<textarea name="description" rows={2} defaultValue={task?.description} /></label>
      <div className="form-grid"><SkillField initial={task?.skill_id} />
        <label>Production stage<select name="stage" defaultValue={task?.stage_id ?? ''}><option value="">No stage</option>{snapshot.stages.filter(stage => stage.project_id === project.id).map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
        <label>Parent task<select name="parent" defaultValue={task?.parent_id ?? ''}><option value="">Top-level task</option>{snapshot.tasks.filter(item => item.project_id === project.id && item.id !== task?.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Depends on<select name="dependency" defaultValue={task?.depends_on ?? ''}><option value="">No dependency</option>{snapshot.tasks.filter(item => item.project_id === project.id && item.id !== task?.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Estimated minutes<input name="minutes" type="number" min={1} max={1440} defaultValue={task?.estimated_minutes ?? ''} /></label>
        <label>Due date<input name="due" type="date" defaultValue={task?.due_date ?? ''} /></label>
        <label>Priority<select name="priority" defaultValue={task?.priority ?? 2}>
          <option value={1}>High</option><option value={2}>Medium</option><option value={3}>Low</option>
        </select></label>
        <label>Status<select name="status" defaultValue={task?.status ?? initialStatus ?? 'todo'}>
          <option value="todo">To do</option><option value="doing">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
        </select></label>
        <label>Completion XP<input name="bonus" type="number" min={0} max={10000} step={1} required defaultValue={task?.bonus ?? defaultBonus} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        {task && <><button className="text-button danger-text push" type="button" disabled={busy} onClick={() => action(task, 'delete')}>Delete task</button>
          <button className="text-button" type="button" disabled={busy} onClick={() => action(task, 'duplicate')}>Duplicate task</button></>}
        <button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
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
        p_minutes: minutes, p_method: session?.entry_method ?? draft?.method ?? (draft ? 'timer' : 'manual'),
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
      {draft?.minutes === 0 && draft.method !== 'manual' && <p className="muted">The timer ran for less than a minute. Enter a duration if you have additional work to log.</p>}
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
