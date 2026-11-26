import { useState, type CSSProperties } from 'react'
import { CalendarDays, Check, ChevronDown, ChevronUp, Ellipsis, GripVertical, Plus } from 'lucide-react'
import { stageKey, workflow, workflowKeys, type Project, type Snapshot, type Task, type WorkflowStage } from '@/lib/studio'

export const boardColumns = [
  { id: 'todo', name: 'To Do' }, { id: 'doing', name: 'In Progress' },
  { id: 'done', name: 'Done' },
] as const

export function nextTask(tasks: Task[]) {
  return tasks.filter(task => task.production_key && task.status !== 'done').sort((a,b) =>
    workflowKeys.indexOf(a.production_key!) - workflowKeys.indexOf(b.production_key!))[0]
}

export function productionProgress(tasks: Task[]) {
  return tasks.filter(task => task.production_key && task.status === 'done').length * 20
}

export function ProjectOptions({ project, edit, archive, remove }: {
  project: Project; edit: (project: Project) => void; archive: (project: Project) => void; remove: (project: Project) => void
}) {
  return <details className="project-options" onKeyDown={event => {
    if (event.key === 'Escape') {
      event.currentTarget.open = false
      event.currentTarget.querySelector('summary')?.focus()
    }
  }}>
    <summary aria-label={`Options for ${project.name}`}><Ellipsis size={19}/></summary>
    <div className="project-options-panel">
      {[
        { label: 'Edit project', action: edit },
        { label: project.archived ? 'Restore project' : 'Archive project', action: archive },
        { label: 'Delete project', action: remove },
      ].map(({ label, action }) => <button type="button" key={label} onClick={event => {
        const menu = event.currentTarget.closest('details')
        if (menu) menu.open = false
        action(project)
      }}>{label}</button>)}
    </div>
  </details>
}

