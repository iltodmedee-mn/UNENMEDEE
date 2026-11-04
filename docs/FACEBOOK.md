# Facebook, Threads, Instagram, Telegram, Discord-д автоматаар нийтлэх

Pipeline (`autonomous-news-pipeline.yml`, цаг тутам), `news-digest.yml` болон гараар ажиллуулах
`social-post.yml` дараахыг ИЛ ТОД МЭДЭЭ-ийн Facebook хуудас, Threads, Instagram, Telegram суваг,
Discord announcement сувагт нийтэлнэ (`npm run social:post`, `scripts/post-social.ts`):

- **Тойм** (`--mode digest`): өглөө/оройн шинэ тойм бүр, эхний 5 гарчиг + `/digest` холбоос.
- **Чухал мэдээ** (`--mode news`): сүүлийн 24 цагт нийтлэгдсэн, огноотой, AI товчилсон, ач холбогдол
  ≥ 75 (`FB_IMPORTANCE_MIN`) эсвэл эрсдэлийн тэмдэгтэй мэдээ. Нэг удаад 1 (`FB_NEWS_PER_RUN`),
  24 цагт ихдээ 4 (`FB_NEWS_PER_DAY`), нэг сэдвийн (cluster) мэдээг нэг л удаа.
- **Өдрийн асуулт** (`--mode quiz`, зөвхөн Discord): гарчигтаа ₮ дүнтэй чухал мэдээгээр "хэд вэ?" poll,
  хариулт нь spoiler дотор, 20 цагт нэгээс илүүгүй.
- **7 хоногийн жагсаалт** (`--mode weekly`, Даваа гаригт): хамгийн том ₮ дүн, олон сайтын мэдээлсэн сэдэв,
  хамгийн олон мэдээнд нэр нь гарсан гишүүн, шинэ хууль, нийт тоо. Instagram-аас бусад сувагт.

Энэ бүгд дүрмээр хийгддэг, AI ашигладаггүй (зөвхөн тоймын гарчиг, "яагаад чухал" нь AI редакторынх).

Пост бүр манай 1080×1350 "hook" карттай (`/ig-image`, `hookCard` in `src/lib/og.tsx`): Facebook-т
зурагтай пост (`/{page}/photos`, холбоос текстэнд; зураггүй үед л `/feed` холбоосны пост), Threads-д
IMAGE пост, Instagram-д зураг + тайлбар. Текст нь hook-оор эхэлнэ (⚡ гарчиг, 👉 яагаад чухал), дараа нь
₮ дүн, эх сурвалж, холбоос, hashtag. Нийтэлсэн бүхэн `social_posts` хүснэгтэд урьдчилан бичигдэх тул нэг
мэдээ хоёр дахин гарахгүй: платформ тодорхой татгалзсан үед л мөр устаж дараагийн run дахин оролдоно;
хариу ирээгүй (timeout) эсвэл нийтлэгдсэний дараа DB алдаа гарвал мөр үлдэж (`post_id = 'unknown'`),
лог-д `::warning::` гарна: хуудсаа гараар шалгана. Токен тохируулаагүй платформ алгасагдана; secret-ийг
устгавал тэр платформ зогсоно (хадгалсан токеныг цааш ашиглахгүй).

## Нэг удаагийн тохиргоо (≈10 минут)

Токеныг хэзээ ч чатад, issue-д, код руу бүү хуулаарай: зөвхөн GitHub Secret-д хадгална.

1. https://developers.facebook.com/apps → **Create app**. Use case: **Manage everything on your
   Page** (Pages API). Апп-ын нэр жишээ нь "ИЛ ТОД МЭДЭЭ poster".
2. **Tools → Graph API Explorer**: баруун талд өөрийн аппыг сонгоод **User or Page → Get User
   Access Token**, эрхүүд: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
   **Generate Access Token** дарж, ИЛ ТОД МЭДЭЭ хуудсаа сонгож зөвшөөрнө.
3. **Tools → Access Token Debugger**: тэр токеныг буулгаад **Extend Access Token** (60 хоногийн
   хэрэглэгчийн токен болно).
4. Graph API Explorer-т урт хугацааны токеноо тавиад `GET me/accounts?fields=id,name,access_token`
   ажиллуулна. Хуудасныхаа мөрнөөс:
   - `access_token` → **FB_PAGE_TOKEN**. Debugger-т шалгахад **Expires: Never** гэж гарна.
     3-р алхмын хэрэглэгчийн токеныг хадгалсан бол скрипт `/me/accounts`-оос хуудасны токеныг авч
     нийтэлнэ, гэхдээ лог-д `::warning::` гарна: тэр токен ~60 хоногт дуусна, хуудасны токеноор солино.
   - `id` → **FB_PAGE_ID** (заавал биш: хоосон бол скрипт хуудасны токеноор `GET /me`-ээс олно).
