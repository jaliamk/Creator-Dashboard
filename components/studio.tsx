'use client'

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  Activity, ArrowDownToLine, CalendarDays, ChartGantt, Check, ChevronRight, CircleCheck, Clock3,
  FolderOpen, Lightbulb, ListTodo, LogIn, LogOut, Plus, Settings2, Sparkles, Timer,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StudioDialog } from '@/components/ui/dialog'
import { initial, rpc, skills, stageKey, workflow, supabase, type Block, type CalendarDay, type Project, type SessionDraft, type Snapshot, type Task, type Template, type Theme, type Topic, type WorkSession, type WorkflowStage } from '@/lib/studio'
import { BlockEditor, CalendarDayEditor, Insights, Planner, currentDay, TemplateEditor } from '@/components/planner'
import { ProjectEditor, SessionEditor, TaskEditor, WorkingDays } from '@/components/studio-forms'

import { Portfolio, ProductionBoard, ProjectOptions, productionProgress } from '@/components/production-board'
import { ProductionTimeline, SpanEditor, type SpanItem } from '@/components/production-timeline'
import { QuickQuests } from '@/components/quick-quests'
import { quests, type QuestKey } from '@/lib/quests'
import type { QuestCompletion } from '@/lib/studio'
import { CreatorJourney } from '@/components/creator-journey'
import { TopicBank, TopicEditor, TopicLink } from '@/components/topic-bank'

const navigation = [
  { name: 'Topic Bank', icon: Lightbulb },
  { name: 'Projects', icon: FolderOpen },
  { name: 'Timeline', icon: ChartGantt },
  { name: 'Calendar', icon: CalendarDays },
  { name: 'Creator Journey', icon: Sparkles },
  { name: 'Today', icon: ListTodo },
  { name: 'Quick Quests', icon: Timer },
  { name: 'Insights', icon: Activity },
  { name: 'Settings', icon: Settings2 },
] as const
type View = typeof navigation[number]['name']
type Modal =
  | { kind: 'auth' }
  | { kind: 'calendar-day'; day: CalendarDay }
  | { kind: 'topic'; topic?: Topic }
  | { kind: 'link'; topic: Topic }
  | { kind: 'span'; item: SpanItem }
  | { kind: 'block'; block?: Block; duplicate?: boolean; day?: string; projectId?: string; taskId?: string }
  | { kind: 'template'; category: Template['kind']; template?: Template }
  | { kind: 'project'; project?: Project; topic?: Topic }
  | { kind: 'task'; project: Project; task?: Task; initialStatus?: Task['status'] }
  | { kind: 'session'; session?: WorkSession }
  | { kind: 'delete'; project?: Project; session?: WorkSession; task?: Task; topic?: Topic }

const priority: Record<number, string> = { 1: 'High', 2: 'Medium', 3: 'Low' }
const skillName = (id: string) => skills.find(skill => skill.id === id)?.name ?? id

