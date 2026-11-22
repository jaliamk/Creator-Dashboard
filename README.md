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

Keep the original local Supabase database. Stop the app with Control+C, then run `supabase migration up --local` from the updated project directory while Docker and Supabase are running. Retain your existing `.env.local` and restart the app with `npm run dev`. If you downloaded a fresh ZIP, copy your existing `.env.local` into the new folder first. See [the planner audit](PLANNER-UPGRADE.md) for data and migration details.

Planner opens to a weekly calendar with a time-grid option. Choose Video production when creating a project to populate stages and tasks. Set a target publication date to assign due dates from the template. From a task, use its calendar button to schedule one or more work blocks. Drag sibling tasks by the grip or use the move buttons. Use Projects to edit all template types and Quick Quests to edit timer and milestone presets. Presets affect future applications. Scheduled blocks and logged sessions are tracked separately.

## XP rules

- Creator XP and individual skill XP begin at Level 1. The total needed to reach a level is `factor × (level − 1) × level`, with default factors of 50 for Creator and 100 for skills.
- A session earns 1 Creator XP and 1 XP in its assigned skill for each eligible whole minute. The first 100 minutes across the local day earn XP. Task bonuses are independent of that cap.
- A session belongs to the local calendar date on which it starts, using the account's time zone at entry. Subsequent time-zone preference changes apply to new sessions. Correcting an existing session uses its original time zone. The profile starts with the browser's time zone when PostgreSQL recognizes it.
- Sessions are allocated the daily budget in start-time order, using session ID to break ties. Editing, backdating, or deleting a session can redistribute XP to other sessions. Preview calculates the current allocation and saving calculates it again inside the write transaction.
- Completing a task grants its configured bonus. Editing the completed task updates its award. Reopening removes the award and completing it again creates a new event.
- Project deletion removes its tasks and sessions and recalculates XP. Archiving hides its unfinished tasks from Next Up and preserves its earned XP.
- Settings exposes the default task bonus, appearance, time zone, and JSON export. Each task can override its bonus.
- The timer is a tab-local draft. Stopping it opens the session editor with elapsed whole minutes. Saving persists the session.

## Architecture

- `app/` and `components/` provide the Next.js dashboard, Radix-based shadcn-style dialogs, project and task editors, session timer and preview, authentication, and preferences.
- `lib/progression.ts` maps effective XP to levels and progress. Its factors come from the database profile. Database defaults also expose the time-based XP rate and daily cap. An administrator can update these rules in PostgreSQL and call the internal reconciliation function in the same transaction if existing awards should use new session rules.
- `supabase/migrations/` owns persistence and authorization. RLS limits reads to each owner. Authenticated clients can mutate data through the authenticated RPCs. Their owner profile row serializes writes per user, including reconciliation. The effective-award ledger has one key per session or completion event and drives both progression tracks. It contains positive awards, and corrections replace or remove effective awards in the same transaction.
- Projects use the existing stage and task tables. A separate work-block table supports multiple calendar entries per task. Skills shows XP-based milestone branches, and Insights shows daily work minutes and XP. Achievements, historical level-up events, and PWA support remain outside this upgrade.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest applies the production SQL migration to PostgreSQL through PGlite. The tests check leveling, cross-skill caps, time zones, correction and replay behavior, and tenant isolation. Playwright runs the responsive planner check by default. To run the authenticated project-to-XP workflow, point `.env.local` at a disposable Supabase development stack with email confirmation disabled and run `E2E_SUPABASE=1 npm run test:e2e`. Set `PLAYWRIGHT_CHROMIUM_PATH` to use an installed Chromium, or `PLAYWRIGHT_BASE_URL` to use a running app.

## Deploy

1. Apply the migrations to the target Supabase project using `supabase db push`.
2. In Supabase Auth URL Configuration, set the site URL to the production origin and allow the production origin as a redirect URL. Configure email delivery if using confirmation emails.
3. Deploy this directory as a Next.js project on a Next.js-compatible host, or run `npm ci && npm run build` followed by `npm start` on a Node host. Set both public Supabase variables before building.
4. Register a test account and verify sign-in, a saved work session, and JSON export in the deployed environment.
