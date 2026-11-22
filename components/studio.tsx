'use client'

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  Activity, ArrowDownToLine, Check, ChevronRight, CircleCheck, Clock3,
  FolderOpen, LayoutGrid, ListTodo, LogIn, LogOut, Plus, Settings2, Sparkles, Timer,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StudioDialog } from '@/components/ui/dialog'
import { progression } from '@/lib/progression'
import { initial, rpc, skills, supabase, type Project, type Snapshot, type Task, type Theme, type WorkSession } from '@/lib/studio'
import { ProjectEditor, SessionEditor, TaskEditor } from '@/components/studio-forms'

const navigation = [
  { name: 'Overview', icon: LayoutGrid },
  { name: 'Projects', icon: FolderOpen },
  { name: 'Work sessions', icon: Clock3 },
  { name: 'Settings', icon: Settings2 },
] as const
type View = typeof navigation[number]['name']
type Modal =
  | { kind: 'auth' }
  | { kind: 'project'; project?: Project }
  | { kind: 'task'; project: Project; task?: Task }
  | { kind: 'session'; session?: WorkSession }
  | { kind: 'delete'; project?: Project; session?: WorkSession }

const priority: Record<number, string> = { 1: 'High', 2: 'Medium', 3: 'Low' }
const status = { todo: 'To do', doing: 'In progress', done: 'Done' }
const skillName = (id: string) => skills.find(skill => skill.id === id)?.name ?? id

function ProgressBar({ value, label }: { value: number; label: string }) {
  return <div className="progress" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <span style={{ width: `${value}%` }} />
  </div>
}