5. GitHub → репо → **Settings → Secrets and variables → Actions**:
   - **Secrets** таб → `FB_PAGE_TOKEN` (хуудасны токен);
   - **Variables** таб → `FB_PAGE_ID` (хүсвэл).
6. Шалгах: **Actions → Social post (manual) → Run workflow** (`dry_run=true` эхлээд). `✓ posted <id>`
   эсвэл "no new important story" гарна.

Хэрэв постыг зөвхөн та харж байвал аппыг **Live** горимд шилжүүлнэ (App settings → Basic:
нууцлалын бодлогын холбоос шаардана).

## Токен хүчингүй болох үед

Facebook нууц үгээ солих, хуудасны админаас гарах, аппыг устгахад токен хүчингүй болно. Лог-д
`Facebook 400: … code 190` / "FB_PAGE_TOKEN expired or revoked" гарна: 2–5-р алхмыг давтаад
secret-ээ шинэчилнэ. `code 200` = `pages_manage_posts` эрх дутуу; `code 368` = Facebook түр
хязгаарласан (бага нийтлэх).

## Messenger бот

Хуудасны Messenger-т ирсэн мессежид AI-гүй бот хариулна (`src/app/api/messenger/route.ts`): "тойм" →
сүүлийн тойм, мэндчилгээ → тусламж, бусад → сайтын хайлтын эхний 3 мэдээ, холбоостой. Мессеж хадгалахгүй.

1. Апп → **Use cases → Engage with customers on Messenger**: хуудсаа холбож `pages_messaging` эрхтэй
   хуудасны токен авна.
2. Vercel → **Environment Variables** → `MESSENGER_SETTINGS` = JSON
   `{"pageId","pageToken","appSecret","verifyToken","igAppSecret"}` (эсвэл `app_settings` түлхүүр `messenger`).
3. Webhook: Callback URL `https://iltodmedee.mn/api/messenger`, Verify token = `verifyToken`, field `messages`.
   POST бүрийг `X-Hub-Signature-256`-аар шалгана; бот эхлээд 200 хариулаад дараа нь илгээнэ (`after()`),
   Meta дахин илгээсэн мессежид (ижил `mid`) нэг л удаа хариулна.

## Гараар

```bash
npm run social:post -- --mode news --dry-run     # юу нийтлэхийг хэвлэнэ, юу ч илгээхгүй
npm run social:post -- --mode digest
```

## Threads

Тойм болон чухал мэдээ Threads-д IMAGE пост болж нийтлэгдэнэ (hook карт, 500 тэмдэгт, emoji-г UTF-8 байтаар
тоолно, холбоос текстэнд).

1. Апп → **App roles → Roles** → Threads Tester болгож Iltodmedee-ийн Threads акаунтыг нэмэх, Threads дээр
   **Settings → Account → Website permissions → Invites**-ээс зөвшөөрөх.
2. **Use cases → Access the Threads API → Customize**: `threads_basic`, `threads_content_publish` → Add;
   **User Token Generator**-оос токен үүсгэх.
3. Токеныг урт хугацааных (60 хоног) болгоод (`graph.threads.com/access_token?grant_type=th_exchange_token`,
   Threads app secret хэрэгтэй) GitHub **Secrets**-д `THREADS_TOKEN` нэрээр хадгална.

Pipeline токеныг 7 хоног тутам өөрөө шинэчилж `app_settings`-д хадгална, тиймээс дахин юу ч хийх шаардлагагүй.
Токен хүчингүй болбол (нууц үг солих г.м.) шинэ токеныг `THREADS_TOKEN`-д хадгалахад хангалттай.

## Instagram

Тойм, чухал мэдээ Instagram-д 1080×1350 JPEG карт + тайлбартай нийтлэгдэнэ (`/ig-image`). Instagram DM-д
Messenger-тэй адил бот (AI-гүй, сайтын мэдээ, холбоосоор) хариулна.

1. Instagram акаунтыг **Professional → Business** болгох.
2. **Use cases → Manage messaging & content on Instagram → API setup with Instagram login**:
   **Add account** → iltodmedee.mn → **Generate token**.
3. Токеныг GitHub **Secrets**-д `INSTAGRAM_TOKEN` нэрээр хадгална. Pipeline 7 хоног тутам өөрөө шинэчилж
   `app_settings`-д хадгална; DM бот тэндээс уншина.
4. DM бот: Instagram апп → **Settings → Messages and story replies → Message controls → Connected tools →
   Allow access to messages**; webhook (`/api/messenger`, object `instagram`, field `messages`); Instagram app
   secret-ийг `MESSENGER_SETTINGS`-д `igAppSecret` болгож нэмнэ.

