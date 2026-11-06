# Хувь нэмэр оруулах / Contributing

Баярлалаа! ИЛ ТОД МЭДЭЭ бол нээлттэй эхийн, хэн ч сайжруулж болох төсөл.
**English below.**

## Эхлэх

```bash
git clone https://github.com/iltodmedee-mn/UNENMEDEE && cd UNENMEDEE
npm ci               # Node.js 24 (.nvmrc); lockfile-ийн яг тэр хувилбарууд
npm run doctor       # орчин бэлэн үү (Node, lockfile, Chromium, ffmpeg, .env-ийн нэрс)
npm run demo         # http://localhost:3000: жишээ өгөгдөлтэй бүтэн сайт (DB, API түлхүүр хэрэггүй)
npm run check        # typecheck + lint + unit test (нууц түлхүүр хэрэггүй)
```

Эхнээс нь: `npm run doctor -- --clean` (`.demo-db/`, `.next/`-ийг устгаад демог дахин ачаална).

`npm run demo` нь `tests/fixtures`-ийн бодит төрийн мэдээ, гишүүд, төсвийн өгөгдлийг процесс доторх
Postgres (PGlite)-д ачаална. Шинэ fixture нэмбэл демо ч баяжина.

Бодит өгөгдөлтэй ажиллуулахын тулд үнэгүй Supabase төсөл үүсгээд `.env`-д `DATABASE_URL`, нэг үнэгүй
AI түлхүүр (`GROQ_API_KEY`) тавина. Дэлгэрэнгүйг [README](README.md#05--өөрийн-компьютер-дээр-ажиллуулах)-с үзнэ үү.

## Юу хийж болох вэ

| Хийх зүйл | Хаана |
|---|---|
| **Төрийн шинэ сайт нэмэх** | [`src/lib/sources.ts`](src/lib/sources.ts)-д нэг мөр нэмнэ. Эсвэл [issue нээж](https://github.com/iltodmedee-mn/UNENMEDEE/issues/new/choose) санал болгоно. |
| **JSON API / RSS-тэй сайт** | [`src/lib/scraper/adapters/`](src/lib/scraper/adapters)-д adapter бичээд `API_ADAPTERS`-д бүртгэнэ (`police.ts`, `legalinfo.ts` жишээ). |
| **Гарчиг, огноо буруу таньж байвал** | Тухайн хуудсыг `tests/fixtures/`-д хадгалаад [`extractor.ts`](src/lib/scraper/extractor.ts) / [`titles.ts`](src/lib/scraper/titles.ts)-ийг засаж, тест нэмнэ. |
| **AI буруу хураангуйлсан** | Эх сурвалжийн холбоостой issue нээнэ. Prompt нь [`src/lib/ai/prompts.ts`](src/lib/ai/prompts.ts)-д бий. |
| **UI, орчуулга, хүртээмж** | `src/components/`, `src/app/`. Бүх текст цэвэр монгол хэлээр. |

## Дүрэм

1. **Зөвхөн баримт.** Хэнийг ч буруутгахгүй; албан эх сурвалжийн холбоостой тоо, баримт л харуулна.
2. **Эелдэг скрапер.** robots.txt-г дагана; нэг сайтад 8 секундээс доошгүй завсар; Cloudflare зэрэг
   хамгаалалтыг тойрох оролдлого хийхгүй; TLS шалгалтыг хэзээ ч унтраахгүй.
3. **Нууц түлхүүр кодонд оруулахгүй.** Түлхүүр зөвхөн `.env` (git-д ордоггүй), GitHub Secrets, Vercel-д.
4. **0₮ дэд бүтэц.** Үнэгүй хязгаарт багтах; HTML биш, цэвэрлэсэн текст л хадгална.
5. **Хурд.** Нүүр хуудсанд хүнд JavaScript нэмэхгүй (Lighthouse mobile ≥ 0.9).

## Алдаа мэдэгдэх

Засахад хэрэгтэй зүйл нь «ажиллахгүй байна» биш, яг юу болсон нь. [Issue нээхдээ](https://github.com/iltodmedee-mn/UNENMEDEE/issues/new/choose) дараахыг **бүтнээр нь** хуул (богиносгож, «...» гэж орхихгүй):

1. **Яг ажиллуулсан команд** (`npm run scrape -- --source mlsp.gov.mn --limit 2` гэх мэт) эсвэл хуудасны холбоос.
2. **Бүтэн лог, алдааны мөрнөөс stack trace хүртэл.** GitHub Actions бол унасан алхмын лог + run-ийн холбоос. Сайт дээр бол «Лавлах код».
3. **`npm run doctor`-ын гаралт** (Node, commit, өгөгдлийн сангийн төрөл; нууц түлхүүр ордоггүй).
4. `npm run demo` дээр давтагддаг уу? Давтагддаг бол алхам алхмаар.
5. Сүүлд юу өөрчилсөн бэ (secret, variable, `.env`, код)? Нэг л зүйлийг өөрчлөөд дахин шалгаарай: хоёр зүйл зэрэг өөрчилбөл аль нь нөлөөлснийг хэн ч хэлж чадахгүй.

Нууц түлхүүр, нууц үг, `DATABASE_URL`-ийг хэзээ ч бүү хуул.

## Pull request

- `main` хамгаалагдсан: өөрчлөлт зөвхөн PR-ээр, CI (`check`) ногоон үед нэгтгэгдэнэ.
- PR илгээхийн өмнө `npm run check` болон `npm run build` (нууц түлхүүргүй) давах ёстой.
- Нэг PR = нэг сэдэв. Юуг, яагаад өөрчилснөө тайлбарлана.
- Архитектурын дэлгэрэнгүй: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), дүрмүүд: [CLAUDE.md](CLAUDE.md).
- **Аюулгүй байдлын асуудлыг** нээлттэй issue биш, [SECURITY.md](SECURITY.md)-ийн дагуу нууцаар мэдэгдэнэ.

Код MIT, сайтын агуулга [CC BY 4.0](LICENSE-CONTENT.md) лицензтэй. PR илгээснээр та өөрийн хувь
нэмрийг эдгээр лицензээр нийтлэхийг зөвшөөрч байна.

## Холбоо барих

Кодоос бусад асуудал (хамтын ажиллагаа, хэвлэл мэдээлэл, эх сурвалжийн засвар): [info@iltodmedee.mn](mailto:info@iltodmedee.mn).

---

## English

**Start:** `npm ci && npm run demo` (Node.js 24, `.nvmrc`): the full site on real sample data from
`tests/fixtures`, loaded into an in-process Postgres (PGlite). No database server, no API keys.
`npm run check` runs typecheck, lint and the unit tests, offline. `npm run doctor` checks the
machine (Node, lockfile, Chromium, ffmpeg, `.env` names) and `--clean` starts the demo over.

**Reporting a bug:** paste, complete and unshortened, the exact command or page URL, the full log
from the error line through the stack trace (for Actions: the failing step's log and the run URL;
on the site: the reference code), the output of `npm run doctor`, whether it reproduces in
`npm run demo`, and what you changed last. Change one thing at a time. Never paste a secret.

**Good first contributions**
- A new government source: one line in [`src/lib/sources.ts`](src/lib/sources.ts), or an issue.
- A site with a JSON API or RSS: an adapter in [`src/lib/scraper/adapters/`](src/lib/scraper/adapters).
- A wrong headline or date: save the page into `tests/fixtures/`, fix
  [`extractor.ts`](src/lib/scraper/extractor.ts) / [`titles.ts`](src/lib/scraper/titles.ts), add a test.
- UI, accessibility and copy (all public text is Mongolian Cyrillic).

**Rules:** facts only (no accusations; official sources linked); respect robots.txt and an 8 s
per-host delay; never bypass Cloudflare or disable TLS checks; no secrets in code; stay within free
tiers; keep the home page light.

**Pull requests:** `main` only accepts PRs with green CI. Run `npm run check` and `npm run build`
first. One topic per PR. Report security problems privately per [SECURITY.md](SECURITY.md).

**Contact** for anything that is not code (partnerships, press, source corrections): [info@iltodmedee.mn](mailto:info@iltodmedee.mn).

Code is MIT; site content is [CC BY 4.0](LICENSE-CONTENT.md). By opening a PR you agree to license
your contribution under these terms.
