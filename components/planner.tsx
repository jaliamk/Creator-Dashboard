import { useState } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { StudioDialog } from '@/components/ui/dialog'
import { localInput, skills, type Block, type Snapshot, type TaskPreset, type Template } from '@/lib/studio'

type Args = Record<string, unknown>
type EditorProps = { busy: boolean; error: string; close: () => void; save: (args: Args) => void }
export const localInstant = (value: string, zone: string) =>
  Temporal.PlainDateTime.from(value).toZonedDateTime(zone, { disambiguation: 'reject' }).toInstant().toString()

export function currentDay(zone: string) {
  return Temporal.Now.plainDateISO(zone)
}

function dateLabel(day: Temporal.PlainDate, options: Intl.DateTimeFormatOptions) {
  return day.toLocaleString('en', options)
}

export function Planner({ snapshot, todayOnly, edit, add, openProject }: {
  snapshot: Snapshot; todayOnly?: boolean; edit: (block: Block) => void; add: (day: string) => void; openProject: (id: string) => void
}) {
  const [offset, setOffset] = useState(0)
  const [timeline, setTimeline] = useState(false)
  const zone = snapshot.profile.timezone
  const today = currentDay(zone)
  const monday = today.subtract({ days: today.dayOfWeek - 1 }).add({ weeks: offset })
  const days = todayOnly ? [today] : Array.from({ length: 7 }, (_, i) => monday.add({ days: i }))
  const time = new Intl.DateTimeFormat('en', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
  const active = snapshot.projects.filter(project => !project.archived)
  return <section className="panel planner-panel" aria-label={todayOnly ? 'Today’s schedule' : 'Weekly production calendar'}>
    <div className="panel-heading planner-heading">
      <div><h2><CalendarDays size={20} />{todayOnly ? 'Today’s schedule' : dateLabel(monday, { month: 'long', year: 'numeric' })}</h2>
        <p className="muted">{todayOnly ? dateLabel(today, { dateStyle: 'full' }) : 'Weekly calendar'} · {zone}</p></div>
      {!todayOnly && <div className="actions">
        <button className="icon-button" aria-label="Previous week" onClick={() => setOffset(offset - 1)}><ChevronLeft size={18} /></button>
        <button className="button secondary compact" onClick={() => setOffset(0)}>This week</button>
        <button className="icon-button" aria-label="Next week" onClick={() => setOffset(offset + 1)}><ChevronRight size={18} /></button>
      </div>}
    </div>
    {!todayOnly && <div className="calendar-mode actions" aria-label="Calendar layout">
      <button className="button secondary compact" aria-pressed={!timeline} onClick={() => setTimeline(false)}>Week</button>
      <button className="button secondary compact" aria-pressed={timeline} onClick={() => setTimeline(true)}>Time grid</button>
    </div>}
    <div className={todayOnly ? 'calendar-today' : 'calendar-week'}>
      {days.map(day => {
        const key = day.toString()
        const from = day.toZonedDateTime(zone).epochMilliseconds
        const until = day.add({ days: 1 }).toZonedDateTime(zone).epochMilliseconds
        const blocks = snapshot.blocks.filter(block => Date.parse(block.starts_at) < until && Date.parse(block.ends_at) > from)
        const due = snapshot.tasks.filter(task => task.due_date === key && task.status !== 'done' && active.some(project => project.id === task.project_id))
        const publishing = active.filter(project => (project.actual_publication_date ?? project.target_publication_date) === key)
        const dayMinutes = (until - from) / 60000
        const rowHeight = 55 * dayMinutes / 1440
        const laneEnds: number[] = []
        const timedBlocks = (timeline && !todayOnly ? blocks : []).map(block => {
          const start = Math.min(dayMinutes - 45, (Math.max(from, Date.parse(block.starts_at)) - from) / 60000)
          const end = Math.max(start + 45, (Math.min(until, Date.parse(block.ends_at)) - from) / 60000)
          const openLane = laneEnds.findIndex(value => value <= start)
          const lane = openLane === -1 ? laneEnds.length : openLane
          laneEnds[lane] = end
          return { block, start, end, lane }
        })
        const renderBlock = (block: Block) => {
          const task = snapshot.tasks.find(item => item.id === block.task_id)
          const project = snapshot.projects.find(item => item.id === block.project_id)
          const color = skills.find(skill => skill.id === task?.skill_id)?.color ?? '#7184C4'
          return <button key={block.id} className={`calendar-event event-${block.status}`} style={{ borderInlineStartColor: color }} onClick={() => edit(block)}>
            <small>{time.format(Math.max(from, Date.parse(block.starts_at)))}–{time.format(Math.min(until, Date.parse(block.ends_at)))}{block.status !== 'planned' && ` · ${block.status}`}</small>
            <strong>{task?.title ?? project?.name ?? 'Work block'}</strong>{task && <small>{project?.name}</small>}
          </button>
        }
        return <article className={`calendar-day ${key === today.toString() ? 'calendar-current' : ''}`} key={key}>
          <header><div><small>{dateLabel(day, { weekday: 'short' })}</small><strong>{day.day}</strong></div>
            <button className="icon-button" aria-label={`Schedule work on ${key}`} onClick={() => add(key)}><Plus size={16} /></button>
          </header>
          {publishing.map(project => <button key={project.id} className="calendar-event calendar-marker" onClick={() => openProject(project.id)}>
            <small>{project.actual_publication_date ? 'Published' : 'Publish target'}</small><strong>{project.name}</strong></button>)}
          {due.map(task => <button key={task.id} className="calendar-event calendar-marker" onClick={() => openProject(task.project_id)}>
            <small>Task due</small><strong>{task.title}</strong></button>)}
          {timeline && !todayOnly ? <div className="calendar-hours" style={{ minHeight: `${rowHeight}rem` }}>
            {Array.from({ length: Math.ceil(dayMinutes / 180) }, (_, index) => <div className="calendar-hour" key={index}
              style={{ top: `${index * 18000 / dayMinutes}%` }}><small>{time.format(from + index * 10800000)}</small></div>)}
            {timedBlocks.map(({ block, start, end, lane }) => {
              const width = 100 / laneEnds.length
              return <div className="calendar-timed" key={block.id} style={{
                top: `${100 * start / dayMinutes}%`, height: `${100 * (end - start) / dayMinutes}%`,
                insetInlineStart: `${lane * width}%`, width: `${width}%`,
              }}>{renderBlock(block)}</div>
            })}
          </div> : blocks.map(renderBlock)}
          {!timeline && !blocks.length && !publishing.length && !due.length && <small className="calendar-empty">No work scheduled</small>}
        </article>
      })}
    </div>
  </section>
}

export function BlockEditor({ snapshot, block, day, projectId, taskId, busy, error, close, save }: EditorProps & {
  snapshot: Snapshot; block?: Block; day?: string; projectId?: string; taskId?: string
}) {
  const [id] = useState(() => block?.id ?? crypto.randomUUID())
  const available = snapshot.projects.filter(project => !project.archived || project.id === block?.project_id)
  const [project, setProject] = useState(block?.project_id ?? projectId ?? available[0]?.id ?? '')
  const [task, setTask] = useState(block?.task_id ?? taskId ?? '')
  const [failure, setFailure] = useState('')
  const zone = block?.timezone ?? snapshot.profile.timezone
  const date = day ?? currentDay(zone).toString()
  const initialStart = block ? localInput(block.starts_at, zone) : `${date}T09:00`
  const estimate = snapshot.tasks.find(item => item.id === taskId)?.estimated_minutes ?? 30
  const initialEnd = block ? localInput(block.ends_at, zone)
    : Temporal.PlainDateTime.from(initialStart).add({ minutes: estimate }).toString({ smallestUnit: 'minute' })
  return <StudioDialog title={block ? 'Edit work block' : 'Schedule work'} description={`Times use ${zone}. Planned work is separate from logged sessions.`} close={() => { if (!busy) close() }}>
    {available.length ? <form className="form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      try {
        const start = String(data.get('start'))
        const end = String(data.get('end'))
        const startAt = block && start === initialStart ? block.starts_at : localInstant(start, zone)
        const endAt = block && end === initialEnd ? block.ends_at : localInstant(end, zone)
        if (Date.parse(endAt) <= Date.parse(startAt)) { setFailure('End time must be after start time.'); return }
        setFailure('')
        save({ p_id: id, p_project: project, p_task: task || null, p_start: startAt, p_end: endAt,
          p_timezone: zone, p_notes: data.get('notes'), p_status: data.get('status') })
      } catch { setFailure('Choose unambiguous local times outside the daylight-saving transition.') }
    }}>
      <label>Project<select value={project} onChange={event => { setProject(event.target.value); setTask('') }}>{available.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Task<select value={task} onChange={event => setTask(event.target.value)}><option value="">No task</option>
        {snapshot.tasks.filter(item => item.project_id === project).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="form-grid">
        <label>Start<input type="datetime-local" name="start" required defaultValue={initialStart} /></label>
        <label>End<input type="datetime-local" name="end" required defaultValue={initialEnd} /></label>
      </div>
      <label>Status<select name="status" defaultValue={block?.status ?? 'planned'}><option value="planned">Planned</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
      <label>Notes<textarea name="notes" defaultValue={block?.notes} rows={3} /></label>
      {(failure || error) && <p role="alert" className="form-error">{failure || error}</p>}
      <div className="form-actions"><button className="button primary" disabled={busy}>Save work block</button></div>
    </form> : <p>Create an active project before scheduling a work block.</p>}
  </StudioDialog>
}