## Өдөр бүрийн видео (Reels)

`.github/workflows/video.yml` өдөр бүр хоёр удаа богино видео хийж, Facebook Reels, Instagram Reels, Threads
руу тавина: 12:41-д «ХҮН БҮРТ ХУВААВАЛ» (шинэ мэдээний том ₮ дүнг хүн амд хуваасан таавар), 19:41-д
«ЧАМД ХАМААТАЙ ЮУ?» (залуучуудад зориулсан: шинэ шийдвэр хэнд, юу өөрчлөгдөх, хэзээнээс, чи юу хийх вэ).
Шинэ шийдвэр олдохгүй өдөр «ҮНЭ ТААГААРАЙ» (нэг барааны 15 жилийн үнэ) гарна. GitHub товлосон
ажлыг хэдэн цаг хоцроодог тул цагийг «цонх» шийднэ: 12–16, 19–23 цагт тухайн цонхонд видео гараагүй бол
30 минут тутмын pipeline эсвэл video.yml (аль нь түрүүлж ажилласан нь) хийж тавина. Шөнө гарахгүй. Шинэ secret хэрэггүй: дээрх `FB_PAGE_TOKEN`, `INSTAGRAM_TOKEN`,
`THREADS_TOKEN` ба `GEMINI_API_KEY` (дуу хоолой) хангалттай; ElevenLabs хоолойд `ELEVENLABS_API_KEY` (доор). Facebook Reels нь `pages_manage_posts`
эрхтэй Page токеноор тавигдана.

- Түр зогсоох: **Settings → Secrets and variables → Actions → Variables** → `VIDEO_POSTING` = `off`.
- Одоо хийх: **Actions → Daily video → Run workflow**; `kind` = `impact` («Чамд хамаатай юу?»), `money` (мэдээний ₮ видео), `prices`, эсвэл
  `good` = `beef` гэх мэт.
- Урьдчилж үзэх: `dry_run` = `true`. Видео нь ажлын **Artifacts** (video-preview) хэсэгт гарна, юу ч тавигдахгүй.
- Хоолой солих: `GEMINI_TTS_VOICE` хувьсагч (анхдагч нь `Aoede`).

### ElevenLabs хоолой (сарын төлбөртэй багц)

Видеоны дууг эхлээд ElevenLabs (`eleven_v4`, Сүх хоолой) уншина; кредит хүрэхгүй эсвэл алдаа гарвал Gemini уншина,
тиймээс видео хэзээ ч алгасахгүй.

1. elevenlabs.io → **Developers → API Keys → Create** (хуучин, чатад харагдсан түлхүүрийг **устгана**). Эрх: Text to
   Speech + User (read) хангалттай.
2. GitHub → **Settings → Secrets and variables → Actions → New repository secret** → нэр `ELEVENLABS_API_KEY`,
   утга нь шинэ түлхүүр. Түлхүүрийг чат, файл, commit-д хэзээ ч бүү бич.
   Утга нь заавал `sk_`-ээр эхэлнэ. API Keys жагсаалтад харагдах 64 тэмдэгттэй **ID** нь түлхүүр биш
   (ElevenLabs үүнийг "API key ID used as API key" гэж буцаадаг). Түлхүүрийг зөвхөн үүсгэх эсвэл rotate
   хийх үед нэг удаа харуулдаг, тэр үед нь хуулж авна.
3. Сонголтоор (**Variables**): `ELEVENLABS_VOICE_ID` (өөр хоолой), `ELEVENLABS_RESERVE_CHARS` (өөртөө үлдээх кредит,
   анхдагч 10 000), `ELEVENLABS_PLAN_USD` (багцын үнэ, анхдагч 6; /transparency дээрх зардлыг тооцоход).

Кредитийн хуваарь: сар бүр шинэчлэгдэх хүртэлх өдрүүдэд үлдсэн кредитийг (нөөцөөс бусад) өдөрт 2 видеонд жигд
хуваана. Нэг видео ≈ 100–230 кредит, сард ≈ 60 видео тул Starter багцын 40 000-д багтана. Та өөрөө сайт дээр
кредит их зарцуулбал видео бүрийн хувь багасч, хүрэхгүй үед тухайн видеог Gemini уншина.

## Telegram суваг

Тойм, чухал мэдээ Telegram сувагт hook карттай зураг + тайлбартай (≤ 1024 тэмдэгт) нийтлэгдэнэ. Bot API үнэгүй.

1. Telegram-д **@BotFather** → `/newbot` → нэр (жишээ нь "ИЛ ТОД МЭДЭЭ"), username (`iltodmedee_bot` гэх мэт) →
   өгсөн токеныг хуулна.
