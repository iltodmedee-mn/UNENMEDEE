# ИЛ ТОД МЭДЭЭ

An open news and public-data site for Mongolia: government pages are read on a schedule, summarised, and shown to readers as stories and lists.

## Language

**Pipeline run**:
One scheduled pass that reads the sources, writes new stories and their summaries, and refreshes what readers see. Runs about every 30 minutes.
_Avoid_: job, cron, scrape (a scrape is only the reading step)

**Snapshot**:
The finished content of one list page (the home feed, a topic, a place, the archive list) as of the last pipeline run, ready to be shown without asking the database again.
_Avoid_: cache, export, dump

**Read path**:
Everything that happens between a reader opening a page and the page appearing. For list pages a reader's visit never queries the database; when a list page is rebuilt it reads only its one snapshot.
_Avoid_: frontend, request path

**Write path**:
Everything a pipeline run does to change stored stories and produce snapshots. Only the write path touches the database for list pages.
_Avoid_: backend, ingestion

## Reader progress

**Counted read**:
A story the reader actually read: its page was on screen for 15 seconds and scrolled past half. Each story counts once, and at most 20 a day count. Stories a browser had already marked read before reader progress existed count once too.
_Avoid_: view, visit, click

**XP**:
The reader's points, earned by counted reads and by habits the site wants to grow (opening the facts-versus-spin view, going to the original source, finishing a digest, reading on consecutive days).
_Avoid_: score, points (in UI copy XP is fine)

**Level**:
One of ten named steps a reader climbs by XP, from «Шинэ уншигч» to «Ил тод баатар»; the top takes about a year of daily reading.
_Avoid_: rank

**Badge**:
A named achievement for one habit (reading, checking, following money, following the state, keeping a streak, exploring), most with tiers. Kept only in the reader's own browser; there are no accounts.
_Avoid_: award, trophy, medal

**Collection**:
A group of badges about one habit (Эхлэл, Дараалсан өдөр, Унших, Шалгах, Мөнгө, Төр ба иргэн, Зуршил, Нээлт, Нууц); each collection has its own badge shape.
_Avoid_: category, set

**Streak**:
Consecutive Ulaanbaatar days with at least one counted read; it stays alive through the next day and breaks after a day with none.
_Avoid_: chain, run

**Tier**:
How far a badge has been taken: хүрэл, мөнгө, алт, ил тод (the rarest, about a year of the habit).
_Avoid_: grade, rank
