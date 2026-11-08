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
