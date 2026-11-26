import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { Check, ChevronRight, RotateCcw } from 'lucide-react'
import { StudioDialog } from '@/components/ui/dialog'
import { currentDay } from '@/components/planner'
import { stageKey, workflow, type Project, type Snapshot, type Span, type Task } from '@/lib/studio'

export type SpanItem = Span & { id: string; project_id: string; title: string; kind: 'stage' | 'task' }
type Row = SpanItem & { progress: number; color?: string; task?: Task; depth: number; collapsible?: boolean }
type Mode = 'move' | 'start' | 'end'
type Drag = { row: Row; pointer: number; x: number; scrollLeft: number; delta: number; mode: Mode }
const calendarDate = (value: string) => Temporal.PlainDate.from(value)
const distance = (a: string,b: string) => calendarDate(a).until(calendarDate(b)).days
const shift = (date: string,days: number) => calendarDate(date).add({ days }).toString()

function moved(row: Row, delta: number, mode: Mode): [string,string] {
  const originalStart = row.planned_start!
  const originalEnd = row.planned_end!
  const start = mode === 'end' ? originalStart : shift(originalStart,delta)
  const end = mode === 'start' ? originalEnd : shift(originalEnd,delta)
  if (start > end) return mode === 'start' ? [end,end] : [start,start]
  return [start,end]
}