export function Portfolio({ snapshot, open, move, busy, edit, archive, remove }: {
  snapshot: Snapshot; open: (project: Project) => void; busy: boolean;
  move: (project: Project, stage: WorkflowStage, before?: string, reorder?: boolean) => void;
  edit: (project: Project) => void; archive: (project: Project) => void; remove: (project: Project) => void
}) {
  const [stage, setStage] = useState<WorkflowStage | ''>('')
  const [sort, setSort] = useState('board')
  const [target, setTarget] = useState<WorkflowStage | null>(null)
  const [archived, setArchived] = useState(false)
  const list = snapshot.projects.filter(project => project.archived === archived && (!stage || project.workflow_stage === stage))
    .sort((a,b) => sort === 'newest' ? b.created_at.localeCompare(a.created_at)
      : sort === 'publication' ? (a.target_publication_date ?? '9999').localeCompare(b.target_publication_date ?? '9999')
      : sort === 'priority' ? a.priority - b.priority || b.created_at.localeCompare(a.created_at)
      : a.board_position - b.board_position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))

  function card(project: Project) {
    const tasks = snapshot.tasks.filter(task => task.project_id === project.id)
    const next = nextTask(tasks)
    const progress = productionProgress(tasks)
    const color = workflow[project.workflow_stage].color
    return <article className="panel portfolio-card" key={project.id} style={{ '--stage': color } as CSSProperties} draggable={!archived && !busy}
      onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/creator-project', project.id) }}
      onDragEnd={() => setTarget(null)}
      onDrop={event => {
        const source = list.find(item => item.id === event.dataTransfer.getData('application/creator-project'))
        if (!source || busy || archived) return
        event.preventDefault()
        event.stopPropagation()
        setTarget(null)
        if (source.id !== project.id) {
          setSort('board')
          move(source, project.workflow_stage, project.id, true)
        }
      }}>
      <div className="portfolio-card-heading">
        <button type="button" className="portfolio-grip" title="Drag project to another stage"
          aria-label={`Open ${project.name}`} draggable={!archived && !busy}
          onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/creator-project', project.id) }}
          onClick={() => open(project)}><GripVertical size={17}/></button>
        <ProjectOptions project={project} edit={edit} archive={archive} remove={remove}/>
      </div>
      <button type="button" className="portfolio-open" onClick={() => open(project)}>
        {/^https?:\/\//i.test(project.cover_url) && <span className="portfolio-cover" style={{ backgroundImage: `url("${encodeURI(project.cover_url).replaceAll('"','%22')}")` }}/>}
        <strong>{project.name}</strong><small>{project.content_type}</small>
        <small>{archived ? `${workflow[project.workflow_stage].name} · ` : ''}{progress}% of production complete</small>
        <span className="production-progress" role="progressbar" aria-label={`${project.name} progress`} aria-valuenow={progress}><span style={{ width: `${progress}%` }}/></span>
        {next && project.workflow_stage !== 'published' && <small>Next · {next.title}</small>}
        {project.actual_publication_date ? <small>Published · {project.actual_publication_date}</small>
          : project.target_publication_date && <small>Target · {project.target_publication_date}</small>}
      </button>
      {!archived && <select aria-label={`Stage for ${project.name}`} disabled={busy} value={project.workflow_stage}
        onChange={event => move(project, event.target.value as WorkflowStage)}>
        {workflowKeys.map(key => <option key={key} value={key}>{workflow[key].name}</option>)}
      </select>}
    </article>
  }

  return <section aria-label="Project portfolio">
    <div className="production-toolbar">
      <label>Production stage<select value={stage} onChange={event => setStage(event.target.value as WorkflowStage | '')}>
        <option value="">All stages</option>{workflowKeys.map(key => <option key={key} value={key}>{workflow[key].name}</option>)}
      </select></label>
      <label>Sort by<select value={sort} onChange={event => setSort(event.target.value)}><option value="board">Board order</option><option value="priority">Priority</option><option value="newest">Newest first</option><option value="publication">Publication target</option></select></label>
      <button type="button" className="button secondary" aria-pressed={archived} onClick={() => {setArchived(!archived);setStage('')}}>{archived ? 'Show active projects' : 'Show archive'}</button>
    </div>
    {archived ? <div className="portfolio-grid">{list.length ? list.map(card) : <p className="panel muted">No archived projects.</p>}</div>
      : <div className="portfolio-kanban" aria-label="Project Kanban" onDragOver={event => {
        if (busy || !event.dataTransfer.types.includes('application/creator-project')) return
        const board = event.currentTarget
        const rect = board.getBoundingClientRect()
        if (event.clientX > rect.right - 48) board.scrollLeft += 16
        if (event.clientX < rect.left + 48) board.scrollLeft -= 16
      }}>{workflowKeys.filter(key => !stage || key === stage).map(key => {
        const projects = list.filter(project => project.workflow_stage === key)
        return <section className={`portfolio-column ${target === key ? 'drop-target' : ''}`} key={key} aria-label={workflow[key].name}
          style={{ '--stage': workflow[key].color } as CSSProperties}
          onDragOver={event => {
            if (!busy && event.dataTransfer.types.includes('application/creator-project')) {
              event.preventDefault()
              setTarget(key)
            }
          }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(current => current === key ? null : current) }}
          onDrop={event => {
            event.preventDefault()
            const project = list.find(item => item.id === event.dataTransfer.getData('application/creator-project'))
            setTarget(null)
            if (project && !busy) {
              setSort('board')
              move(project, key, undefined, true)
            }
          }}>
          <h2>{workflow[key].name} <small>{projects.length}</small></h2>
          {projects.map(card)}
        </section>
      })}</div>}
  </section>
}