export function TemplateEditor({ template, kind, busy, error, close, save }: EditorProps & {
  template?: Template; kind: Template['kind']
}) {
  const [id] = useState(() => template?.id ?? crypto.randomUUID())
  const [stages, setStages] = useState(() => (kind === 'stage'
    ? [{ name: '', tasks: template?.details.tasks ?? [] }]
    : template?.details.stages ?? [{ name: 'Script', tasks: [{ title: 'Finish the script', skill: 'scriptwriting', minutes: 25 }] }]
  ).map(stage => ({ ...stage, key: crypto.randomUUID(), tasks: stage.tasks.map(task => ({ ...task, key: crypto.randomUUID() })) })))

  function patchTask(stageKey: string, taskKey: string, patch: Partial<TaskPreset>) {
    setStages(items => items.map(stage => stage.key === stageKey
      ? { ...stage, tasks: stage.tasks.map(task => task.key === taskKey ? { ...task, ...patch } : task) } : stage))
  }
  return <StudioDialog title={template ? 'Edit preset' : `New ${kind} preset`} description="Make reusable changes for future projects and work." close={() => { if (!busy) close() }}>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      const stageDetails = stages.map(stage => ({ name: stage.name, tasks: stage.tasks.map(task => ({
        title: task.title, skill: task.skill, minutes: task.minutes, days_before_publish: task.days_before_publish,
      })) }))
      const details = kind === 'quest' || kind === 'task' ? {
        skill: data.get('skill'), ...(data.get('minutes') ? { minutes: Number(data.get('minutes')) } : {}),
        ...(data.get('bonus') ? { bonus: Number(data.get('bonus')) } : {}),
      } : kind === 'stage' ? { tasks: stageDetails[0].tasks }
        : { content_type: data.get('type'), stages: stageDetails }
      save({ p_id: id, p_kind: kind, p_name: data.get('name'), p_details: details })
    }}>
      <label>Name<input name="name" required maxLength={160} defaultValue={template?.name} /></label>
      {kind === 'quest' || kind === 'task' ? <>
        <label>Skill<select name="skill" defaultValue={template?.details.skill ?? 'editing'}>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
        <label>{kind === 'quest' ? 'Timer minutes (leave blank for a completion milestone)' : 'Estimated minutes'}<input name="minutes" type="number" min={1} max={1440} defaultValue={template?.details.minutes ?? (template ? '' : 25)} /></label>
        {kind === 'quest' && <label>Milestone completion XP<input name="bonus" type="number" min={0} max={10000} defaultValue={template?.details.bonus ?? 10} /></label>}
      </> : <>
        {kind === 'project' && <label>Content type<input name="type" required maxLength={80} defaultValue={template?.details.content_type ?? 'Video'} /></label>}
        {stages.map(stage => <fieldset key={stage.key} className="form preset-stage">
          {kind === 'project' && <label>Stage name<input required maxLength={120} value={stage.name} onChange={event => {
            setStages(items => items.map(item => item.key === stage.key ? { ...item, name: event.target.value } : item))
          }} /></label>}
          {stage.tasks.map(task => <div key={task.key} className="form preset-task">
            <label>Task title<input required maxLength={160} value={task.title} onChange={event => patchTask(stage.key, task.key, { title: event.target.value })} /></label>
            <div className="form-grid">
              <label>Skill<select value={task.skill} onChange={event => patchTask(stage.key, task.key, { skill: event.target.value })}>
                {skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
              <label>Estimated minutes<input type="number" min={1} max={1440} value={task.minutes ?? ''} onChange={event => patchTask(stage.key, task.key, { minutes: event.target.value ? Number(event.target.value) : undefined })} /></label>
            </div>
            {kind === 'project' && <label>Days before target publication<input type="number" min={0} max={365}
              value={task.days_before_publish ?? ''} onChange={event => patchTask(stage.key, task.key, {
                days_before_publish: event.target.value ? Number(event.target.value) : undefined,
              })} /></label>}
            <button className="text-button" type="button" onClick={() => {
              setStages(items => items.map(item => item.key === stage.key ? { ...item, tasks: item.tasks.filter(entry => entry.key !== task.key) } : item))
            }}>Remove task</button>
          </div>)}
          <div className="actions">
            <button className="button secondary compact" type="button" onClick={() => {
              const entry = { key: crypto.randomUUID(), title: '', skill: 'editing', minutes: 25 }
              setStages(items => items.map(item => item.key === stage.key ? { ...item, tasks: [...item.tasks, entry] } : item))
            }}>Add task</button>
            {kind === 'project' && <button className="text-button" type="button" onClick={() => {
              setStages(items => items.filter(item => item.key !== stage.key))
            }}>Remove stage</button>}
          </div>
        </fieldset>)}
        {kind === 'project' && <button className="button secondary compact" type="button" onClick={() => {
          const stage = { key: crypto.randomUUID(), name: '', tasks: [] }
          setStages(items => [...items, stage])
        }}>Add stage</button>}
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        {template && <button className="text-button danger-text push" type="button" disabled={busy}
          onClick={() => save({ p_id: id, p_kind: kind, p_name: template.name, p_details: {}, p_delete: true })}>Delete preset</button>}
        <button className="button primary" disabled={busy}>Save preset</button>
      </div>
    </form>
  </StudioDialog>
}

export function Insights({ snapshot }: { snapshot: Snapshot }) {
  const zone = snapshot.profile.timezone
  const today = currentDay(zone)
  const days = Array.from({ length: 7 }, (_, i) => today.subtract({ days: 6 - i }))
  const rows = days.map(day => ({
    day,
    minutes: snapshot.sessions.filter(session => localInput(session.started_at, zone).startsWith(day.toString())).reduce((sum, session) => sum + session.minutes, 0),
    xp: snapshot.ledger.filter(award => localInput(award.earned_at, zone).startsWith(day.toString())).reduce((sum, award) => sum + award.xp, 0),
  }))
  const max = Math.max(1, ...rows.map(row => row.minutes))
  return <section className="panel"><div className="panel-heading"><h2>Last seven days</h2></div>
    <div className="insight-totals"><div><strong>{rows.reduce((sum, row) => sum + row.minutes, 0)}</strong> minutes logged</div>
      <div><strong>{rows.reduce((sum, row) => sum + row.xp, 0)}</strong> XP earned</div></div>
    <ul className="insight-chart" aria-label="Daily work minutes and XP">{rows.map(row => <li key={row.day.toString()}>
      <span>{dateLabel(row.day, { weekday: 'short' })}</span>
      <span className="insight-track"><span style={{ width: `${100 * row.minutes / max}%` }} /></span>
      <small>{row.minutes} min · {row.xp} XP</small>
    </li>)}</ul>
  </section>
}
