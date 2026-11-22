-- Run only against a development database after creating your account.
-- Set the owner email in psql with -v seed_email=... (see README).
select set_config('studio.seed_email', :'seed_email', false);
do $$
declare owner_id uuid;
  project_id uuid := 'ad34a000-3168-4697-a185-74f95a58cbbd';
  task_id uuid := 'ad34a001-3168-4697-a185-74f95a58cbbd';
begin
  select id into owner_id from auth.users where email = current_setting('studio.seed_email');
  if owner_id is null then raise exception 'Create the development account first'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform public.studio_project(project_id,'Behind the timeline','A short video about how an edit comes together.',false);
  perform public.studio_task(task_id,project_id,'Cut the opening sequence','editing','done',1,10);
  perform public.studio_task('ad34a002-3168-4697-a185-74f95a58cbbd',project_id,'Record the voice-over','presentation','todo',2,10);
  perform public.studio_session('ad34a003-3168-4697-a185-74f95a58cbbd',project_id,task_id,'editing',date_trunc('day',now()) - interval '12 hours',45);
end $$;
