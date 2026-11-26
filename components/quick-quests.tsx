import type { CSSProperties } from 'react'
import { Check, Undo2 } from 'lucide-react'
import { questKeys, quests, type QuestKey } from '@/lib/quests'
import { workflow, type QuestCompletion } from '@/lib/studio'

export function QuickQuests({ keys = questKeys, latest, acknowledged, busy, complete, undo, daily = false }: {
  keys?: QuestKey[]; latest?: QuestCompletion; acknowledged: QuestKey[]; busy: boolean; daily?: boolean;
  complete: (key: QuestKey) => void; undo: (completion: QuestCompletion) => void
}) {
  return <section className="panel" aria-label={daily ? 'Daily quests' : 'Quick quests'}>
    <div className="panel-heading">
      <h2>{daily ? 'Daily quests' : 'Creative quests'}</h2>
      {latest && <button type="button" className="button secondary compact" disabled={busy} onClick={() => undo(latest)}
        aria-label={`Undo ${quests[latest.quest_key].title}`}><Undo2 size={15}/> Undo last completion</button>}
    </div>
    <div className="quest-grid">{keys.map(key => {
      const quest = quests[key]
      return <article className="quest-card" key={key} style={{ '--skill': workflow[quest.stage].color } as CSSProperties}>
        <div><h3>{quest.title}</h3><p className="muted">{quest.description}</p></div>
        <div className="actions"><button type="button" className="button primary compact" disabled={busy || acknowledged.includes(key)}
          aria-label={`Complete ${quest.title}`} onClick={() => complete(key)}><Check size={15}/> {acknowledged.includes(key) ? 'Acknowledged today' : 'Complete'}</button></div>
      </article>
    })}</div>
  </section>
}