function Empty({ icon: Icon, title, children }: { icon: typeof Clock3; title: string; children: React.ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon size={19} /></span><div><strong>{title}</strong><p>{children}</p></div></div>
}

export function Studio() {
  const [user, setUser] = useState<User | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>(initial)
  const [view, setView] = useState<View>('Overview')
  const [projectId, setProjectId] = useState<string>()
  const [modal, setModal] = useState<Modal>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [modalError, setModalError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [timerStart, setTimerStart] = useState<number>()
  const [elapsed, setElapsed] = useState(0)
  const [timerDraft, setTimerDraft] = useState<{ started: string; minutes: number }>()
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
      if (currentOwner.current === nextOwner) { setLoading(false); return }
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
      if (!nextUser) { setLoading(false); return }
      setLoading(true)
      reload = setTimeout(() => {
        rpc<Snapshot>('studio_snapshot', { p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(data => {
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
    if (busy) return
    const owner = currentOwner.current
    const inDialog = Boolean(modal)
    setBusy(true)
    setError('')
    setModalError('')
    setNotice('')
    try {
      await work()
      if (owner !== currentOwner.current) return
      setModal(undefined)
      setNotice(message)
      after?.()
      const data = await rpc<Snapshot>('studio_snapshot')
      if (owner === currentOwner.current) setSnapshot(data)
    } catch (failure) {
      if (owner !== currentOwner.current) return
      const message = failure instanceof Error ? failure.message : 'Something went wrong. Try again.'
      if (inDialog) setModalError(message)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  function updateTask(task: Task, state: Task['status']) {
    void mutate(() => rpc('studio_task', {
      p_id: task.id, p_project: task.project_id, p_title: task.title, p_skill: task.skill_id,
      p_status: state, p_priority: task.priority, p_bonus: task.bonus,
    }), state === 'done' ? 'Task completed. XP updated.' : 'Task reopened. XP updated.')
  }

  function stopTimer() {
    if (timerStart === undefined) return
    setTimerDraft({
      started: new Date(timerStart).toISOString(),
      minutes: Math.min(1440, Math.floor((Date.now() - timerStart) / 60000)),
    })
    setTimerStart(undefined)
    open({ kind: 'session' })
  }

  const projects = snapshot.projects.filter(project => !project.archived)
  const selected = snapshot.projects.find(project => project.id === projectId)
  const projectById = new Map(snapshot.projects.map(project => [project.id, project]))
  const queue = snapshot.tasks.filter(task => task.status !== 'done' && !projectById.get(task.project_id)?.archived)
  const total = snapshot.ledger.reduce((sum, entry) => sum + entry.xp, 0)
  const creator = progression(total, snapshot.profile.creator_factor)
  const activity = [
    ...snapshot.sessions.map(session => ({
      id: session.id, date: session.started_at, title: `${session.minutes} min · ${skillName(session.skill_id)}`,
      subtitle: projectById.get(session.project_id)?.name, kind: 'session',
    })),
    ...snapshot.tasks.filter(task => task.status === 'done').map(task => ({
      id: task.completion_id!, date: task.completed_at!, title: task.title,
      subtitle: projectById.get(task.project_id)?.name, kind: 'completion',
    })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

  function showProject(project: Project) {
    setView('Projects')
    setProjectId(project.id)
  }

  function renderTask(task: Task) {
    const project = projectById.get(task.project_id)
    return <div className="list-row" key={task.id}>
      <button className={`check-button ${task.status === 'done' ? 'checked' : ''}`} disabled={busy}
        aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}
        onClick={() => updateTask(task, task.status === 'done' ? 'todo' : 'done')}><Check size={15} /></button>
      <div className="row-copy"><strong>{task.title}</strong><small>{view === 'Projects' && selected ? status[task.status] : project?.name} · {skillName(task.skill_id)}</small></div>
      <Badge tone={task.priority === 1 ? 'danger' : 'neutral'}>{priority[task.priority]}</Badge>
      {project && <button className="icon-button" aria-label={`Edit ${task.title}`} onClick={() => open({ kind: 'task', project, task })}><ChevronRight size={18} /></button>}
    </div>
  }

  function renderProject(project: Project) {
    const tasks = snapshot.tasks.filter(task => task.project_id === project.id)
    return <button key={project.id} className="project-row" onClick={() => showProject(project)}>
      <span className="project-icon"><FolderOpen size={20} /></span>
      <span className="row-copy"><strong>{project.name}</strong><small>{project.archived ? 'Archived · ' : ''}{tasks.filter(task => task.status === 'done').length}/{tasks.length} tasks complete</small></span>
      <ChevronRight size={17} className="muted" />
    </button>
  }

  const logButton = <button className="button secondary" onClick={() => open({ kind: 'session' })}><Clock3 size={17} /> Log time</button>
  const newButton = <button className="button primary" onClick={() => open({ kind: 'project' })}><Plus size={18} /> New project</button>
  const timerButton = <button className={`button ${timerStart === undefined ? 'secondary' : 'primary'}`} onClick={() => {
    if (!user) { open({ kind: 'auth' }); return }
    if (timerStart !== undefined) { stopTimer(); return }
    setElapsed(0)
    setTimerStart(Date.now())
    setNotice('Work timer started.')
  }}><Timer size={17} />{timerStart === undefined ? 'Start timer' : `Stop · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}</button>

  return <div className="studio-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => { setView('Overview'); setProjectId(undefined) }}>
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
      <div className="topline"><span>Workspace</span><ChevronRight size={14} /><strong>{view}</strong></div>
      <header className="page-header">
        <div>
          {view === 'Projects' && selected && <button className="text-button back" onClick={() => setProjectId(undefined)}>All projects</button>}
          <h1>{view === 'Overview' ? 'Studio overview' : selected?.name ?? view}</h1>
          <p>{view === 'Overview' ? 'Track your projects, build your skills, and see your progress.' :
            view === 'Projects' ? selected?.description || 'Organize creative projects and production tasks.' :
            view === 'Work sessions' ? 'Track the time you spend building your skills.' : 'Manage your workspace preferences and data.'}</p>
        </div>
        <div className="actions">
          {view === 'Overview' && <>{logButton}{newButton}</>}
          {view === 'Projects' && (selected ? <>
            <button className="button secondary" onClick={() => open({ kind: 'project', project: selected })}>Edit project</button>
            <button className="button primary" onClick={() => open({ kind: 'task', project: selected })}><Plus size={17} /> New task</button>
          </> : newButton)}
          {(view === 'Work sessions' || (timerStart !== undefined && view !== 'Settings')) && timerButton}
          {view === 'Work sessions' && logButton}
        </div>
      </header>
      {loading && <div className="banner" role="status">Loading your workspace…</div>}
      {error && !modal && <div className="banner danger" role="alert" ref={pageError} tabIndex={-1}>{error}
        {user && <button className="text-button" onClick={() => void mutate(async () => {}, 'Workspace refreshed.')}>Refresh workspace</button>}
      </div>}
      {notice && <div className="banner success" role="status"><CircleCheck size={17} /> {notice}</div>}
      {!loading && !user && <div className="banner guest">
        <span>{supabase ? 'Sign in to save projects and start earning XP.' : 'Connect Supabase to enable sign-in and save your work.'}</span>
        <button className="text-button" onClick={() => open({ kind: 'auth' })}>{supabase ? 'Sign in' : 'Connection details'}</button>
      </div>}

      {view === 'Overview' && <>
        <section className="hero" aria-labelledby="creator-level">
          <div className="hero-content">
            <div className="hero-label"><Sparkles size={17} /> Creator progression</div>
            <div className="hero-level"><h2 id="creator-level">Level {creator.level}</h2><span>{total.toLocaleString()} total XP</span></div>
            <ProgressBar value={creator.percent} label="Creator level progress" />
            <div className="hero-meta"><span>{creator.current.toLocaleString()} / {creator.target.toLocaleString()} XP</span><span>Level {creator.level + 1}</span></div>
          </div>
          <div className="hero-art" aria-hidden="true"><div className="orbit orbit-outer" /><div className="orbit orbit-inner" /><div className="hero-glyph"><Sparkles size={69} strokeWidth={1.25} /></div></div>
        </section>
        <section className="skills-section" aria-labelledby="skill-heading">
          <div className="section-heading"><div><h2 id="skill-heading">Creative skills</h2><p>Progress across your production toolkit.</p></div></div>
          <div className="skill-grid">{skills.map(({ id, name, color, icon: Icon }) => {
            const xp = snapshot.ledger.filter(entry => entry.skill_id === id).reduce((sum, entry) => sum + entry.xp, 0)
            const skill = progression(xp, snapshot.profile.skill_factor)
            return <article className="skill-card" key={id} style={{ '--skill': color } as CSSProperties}>
              <div className="skill-top"><span className="skill-icon"><Icon size={19} /></span><Badge>Lv. {skill.level}</Badge></div>
              <h3>{name}</h3><ProgressBar value={skill.percent} label={`${name} level progress`} />
              <p>{skill.current.toLocaleString()} / {skill.target.toLocaleString()} XP</p>
            </article>
          })}</div>
        </section>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-heading"><h2><FolderOpen size={20} /> Current projects</h2><button className="text-button" onClick={() => { setView('Projects'); setProjectId(undefined) }}>View all</button></div>
            {projects.length ? projects.slice(0, 4).map(renderProject) : <Empty icon={FolderOpen} title="No active projects">Create a project to plan your next piece.</Empty>}
          </section>
          <section className="panel">
            <div className="panel-heading"><h2><ListTodo size={20} /> Next up</h2><Badge>{queue.length}</Badge></div>
            {queue.length ? queue.slice(0, 4).map(renderTask) : <Empty icon={ListTodo} title="Your queue is clear">Add tasks within a project to see them here.</Empty>}
          </section>
        </div>
        <section className="panel activity-panel">
          <div className="panel-heading"><h2><Activity size={20} /> Recent activity</h2></div>
          {activity.length ? activity.slice(0, 6).map(item => <div className="list-row" key={item.id}>
            <span className="project-icon">{item.kind === 'session' ? <Clock3 size={18} /> : <Check size={18} />}</span>
            <div className="row-copy"><strong>{item.title}</strong><small>{item.subtitle} · {formatDate(item.date, snapshot.profile.timezone)}</small></div>
            <span className="xp-label">+{snapshot.ledger.find(award => award.source_type === item.kind && award.source_id === item.id)?.xp ?? 0} XP</span>
          </div>) : <Empty icon={Activity} title="No activity yet">Completed tasks and logged work will show up here.</Empty>}
        </section>
      </>}

      {view === 'Projects' && (selected ? <section className="panel">
        <div className="panel-heading"><h2><ListTodo size={20} /> Production tasks</h2>{selected.archived && <Badge>Archived</Badge>}</div>
        {snapshot.tasks.some(task => task.project_id === selected.id)
          ? snapshot.tasks.filter(task => task.project_id === selected.id).map(renderTask)
          : <Empty icon={ListTodo} title="No tasks yet">Add the first production task for this project.</Empty>}
      </section> : <div className="dashboard-grid projects-grid">
        <section className="panel"><div className="panel-heading"><h2>Active projects</h2><Badge>{projects.length}</Badge></div>
          {projects.length ? projects.map(renderProject) : <Empty icon={FolderOpen} title="No active projects">Create a project to start planning.</Empty>}
        </section>
        <section className="panel"><div className="panel-heading"><h2>Archived projects</h2></div>
          {snapshot.projects.some(project => project.archived) ? snapshot.projects.filter(project => project.archived).map(renderProject) : <Empty icon={FolderOpen} title="Nothing archived">Archived projects appear here.</Empty>}
        </section>
      </div>)}

      {view === 'Work sessions' && <section className="panel">
        <div className="panel-heading"><h2><Clock3 size={20} /> Session history</h2><Badge>{snapshot.sessions.length}</Badge></div>
        {snapshot.sessions.length ? snapshot.sessions.map(session => <div className="list-row" key={session.id}>
          <span className="project-icon"><Clock3 size={18} /></span>
          <div className="row-copy"><strong>{session.minutes} min · {skillName(session.skill_id)}</strong>
            <small>{projectById.get(session.project_id)?.name} · {formatDate(session.started_at, session.timezone)}</small></div>
          <span className="xp-label">+{snapshot.ledger.find(award => award.source_type === 'session' && award.source_id === session.id)?.xp ?? 0} XP</span>
          <button className="button secondary compact" onClick={() => open({ kind: 'session', session })}>Edit</button>
        </div>) : <Empty icon={Clock3} title="No sessions logged">Start the timer or log time manually.</Empty>}
      </section>}

      {view === 'Settings' && <div className="dashboard-grid projects-grid">
        <section className="panel"><div className="panel-heading"><h2>Preferences</h2></div>
          <form className="form settings-form" key={JSON.stringify(snapshot.profile)} onSubmit={event => {
            event.preventDefault()
            if (!user) return
            const values = new FormData(event.currentTarget)
            void mutate(() => rpc('studio_preferences', { p_timezone: values.get('timezone'), p_theme: values.get('theme'), p_bonus: Number(values.get('bonus')) }), 'Preferences saved.')
          }}>
            <label>Appearance<select name="theme" defaultValue={user ? snapshot.profile.theme : localTheme} onChange={event => { if (!user) setLocalTheme(event.target.value as Theme) }}>
              <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
            </select></label>
            {user && <>
              <label>Time zone<input name="timezone" required defaultValue={snapshot.profile.timezone} list="timezones" /></label>
              <datalist id="timezones">{Array.from(new Set(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, ...Intl.supportedValuesOf('timeZone')])).map(zone => <option key={zone}>{zone}</option>)}</datalist>
              <button type="button" className="text-button zone-button" onClick={event => {
                const input = event.currentTarget.form?.elements.namedItem('timezone')
                if (input instanceof HTMLInputElement) input.value = Intl.DateTimeFormat().resolvedOptions().timeZone
              }}>Use device time zone</button>
              <label>Default task completion XP<input name="bonus" type="number" min="0" max="10000" required defaultValue={snapshot.profile.default_task_xp} /></label>
              <button className="button primary" disabled={busy}>Save preferences</button>
            </>}
          </form>
        </section>
        <section className="panel"><div className="panel-heading"><h2>Your data</h2></div>
          <div className="settings-form"><p>Download your preferences, projects, tasks, work sessions, and XP ledger as JSON.</p>
            <button className="button secondary" disabled={!user || busy} onClick={async () => {
              setError('')
              const owner = currentOwner.current
              try {
                const data = await rpc<Snapshot>('studio_snapshot')
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
    {modal?.kind === 'project' && <ProjectEditor project={modal.project} busy={busy} error={modalError} close={() => setModal(undefined)}
      remove={project => open({ kind: 'delete', project })} save={(args, id) => void mutate(() => rpc('studio_project', args), 'Project saved.', () => {
        setView('Projects')
        setProjectId(id)
      })} />}
    {modal?.kind === 'task' && <TaskEditor project={modal.project} task={modal.task} defaultBonus={snapshot.profile.default_task_xp}
      busy={busy} error={modalError} close={() => setModal(undefined)}
      save={args => void mutate(() => rpc('studio_task', args), args.p_status === 'done' ? 'Task saved. XP updated.' : 'Task saved.')} />}
    {modal?.kind === 'session' && <SessionEditor snapshot={snapshot} session={modal.session} draft={modal.session ? undefined : timerDraft}
      busy={busy} error={modalError} close={() => setModal(undefined)} remove={session => open({ kind: 'delete', session })}
      save={args => void mutate(() => rpc('studio_session', args), 'Work session saved. XP updated.', () => {
        if (!modal.session) setTimerDraft(undefined)
      })} />}
    {modal?.kind === 'delete' && <StudioDialog title={modal.project ? 'Delete project?' : 'Delete work session?'} description={
      modal.project ? `“${modal.project.name}” and its tasks and sessions will be permanently deleted. XP will be recalculated.` :
        'This session will be permanently deleted. XP for that day will be recalculated.'
    } close={() => { if (!busy) setModal(undefined) }}>
      {modalError && <p className="form-error" role="alert">{modalError}</p>}
      <div className="form-actions">
        <button className="button secondary" disabled={busy} onClick={() => setModal(undefined)}>Cancel</button>
        <button className="button destructive" disabled={busy} onClick={() => {
          const { project, session } = modal
          if (project) void mutate(() => rpc('studio_project', { p_id: project.id, p_name: '', p_description: '', p_archived: false, p_delete: true }), 'Project deleted. XP updated.', () => setProjectId(undefined))
          if (session) void mutate(() => rpc('studio_session', { p_id: session.id, p_project: null, p_task: null, p_skill: null, p_started: null, p_minutes: null, p_delete: true }), 'Session deleted. XP updated.')
        }}>Delete {modal.project ? 'project' : 'session'}</button>
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
