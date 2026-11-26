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

export const workflow = {
  ideation: { name: 'Ideation', color: '#A68BB5' },
  scriptwriting: { name: 'Scriptwriting', color: '#6489B5' },
  filming: { name: 'Filming', color: '#648B80' },
  editing: { name: 'Editing', color: '#BD8A55' },
  preparing: { name: 'Preparing to Publish', color: '#BF7886' },
  published: { name: 'Published', color: '#749B68' },
} as const
export type WorkflowStage = keyof typeof workflow
export const workflowKeys = Object.keys(workflow) as WorkflowStage[]

export function stageKey(name: string | undefined, skill?: string): WorkflowStage {
  if (name) {
    if (/publish|thumbnail|metadata|upload/i.test(name)) return 'preparing'
    if (/edit|post-production/i.test(name)) return 'editing'
    if (/film|rehears|test run|record/i.test(name)) return 'filming'
    if (/script|writ/i.test(name)) return 'scriptwriting'
    if (/ideation|research|selection/i.test(name)) return 'ideation'
  }
  if (skill === 'editing' || skill === 'filming' || skill === 'scriptwriting') return skill
  return skill === 'production' ? 'preparing' : skill === 'presentation' ? 'filming' : 'ideation'
}

export type CalendarDay = {
  project_id: string; task_id: string; day: string;
  starts_at: string | null; ends_at: string | null; timezone: string | null;
}
export type Publication = { source_project_id: string; title: string; format: 'long' | 'short'; published_on: string }

export type Project = { id: string; name: string; description: string; archived: boolean
  content_type: string; production_stage_id: string | null; priority: number; status: string; workflow_stage: WorkflowStage
  target_publication_date: string | null; actual_publication_date: string | null; notes: string; script: string
  created_at: string; updated_at: string; start_date: string | null; cover_url: string
}
export type Span = { planned_start: string | null; planned_end: string | null }
export type Stage = Span & { id: string; project_id: string; name: string; position: number }
export type Block = { id: string; project_id: string; task_id: string | null; starts_at: string; ends_at: string; timezone: string; notes: string; status: 'planned' | 'completed' | 'cancelled' }
export type TaskPreset = { title: string; skill: string; minutes?: number; days_before_publish?: number; bonus?: number }
export type Template = { id: string; name: string; kind: 'project' | 'stage' | 'task' | 'quest'; details: {
  stages?: { name: string; duration_days?: number; tasks: TaskPreset[] }[]; tasks?: TaskPreset[];
  skill?: string; minutes?: number; bonus?: number; content_type?: string
} }
export type Milestone = { skill_id: string; branch: string; title: string; xp: number }
export type Topic = { id: string; project_id: string | null; title: string; description: string; notes: string; links: string[];
  category: string; content_type: string; priority: number; status: 'idea' | 'exploring' | 'ready' | 'converted'; archived: boolean; created_at: string }
export type Achievement = { id: string; title: string; description: string; metric: 'projects' | 'tasks' | 'minutes' | 'xp'; threshold: number }
export type PlanPhase = { name: string; duration: number; start: string | null; end: string | null; tasks: (TaskPreset & { start: string | null; end: string | null })[] }
export type SessionDraft = { started: string; minutes: number; ended?: string; skill?: string; project?: string; task?: string; method?: 'timer' | 'manual' }
export type Task = Span & {
  id: string; project_id: string; title: string; skill_id: string; status: 'todo' | 'doing' | 'done';
  depends_on: string | null; parent_id: string | null; stage_id: string | null; description: string; position: number;
  estimated_minutes: number | null; due_date: string | null; created_at: string; updated_at: string;
  priority: number; bonus: number; completion_id: string | null; completed_at: string | null
}
export type WorkSession = {
  id: string; project_id: string | null; task_id: string | null; skill_id: string; started_at: string;
  minutes: number; timezone: string; local_day: string; ended_at: string | null; entry_method: 'timer' | 'manual'; notes: string; created_at: string; updated_at: string
}
export type Award = { source_type: 'session' | 'completion'; source_id: string; skill_id: string; xp: number; earned_at: string }
export type Theme = 'system' | 'light' | 'dark'
export type Profile = { timezone: string; theme: Theme; creator_factor: number; skill_factor: number; daily_cap: number; default_task_xp: number; working_days: number[] }
export type Snapshot = { profile: Profile; projects: Project[]; stages: Stage[]; blocks: Block[]; templates: Template[]; milestones: Milestone[]; tasks: Task[]; sessions: WorkSession[]; ledger: Award[]; topics: Topic[]; achievements: Achievement[]; calendar_days: CalendarDay[]; publications: Publication[] }

export const initial: Snapshot = {
  profile: { timezone: 'UTC', theme: 'system', creator_factor: 50, skill_factor: 100, daily_cap: 100, default_task_xp: 10, working_days: [1, 2, 3, 4, 5] },
  projects: [], stages: [], tasks: [], sessions: [], ledger: [], blocks: [], templates: [], milestones: [], topics: [], achievements: [], calendar_days: [], publications: [],
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
