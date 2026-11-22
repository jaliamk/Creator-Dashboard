import { createClient } from '@supabase/supabase-js'
import { Clapperboard, FileText, Video, Search, Mic2, Layers3 } from 'lucide-react'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
export const supabase = url && key ? createClient(url, key) : null

export const skills = [
  { id: 'editing', name: 'Editing', color: '#558DE4', icon: Clapperboard },
  { id: 'scriptwriting', name: 'Scriptwriting', color: '#AD78DB', icon: FileText },
  { id: 'filming', name: 'Filming', color: '#D79A4C', icon: Video },
  { id: 'research', name: 'Research', color: '#43A69A', icon: Search },
  { id: 'presentation', name: 'Presentation', color: '#D97792', icon: Mic2 },
  { id: 'production', name: 'Production', color: '#7184C4', icon: Layers3 },
] as const

export type Project = { id: string; name: string; description: string; archived: boolean }
export type Task = {
  id: string; project_id: string; title: string; skill_id: string; status: 'todo' | 'doing' | 'done';
  priority: number; bonus: number; completion_id: string | null; completed_at: string | null
}
export type WorkSession = {
  id: string; project_id: string; task_id: string | null; skill_id: string; started_at: string;
  minutes: number; timezone: string; local_day: string
}
export type Award = { source_type: 'session' | 'completion'; source_id: string; skill_id: string; xp: number; earned_at: string }
export type Theme = 'system' | 'light' | 'dark'
export type Profile = { timezone: string; theme: Theme; creator_factor: number; skill_factor: number; daily_cap: number; default_task_xp: number }
export type Snapshot = { profile: Profile; projects: Project[]; stages: unknown[]; tasks: Task[]; sessions: WorkSession[]; ledger: Award[] }

export const initial: Snapshot = {
  profile: { timezone: 'UTC', theme: 'system', creator_factor: 50, skill_factor: 100, daily_cap: 100, default_task_xp: 10 },
  projects: [], stages: [], tasks: [], sessions: [], ledger: [],
}

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Connect Supabase to save your work.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export function localInput(iso: string, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
