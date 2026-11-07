# Өгөгдлийн сангийн нөөц хуулбар (backup)

`backup.yml` долоо хоног бүр (Пүрэв гараг, Улаанбаатарын 04:11) өгөгдлийн санг бүхэлд нь
шифрлэж GitHub Actions-ийн artifact болгон 90 хоног хадгална. Энэ нь Supabase-ийн үнэгүй төсөл
устах, эвдрэх, андуурч устгагдах үед сайтыг сэргээх цорын ганц арга.

Юу хадгалагдах вэ: `app_settings` (VAPID түлхүүр, Threads/Instagram-ийн шинэчлэгдсэн токен,
хандивын данс, нуусан жилүүд), эх сурвалжууд, бүх мэдээ, cluster, тойм, УИХ-ын гишүүд ба
мэдүүлэг, өгөгдлийн хэсгүүд, тайлан (ledger), push захиалагчид, сошиал постын бүртгэл,
`seen_urls`, тендер, баримт бичгийн бүртгэл (`tenders`, `watched_pages`, `documents`).
Хадгалахгүй (`src/lib/backup.ts`): `ai_usage_logs` (сар бүрийн нийт дүн ledger-т бий),
`open_datasets` (дараагийн `data:sync` дахин бүтээнэ), `videos` (MP4 хэдэн өдөр л хадгалагддаг),
`press_items` ба `press_links` (дараагийн `press:sync` feed-үүдийг дахин уншина).

