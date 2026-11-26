# Creator Studio

A personal workspace for content production and creative skill progression. The Next.js dashboard uses Supabase Auth and PostgreSQL for sign-in, projects, tasks, work sessions, preferences, and XP.

## Run locally

Requires Node.js 22 or later and npm. Use either a hosted Supabase project or a local Supabase CLI stack. The local stack also requires Docker.

1. Run `npm ci`.
2. For local Supabase, run `supabase start` and copy the API URL and publishable key shown by `supabase status`. The CLI applies migrations at startup. For a new hosted project, run `supabase login`, `supabase link --project-ref YOUR_PROJECT_REF`, then `supabase db push`. Copy the project URL and publishable key from the Supabase dashboard.
3. Copy `.env.example` to `.env.local` and set both variables below.
4. Run `npm run dev`, visit `http://localhost:3000`, and create an account. If email confirmation is enabled in Supabase, follow the confirmation link before signing in.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase project API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The Supabase publishable key or legacy anon key |

The dashboard renders a connection prompt when these variables are absent. All project and progression writes require an authenticated Supabase session.

For sample data, create a local development account, then run the following with PostgreSQL's `psql` client. The default local database connection string is shown by `supabase status`.

```sh
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -v ON_ERROR_STOP=1 -v seed_email=you@example.com -f supabase/seed.sql
```

The seed is scoped to one disposable account per development database and uses fixed IDs, so rerunning it updates its sample rows. The migrations populate the six skill definitions for every installation.

## Upgrade an existing local installation

Keep the original local Supabase database. Stop the app with Control+C, then run `supabase migration up --local` from the updated project directory while Docker and Supabase are running. Retain your existing `.env.local` and restart the app with `npm run dev`. If you downloaded a fresh ZIP, copy your existing `.env.local` into the new folder first. The workflow migration retains existing tasks and templates and maps previously blocked tasks to In Progress. See [the planning migration notes](PROJECT-CENTRIC-UPGRADE.md) for the prior upgrade.

**Projects** is the production board. New projects default to Studio workflow with five actionable tasks. Move project cards through the board to Published, or use the stage menu on a card. Use **Show archive** to find and restore archived projects. Existing templates and older workflows remain available.

**Timeline** shows project phases and task date ranges. A task appears once per calendar date in its range. All-day entries can be assigned a start, an end, or a duration in Calendar. Use **Time grid** to drag or resize a timed entry within its date. Timeline changes add or remove daily entries and keep times for the dates that are still in range. Standalone work blocks remain available and keep their existing schedule.

**Creator Journey** tracks long- and short-form publications, completed projects, creative hours, sessions, and milestones. Published is the final completion stage, so published projects are also counted as completed. A publication is recorded once per project. Deleting a project clears its planning records and retains its publication and logged time. Archiving preserves the project and removes it from active planning views.

**Quick Quests** can start a timer or prefill a manual work log. Choose a project and task if they apply. Insights provides a session history. Historical XP rows and the existing reconciliation routines remain available for compatibility and export. The workspace uses accomplishments and time for progress.

## Architecture

- `app/` and `components/` provide the Next.js dashboard, Radix-based shadcn-style dialogs, project and task editors, session timer and preview, authentication, and preferences.
- `lib/progression.ts` maps effective XP to levels and progress. Its factors come from the database profile. Database defaults also expose the time-based XP rate and daily cap. An administrator can update these rules in PostgreSQL and call the internal reconciliation function in the same transaction if existing awards should use new session rules.
- `supabase/migrations/` owns persistence and authorization. RLS limits reads to each owner. Authenticated clients can mutate data through the authenticated RPCs. Their owner profile row serializes writes per user, including reconciliation. The effective-award ledger has one key per session or completion event and drives both progression tracks. It contains positive awards, and corrections replace or remove effective awards in the same transaction.
- Projects use the existing stage and task tables. A separate work-block table supports multiple calendar entries per task. Creator Journey groups session totals by activity and counts publication records independently from active projects. Insights shows daily work minutes. 

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest applies the production SQL migration to PostgreSQL through PGlite. The tests check leveling, cross-skill caps, time zones, correction and replay behavior, and tenant isolation. Playwright runs the responsive portfolio check by default. To run the authenticated project-to-XP workflow, point `.env.local` at a disposable Supabase development stack with email confirmation disabled and run `E2E_SUPABASE=1 npm run test:e2e`. Set `PLAYWRIGHT_CHROMIUM_PATH` to use an installed Chromium, or `PLAYWRIGHT_BASE_URL` to use a running app.

## Deploy

1. Apply the migrations to the target Supabase project using `supabase db push`.
2. In Supabase Auth URL Configuration, set the site URL to the production origin and allow the production origin as a redirect URL. Configure email delivery if using confirmation emails.
3. Deploy this directory as a Next.js project on a Next.js-compatible host, or run `npm ci && npm run build` followed by `npm start` on a Node host. Set both public Supabase variables before building.
4. Register a test account and verify sign-in, a saved work session, and JSON export in the deployed environment.
