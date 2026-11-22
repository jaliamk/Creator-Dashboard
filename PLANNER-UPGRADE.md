# Planner upgrade audit and plan

The Next.js workspace uses the existing Supabase snapshot and owner-serialized RPCs. Projects, production stages, parent tasks, work sessions, profiles, skills, and the effective-award ledger already exist. Task stage, parent and ordering columns are unused by the current forms. Two legacy task scheduling columns can represent only one interval. There are no calendar views, template records, drag-and-drop controls, or skill branch views.

1. Extend the existing tables with production and session metadata. Preserve identifiers, completion events, award rows, and timezone attribution. Backfill a valid legacy task schedule into a distinct work block and retain the legacy columns for older clients.
2. Introduce independent work blocks and editable, owner-scoped templates and presets. Keep work blocks outside XP calculation. Instantiate templates inside the same transaction as project creation.
3. Make Planner the landing view. Integrate task nesting and ordering, Today, Quick Quests, Skills, and Insights with the existing auth, timer, ledger, and editing flows.
4. Exercise upgrades with existing rows and test application behavior before sharing the source. Apply with `supabase migration up --local` on an existing local installation. Preserve the local database volume and back it up before applying the upgrade.

The existing ledger records effective awards rather than immutable historical events. The migration preserves these rows and leaves the established reconciliation rules in place. Old sessions have their end time inferred from duration and their entry method defaults to manual because older clients did not record that distinction. Existing projects continue with their current stages and data.
