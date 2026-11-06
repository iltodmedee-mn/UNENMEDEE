# Pipeline fallback (Supabase pg_cron)

GitHub drops scheduled runs of public repositories when it is busy. On Oct 29 2026 none of the
pipeline's 30-minute crons started for two hours while other workflows ran, so the site got no
news. The fallback lives in the database, which is always up: every 10 minutes a pg_cron job
checks when a pipeline run last started (`app_settings.pipeline_started_at`, written by the
pipeline's first step) and, after an hour without one, asks GitHub to start a run
(`workflow_dispatch`). While the crons work it does nothing.

## Нэг удаагийн тохиргоо (эзэмшигч)

1. **GitHub token үүсгэх.** github.com → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token.
   - Token name: `iltodmedee-pipeline-fallback`
   - Expiration: 1 жил (дуусахын өмнө 3-р алхмыг дахин хийнэ)
   - Resource owner: **iltodmedee-mn** (байгууллага; хувийн account-ын token энэ репод хандаж чадахгүй)
   - Repository access: **Only select repositories** → `iltodmedee-mn/UNENMEDEE`
   - Permissions → Repository permissions → **Actions: Read and write**. Өөр юу ч сонгохгүй
     (Metadata: Read автоматаар нэмэгдэнэ).
   - Generate token → хуулж авна. Чатад, issue-д, файлд хэзээ ч бүү буулга.
2. **SQL ажиллуулах.** Supabase → SQL Editor → `supabase/pipeline-fallback.sql`-ийн агуулгыг бүтнээр
   нь хуулж Run. (Аль хэдийн ажиллуулсан бол алгасна; дахин ажиллуулахад хор хөнөөлгүй.)
3. **Token-ийг Vault-д хадгалах.** Мөн SQL Editor дээр, `ghp_…`/`github_pat_…`-ийн оронд өөрийн
   token-ийг тавьж:
   ```sql
   select vault.create_secret('github_pat_ЭНД_TOKEN', 'github_dispatch_token', 'pipeline fallback: Actions write on iltodmedee-mn/UNENMEDEE');
   ```
   Token солих үед (жилд нэг): `select vault.update_secret((select id from vault.secrets where name = 'github_dispatch_token'), 'шинэ_token');`
   Дараа нь шинэ token-ий дуусах өдрийг бичнэ, watchdog 30 хоногийн өмнө сануулна:
   `insert into app_settings (key, value) values ('github_dispatch_token_expires', '2028-10-29T00:00:00.000Z') on conflict (key) do update set value = excluded.value;`

## Шалгах

```sql
select jobname, schedule, active from cron.job where jobname = 'pipeline-fallback';
select key, value from app_settings where key in ('pipeline_started_at', 'pipeline_dispatched_at');
-- GitHub-ийн хариу (204 = run эхэлсэн, 401 = token буруу/дууссан, 404/403 = эрх дутуу):
select created, status_code, left(content::text, 200) from net._http_response order by created desc limit 5;
```

Унтраах: `select cron.unschedule('pipeline-fallback');` эсвэл Vault-аас token-ийг устгах.

The watchdog reports a pipeline that has not started for `PIPELINE_QUIET_H` (6) hours.