2. Шинэ **нийтийн суваг** (Channel) үүсгэнэ, хаяг нь жишээ нь `t.me/iltodmedee`.
3. Сувгийн **Administrators → Add Admin** → ботоо нэмж **Post Messages** эрх өгнө.
4. GitHub → **Settings → Secrets and variables → Actions**:
   - **Secrets** → `TELEGRAM_BOT_TOKEN` = BotFather-ын токен;
   - **Variables** → `TELEGRAM_CHAT_ID` = `@iltodmedee` (сувгийн @хаяг).
5. Шалгах: **Actions → Social post (manual)** (`dry_run=true`, дараа нь `false`).

Токеныг чатад бүү бичээрэй. Bot API токеныг URL-д хийдэг тул скрипт URL-ыг хэзээ ч лог-д бичихгүй, алдааны мессежээс токеныг арилгана.

## Discord (announcement суваг, бот host хийх шаардлагагүй)

Тойм, чухал мэдээ манай Discord server-ийн **announcement** сувагт hook карттай нийтлэгдэж, автоматаар
**Publish** (crosspost) хийгдэнэ. Бусад server-ийн эзэд сувгийн **Follow** товчийг дарахад мэдээ тэдний
сонгосон сувагт өөрөө орж ирнэ: тэд бот нэмэх, бидэнд холбоос өгөх шаардлагагүй. Бот зөвхөн GitHub
Actions-аас REST дуудлага хийдэг (gateway-д холбогддоггүй), тиймээс хаана ч ажиллуулж байх сервер хэрэггүй.

1. Discord дээр шинэ server үүсгэнэ (жишээ нь "ИЛ ТОД МЭДЭЭ").
2. **Server Settings → Enable Community** (announcement сувагт хэрэгтэй), дараа нь шинэ суваг үүсгэхдээ
   төрлийг **Announcement** болгоно (жишээ нь `#мэдээ`).
3. https://discord.com/developers/applications → **New Application** → **Bot** → **Reset Token** → токеныг хуулна.
   "Privileged Gateway Intents"-ийг асаах шаардлагагүй.
4. **OAuth2 → URL Generator**: scope `bot`, эрх **Send Messages**, **Embed Links**, **Manage Messages**
   (өөрийн мессежийг publish хийхэд) → гарсан холбоосоор ботыг server-тээ нэмнэ.
5. Discord-д **User Settings → Advanced → Developer Mode** асааж, announcement суваг дээр баруун товч →
   **Copy Channel ID**.
6. GitHub → **Settings → Secrets and variables → Actions**:
   - **Secrets** → `DISCORD_BOT_TOKEN` = ботын токен;
   - **Variables** → `DISCORD_CHANNEL_ID` = сувгийн ID (зөвхөн тоо).
7. Шалгах: **Actions → Social post (manual)** (`dry_run=true`, дараа нь `false`).
8. Сувгийн холбоосоо (Invite) нийтэлнэ: бусад server-ийн админ сувгийг нээгээд **Follow** дарна.

Скрипт `allowed_mentions: { parse: [] }` илгээдэг тул мэдээн дэх "@everyone" хэнийг ч дуудахгүй.
Токеныг чатад бүү бичээрэй; энэ нь зөвхөн `Authorization` толгойд явна, алдааны мессежээс арилгагдана.

### Discord slash command (`/toim`, `/haih`, `/aimag`)

Хүн бүр өөрөө дуудаж болох командууд: `/toim` (сүүлийн тойм), `/haih ug: төсөв` (хайлт),
`/aimag ner: Ховд` (аймаг, дүүргийн мэдээ). Discord командыг манай сайт руу HTTP-ээр илгээдэг
(`https://iltodmedee.mn/api/discord`), тиймээс бот host хийх шаардлагагүй. Хариулт нь зөвхөн манай мэдээ, AI биш.

1. Developer Portal → таны app → **General Information** → **Public Key**-г хуулна.
2. Vercel → Project → **Settings → Environment Variables** → `DISCORD_PUBLIC_KEY` = тэр Public Key
   (Production), дараа нь **Redeploy** хийнэ. (Public key нууц биш, гэхдээ тохиргоонд байлгана.)
3. Developer Portal → **General Information → Interactions Endpoint URL** =
   `https://iltodmedee.mn/api/discord` → **Save**. Discord тэр даруй шалгана: алдаа гарвал 2-р алхмыг шалгаарай.
4. GitHub → **Actions → Discord commands (manual)** → Run (командуудыг бүртгэнэ).
5. Developer Portal → **Installation**: **Guild Install** ба **User Install**-ийг асааж, Default Install
   Settings-д `applications.commands` (+ server-т `bot`) сонгоно. Гарсан **Install Link**-ийг нийтэлнэ:
   хүмүүс өөрийн аккаунтдаа нэмээд ямар ч server, DM дээр командуудыг ашиглана.
