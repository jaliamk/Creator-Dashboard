import { useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { StudioDialog } from '@/components/ui/dialog'
import { localInput, skills, stageKey, workflow, type Block, type CalendarDay, type Snapshot, type TaskPreset, type Template } from '@/lib/studio'

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

type CalendarBlock = Block & { daily?: CalendarDay }

export function Planner({ snapshot, todayOnly, edit, editDay, moveDay, add, openProject, busy, reschedule, timeDay }: {
  snapshot: Snapshot; todayOnly?: boolean; edit: (block: Block) => void; editDay: (day: CalendarDay) => void; moveDay: (day: CalendarDay, date: string) => void; timeDay: (day: CalendarDay,start: string,end: string) => void; add: (day: string) => void; openProject: (id: string) => void; busy: boolean; reschedule: (block: Block,start: string,end: string) => void
}) {
  const [offset, setOffset] = useState(0)
  const [timeline, setTimeline] = useState(false)
  const resize = useRef<{ y: number; edge: 'start'|'end' }>(null)
  const [resizeGuide,setResizeGuide]=useState<{ id:string; edge:'start'|'end'; minutes:number }>()
  const [moveError,setMoveError]=useState('')
  const zone = snapshot.profile.timezone
  const today = currentDay(zone)
  const monday = today.subtract({ days: today.dayOfWeek - 1 }).add({ weeks: offset })
  const days = todayOnly ? [today] : Array.from({ length: 7 }, (_, i) => monday.add({ days: i }))
  const time = new Intl.DateTimeFormat('en', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
  const [showCompleted,setShowCompleted] = useState(false)
  const active = snapshot.projects.filter(project => !project.archived)
  const byProject = new Map(active.map(project => [project.id,project]))
  const byTask = new Map(snapshot.tasks.map(task => [task.id,task]))
  const dailyId = (day: CalendarDay) => `${day.task_id}:${day.day}`
  const daily = snapshot.calendar_days.filter(day => {
    const project = byProject.get(day.project_id)
    const task = byTask.get(day.task_id)
    return project && task?.production_key && (showCompleted || task.status !== 'done')
      && (project.workflow_stage !== 'published' || day.day < today.toString())
  })
  const timed: CalendarBlock[] = [...snapshot.blocks.filter(block => {
    const project = byProject.get(block.project_id)
    return project && (project.workflow_stage!=='published' || Date.parse(block.starts_at)<today.toZonedDateTime(zone).epochMilliseconds)
      && (showCompleted || (block.status==='planned' && (!block.task_id || byTask.get(block.task_id)?.status!=='done')))
  }), ...daily.flatMap(day =>
    day.starts_at && day.ends_at ? [{
      id: dailyId(day), project_id: day.project_id, task_id: day.task_id, starts_at: day.starts_at,
      ends_at: day.ends_at, timezone: day.timezone ?? zone, status: 'planned' as const, notes: '', daily: day,
    }] : [])]
  const phaseColor = (projectId: string, taskId: string | null) => {
    const project = snapshot.projects.find(item => item.id === projectId)
    const task = snapshot.tasks.find(item => item.id === taskId)
    const phase = snapshot.stages.find(item => item.id === task?.stage_id)
    return workflow[task ? task.production_key ?? stageKey(phase?.name, task.skill_id) : project?.workflow_stage ?? 'ideation'].color
  }
  function saveTime(block: CalendarBlock, start: number, end: number) {
    if (block.daily) timeDay(block.daily,new Date(start).toISOString(),new Date(end).toISOString())
    else reschedule(block,new Date(start).toISOString(),new Date(end).toISOString())
  }
  function drop(event: DragEvent<HTMLElement>, day: string, from?: number, until?: number) {
    event.preventDefault()
    event.stopPropagation()
    if(busy) return
    const dragged = event.dataTransfer.getData('application/creator-block')
    const entry = daily.find(item => dailyId(item)===dragged)
    if (entry && entry.day!==day) { moveDay(entry,day);return }
    const block=timed.find(item=>item.id===dragged)
    if(!block || (block.daily && from===undefined)) return
    const duration=Date.parse(block.ends_at)-Date.parse(block.starts_at)
    try {
      let start: number
      if(from!==undefined && until!==undefined){
        const bounds=event.currentTarget.getBoundingClientRect()
        const minutes=Math.round((event.clientY-bounds.top)/bounds.height*(until-from)/900000)*15
        start=Math.max(from,Math.min(until-900000,from+minutes*60000))
      }else{
        const clock=localInput(block.starts_at,zone).slice(11)
        start=Date.parse(localInstant(`${day}T${clock}`,zone))
      }
      if (block.daily && from !== undefined && until !== undefined) start = Math.max(from, Math.min(start, until - duration))
      if(start!==Date.parse(block.starts_at)) saveTime(block,start,start+duration)
      setMoveError('')
    }catch{setMoveError('Choose a different time outside the daylight-saving transition.')}
  }

  function startResize(event:PointerEvent<HTMLElement>,edge:'start'|'end'){
    if(busy || event.button!==0)return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resize.current={y:event.clientY,edge}
  }
  function resizeMinutes(event:PointerEvent<HTMLElement>,row:HTMLElement,minutes:number){
    const height=row.getBoundingClientRect().height
    return Math.round((event.clientY-(resize.current?.y??event.clientY))/height*minutes/15)*15
  }
  function finishResize(event:PointerEvent<HTMLElement>,block:CalendarBlock,minutes:number,from:number,until:number){
    const operation=resize.current
    const row=event.currentTarget.closest<HTMLElement>('.calendar-hours')
    if(!operation || !row)return
    const delta=resizeMinutes(event,row,minutes)*60000
    resize.current=null
    setResizeGuide(undefined)
    if(!delta)return
    const start=Date.parse(block.starts_at)
    const end=Date.parse(block.ends_at)
    const minimum=Math.min(end-start,900000)
    const nextStart=operation.edge==='start'?Math.min(start+delta,end-minimum):start
    const nextEnd=operation.edge==='end'?Math.max(end+delta,start+minimum):end
    saveTime(block,block.daily?Math.max(from,nextStart):nextStart,block.daily?Math.min(until,nextEnd):nextEnd)
  }

  return <section className="panel planner-panel" aria-label={todayOnly ? 'Today’s schedule' : 'Weekly production calendar'}>
    <div className="panel-heading planner-heading">
      <div><h2><CalendarDays size={20} />{todayOnly ? 'Today’s schedule' : dateLabel(monday, { month: 'long', year: 'numeric' })}</h2>
        <p className="muted">{todayOnly ? dateLabel(today, { dateStyle: 'full' }) : 'Weekly calendar'} · {zone}</p></div>
      <label className="calendar-completed"><input type="checkbox" checked={showCompleted} onChange={event=>setShowCompleted(event.target.checked)}/> Show completed</label>
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
    {moveError&&<p role="alert" className="form-error">{moveError}</p>}
    <div className={todayOnly ? 'calendar-today' : 'calendar-week'}>
      {days.map(day => {
        const key = day.toString()
        const from = day.toZonedDateTime(zone).epochMilliseconds
        const until = day.add({ days: 1 }).toZonedDateTime(zone).epochMilliseconds
        const entries = daily.filter(entry => entry.day === key)
        const blocks = timed.filter(block => block.daily ? block.daily.day === key :
          Date.parse(block.starts_at) < until && Date.parse(block.ends_at) > from)
          .sort((a,b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        const due = snapshot.tasks.filter(task => task.production_key && task.due_date === key && (showCompleted || task.status!=='done') && !entries.some(entry=>entry.task_id===task.id) && byProject.get(task.project_id)?.workflow_stage!=='published' && byProject.has(task.project_id))
        const targets = active.filter(project => project.workflow_stage!=='published' && project.target_publication_date===key && !snapshot.publications.some(item=>item.source_project_id===project.id))
        const publishing = snapshot.publications.filter(item => item.published_on===key)
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
        const renderBlock = (block: CalendarBlock) => {
          const task = snapshot.tasks.find(item => item.id === block.task_id)
          const project = snapshot.projects.find(item => item.id === block.project_id)
          const color = phaseColor(block.project_id,block.task_id)
          return <button key={block.id} className={`calendar-event event-${block.status}`} style={{ borderInlineStartColor: color }}
            draggable={!busy} onDragStart={event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/creator-block',block.id)}} onClick={() => block.daily ? editDay(block.daily) : edit(block)}>
            <small>{time.format(block.daily ? Date.parse(block.starts_at) : Math.max(from, Date.parse(block.starts_at)))}–{time.format(block.daily ? Date.parse(block.ends_at) : Math.min(until, Date.parse(block.ends_at)))}{block.status !== 'planned' && ` · ${block.status}`}</small>
            <strong>{task ? workflow[task.production_key ?? stageKey(snapshot.stages.find(stage=>stage.id===task.stage_id)?.name,task.skill_id)].name : project?.name ?? 'Work block'}</strong>{task && <small>{project?.name}{task.status==='done'?' · Task done':''}</small>}
          </button>
        }
        return <article className={`calendar-day ${key === today.toString() ? 'calendar-current' : ''}`} key={key}
          onDragOver={event=>{if(!busy && event.dataTransfer.types.includes('application/creator-block'))event.preventDefault()}}
          onDrop={event=>drop(event,key)}>
          <header><div><small>{dateLabel(day, { weekday: 'short' })}</small><strong>{day.day}</strong></div>
            <button className="icon-button" aria-label={`Schedule work on ${key}`} onClick={() => add(key)}><Plus size={16} /></button>
          </header>
          {publishing.map(publication => <button key={publication.source_project_id} className="calendar-event calendar-marker"
            disabled={!byProject.has(publication.source_project_id)} style={{ borderInlineStartColor:workflow.published.color }}
            onClick={()=>openProject(publication.source_project_id)}><small>Published</small><strong>{publication.title}</strong></button>)}
          {targets.map(project => <button key={project.id} className="calendar-event calendar-marker"
            style={{ borderInlineStartColor:workflow.preparing.color }} onClick={()=>openProject(project.id)}>
            <small>Publish target</small><strong>{project.name}</strong></button>)}
          {due.map(task => <button key={task.id} className="calendar-event calendar-marker" style={{ borderInlineStartColor: phaseColor(task.project_id,task.id) }} onClick={() => openProject(task.project_id)}>
            <small>Task due</small><strong>{task.title}</strong></button>)}
          {entries.filter(entry => !entry.starts_at).map(entry => {
            const task = snapshot.tasks.find(item => item.id === entry.task_id)
            const project = active.find(item => item.id === entry.project_id)
            return <button key={dailyId(entry)} className="calendar-event calendar-all-day" onClick={() => editDay(entry)} draggable={!busy}
              onDragStart={event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/creator-block',dailyId(entry))}}
              style={{ borderInlineStartColor: phaseColor(entry.project_id,entry.task_id) }}>
              <small>All day{task?.status === 'done' ? ' · Done' : ''}</small><strong>{task?.title}</strong><small>{project?.name}</small>
            </button>
          })}
          {timeline && !todayOnly ? <div className="calendar-hours" style={{ minHeight: `${rowHeight}rem` }} onDrop={event=>drop(event,key,from,until)}>
            {Array.from({ length: Math.ceil(dayMinutes / 180) }, (_, index) => <div className="calendar-hour" key={index}
              style={{ top: `${index * 18000 / dayMinutes}%` }}><small>{time.format(from + index * 10800000)}</small></div>)}
            {timedBlocks.map(({ block, start, end, lane }) => {
              const width = 100 / laneEnds.length
              const shifting=resizeGuide?.id===block.id?resizeGuide:undefined
              const visualStart=shifting?.edge==='start'?Math.min(start+shifting.minutes,end-15):start
              const visualEnd=shifting?.edge==='end'?Math.max(end+shifting.minutes,start+15):end
              return <div className="calendar-timed" key={block.id} style={{
                top: `${100 * visualStart / dayMinutes}%`, height: `${100 * (visualEnd - visualStart) / dayMinutes}%`,
                insetInlineStart: `${lane * width}%`, width: `${width}%`,
              }}>{renderBlock(block)}
                {(['start','end'] as const).map(edge=><span key={edge} aria-hidden="true" className={`calendar-resize ${edge}`}
                  onPointerDown={event=>startResize(event,edge)} onPointerMove={event=>{
                    if(!resize.current)return
                    const row=event.currentTarget.closest<HTMLElement>('.calendar-hours')
                    if(row)setResizeGuide({id:block.id,edge,minutes:resizeMinutes(event,row,dayMinutes)})
                  }} onPointerUp={event=>finishResize(event,block,dayMinutes,from,until)}
                  onPointerCancel={()=>{resize.current=null;setResizeGuide(undefined)}}/>)}
              </div>
            })}
          </div> : blocks.map(renderBlock)}
          {!timeline && !blocks.length && !entries.length && !publishing.length && !targets.length && !due.length && <small className="calendar-empty">No work scheduled</small>}
        </article>
      })}
    </div>
  </section>
}

function dayClock(instant: string, zone: string) {
  return localInput(instant, zone).slice(11)
}

export function CalendarDayEditor({ entry, snapshot, busy, error, close, save }: EditorProps & {
  entry: CalendarDay; snapshot: Snapshot
}) {
  const zone = entry.timezone ?? snapshot.profile.timezone
  const [start,setStart] = useState(entry.starts_at ? dayClock(entry.starts_at,zone) : '09:00')
  const [end,setEnd] = useState(entry.ends_at ? dayClock(entry.ends_at,zone) : '09:30')
  const [failure,setFailure] = useState('')
  const [durationInput,setDurationInput] = useState<string>()
  const task = snapshot.tasks.find(item => item.id === entry.task_id)
  const day = Temporal.PlainDate.from(entry.day)
  const nextDay = day.add({days:1}).toString()
  function instant(clock: string, endTime = false) {
    return localInstant(`${endTime && clock === '00:00' ? nextDay : entry.day}T${clock}`,zone)
  }
  const args = { p_task: entry.task_id, p_day: entry.day }
  let duration = ''
  try {
    const difference = (Date.parse(instant(end,true)) - Date.parse(instant(start))) / 60000
    if (difference > 0) duration = String(difference)
  } catch { /* The form reports invalid or ambiguous times when submitted. */ }
  function durationEnd(value: string) {
    const minutes = Number(value)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1500) throw new RangeError()
    const target = Temporal.Instant.from(instant(start)).add({minutes}).toZonedDateTimeISO(zone)
    if (target.toPlainDate().toString() !== entry.day && !(target.toPlainDate().toString() === nextDay && target.hour === 0 && target.minute === 0)) {
      throw new RangeError()
    }
    return target
  }
  return <StudioDialog title={task?.title ?? 'Daily task'} description={`${entry.day} · ${zone}. These times apply to this day.`}
    close={() => {if (!busy) close()}}>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      try {
        const p_start = entry.starts_at && start === dayClock(entry.starts_at,zone) ? entry.starts_at : instant(start)
        const p_end = durationInput !== undefined ? durationEnd(durationInput).toInstant().toString()
          : entry.ends_at && end === dayClock(entry.ends_at,zone) ? entry.ends_at : instant(end,true)
        if (Date.parse(p_end) <= Date.parse(p_start)) {setFailure('The end must be after the start.');return}
        save({...args,p_start,p_end,p_timezone:zone})
      } catch {setFailure('Choose valid local times within this day.')}
    }}>
      <div className="form-grid">
        <label>Start time<input required type="time" value={start} onChange={event => {setStart(event.target.value);setDurationInput(undefined)}}/></label>
        <label>End time<input required type="time" value={end} onChange={event => {setEnd(event.target.value);setDurationInput(undefined)}}/></label>
      </div>
      <label>Duration (minutes)<input type="number" min={1} max={1500} value={durationInput ?? duration}
        onChange={event => setDurationInput(event.target.value)} onBlur={() => {
          if (durationInput === undefined) return
          try {
            const target = durationEnd(durationInput)
            setEnd(target.toPlainTime().toString({smallestUnit:'minute'}))
            setDurationInput(undefined)
            setFailure('')
          } catch {setFailure('Choose a duration that ends within this day.')}
        }}/></label>
      {(failure||error) && <p className="form-error" role="alert">{failure||error}</p>}
      <div className="form-actions">
        {entry.starts_at && <button type="button" className="text-button push" disabled={busy}
          onClick={() => save({...args,p_start:null,p_end:null,p_timezone:null})}>Set all day</button>}
        <button className="button primary" disabled={busy}>Save time</button>
      </div>
    </form>
  </StudioDialog>
}

export function BlockEditor({ snapshot, block, duplicate, copy, day, projectId, taskId, busy, error, close, save }: EditorProps & {
  snapshot: Snapshot; block?: Block; duplicate?: boolean; copy: (block: Block) => void; day?: string; projectId?: string; taskId?: string
}) {
  const [id] = useState(() => !duplicate && block ? block.id : crypto.randomUUID())
  const available = snapshot.projects.filter(project => (!project.archived && project.workflow_stage!=='published') || project.id === block?.project_id)
  const [project, setProject] = useState(block?.project_id ?? projectId ?? available[0]?.id ?? '')
  const [task, setTask] = useState(block?.task_id ?? taskId ?? '')
  const [failure, setFailure] = useState('')
  const zone = block?.timezone ?? snapshot.profile.timezone
  const date = day ?? currentDay(zone).toString()
  const initialStart = block ? localInput(block.starts_at, zone) : `${date}T09:00`
  const estimate = snapshot.tasks.find(item => item.id === taskId)?.estimated_minutes ?? 30
  const initialEnd = block ? localInput(block.ends_at, zone)
    : Temporal.PlainDateTime.from(initialStart).add({ minutes: estimate }).toString({ smallestUnit: 'minute' })
  return <StudioDialog title={duplicate ? 'Duplicate work block' : block ? 'Edit work block' : 'Schedule work'} description={`Times use ${zone}. Planned work is separate from logged sessions.`} close={() => { if (!busy) close() }}>
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
      <label>Status<select name="status" defaultValue={duplicate ? 'planned' : block?.status ?? 'planned'}><option value="planned">Planned</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
      <label>Notes<textarea name="notes" defaultValue={block?.notes} rows={3} /></label>
      {(failure || error) && <p role="alert" className="form-error">{failure || error}</p>}
      <div className="form-actions">
        {block && !duplicate && <button type="button" className="text-button push" disabled={busy} onClick={()=>copy(block)}>Duplicate work block</button>}
        <button className="button primary" disabled={busy}>Save work block</button></div>
    </form> : <p>Create an active project before scheduling a work block.</p>}
  </StudioDialog>
}

export function TemplateEditor({ template, kind, busy, error, close, save }: EditorProps & {
  template?: Template; kind: Template['kind']
}) {
  const [id] = useState(() => template?.id ?? crypto.randomUUID())
  const [stages, setStages] = useState(() => (kind === 'stage'
    ? [{ name: '', duration_days: 1, tasks: template?.details.tasks ?? [] }]
    : template?.details.stages ?? [{ name: 'Script', duration_days: 2, tasks: [{ title: 'Finish the script', skill: 'scriptwriting', minutes: 25 }] }]
  ).map(stage => ({ ...stage, key: crypto.randomUUID(), tasks: stage.tasks.map(task => ({ ...task, key: crypto.randomUUID() })) })))

  function patchTask(stageKey: string, taskKey: string, patch: Partial<TaskPreset>) {
    setStages(items => items.map(stage => stage.key === stageKey
      ? { ...stage, tasks: stage.tasks.map(task => task.key === taskKey ? { ...task, ...patch } : task) } : stage))
  }
  function reorder<T>(items: T[], index: number, offset: number) {
    const next = [...items]
    const [item] = next.splice(index, 1)
    next.splice(index + offset, 0, item)
    return next
  }
  return <StudioDialog title={template ? 'Edit preset' : `New ${kind} preset`} description="Make reusable changes for future projects and work." close={() => { if (!busy) close() }}>
    <form className="form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      const stageDetails = stages.map(stage => ({ name: stage.name, duration_days: stage.duration_days, tasks: stage.tasks.map(task => ({
        title: task.title, skill: task.skill, minutes: task.minutes, days_before_publish: task.days_before_publish, bonus: task.bonus,
      })) }))
      const details = kind === 'quest' || kind === 'task' ? {
        skill: data.get('skill'), ...(data.get('minutes') ? { minutes: Number(data.get('minutes')) } : {}),
        ...(template?.details.bonus !== undefined ? { bonus: template.details.bonus } : {}),
      } : kind === 'stage' ? { tasks: stageDetails[0].tasks }
        : { content_type: data.get('type'), stages: stageDetails }
      save({ p_id: id, p_kind: kind, p_name: data.get('name'), p_details: details })
    }}>
      <label>Name<input name="name" required maxLength={160} defaultValue={template?.name} /></label>
      {kind === 'quest' || kind === 'task' ? <>
        <label>Skill<select name="skill" defaultValue={template?.details.skill ?? 'editing'}>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
        <label>{kind === 'quest' ? 'Timer minutes (leave blank for a completion milestone)' : 'Estimated minutes'}<input name="minutes" type="number" min={1} max={1440} defaultValue={template?.details.minutes ?? (template ? '' : 25)} /></label>
      </> : <>
        {kind === 'project' && <label>Content type<input name="type" required maxLength={80} defaultValue={template?.details.content_type ?? 'Video'} /></label>}
        {stages.map((stage, stageIndex) => <fieldset key={stage.key} className="form preset-stage">
          {kind === 'project' && <label>Stage name<input required maxLength={120} value={stage.name} onChange={event => {
            setStages(items => items.map(item => item.key === stage.key ? { ...item, name: event.target.value } : item))
          }} /></label>}
          {kind === 'project' && <div className="form-grid">
            <label>Default stage duration (days)<input required type="number" min={1} max={365} value={stage.duration_days ?? 1} onChange={event => {
              const value = Number(event.target.value)
              setStages(items => items.map(item => item.key === stage.key ? { ...item, duration_days: value } : item))
            }} /></label>
            <div className="actions">
              <button type="button" className="icon-button" disabled={stageIndex===0} aria-label="Move stage up" onClick={() => setStages(items => reorder(items,stageIndex,-1))}><ArrowUp size={16} /></button>
              <button type="button" className="icon-button" disabled={stageIndex===stages.length-1} aria-label="Move stage down" onClick={() => setStages(items => reorder(items,stageIndex,1))}><ArrowDown size={16} /></button>
            </div>
          </div>}
          {stage.tasks.map((task,taskIndex) => <div key={task.key} className="form preset-task">
            <label>Task title<input required maxLength={160} value={task.title} onChange={event => patchTask(stage.key, task.key, { title: event.target.value })} /></label>
            <div className="form-grid">
              <label>Skill<select value={task.skill} onChange={event => patchTask(stage.key, task.key, { skill: event.target.value })}>
                {skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
              <label>Estimated minutes<input type="number" min={1} max={1440} value={task.minutes ?? ''} onChange={event => patchTask(stage.key, task.key, { minutes: event.target.value ? Number(event.target.value) : undefined })} /></label>
            </div>
            <div className="actions">
              {([-1,1] as const).map(direction => <button key={direction} type="button" className="icon-button"
                aria-label={`Move task ${direction===-1?'up':'down'}`} disabled={taskIndex+direction<0 || taskIndex+direction>=stage.tasks.length}
                onClick={() => setStages(items => items.map(item => item.key===stage.key ? { ...item,tasks:reorder(item.tasks,taskIndex,direction) } : item))}>
                {direction===-1?<ArrowUp size={15}/>:<ArrowDown size={15}/>}
              </button>)}
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
          const stage = { key: crypto.randomUUID(), name: '', duration_days: 1, tasks: [] }
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
  }))
  const max = Math.max(1, ...rows.map(row => row.minutes))
  return <section className="panel"><div className="panel-heading"><h2>Last seven days</h2></div>
    <div className="insight-totals"><div><strong>{rows.reduce((sum, row) => sum + row.minutes, 0)}</strong> minutes logged</div>
      </div>
    <ul className="insight-chart" aria-label="Daily work minutes">{rows.map(row => <li key={row.day.toString()}>
      <span>{dateLabel(row.day, { weekday: 'short' })}</span>
      <span className="insight-track"><span style={{ width: `${100 * row.minutes / max}%` }} /></span>
      <small>{row.minutes} min</small>
    </li>)}</ul>
  </section>
}
