import { useState, type CSSProperties } from 'react'
import { CalendarDays, Check, ChevronDown, ChevronUp, GripVertical, ImageIcon, Plus } from 'lucide-react'
import { skills, type Project, type Snapshot, type Task } from '@/lib/studio'

export const boardColumns = [
  { id: 'todo', name: 'To Do' }, { id: 'doing', name: 'In Progress' },
  { id: 'blocked', name: 'Blocked' }, { id: 'done', name: 'Done' },
] as const

export function nextTask(tasks: Task[]) {
  return [...tasks].filter(task => task.status !== 'done').sort((a,b) =>
    Number(b.status === 'doing') - Number(a.status === 'doing') || Number(a.status === 'blocked') - Number(b.status === 'blocked')
    || a.priority - b.priority || a.position - b.position)[0]
}

export function Portfolio({ snapshot, open }: { snapshot: Snapshot; open: (project: Project) => void }) {
  const [stage, setStage] = useState('')
  const [sort, setSort] = useState('priority')
  const [archived, setArchived] = useState(false)
  const stageNames = new Set(snapshot.stages.map(item => item.name))
  const list = snapshot.projects.filter(project => project.archived === archived
    && (!stage || snapshot.stages.find(item => item.id === project.production_stage_id)?.name === stage))
    .sort((a,b) => sort === 'newest' ? b.created_at.localeCompare(a.created_at)
      : sort === 'publication' ? (a.target_publication_date ?? '9999').localeCompare(b.target_publication_date ?? '9999')
      : a.priority - b.priority || b.created_at.localeCompare(a.created_at))
  return <section aria-label="Project portfolio">
    <div className="production-toolbar">
      <label>Production stage<select value={stage} onChange={event => setStage(event.target.value)}><option value="">All stages</option>
        {[...stageNames].sort().map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Sort by<select value={sort} onChange={event => setSort(event.target.value)}><option value="priority">Priority</option><option value="newest">Newest first</option><option value="publication">Publication target</option></select></label>
      <label>Projects<select value={archived ? 'archived' : 'active'} onChange={event => setArchived(event.target.value === 'archived')}>
        <option value="active">Active</option><option value="archived">Archived</option></select></label>
    </div>
    <div className="portfolio-grid">{list.map(project => {
      const tasks = snapshot.tasks.filter(task => task.project_id === project.id)
      const next = nextTask(tasks)
      const progress = tasks.length ? Math.round(100 * tasks.filter(task => task.status === 'done').length / tasks.length) : 0
      const stage = snapshot.stages.find(item => item.id === project.production_stage_id)?.name
      return <button type="button" className="panel portfolio-card" key={project.id} onClick={() => open(project)}>
        {/^https?:\/\//i.test(project.cover_url) ? <span className="portfolio-cover" style={{ backgroundImage: `url("${encodeURI(project.cover_url).replaceAll('"','%22')}")` }} /> : <span className="portfolio-placeholder"><ImageIcon size={18} aria-hidden="true" /></span>}
        <span className="muted">{project.content_type} · {project.status}</span><strong>{project.name}</strong>
        <span>{stage ?? 'Unstaged'} · {progress}% complete</span>
        <span className="production-progress" role="progressbar" aria-label={`${project.name} progress`} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></span>
        <small>{['filming','editing'].map(skill => {
          const scoped = tasks.filter(task => task.skill_id === skill)
          const done = scoped.filter(task => task.status === 'done').length
          const mood = done === scoped.length ? 'done' : scoped.some(task => task.status === 'blocked') ? 'blocked'
            : scoped.some(task => task.status === 'doing') || done > 0 ? 'in progress' : 'to do'
          return scoped.length ? `${skill === 'filming' ? 'Filming' : 'Editing'} ${mood} (${done}/${scoped.length})` : null
        }).filter(Boolean).join(' · ')}</small>
        {next && <small>Next · {next.title}</small>}
        {project.target_publication_date && <small>Publish · {project.target_publication_date}</small>}
      </button>
    })}</div>
    {!list.length && <p className="panel muted">{archived ? 'Nothing archived' : 'No projects match these filters.'}</p>}
  </section>
}

export function ProductionBoard({ snapshot, project, busy, add, edit, move, schedule }: {
  snapshot: Snapshot; project: Project; busy: boolean; add: (status: Task['status']) => void; edit: (task: Task) => void;
  move: (task: Task, status: Task['status'], before?: string) => void; schedule: (task: Task) => void
}) {
  const tasks = snapshot.tasks.filter(task => task.project_id === project.id)
    .sort((a,b) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const done = tasks.filter(task => task.status === 'done').length
  return <section className="board-panel" aria-label="Production Kanban">
    <div className="board-progress"><strong>{done} of {tasks.length} tasks complete</strong>
      <span className="production-progress" role="progressbar" aria-label="Project completion" aria-valuenow={tasks.length ? Math.round(done * 100 / tasks.length) : 0}>
        <span style={{ width: `${tasks.length ? done * 100 / tasks.length : 0}%` }} /></span></div>
    <div className="kanban-board">{boardColumns.map(column => {
      const cards = tasks.filter(task => task.status === column.id)
      const drop = (id: string, before?: string) => {
        const task = tasks.find(item => item.id === id)
        if (task && !busy && task.id !== before) move(task,column.id,before)
      }
      return <section key={column.id} className={`kanban-column column-${column.id}`}
        onDragOver={event => { if (!busy) event.preventDefault() }}
        onDrop={event => { event.preventDefault(); drop(event.dataTransfer.getData('text/plain')) }}>
        <header><h2>{column.name} <small>{cards.length}</small></h2>
          <button className="icon-button" aria-label={`Add task to ${column.name}`} onClick={() => add(column.id)}><Plus size={17} /></button></header>
        {cards.map((task,index) => {
          const phase = snapshot.stages.find(item => item.id === task.stage_id)
          const skill = skills.find(item => item.id === task.skill_id)
          const parent = tasks.find(item => item.id === task.parent_id)
          return <article className="kanban-card" key={task.id} style={{ '--skill': skill?.color } as CSSProperties}
            onDragOver={event => { if (!busy) event.preventDefault() }}
            onDrop={event => { event.preventDefault(); event.stopPropagation(); drop(event.dataTransfer.getData('text/plain'),task.id) }}>
            <button className="kanban-title" onClick={() => edit(task)}><strong>{task.title}</strong></button>
            <small>{phase?.name ?? 'No phase'} · {skill?.name} · {task.bonus} XP</small>
            {parent && <small>Subtask of {parent.title}</small>}
            {task.planned_start && <small>{task.planned_start} – {task.planned_end}</small>}
            {!!task.estimated_minutes && <small>{task.estimated_minutes} min estimated</small>}
            <div className="kanban-actions">
              <span className="task-grip" draggable={!busy} title="Drag task" onDragStart={event => {
                event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain',task.id)
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