export function ProductionTimeline({ snapshot, project, busy, undo, edit, move, complete, openTask, openProject }: {
  snapshot: Snapshot; project?: Project; busy: boolean; undo?: () => void; edit: (item: SpanItem) => void;
  move: (item: SpanItem,start: string,end: string) => void; complete: (task: Task) => void;
  openTask: (task: Task) => void; openProject: (project: Project) => void
}) {
  const [scale,setScale] = useState<'day'|'week'|'month'>('day')
  const [closed,setClosed] = useState<string[]>([])
  const [extra,setExtra] = useState(0)
  const [past,setPast] = useState(0)
  const [drag,setDrag] = useState<Drag>()
  const scroll = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const scrollbar = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const viewport = scroll.current
    const grid = content.current
    const slider = scrollbar.current
    if (!viewport || !grid || !slider) return

    const syncPosition = () => {
      slider.value = String(Math.round(Math.max(0, viewport.scrollLeft)))
    }
    const syncSize = () => {
      const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      slider.max = String(max)
      slider.disabled = max === 0
      slider.style.setProperty('--gantt-thumb', `${viewport.clientWidth / Math.max(1, viewport.scrollWidth) * 100}%`)
      syncPosition()
    }
    const resize = new ResizeObserver(syncSize)
    resize.observe(viewport)
    resize.observe(grid)
    viewport.addEventListener('scroll', syncPosition, { passive: true })
    const shiftWheel = (event: WheelEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.deltaX || !event.deltaY || !event.cancelable) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1
      const next = Math.min(viewport.scrollWidth - viewport.clientWidth, Math.max(0, viewport.scrollLeft + event.deltaY * unit))
      if (next === viewport.scrollLeft) return
      event.preventDefault()
      viewport.scrollLeft = next
    }
    viewport.addEventListener('wheel', shiftWheel, { passive: false })
    syncSize()
    return () => {
      resize.disconnect()
      viewport.removeEventListener('scroll', syncPosition)
      viewport.removeEventListener('wheel', shiftWheel)
    }
  }, [])
  const today = currentDay(snapshot.profile.timezone).toString()
  const projects = project ? [project] : snapshot.projects.filter(item => !item.archived)
  const projectIds = new Set(projects.map(item => item.id))
  const assigned = snapshot.tasks.filter(task => projectIds.has(task.project_id))
  const stages = snapshot.stages.filter(stage => projectIds.has(stage.project_id))
  const rowsForProject = (video: Project): Row[] => {
    const tasks = assigned.filter(task => task.project_id===video.id)
    const taskRow = (task: Task): Row => ({
      ...task, kind:'task', task, depth:task.stage_id ? 1 : 0, progress:Number(task.status==='done'),
      color:workflow[stageKey(stages.find(item=>item.id===task.stage_id)?.name,task.skill_id)].color,
    })
    const phases = stages.filter(stage => stage.project_id===video.id).flatMap(stage => {
      const children=tasks.filter(task=>task.stage_id===stage.id)
      const row:Row = { ...stage, title:stage.name, kind:'stage', depth:0, collapsible:Boolean(project && children.length),
        progress:children.length?children.filter(task=>task.status==='done').length/children.length:0, color:workflow[stageKey(stage.name)].color }
      return [row,...(project && !closed.includes(stage.id) ? children.map(taskRow) : [])]
    })
    return [...phases,...(project ? tasks.filter(task=>!task.stage_id).map(taskRow) : [])]
  }
  const groupRows = projects.map(item=>({ item, rows: rowsForProject(item) }))
  const dates = [today,...projects.flatMap(item=>[item.start_date,item.target_publication_date,item.actual_publication_date]),
    ...[...stages,...assigned].flatMap(item=>[item.planned_start,item.planned_end])].filter((value):value is string=>Boolean(value)).sort()
  const from = shift(dates[0],-past)
  const latest = dates.at(-1)!
  const step = scale==='day'?1:scale==='week'?7:30
  const px = scale==='day'?42:scale==='week'?17:5
  const days = Math.max(distance(from,latest) + 16 + extra, 31)
  const width = days * px
  const tick = scale==='month' ? (()=> {
    const first=calendarDate(from).with({ day:1 })
    const end=calendarDate(shift(from,days))
    const months=first.until(end,{ largestUnit:'months' }).months
    return Array.from({length:months+1},(_,index)=>first.add({months:index}).toString()).filter(value=>value>=from)
  })() : Array.from({length:Math.ceil(days/step)},(_,index)=>shift(from,index*step))
  const todayOffset = distance(from, today) * px
  const monthGrid = scale === 'month' && tick.length
    ? `linear-gradient(to right, ${tick.flatMap(date => {
        const x = distance(from, date) * px
        return [`transparent ${x}px`, `var(--line) ${x}px`, `var(--line) ${x + 1}px`, `transparent ${x + 1}px`]
      }).join(', ')})`
    : undefined
  const layout = {
    '--gantt-width': `${width}px`,
    '--gantt-step': `${step * px}px`,
    '--gantt-week': `${px * 7}px`,
    '--gantt-weekend': `${px * 5}px`,
    '--gantt-week-offset': `${-(calendarDate(from).dayOfWeek - 1) * px}px`,
    '--gantt-today': `${todayOffset}px`,
    '--gantt-day': `${px}px`,
    '--gantt-grid-lines': monthGrid,
  } as CSSProperties
  const todayIndicator = <span className="gantt-now" aria-hidden="true" />
  const label = (date: string) => calendarDate(date).toLocaleString('en',scale==='month'?{month:'short',year:'2-digit'}:{month:'short',day:'numeric'})

  function begin(event: PointerEvent<HTMLElement>,row: Row,mode: Mode) {
    if (busy || event.button!==0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ row, pointer:event.pointerId,x:event.clientX,scrollLeft:scroll.current?.scrollLeft ?? 0,delta:0,mode })
  }

  function update(event: PointerEvent<HTMLElement>) {
    if (drag?.pointer!==event.pointerId) return
    const delta=Math.round((event.clientX-drag.x+(scroll.current?.scrollLeft ?? 0)-drag.scrollLeft)/px)
    if(delta!==drag.delta) setDrag({ ...drag,delta })
  }

  function finish(event: PointerEvent<HTMLElement>) {
    if (drag?.pointer!==event.pointerId) return
    const delta=Math.round((event.clientX-drag.x+(scroll.current?.scrollLeft ?? 0)-drag.scrollLeft)/px)
    setDrag(undefined)
    if(delta) {
      const [start,end]=moved(drag.row,delta,drag.mode)
      move(drag.row,start,end)
    } else if(drag.mode==='move') edit(drag.row)
  }

  return <section className="panel gantt" style={layout} data-scale={scale} aria-label={project ? 'Project timeline' : 'Master timeline'}>
    <header className="gantt-toolbar">
      <h2>{project ? 'Project timeline' : 'Master timeline'}</h2>
      <div className="actions">
        <label>Scale <select value={scale} onChange={event=>setScale(event.target.value as typeof scale)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
        <button className="button secondary compact" onClick={() => {
          const viewport = scroll.current
          const labelWidth = viewport?.querySelector('.gantt-label')?.getBoundingClientRect().width ?? 0
          if (viewport) viewport.scrollLeft = Math.max(0, todayOffset - Math.max(0, (viewport.clientWidth - labelWidth) / 2 - px / 2))
        }}>Today</button>
        <button className="button secondary compact" onClick={()=>setPast(past+30)}>Earlier</button>
        <button className="button secondary compact" onClick={()=> {
          setExtra(extra+45)
          requestAnimationFrame(()=>scroll.current?.scrollBy({left:Math.min(45*px,700),behavior:'smooth'}))
        }}>Later</button>
        <button className="button secondary compact" disabled={!undo || busy} onClick={undo}><RotateCcw size={15}/> Undo</button>
      </div>
    </header>
    <div className="gantt-scroll" ref={scroll} tabIndex={0} aria-label="Scrollable production timeline">
      <div className="gantt-content" ref={content}>
        <div className="gantt-line gantt-axis"><strong className="gantt-label">Production</strong>
          <div className="gantt-track">{todayIndicator}{tick.map(date=><span className="gantt-tick" key={date}
            aria-current={date === today ? 'date' : undefined} style={{left:distance(from,date)*px}}>
            {label(date)}
          </span>)}</div>
        </div>
        {groupRows.map(({item,rows})=><div key={item.id}>
          {!project && <div className="gantt-line gantt-project"><button className="gantt-label text-button" onClick={()=>openProject(item)}>{item.name}</button>
            <div className="gantt-track">{todayIndicator}
              {item.start_date && <span className="gantt-project-marker" style={{left:distance(from,item.start_date)*px}}>Start</span>}
              {item.target_publication_date && <span className="gantt-project-marker" style={{left:distance(from,item.target_publication_date)*px}}>Publish</span>}
            </div>
          </div>}
          {rows.map(row=>{
            const active=drag?.row.id===row.id
            const span=row.planned_start && row.planned_end ? active ? moved(row,drag.delta,drag.mode) : [row.planned_start,row.planned_end] : null
            const dependency=row.task?.depends_on ? assigned.find(task=>task.id===row.task?.depends_on) : undefined
            return <div className={`gantt-line ${row.kind==='stage'?'gantt-stage':''}`} key={row.id}>
              <div className="gantt-label" style={{paddingInlineStart:row.depth ? '1.25rem' : undefined}}>
                {row.collapsible && <button className="icon-button gantt-collapse" aria-label={`${closed.includes(row.id)?'Expand':'Collapse'} ${row.title}`}
                  aria-expanded={!closed.includes(row.id)} onClick={()=>setClosed(items=>items.includes(row.id)?items.filter(id=>id!==row.id):[...items,row.id])}><ChevronRight size={14}/></button>}
                {row.task && <button className={`gantt-check ${row.task.status==='done'?'checked':''}`}
                  aria-label={`${row.task.status==='done'?'Reopen':'Complete'} ${row.title}`} disabled={busy} onClick={()=>complete(row.task!)}><Check size={13}/></button>}
                <div className="gantt-label-copy">
                  <button title={row.title} className="gantt-name" onClick={()=>row.task?openTask(row.task):edit(row)}>{row.title}</button>
                  {dependency && <small>After {dependency.title}</small>}
                  {row.kind==='stage' && row.progress>0 && <small>{Math.round(row.progress*100)}% complete</small>}
                  {row.task?.completed_at && <small>Done {row.task.completed_at.slice(0,10)}</small>}
                </div>
                <button className="text-button gantt-dates" aria-label={`Edit dates for ${row.title}`} onClick={()=>edit(row)}>Dates</button>
              </div>
              <div className="gantt-track">
                {todayIndicator}
                {span?<div className={`gantt-bar ${active?'dragging':''} ${row.progress===1?'gantt-completed':''}`}
                  style={{left:distance(from,span[0])*px,width:Math.max(px,(distance(span[0],span[1])+1)*px),backgroundColor:row.color}}>
                  <span className="gantt-bar-progress" style={{width:`${row.progress*100}%`}}/>
                  <span aria-hidden="true" className="gantt-handle start" onPointerDown={event=>begin(event,row,'start')} onPointerMove={update} onPointerUp={finish} onPointerCancel={()=>setDrag(undefined)}/>
                  <button className={`gantt-bar-body ${scale==='month'?'compact-bar':''}`} aria-label={`Move or edit ${row.title}`} title={`${row.title} · ${span[0]} to ${span[1]}`}
                    onPointerDown={event=>begin(event,row,'move')} onPointerMove={update} onPointerUp={finish} onPointerCancel={()=>setDrag(undefined)}
                    onClick={event=>{if(event.detail===0) edit(row)}}>{row.progress===1&&'✓ '}{row.title}</button>
                  <span aria-hidden="true" className="gantt-handle end" onPointerDown={event=>begin(event,row,'end')} onPointerMove={update} onPointerUp={finish} onPointerCancel={()=>setDrag(undefined)}/>
                </div>:<button className="text-button gantt-unscheduled" onClick={()=>edit(row)}>Add dates</button>}
              </div>
            </div>
          })}
          {!rows.length && <p className="gantt-empty muted">No phases or tasks have been added.</p>}
        </div>)}
        {!projects.length && <p className="gantt-empty muted">Create a project to start planning.</p>}
      </div>
    </div>
    <input ref={scrollbar} className="gantt-scrollbar" type="range" aria-label="Scroll timeline horizontally" min={0}
      max={0} defaultValue={0}
      onChange={event => { if (scroll.current) scroll.current.scrollLeft = Number(event.target.value) }}
      onKeyDown={event => {
        if (!scroll.current || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
        event.preventDefault()
        scroll.current.scrollLeft += (event.key === 'ArrowLeft' ? -1 : 1) * px
      }}
    />
  </section>
}

export function SpanEditor({ item,busy,error,close,save }: {
  item:SpanItem; busy:boolean; error:string; close:()=>void; save:(start:string|null,end:string|null)=>void
}) {
  const [start,setStart]=useState(item.planned_start??'')
  const [end,setEnd]=useState(item.planned_end??'')
  return <StudioDialog title={`Dates for ${item.title}`} description="Choose an inclusive start and end date." close={()=>{if(!busy)close()}}>
    <form className="form" onSubmit={event=>{event.preventDefault();save(start,end)}}>
      <div className="form-grid"><label>Start date<input required type="date" value={start} onChange={event=>{
        setStart(event.target.value);if(!end || end<event.target.value)setEnd(event.target.value)
      }}/></label>
        <label>End date<input required type="date" min={start} value={end} onChange={event=>setEnd(event.target.value)}/></label></div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="text-button push" disabled={busy || !item.planned_start} onClick={()=>save(null,null)}>Clear dates</button>
        <button className="button primary" disabled={busy}>Save dates</button>
      </div>
    </form>
  </StudioDialog>
}
