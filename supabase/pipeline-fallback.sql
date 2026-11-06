-- Pipeline fallback: when GitHub drops the scheduled runs (it does for public repositories under
-- load: on Oct 29 2026 none of the 30-minute crons started for two hours), the database starts one.
--
-- Every 10 minutes pg_cron calls private.dispatch_pipeline_if_idle(). It does nothing while a run
-- has started in the last 60 minutes (app_settings.pipeline_started_at, written by the pipeline's
-- first step, `npm run pipeline:mark`) or a dispatch was sent in the last 30 minutes. Otherwise it
-- POSTs GitHub's workflow_dispatch for autonomous-news-pipeline.yml on main with a fine-grained
-- token kept in Supabase Vault (name `github_dispatch_token`; repository iltodmedee-mn/UNENMEDEE
-- only, permission "Actions: Read and write" only). No token in Vault = nothing happens.
--
-- Applied by hand in the Supabase SQL editor (not a Drizzle migration: the demo's PGlite has no
-- pg_cron). Idempotent: running it again replaces the function and the schedule.
-- Setup and token rotation: docs/PIPELINE-FALLBACK.md.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.dispatch_pipeline_if_idle()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  started timestamptz;
  dispatched timestamptz;
  token text;
begin
  select nullif(trim(both '"' from value), '')::timestamptz into started
    from public.app_settings where key = 'pipeline_started_at';
  if started is not null and started > now() - interval '60 minutes' then
    return;
  end if;

  select nullif(trim(both '"' from value), '')::timestamptz into dispatched
    from public.app_settings where key = 'pipeline_dispatched_at';
  if dispatched is not null and dispatched > now() - interval '30 minutes' then
    return;
  end if;

  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_dispatch_token';
  if token is null or token = '' then
    return;
  end if;

  perform net.http_post(
    url := 'https://api.github.com/repos/iltodmedee-mn/UNENMEDEE/actions/workflows/autonomous-news-pipeline.yml/dispatches',
    body := '{"ref":"main"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'Content-Type', 'application/json',
      'User-Agent', 'iltodmedee-pipeline-fallback'
    ),
    timeout_milliseconds := 10000
  );

  insert into public.app_settings (key, value, updated_at)
  values ('pipeline_dispatched_at', now()::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
end;
$$;

revoke execute on function private.dispatch_pipeline_if_idle() from public, anon, authenticated;

select cron.schedule('pipeline-fallback', '*/10 * * * *', $$select private.dispatch_pipeline_if_idle()$$);
