import { useState, type CSSProperties } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { Check, Clock3, Film, Video } from 'lucide-react'
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
  const { publications, sessions } = snapshot
  const total = publications.length
  const long = publications.filter(item => item.format === 'long').length
  const minutes = sessions.reduce((sum, session) => sum + session.minutes, 0)
  const next = milestones.find(count => count > total)
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
        { label: 'Short-form videos published', value: total - long, icon: Video },
        { label: 'Projects completed', value: total, icon: Check },
        { label: 'Creative hours invested', value: hours(minutes), icon: Clock3 },
      ].map(({ label, value, icon: Icon }) => <article className="panel journey-stat" key={label}>
        <Icon size={19} aria-hidden="true"/><strong>{value}</strong><span>{label}</span>
      </article>)}
    </section>
    <section className="panel journey-milestones">
      <h2>Publication milestones</h2>
      <p>{next ? `${total} of ${next} published ${next === 1 ? 'video' : 'videos'} toward your next milestone` : 'All publication milestones reached'}</p>
      <progress max={next ?? 100} value={Math.min(total, next ?? 100)} aria-label="Progress toward next publication milestone" />
      <ul>{milestones.map(count => <li key={count} data-reached={total >= count}>
        <span>{total >= count ? <Check size={15} aria-label="Reached"/> : count}</span>
        {count === 1 ? 'First video' : `${count} videos`}
      </li>)}</ul>
    </section>
    <section className="panel journey-effort">
      <div className="panel-heading"><h2>Creative effort</h2><label>Period <select value={period}
        onChange={event => setPeriod(event.target.value as typeof period)}>
        <option value="week">This week</option><option value="month">This month</option><option value="all">All time</option>
      </select></label></div>
      <p><strong>{hours(visibleMinutes)} hours</strong> · {visible.length} sessions · {activeWeeks} active weeks overall</p>
      <ul>{activity.map(item => <li key={item.stage} style={{ '--stage': workflow[item.stage].color } as CSSProperties}>
        <span>{activities[item.stage]}</span>
        <progress max={Math.max(visibleMinutes, 1)} value={item.minutes} aria-label={`${activities[item.stage]} share of time`} />
        <strong>{hours(item.minutes)} h</strong>
      </li>)}</ul>
    </section>
    {total > 0 && <section className="panel journey-publications">
      <h2>Published work</h2>
      {publications.slice().reverse().map(item => <div className="list-row" key={item.source_project_id}>
        <div className="row-copy"><strong>{item.title}</strong><small>{item.format === 'long' ? 'Long-form' : 'Short-form'}</small></div>
        <time dateTime={item.published_on}>{Temporal.PlainDate.from(item.published_on).toLocaleString('en', { dateStyle: 'medium' })}</time>
      </div>)}
    </section>}
  </div>
}