function Empty({ icon: Icon, title, children }: { icon: typeof Clock3; title: string; children: React.ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon size={19} /></span><div><strong>{title}</strong><p>{children}</p></div></div>
}

export function Studio() {
  const [user, setUser] = useState<User | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>(initial)
  const [view, setView] = useState<View>('Projects')
  const [projectTab, setProjectTab] = useState<'board'|'timeline'|'checklist'>('board')
  const [scheduleUndo,setScheduleUndo] = useState<{ rpcName: string; args: Record<string,unknown> }[]>([])
  const [additionalTasks,setAdditionalTasks] = useState(false)
  const [projectId, setProjectId] = useState<string>()
  const [modal, setModal] = useState<Modal>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [modalError, setModalError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [timerStart, setTimerStart] = useState<number>()
  const [timerContext, setTimerContext] = useState<{ project?: string; skill?: string; goal?: number; task?: string }>({})
  const mutationLock = useRef(false)
  const [elapsed, setElapsed] = useState(0)
  const [timerDraft, setTimerDraft] = useState<SessionDraft>()
  const [daysDraft, setDaysDraft] = useState<number[]>()
  const [localTheme, setLocalTheme] = useState<Theme>('system')
  const currentOwner = useRef<string | null>(null)
  const loadSequence = useRef(0)
  const pageError = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!supabase) return
    let active = true
    let reload: ReturnType<typeof setTimeout> | undefined
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      const nextOwner = nextUser?.id ?? null
      if (currentOwner.current === nextOwner) {
        if (!nextOwner) setLoading(false)
        return
      }
      currentOwner.current = nextOwner
      const request = ++loadSequence.current
      clearTimeout(reload)
      setUser(nextUser)
      setSnapshot(initial)
      setProjectId(undefined)
      setModal(undefined)
      setNotice('')
      setError('')
      setTimerStart(undefined)
      setTimerDraft(undefined)
      setTimerContext({})
      setScheduleUndo([])
      setDaysDraft(undefined)
      if (!nextUser) { setLoading(false); return }
      setLoading(true)
      reload = setTimeout(() => {
        rpc<Snapshot>('studio_simple_snapshot', { p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(data => {
          if (active && request === loadSequence.current) setSnapshot(data)
        }).catch((failure: Error) => {
          if (active && request === loadSequence.current) setError(failure.message)
        }).finally(() => {
          if (active && request === loadSequence.current) setLoading(false)
        })
      }, 0)
    })
    return () => { active = false; currentOwner.current = null; clearTimeout(reload); subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = user ? snapshot.profile.theme : localTheme
  }, [user, snapshot.profile.theme, localTheme])

  useEffect(() => {
    if (timerStart === undefined) return
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - timerStart) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [timerStart])

  useEffect(() => {
    if (error) pageError.current?.focus()
  }, [error])

  function open(next: Modal) {
    setModalError('')
    setError('')
    setModal(user ? next : { kind: 'auth' })
  }

  async function mutate(work: () => Promise<unknown>, message: string, after?: () => void) {
    if (mutationLock.current) return
    mutationLock.current = true
    const owner = currentOwner.current
    const inDialog = Boolean(modal)
    setBusy(true)
    setError('')
    setModalError('')
    setNotice('')
    try {
      await work()
      if (owner !== currentOwner.current) return
      const data = await rpc<Snapshot>('studio_simple_snapshot')
      if (owner !== currentOwner.current) return
      setSnapshot(data)
      setModal(undefined)
      setNotice(message)
      after?.()
    } catch (failure) {
      if (owner !== currentOwner.current) return
      const message = failure instanceof Error ? failure.message : 'Something went wrong. Try again.'
      if (inDialog) setModalError(message)
      setError(message)
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
  }

  function updateTask(task: Task, state: Task['status'], before?: string) {
    const message = state === task.status ? 'Task order saved.' : state === 'done'
      ? 'Task completed.' : task.status === 'done' ? 'Task reopened.' : 'Task status updated.'
    void mutate(() => rpc('studio_simple_board_task', { p_project: task.project_id, p_task: task.id, p_status: state, p_before: before ?? null }), message)
  }

  function remember(rpcName: string,args: Record<string,unknown>) {
    setScheduleUndo(items=>[...items.slice(-19),{rpcName,args}])
  }

  function undoSchedule() {
    const previous = scheduleUndo.at(-1)
    if(previous) void mutate(()=>rpc(previous.rpcName,previous.args),'Scheduling change undone.',()=>setScheduleUndo(items=>items.slice(0,-1)))
  }

  function saveSpan(item: SpanItem,start: string|null,end: string|null) {
    const args={p_project:item.project_id,p_kind:item.kind,p_id:item.id}
    void mutate(()=>rpc('studio_schedule_span',{...args,p_start:start,p_end:end,p_expected_start:item.planned_start,p_expected_end:item.planned_end}),
      'Timeline updated.',()=>remember('studio_schedule_span',{...args,p_start:item.planned_start,p_end:item.planned_end,p_expected_start:start,p_expected_end:end}))
  }

  function blockArgs(block:Block) {
    return {p_id:block.id,p_project:block.project_id,p_task:block.task_id,p_start:block.starts_at,p_end:block.ends_at,
      p_timezone:block.timezone,p_notes:block.notes,p_status:block.status}
  }

  function saveBlock(args:Record<string,unknown>) {
    const previous=snapshot.blocks.find(block=>block.id===args.p_id)
    void mutate(()=>rpc('studio_block',args),'Work block saved.',()=>previous
      ? remember('studio_block',blockArgs(previous)) : remember('studio_remove_block',{p_id:args.p_id}))
  }

  function saveDay(entry: CalendarDay, args: Record<string, unknown>) {
    void mutate(() => rpc('studio_time_task_day',args), 'Calendar time saved.', () => remember('studio_time_task_day', {
      p_task: entry.task_id, p_day: entry.day, p_start: entry.starts_at, p_end: entry.ends_at, p_timezone: entry.timezone,
    }))
  }

  function editProject(project: Project) { open({kind:'project',project}) }

  function archiveProject(project: Project) {
    void mutate(() => rpc('studio_archive_project',{p_id:project.id,p_archived:!project.archived}),
      project.archived?'Project restored.':'Project archived.')
  }

  function removeProject(project: Project) { open({kind:'delete',project}) }

  function moveProject(project: Project, stage: WorkflowStage, before?: string, reorder = false) {
    void mutate(() => rpc('studio_project_board',{p_id:project.id,p_stage:stage,p_before:before??null,p_reorder:reorder}),
      stage===project.workflow_stage?'Project order saved.':stage==='published'?'Project marked published.':'Project stage updated.')
  }

  function moveCalendarDay(entry: CalendarDay, day: string) {
    const args = {p_task:entry.task_id,p_from:entry.day,p_to:day}
    void mutate(() => rpc('studio_move_calendar_day',args),'Stage rescheduled.',()=>remember('studio_move_calendar_day',{
      ...args,p_from:day,p_to:entry.day,
    }))
  }

  function completeQuest(key: QuestKey) {
    if (!user) {open({kind:'auth'});return}
    const id = crypto.randomUUID()
    void mutate(() => rpc('studio_one_click_quest',{p_id:id,p_key:key}),`${quests[key].title} completed.`)
  }

  function undoQuest(completion: QuestCompletion) {
    void mutate(() => rpc('studio_one_click_quest',{p_id:completion.id,p_key:completion.quest_key,p_undo:true}),'Quest completion undone.')
  }

  function stopTimer() {
    if (timerStart === undefined) return
    const end = Date.now()
    setTimerDraft({
      ...timerContext, ended: new Date(end).toISOString(),
      started: new Date(timerStart).toISOString(),
      minutes: Math.min(1440, Math.floor((end - timerStart) / 60000)),
    })
    setTimerStart(undefined)
    open({ kind: 'session' })
  }

  const today = currentDay(snapshot.profile.timezone).toString()
  const acknowledged = snapshot.quest_completions.filter(item => item.completed_on === today
    && (item.quest_key === 'short' || item.quest_key === 'long')).map(item => item.quest_key)
  const projects = snapshot.projects.filter(project => !project.archived).sort((a, b) => a.priority - b.priority)
  const selected = snapshot.projects.find(project => project.id === projectId)
  const projectById = new Map(snapshot.projects.map(project => [project.id, project]))
  const queue = snapshot.tasks.filter(task => task.production_key && task.status !== 'done' && !projectById.get(task.project_id)?.archived && projectById.get(task.project_id)?.workflow_stage !== 'published')
  const activity = [
    ...snapshot.sessions.map(session => ({
      id: session.id, date: session.started_at, title: `${session.minutes} min · ${skillName(session.skill_id)}`,
      subtitle: projectById.get(session.project_id ?? '')?.name, kind: 'session',
    })),
    ...snapshot.tasks.filter(task => task.status === 'done').map(task => ({
      id: task.completion_id!, date: task.completed_at!, title: task.title,
      subtitle: projectById.get(task.project_id)?.name, kind: 'completion',
    })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

  function showProject(project: Project) {
    setView('Projects')
    setProjectId(project.id)
    setAdditionalTasks(false)
    setProjectTab('board')
  }

  const selectedTasks = snapshot.tasks.filter(task => task.project_id === selected?.id)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))

  function openTask(task: Task) {
    const project=projectById.get(task.project_id)
    if(project) open({kind:'task',project,task})
  }

  function renderTask(task:Task) {
    const phase = snapshot.stages.find(stage => stage.id === task.stage_id)
    return <div className="list-row staged-row" key={task.id} style={{ '--stage': workflow[stageKey(phase?.name,task.skill_id)].color } as CSSProperties}>
      <button className={`check-button ${task.status==='done'?'checked':''}`} disabled={busy}
        aria-label={`${task.status==='done'?'Reopen':'Complete'} ${task.title}`}
        onClick={()=>updateTask(task,task.status==='done'?'todo':'done')}><Check size={15}/></button>
      <div className="row-copy"><strong>{task.title}</strong><small>{projectById.get(task.project_id)?.name} · {skillName(task.skill_id)}
        {task.stage_id&&` · ${snapshot.stages.find(stage=>stage.id===task.stage_id)?.name??''}`}</small></div>
      <Badge tone={task.priority===1?'danger':'neutral'}>{priority[task.priority]}</Badge>
      <button className="icon-button" aria-label={`Edit ${task.title}`} onClick={()=>openTask(task)}><ChevronRight size={18}/></button>
    </div>
  }

  function renderTaskTree(parent: string|null):React.ReactNode {
    return selectedTasks.filter(task=>task.parent_id===parent && (additionalTasks || task.production_key)).map(task=><div key={task.id}>
      {renderTask(task)}{selectedTasks.some(child=>child.parent_id===task.id)&&<div className="nested-tasks">{renderTaskTree(task.id)}</div>}
    </div>)
  }

  function renderProject(project: Project) {
    const tasks = snapshot.tasks.filter(task => task.project_id === project.id)
    return <button key={project.id} className="project-row" onClick={() => showProject(project)}>
      <span className="project-icon"><FolderOpen size={20} /></span>
      <span className="row-copy"><strong>{project.name}</strong><small>{project.archived ? 'Archived' : project.status} · {project.content_type} · {workflow[project.workflow_stage].name} · {productionProgress(tasks)}% complete</small></span>
      <ChevronRight size={17} className="muted" />
    </button>
  }

  const logButton = <button className="button secondary" onClick={() => {setTimerDraft(undefined);open({ kind: 'session' })}}><Clock3 size={17} /> Log time</button>
  const newButton = <button className="button primary" disabled={loading} onClick={() => open({ kind: 'project' })}><Plus size={18} /> New project</button>
  const timerButton = <button className={`button ${timerStart === undefined ? 'secondary' : 'primary'}`} onClick={() => {
    if (!user) { open({ kind: 'auth' }); return }
    if (timerStart !== undefined) { stopTimer(); return }
    setElapsed(0)
    setTimerContext({})
    setTimerStart(Date.now())
    setNotice('Work timer started.')
  }}><Timer size={17} />{timerStart === undefined ? 'Start timer' : `Stop · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}${timerContext.goal ? ` / ${timerContext.goal} min` : ''}`}</button>

  return <div className="studio-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => { setView('Projects'); setProjectId(undefined) }}>
        <span className="brand-icon"><Sparkles size={21} /></span><span>Creator Studio<small>Personal workspace</small></span>
      </button>
      <nav aria-label="Workspace">
        {navigation.map(({ name, icon: Icon }) => <button key={name} className={view === name ? 'active' : ''}
          aria-current={view === name ? 'page' : undefined} onClick={() => { setView(name); setProjectId(undefined) }}>
          <Icon size={19} /><span>{name}</span>
        </button>)}
      </nav>
      <div className="account">
        <span className="avatar">{user?.email?.[0]?.toUpperCase() ?? <Sparkles size={17} />}</span>
        <div><strong>{user?.email?.split('@')[0] ?? 'Creator account'}</strong><small>{user ? 'Signed in' : 'Sign in to save your work'}</small></div>
        <button className="icon-button" aria-label={user ? 'Sign out' : 'Sign in'} onClick={async () => {
          if (!user) { open({ kind: 'auth' }); return }
          const result = await supabase?.auth.signOut()
          if (result?.error) setError(result.error.message)
        }}>{user ? <LogOut size={18} /> : <LogIn size={18} />}</button>
      </div>
    </aside>

    <main className="workspace">
      <div className="topline"><span>Workspace</span><ChevronRight size={14} /><strong>{view}</strong>
      </div>
      <header className="page-header">
        <div>
          {view === 'Projects' && selected && <button className="text-button back" onClick={() => setProjectId(undefined)}>All projects</button>}
          <h1>{selected?.name ?? view}</h1>
          <p>{{
            'Topic Bank': 'Capture and develop ideas for future videos.',
            Timeline: 'Set dates for production phases across projects.',
            Calendar: 'Schedule specific work sessions during the week.',
            Projects: selected?.description || 'Manage content projects from idea to publication.',
            Today: 'See what’s on the calendar and what to do next.',
            'Quick Quests': 'Start a focused session or check off a production milestone.',
            'Creator Journey': 'Track published work and the time you invest in creating it.',
            Insights: 'Review logged sessions and recent creative effort.',
            Settings: 'Manage workspace preferences and data.',
          }[view]}</p>
        </div>
        <div className="actions">
          {view==='Topic Bank' && <button className="button primary" onClick={()=>open({kind:'topic'})}><Plus size={16}/> New idea</button>}
          {view==='Calendar' && <><button className="button secondary" onClick={undoSchedule} disabled={busy||!scheduleUndo.length}>Undo scheduling</button>
            <button className="button primary" onClick={()=>open({kind:'block'})}><Plus size={16}/> Schedule work</button></>}
          {view === 'Projects' && (selected ? <>
            <ProjectOptions project={selected} edit={editProject} archive={archiveProject} remove={removeProject}/>
            <button className="button primary" onClick={() => open({ kind: 'task', project: selected })}><Plus size={17} /> New task</button>
          </> : newButton)}
          {(view === 'Today' || timerStart !== undefined) && timerButton}
          {(view === 'Today' || view === 'Insights') && logButton}
        </div>
      </header>
      {loading && <div className="banner" role="status">Loading your workspace…</div>}
      {error && !modal && <div className="banner danger" role="alert" ref={pageError} tabIndex={-1}>{error}
        {user && <button className="text-button" onClick={() => void mutate(async () => {}, 'Workspace refreshed.')}>Refresh workspace</button>}
      </div>}
      {notice && <div className="banner success" role="status"><CircleCheck size={17} /> {notice}</div>}
      {!loading && !user && <div className="banner guest">
        <span>{supabase ? 'Sign in to save projects and track your creative work.' : 'Connect Supabase to enable sign-in and save your work.'}</span>
        <button className="text-button" onClick={() => open({ kind: 'auth' })}>{supabase ? 'Sign in' : 'Connection details'}</button>
      </div>}

      {view==='Projects' && selected && <div className="project-tabs actions">
        {(['board','timeline','checklist'] as const).map(tab=><button key={tab} className="button secondary compact"
          aria-pressed={projectTab===tab} onClick={()=>setProjectTab(tab)}>{tab==='board'?'Tasks':tab==='timeline'?'Project timeline':'Checklist'}</button>)}
      </div>}
      {(view==='Timeline' || (view==='Projects' && selected && projectTab==='timeline')) && <ProductionTimeline snapshot={snapshot}
        project={view==='Projects'?selected:undefined} busy={busy} undo={scheduleUndo.length?undoSchedule:undefined}
        edit={item=>open({kind:'span',item})} move={saveSpan}
        complete={task=>updateTask(task,task.status==='done'?'todo':'done')} openTask={openTask} openProject={showProject}/>}
      {view==='Topic Bank' && <TopicBank topics={snapshot.topics} projects={snapshot.projects} edit={topic=>open({kind:'topic',topic})}
        convert={topic=>open({kind:'project',topic})} link={topic=>open({kind:'link',topic})} open={showProject}/>}
      {(view === 'Calendar' || view === 'Today') && <Planner snapshot={snapshot} todayOnly={view === 'Today'} busy={busy}
        reschedule={(block,start,end)=>saveBlock({...blockArgs(block),p_start:start,p_end:end})}
        editDay={day=>open({kind:'calendar-day',day})} moveDay={moveCalendarDay}
        timeDay={(day,start,end)=>saveDay(day,{p_task:day.task_id,p_day:day.day,p_start:start,p_end:end,p_timezone:snapshot.profile.timezone})}
        edit={block => open({ kind: 'block', block })} add={day => open({ kind: 'block', day })}
        openProject={id => { const project = projectById.get(id); if (project) showProject(project) }} />}
      {view === 'Creator Journey' && <CreatorJourney snapshot={snapshot}/>}
      {view === 'Today' && <>
        <QuickQuests daily keys={['ideation','scriptwriting','editing','preparing']} busy={busy} latest={snapshot.quest_completions[0]} acknowledged={acknowledged}
          complete={completeQuest} undo={undoQuest}/>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-heading"><h2><FolderOpen size={20} /> Current projects</h2><button className="text-button" onClick={() => { setView('Projects'); setProjectId(undefined) }}>View all</button></div>
            {projects.length ? projects.slice(0, 4).map(renderProject) : <Empty icon={FolderOpen} title="No active projects">Create a project to plan your next piece.</Empty>}
          </section>
          <section className="panel">
            <div className="panel-heading"><h2><ListTodo size={20} /> Next up</h2><Badge>{queue.length}</Badge></div>
            {queue.length ? queue.map(task => renderTask(task)) : <Empty icon={ListTodo} title="Your queue is clear">Add tasks within a project to see them here.</Empty>}
          </section>
        </div>
        <section className="panel activity-panel">
          <div className="panel-heading"><h2><Activity size={20} /> Recent activity</h2></div>
          {activity.length ? activity.slice(0, 6).map(item => <div className="list-row" key={item.id}>
            <span className="project-icon">{item.kind === 'session' ? <Clock3 size={18} /> : <Check size={18} />}</span>
            <div className="row-copy"><strong>{item.title}</strong><small>{item.subtitle} · {formatDate(item.date, snapshot.profile.timezone)}</small></div>
          </div>) : <Empty icon={Activity} title="No activity yet">Completed tasks and logged work will show up here.</Empty>}
        </section>
      </>}

      {view === 'Quick Quests' && <QuickQuests busy={busy} latest={snapshot.quest_completions[0]} acknowledged={acknowledged}
        complete={completeQuest} undo={undoQuest}/>}
      {view === 'Projects' && (selected ? <>
        <section className="panel project-details">
          <div className="panel-heading"><h2>Production pipeline</h2><Badge>{selected.archived ? 'Archived' : workflow[selected.workflow_stage].name}</Badge></div>
          <div className="pipeline">{Object.entries(workflow).map(([key,stage]) =>
            <span key={key} className="stage-label" aria-current={key===selected.workflow_stage?'step':undefined}
              style={{ '--stage': stage.color } as CSSProperties}>{stage.name}</span>)}</div>
          {selected.target_publication_date && <p>Target publication · {selected.target_publication_date}</p>}
          {selected.actual_publication_date && <p>Published · {selected.actual_publication_date}</p>}
          {selected.notes && <details><summary>Notes</summary><p>{selected.notes}</p></details>}
          {selected.script && <details><summary>Script</summary><p>{selected.script}</p></details>}
          {!selected.archived && <details className="optional-presets"><summary>Add a preset to additional tasks</summary><form className="apply-template" onSubmit={event => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void mutate(() => rpc('studio_apply_template', { p_project: selected.id, p_template: data.get('preset'), p_stage: data.get('stage') || null }), 'Production preset added.',()=>setAdditionalTasks(true))
          }}>
            <label>Add a preset<select name="preset" required defaultValue="">
              <option value="" disabled>Choose preset</option>{snapshot.templates.filter(item => item.kind !== 'quest').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label>Stage for task<select name="stage" defaultValue={selected.production_stage_id ?? ''}><option value="">No stage</option>
              {snapshot.stages.filter(stage => stage.project_id === selected.id).map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
            <button className="button secondary" disabled={busy}>Add preset</button>
          </form></details>}
        </section>
        {projectTab==='board' && <ProductionBoard key={selected.id} snapshot={snapshot} project={selected} busy={busy} move={updateTask} additional={additionalTasks} setAdditional={setAdditionalTasks}
          add={initialStatus=>open({kind:'task',project:selected,initialStatus})} edit={openTask}
          schedule={task=>open({kind:'block',projectId:selected.id,taskId:task.id})}/>}
        {projectTab==='checklist' && <section className="panel activity-panel">
          <div className="panel-heading"><h2>Production checklist</h2></div>
          {selectedTasks.some(task => !task.production_key) && <button className="button secondary compact additional-tasks"
            onClick={()=>setAdditionalTasks(value=>!value)} aria-pressed={additionalTasks}>
            {additionalTasks?'Hide additional tasks':'Show additional tasks'}</button>}
          {renderTaskTree(null)}
        </section>}
      </> : <Portfolio snapshot={snapshot} open={showProject} busy={busy} move={moveProject}
        edit={editProject} archive={archiveProject} remove={removeProject}/>)}

      {view === 'Insights' && <><Insights snapshot={snapshot} /><section className="panel activity-panel">
        <div className="panel-heading"><h2><Clock3 size={20} /> Session history</h2><Badge>{snapshot.sessions.length}</Badge></div>
        {snapshot.sessions.length ? snapshot.sessions.map(session => <div className="list-row" key={session.id}>
          <span className="project-icon"><Clock3 size={18} /></span>
          <div className="row-copy"><strong>{session.minutes} min · {skillName(session.skill_id)}</strong>
            <small>{projectById.get(session.project_id ?? '')?.name} · {formatDate(session.started_at, session.timezone)}</small></div>
          <button className="button secondary compact" onClick={() => open({ kind: 'session', session })}>Edit</button>
        </div>) : <Empty icon={Clock3} title="No sessions logged">Start the timer or log time manually.</Empty>}
      </section></>}

      {(view === 'Projects' && !selected) && user && <section className="panel activity-panel">
        <div className="panel-heading"><h2>Production templates</h2></div>
        {(['project', 'stage', 'task'] as const).map(kind => <div className="template-group" key={kind}>
          <div className="panel-heading"><h3>{kind[0].toUpperCase() + kind.slice(1)} templates</h3>
            <button className="text-button" onClick={() => open({ kind: 'template', category: kind })}>New {kind} template</button></div>
          {snapshot.templates.filter(item => item.kind === kind).map(template => <div className="list-row" key={template.id}>
            <strong className="row-copy">{template.name}</strong>
            <button className="button secondary compact" onClick={() => open({ kind: 'template', category: kind, template })}>Edit</button>
          </div>)}
        </div>)}
      </section>}

      {view === 'Settings' && <div className="dashboard-grid projects-grid">
        <section className="panel"><div className="panel-heading"><h2>Preferences</h2></div>
          <form className="form settings-form" key={JSON.stringify(snapshot.profile)} onSubmit={event => {
            event.preventDefault()
            if (!user) return
            const values = new FormData(event.currentTarget)
            void mutate(() => rpc('studio_preferences', { p_timezone: values.get('timezone'), p_theme: values.get('theme'), p_bonus: snapshot.profile.default_task_xp }), 'Preferences saved.')
          }}>
            <label>Appearance<select name="theme" defaultValue={user ? snapshot.profile.theme : localTheme} onChange={event => { if (!user) setLocalTheme(event.target.value as Theme) }}>
              <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
            </select></label>
            {user && <>
              <WorkingDays days={daysDraft??snapshot.profile.working_days} change={setDaysDraft}/>
              {daysDraft && <button type="button" className="button secondary" disabled={busy} onClick={()=>{
                void mutate(()=>rpc('studio_working_days',{p_days:daysDraft}),'Working days saved.',()=>setDaysDraft(undefined))
              }}>Save working days</button>}
              <label>Time zone<input name="timezone" required defaultValue={snapshot.profile.timezone} list="timezones" /></label>
              <datalist id="timezones">{Array.from(new Set(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, ...Intl.supportedValuesOf('timeZone')])).map(zone => <option key={zone}>{zone}</option>)}</datalist>
              <button type="button" className="text-button zone-button" onClick={event => {
                const input = event.currentTarget.form?.elements.namedItem('timezone')
                if (input instanceof HTMLInputElement) input.value = Intl.DateTimeFormat().resolvedOptions().timeZone
              }}>Use device time zone</button>
              <button className="button primary" disabled={busy}>Save preferences</button>
            </>}
          </form>
        </section>
        <section className="panel"><div className="panel-heading"><h2>Your data</h2></div>
          <div className="settings-form"><p>Download your preferences, projects, tasks, work sessions, and publication history as JSON.</p>
            <button className="button secondary" disabled={!user || busy} onClick={async () => {
              setError('')
              const owner = currentOwner.current
              try {
                const data = await rpc<Snapshot>('studio_simple_snapshot')
                if (owner !== currentOwner.current) return
                const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
                const link = document.createElement('a')
                link.href = url
                link.download = 'creator-studio-export.json'
                link.click()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
              } catch (failure) { if (owner === currentOwner.current) setError((failure as Error).message) }
            }}><ArrowDownToLine size={17} /> Export JSON</button>
          </div>
        </section>
      </div>}
    </main>

    {modal?.kind === 'auth' && <AuthDialog close={() => setModal(undefined)} />}
    {modal?.kind==='topic' && <TopicEditor topic={modal.topic} busy={busy} error={modalError} close={()=>setModal(undefined)}
      remove={topic=>open({kind:'delete',topic})} save={(id,data)=>void mutate(()=>rpc('studio_topic',{p_id:id,p_data:data}),'Idea saved.')}/>}
    {modal?.kind==='link' && <TopicLink topic={modal.topic} projects={snapshot.projects.filter(project=>!snapshot.topics.some(topic=>topic.project_id===project.id))}
      busy={busy} error={modalError} close={()=>setModal(undefined)} save={id=>void mutate(()=>rpc('studio_link_topic',{p_id:modal.topic.id,p_project:id}),'Project linked.')}/>}
    {modal?.kind==='span' && <SpanEditor item={modal.item} busy={busy} error={modalError} close={()=>setModal(undefined)}
      save={(start,end)=>saveSpan(modal.item,start,end)}/>}
    {modal?.kind==='calendar-day' && <CalendarDayEditor entry={modal.day} snapshot={snapshot} busy={busy} error={modalError}
      close={()=>setModal(undefined)} save={args=>saveDay(modal.day,args)}/>}
    {modal?.kind === 'block' && <BlockEditor snapshot={snapshot} block={modal.block} day={modal.day} projectId={modal.projectId} taskId={modal.taskId} busy={busy} error={modalError}
      close={() => setModal(undefined)} save={saveBlock} duplicate={modal.duplicate} copy={block=>open({kind:'block',block,duplicate:true})} key={modal.duplicate?'duplicate':'block'} />}
    {modal?.kind === 'template' && <TemplateEditor kind={modal.category} template={modal.template} busy={busy} error={modalError}
      close={() => setModal(undefined)} save={args => void mutate(() => rpc('studio_template', args), args.p_delete ? 'Preset deleted.' : 'Preset saved.')} />}
    {modal?.kind === 'project' && <ProjectEditor snapshot={snapshot} project={modal.project} topic={modal.topic} busy={busy} error={modalError} close={() => setModal(undefined)}
      remove={project => open({ kind: 'delete', project })} save={(args, id) => void mutate(() => rpc(modal.project?'studio_edit_workflow_project':'studio_create_simple', args), 'Project saved.', () => {
        setView('Projects')
        setProjectId(id)
        setAdditionalTasks(false)
        setProjectTab('board')
      })} />}
    {modal?.kind === 'task' && <TaskEditor snapshot={snapshot} project={modal.project} task={modal.task} initialStatus={modal.initialStatus}
      busy={busy} error={modalError} close={() => setModal(undefined)}
      action={(task,action)=>action==='delete'?open({kind:'delete',task}):void mutate(()=>rpc('studio_task_action',{
        p_project:task.project_id,p_task:task.id,p_action:action,p_new_id:crypto.randomUUID(),
      }),'Task duplicated.',()=>setAdditionalTasks(true))}
      save={args => void mutate(() => rpc('studio_simple_edit_task', args), 'Task saved.',()=>{if (!modal.task?.production_key) setAdditionalTasks(true)})} />}
    {modal?.kind === 'session' && <SessionEditor snapshot={snapshot} session={modal.session} draft={modal.session ? undefined : timerDraft}
      busy={busy} error={modalError} close={() => setModal(undefined)} remove={session => open({ kind: 'delete', session })}
      save={args => void mutate(() => rpc('studio_log_session', args), 'Work session saved.', () => {
        if (!modal.session) setTimerDraft(undefined)
      })} />}
    {modal?.kind === 'delete' && <StudioDialog title={modal.project ? 'Delete project?' : modal.task ? 'Delete task?' : modal.topic ? 'Delete idea?' : 'Delete work session?'} description={
      modal.project ? `“${modal.project.name}” and its tasks, timeline dates, and calendar entries will be permanently deleted. Logged time and publication history will be kept.` :
        modal.task ? 'This removes the task and its timeline dates. Manually scheduled blocks and logged sessions stay linked to the project.' :
          modal.topic ? 'This permanently deletes the idea. A linked project stays in Projects.' :
            'This session will be permanently deleted from your creative time history.'
    } close={() => { if (!busy) setModal(undefined) }}>
      {modalError && <p className="form-error" role="alert">{modalError}</p>}
      <div className="form-actions">
        <button className="button secondary" disabled={busy} onClick={() => setModal(undefined)}>Cancel</button>
        <button className="button destructive" disabled={busy} onClick={() => {
          const { project, session, task, topic } = modal
          if(task) void mutate(()=>rpc('studio_task_action',{p_project:task.project_id,p_task:task.id,p_action:'delete'}),'Task deleted.')
          if(topic) void mutate(()=>rpc('studio_topic',{p_id:topic.id,p_data:{},p_delete:true}),'Idea deleted.')
          if (project) void mutate(() => rpc('studio_delete_project_keep_history', { p_id: project.id }), 'Project deleted.', () => setProjectId(undefined))
          if (session) void mutate(() => rpc('studio_session', { p_id: session.id, p_project: null, p_task: null, p_skill: null, p_started: null, p_minutes: null, p_delete: true }), 'Session deleted.')
        }}>Delete {modal.project ? 'project' : modal.task ? 'task' : modal.topic ? 'idea' : 'session'}</button>
      </div>
    </StudioDialog>}
  </div>
}

function formatDate(date: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium' }).format(new Date(date))
}

function AuthDialog({ close }: { close: () => void }) {
  const [signup, setSignup] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const form = new FormData(event.currentTarget)
    const fields = { email: String(form.get('email')), password: String(form.get('password')) }
    setPending(true)
    setError('')
    setNotice('')
    try {
      const { data, error } = signup
        ? await supabase.auth.signUp({ ...fields, options: { emailRedirectTo: window.location.origin } })
        : await supabase.auth.signInWithPassword(fields)
      if (error) throw error
      if (data.session) close()
      else setNotice('Check your email for a confirmation link.')
    } catch (failure) { setError((failure as Error).message) }
    finally { setPending(false) }
  }

  return <StudioDialog title={supabase ? signup ? 'Create your account' : 'Sign in to Creator Studio' : 'Connect Supabase'}
    description={supabase ? 'Use your email to access your personal workspace.' : 'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the app. See the README for database setup.'}
    close={close}>
    {supabase && <form className="form" onSubmit={submit}>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 6 : undefined} required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="banner success" role="status">{notice}</p>}
      <div className="form-actions"><button type="button" className="text-button" disabled={pending} onClick={() => { setSignup(!signup); setNotice(''); setError('') }}>{signup ? 'Back to sign in' : 'Create an account'}</button>
        <button className="button primary" disabled={pending}>{pending ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button></div>
    </form>}
  </StudioDialog>
}