export function ProductionBoard({ snapshot, project, busy, add, edit, move, schedule, additional, setAdditional }: {
  snapshot: Snapshot; project: Project; busy: boolean; add: (status: Task['status']) => void; edit: (task: Task) => void;
  move: (task: Task, status: Task['status'], before?: string) => void; schedule: (task: Task) => void;
  additional: boolean; setAdditional: (value: boolean) => void
}) {
  const [target,setTarget] = useState<Task['status'] | null>(null)
  const projectTasks = snapshot.tasks.filter(task => task.project_id === project.id)
  const tasks = projectTasks.filter(task => additional || task.production_key)
    .sort((a,b) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const progress = productionProgress(projectTasks)
  const done = progress / 20
  return <section className="board-panel" aria-label="Production Kanban">
    <div className="board-progress"><strong>{done} of 5 stages complete</strong>
      <span className="production-progress" role="progressbar" aria-label="Project completion" aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} /></span></div>
    {projectTasks.some(task => !task.production_key) && <button type="button" className="button secondary compact additional-tasks"
      aria-pressed={additional} onClick={() => setAdditional(!additional)}>{additional ? 'Hide additional tasks' : 'Show additional tasks'}</button>}
    <div className="kanban-board">{boardColumns.map(column => {
      const cards = tasks.filter(task => task.status === column.id)
      const drop = (id: string, before?: string) => {
        setTarget(null)
        const task = tasks.find(item => item.id === id)
        if (task && !busy && task.id !== before) move(task,column.id,before)
      }
      return <section key={column.id} className={`kanban-column column-${column.id} ${target === column.id ? 'drop-target' : ''}`}
        onDragOver={event => { if (!busy && event.dataTransfer.types.includes('application/creator-task')) { event.preventDefault(); setTarget(column.id) } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(value => value === column.id ? null : value) }}
        onDrop={event => { event.preventDefault(); drop(event.dataTransfer.getData('application/creator-task')) }}>
        <header><h2>{column.name} <small>{cards.length}</small></h2>
          <button className="icon-button" aria-label={`Add task to ${column.name}`} onClick={() => add(column.id)}><Plus size={17} /></button></header>
        {cards.map((task,index) => {
          const phase = snapshot.stages.find(item => item.id === task.stage_id)
          const stage = workflow[task.production_key ?? stageKey(phase?.name, task.skill_id)]
          const parent = tasks.find(item => item.id === task.parent_id)
          return <article className="kanban-card" key={task.id} style={{ '--stage': stage.color } as CSSProperties}
            draggable={!busy} onDragStart={event => {
              event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('application/creator-task',task.id)
            }} onDragEnd={() => setTarget(null)}
            onDragOver={event => { if (!busy && event.dataTransfer.types.includes('application/creator-task')) event.preventDefault() }}
            onDrop={event => { event.preventDefault(); event.stopPropagation(); drop(event.dataTransfer.getData('application/creator-task'),task.id) }}>
            <button className="kanban-title" onClick={() => edit(task)}><strong>{task.title}</strong></button>
            <small>{phase?.name ?? stage.name}</small>
            {parent && <small>Subtask of {parent.title}</small>}
            {task.planned_start && <small>{task.planned_start} – {task.planned_end}</small>}
            {!!task.estimated_minutes && <small>{task.estimated_minutes} min estimated</small>}
            <div className="kanban-actions">
              <span className="task-grip" draggable={!busy} title="Drag task" onDragStart={event => {
                event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('application/creator-task',task.id)
              }}><GripVertical size={16} /></span>
              <button className="icon-button" disabled={busy || index===0} aria-label={`Move ${task.title} up`}
                onClick={() => move(task,column.id,cards[index-1].id)}><ChevronUp size={15} /></button>
              <button className="icon-button" disabled={busy || index===cards.length-1} aria-label={`Move ${task.title} down`}
                onClick={() => move(task,column.id,cards[index+2]?.id)}><ChevronDown size={15} /></button>
              <button className="icon-button" disabled={busy || project.archived} aria-label={`Schedule ${task.title}`} onClick={() => schedule(task)}><CalendarDays size={15} /></button>
              <button className="icon-button" disabled={busy} aria-label={`${task.status==='done'?'Reopen':'Complete'} ${task.title}`}
                onClick={() => move(task,task.status==='done'?'todo':'done')}><Check size={16} /></button>
            </div>
            <label className="sr-only" htmlFor={`status-${task.id}`}>Status for {task.title}</label>
            <select id={`status-${task.id}`} disabled={busy} value={task.status} onChange={event => move(task,event.target.value as Task['status'])}>
              {boardColumns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </article>
        })}
      </section>
    })}</div>
  </section>
}