**Аюулгүй байдал.** Нээлттэй репозиторийн artifact-ийг GitHub-д нэвтэрсэн хэн ч татаж чадна.
Тиймээс файл зөвхөн таны **нийтийн** түлхүүрээр [age](https://age-encryption.org) аргаар
шифрлэгдэж байршина. Тайлах **нууц** түлхүүр зөвхөн танд байна, GitHub-д хэзээ ч орохгүй.
Шифрлээгүй өгөгдөл runner-ийн диск дээр ч бичигдэхгүй (`db:backup | gzip | age` урсгал), лог
зөвхөн мөрийн тоог хэвлэнэ.

## 1. Түлхүүрийн хос үүсгэх (нэг удаа, өөрийн компьютер дээр)

```bash
# macOS: brew install age   ·   Ubuntu/Debian: sudo apt install age   ·   Windows: winget install FiloSottile.age
age-keygen -o iltodmedee-backup-key.txt
```

Файл ийм хоёр мөртэй:

```
# public key: age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs0abcd
AGE-SECRET-KEY-1...
```

- `AGE-SECRET-KEY-1…` мөртэй **бүтэн файлыг** нууц үг хадгалагчдаа (1Password, Bitwarden …)
  хадгалж, компьютерээсээ устгана. Үүнийг алдвал нөөц хуулбарыг хэн ч тайлж чадахгүй.
  Чат, issue, commit, имэйлд хэзээ ч бүү хуулаарай.
- `age1…` (public key) мөрийг GitHub → Settings → Secrets and variables → Actions → **New
  repository secret** → нэр `BACKUP_AGE_PUBLIC_KEY`, утга нь `age1…` гэж хадгална.

Үүний дараа Actions → Backup → **Run workflow** дарж эхний нөөцийг шалгана. Түлхүүргүй бол
workflow улаан болж, watchdog issue нээнэ.

## 2. Нөөц хуулбар байгаа эсэхийг шалгах

Actions → Backup → сүүлийн ажиллалт → **Artifacts** хэсэгт `iltodmedee-backup-<дугаар>` байна.
Watchdog сүүлийн амжилттай нөөц (`app_settings.backup_last_at`) 10 хоногоос хуучирвал issue
нээнэ.

## 3. Улиралд нэг удаа: сэргээх дадлага

Нөөц хуулбар ажиллаж байгааг зөвхөн тайлж үзэж мэднэ.

```bash
# 1. Artifact-ийг татаж задлах (iltodmedee-YYYYMMDD-HHMM.ndjson.gz.age гарна)
# 2. Тайлах
age -d -i iltodmedee-backup-key.txt iltodmedee-YYYYMMDD-HHMM.ndjson.gz.age > backup.ndjson.gz
# 3. Мөр бүрийг уншиж шалгах (--dry-run юу ч бичихгүй, санах ой дахь хоосон сан хангалттай)
DATABASE_URL=pglite:memory npm run db:restore -- --file backup.ndjson.gz --dry-run
```

Сүүлийн мөр хүснэгт бүрийн мөрийн тоог хэвлэнэ (articles, push_subscriptions …). Дараа нь
`backup.ndjson.gz`-ийг устгана: дотор нь VAPID түлхүүр, push захиалгууд байгаа.

## 4. Supabase төсөл алдагдвал: бүрэн сэргээх

1. Шинэ Supabase төсөл үүсгэж (ap-southeast-1, Singapore), `vector` өргөтгөлийг асаана.
2. Шинэ connection string-ийг GitHub secret `DATABASE_URL` (+ `DATABASE_URL_DIRECT`) болон
   Vercel-ийн `DATABASE_URL`-д солино.
3. Өөрийн компьютер дээр:
   ```bash
   DATABASE_URL='<шинэ connection string>' npm run db:migrate
   DATABASE_URL='<шинэ connection string>' npm run db:restore -- --file backup.ndjson.gz --dry-run
   DATABASE_URL='<шинэ connection string>' npm run db:restore -- --file backup.ndjson.gz --yes
   ```
4. Vercel дээр Redeploy хийнэ. Pipeline дараагийн цагт өөрөө үргэлжилнэ.

Зөвхөн нэг хүснэгт сэргээх: `--table app_settings` (таслалаар хэд хэдийг). Сэргээлт мөр бүрийг
үндсэн түлхүүрээр нь дарж бичнэ (upsert): файлд байхгүй мөрийг хөндөхгүй.

**Амьд мэдээллийн сан руу сэргээхдээ болгоомжил.** Upsert зөвхөн үндсэн түлхүүрээр таарна. Хоёр дахь
unique түлхүүртэй хүснэгтэд (`articles` slug/original_url, `sources` domain, `politicians`
parliament_member_id, `asset_declarations` politician+year, `push_subscriptions` endpoint,
`social_posts` platform+kind+ref, `transparency_ledger` month, `tenders` key, `documents` url)
нөөц авснаас хойш амьд сан дээр ижил мөр өөр id-тай үүссэн бол unique зөрчил гарч, сэргээлт
**бүхэлдээ** буцна (нэг transaction). Тиймээс бүрэн сэргээлтийг **хоосон, migrate хийсэн** шинэ санд
хий. Амьд сан руу `--table` ашиглавал зөвхөн ийм хоёр дахь түлхүүргүй хүснэгтэд:
`app_settings`, `indicator_snapshots`, `watched_pages`, `seen_urls`, `clusters`, `digests`,
`donations`.

**VAPID түлхүүрийг хэзээ ч шинээр бүү үүсгээрэй.** Push захиалагч бүр тэр хостой холбоотой:
шинэ хос үүсгэвэл бүх захиалагч алга болно. Сэргээлт `app_settings`-ийг хуучнаар нь буцаана.

## English summary

`backup.yml` runs weekly: `npm run db:backup` (NDJSON through the app's own connection; the
runner's `pg_dump` 16 refuses Supabase's Postgres 17) is piped through `gzip` and
`age -r $BACKUP_AGE_PUBLIC_KEY`, so plain text never touches disk, and only the encrypted file
is uploaded as a 90-day artifact (public-repo artifacts are downloadable by any signed-in user).
The owner keeps the age private key offline. Restore: `age -d`, then
`npm run db:restore -- --file backup.ndjson.gz --dry-run`, then `--yes`. Rows are upserted by
primary key in foreign-key order and serial sequences are moved past the restored ids. Not backed
up: `ai_usage_logs`, `open_datasets`, `videos`, `press_items`, `press_links`. A restore into a live
database aborts (one transaction) on any second unique key (articles slug/url, sources domain,
politicians, push_subscriptions endpoint, social_posts, transparency_ledger month, tenders,
documents, asset_declarations) when the same row has a different id there: restore everything
into an empty, migrated database, or use `--table` only on `app_settings`, `indicator_snapshots`,
`watched_pages`, `seen_urls`, `clusters`, `digests`, `donations`.
