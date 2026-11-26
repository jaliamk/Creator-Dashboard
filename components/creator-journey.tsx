import { useState, type CSSProperties } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { Check, Clock3, Film, Video } from 'lucide-react'
import { quests } from '@/lib/quests'
import { currentDay } from '@/components/planner'
import { stageKey, workflow, workflowKeys, type Snapshot } from '@/lib/studio'

const milestones = [1, 5, 10, 25, 50, 100]
const hours = (minutes: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(minutes / 60)
const activities = {
  ideation: 'Ideation and research',
  scriptwriting: 'Scriptwriting',
  filming: 'Filming and rehearsal',
  editing: 'Editing',
  preparing: 'Publishing preparation',
  published: 'Published',
}

export function CreatorJourney({ snapshot }: { snapshot: Snapshot }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('week')
  const { publications, sessions, quest_completions } = snapshot
  const total = publications.length
  const long = publications.filter(item => item.format === 'long').length
  const minutes = sessions.reduce((sum, session) => sum + session.minutes, 0)
  const short = total - long
  const sessionCount = sessions.length + quest_completions.filter(item => quests[item.quest_key].session).length
  const history = [
    ...publications.map(item => ({
      id: item.source_project_id, title: item.title, date: item.published_on,
      description: item.format === 'long' ? 'Long-form video published' : 'Short published',
    })),
    ...quest_completions.map(item => ({
      id: item.id, title: quests[item.quest_key].title,
      date: Temporal.Instant.from(item.completed_at).toZonedDateTimeISO(snapshot.profile.timezone).toPlainDate().toString(),
      description: 'Quest completed',
    })),
  ].sort((a,b) => b.date.localeCompare(a.date))
  const activeWeeks = new Set(sessions.map(session => {
    const date = Temporal.PlainDate.from(session.local_day)
    return date.subtract({ days: date.dayOfWeek - 1 }).toString()
  })).size
  const day = currentDay(snapshot.profile.timezone)
  const thisPeriod = period === 'week' ? day.subtract({ days: day.dayOfWeek - 1 }) : day.with({ day: 1 })
  const visible = sessions.filter(session => session.local_day <= day.toString() && (period === 'all' || session.local_day >= thisPeriod.toString()))
  const visibleMinutes = visible.reduce((sum, session) => sum + session.minutes, 0)
  const activity = workflowKeys.filter(stage => stage !== 'published').map(stage => ({
    stage, minutes: visible.filter(session => stageKey(undefined, session.skill_id) === stage).reduce((sum, session) => sum + session.minutes, 0),
  }))
  return <div className="journey">
    <section className="journey-metrics" aria-label="Creative accomplishments">
      {[
        { label: 'Long-form videos published', value: long, icon: Film },
        { label: 'Shorts published', value: short, icon: Video },
        { label: 'Total content pieces published', value: total, icon: Check },
        { label: 'Creative work sessions completed', value: sessionCount, icon: Clock3 },
      ].map(({ label, value, icon: Icon }) => <article className="panel journey-stat" key={label}>
        <Icon size={19} aria-hidden="true"/><strong>{value}</strong><span>{label}</span>
      </article>)}
    </section>
    <div className="journey-publication-milestones">
      <Milestones title="Long-form milestones" count={long} unit="videos"/>
      <Milestones title="Short-form milestones" count={short} unit="Shorts"/>
    </div>
    <section className="panel journey-effort">
      <div className="panel-heading"><h2>Creative effort</h2><label>Period <select value={period}
        onChange={event => setPeriod(event.target.value as typeof period)}>
        <option value="week">This week</option><option value="month">This month</option><option value="all">All time</option>
      </select></label></div>
      <p><strong>{hours(visibleMinutes)} hours</strong> · {hours(minutes)} hours overall · {visible.length} logged sessions · {activeWeeks} active weeks overall</p>
      <ul>{activity.map(item => <li key={item.stage} style={{ '--stage': workflow[item.stage].color } as CSSProperties}>
        <span>{activities[item.stage]}</span>
        <progress max={Math.max(visibleMinutes, 1)} value={item.minutes} aria-label={`${activities[item.stage]} share of time`} />
        <strong>{hours(item.minutes)} h</strong>
      </li>)}</ul>
    </section>
    <section className="panel journey-publications">
      <h2>Accomplishment history</h2>
      {history.length ? history.map(item => <div className="list-row" key={item.id}>
        <div className="row-copy"><strong>{item.title}</strong><small>{item.description}</small></div>
        <time dateTime={item.date}>{Temporal.PlainDate.from(item.date).toLocaleString('en',{dateStyle:'medium'})}</time>
      </div>) : <p>Published projects and completed quests will appear here.</p>}
    </section>
  </div>
}

function Milestones({title,count,unit}:{title:string;count:number;unit:string}) {
  const next = milestones.find(value => value > count)
  return <section className="panel journey-milestones" aria-label={title}>
    <h2>{title}</h2>
    <p>{next ? `${count} of ${next} toward the next milestone` : 'All milestones reached'}</p>
    <progress max={next ?? 100} value={Math.min(count,next ?? 100)} aria-label={`Progress toward next ${title.toLowerCase()}`}/>
    <ul>{milestones.map(value => <li key={value} data-reached={count>=value}>
      <span>{count>=value ? <Check size={15} aria-label="Reached"/> : value}</span>
      {value===1?'First publication':`${value} ${unit}`}
    </li>)}</ul>
  </section>
}
