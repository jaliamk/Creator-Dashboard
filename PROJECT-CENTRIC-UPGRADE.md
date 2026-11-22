# Project-centric upgrade

## Repository audit

Creator Studio uses a Next.js client workspace with Supabase RPCs. The planner snapshot contains projects, phases, nested tasks, work blocks, work sessions, presets, and the XP ledger. Completion already goes through `studio_task`, which reconciles effective awards. A calendar block references one stable task ID and does not award XP. The previous planner exposes a weekly calendar and a task tree with sibling reordering. It has no idea backlog, status-based board, date spans, dependency links, or Gantt interactions.

## Phases

1. Add topic, ownership-safe linking, phase and task date spans, dependencies, and achievement definitions. Preserve existing IDs, XP, and clock-time blocks.
2. Expand editable templates and generate the project, board, and date ranges transactionally. Reuse the existing task completion operation.
3. Add a project and master Gantt with scale controls, date editing, move and resize gestures, completion indicators, and undo.
4. Expose work-block move, resize, and duplication in the weekly calendar. Keep clock-time blocks independent of all-day production spans.
5. Add Topic Bank with deduplicated transactional conversion and retroactive project linking.
6. Refine quest recommendations and portfolio filters. Verify data persistence, XP reversal, and interaction across views.

## Migration and existing data

Apply the new migration against the existing database with `supabase migration up --local`. Existing rows, IDs, completion events, work blocks, and award rows are retained. Existing deadline dates and date spans serve different purposes. Old projects receive an initial project start date from their creation date in the owner's time zone. Existing phase and task spans are left unplanned for manual scheduling. New starter presets are copied into existing accounts by name and never overwrite an editable preset.

Task completion awards are effective balances. Moving a task out of Done reverses its effective award. Completing it again restores one award at the configured amount. Rescheduling and work-block completion do not change task completion or XP. Explicitly deleting a task removes its completion award and preserves associated planned blocks and sessions as project-level records.
