/**
 * The SQL conditions the /tenders queries share (src/lib/queries.ts), kept apart so a test can
 * render them without a database (tests/tender-sql.test.ts).
 */
import { sql } from "drizzle-orm";

import { tenders } from "@/db/schema";
import { NO_AWARD_SQL } from "@/lib/procurement/tenders";

/**
 * This year's lots, in Ulaanbaatar time. A lot without a result date belongs to its code's year
 * ("…/2026…"), not to the day we first saw it: the 12-month first sync counted 119 lots with 2025
 * codes as this year's (Nov 2026 audit). The backslash is doubled: in a template literal "\d" is
 * just "d", so the database got '/(d{4})' and the code's year was never read (Nov 6 2026).
 */
export const tenderThisYear = sql`coalesce(${tenders.resultDate}, make_date(nullif(substring(${tenders.code} from '/(\\d{4})'), '')::int, 1, 1)) >= date_trunc('year', now() at time zone 'Asia/Ulaanbaatar')::date`;

/**
 * Stored rows keep the awarded flag of the sync that wrote them, so a winner cell later known to be a
 * status ("Зарлагдаагүй", "эхлээгүй") is checked again here.
 */
export const tenderAwarded = sql`${tenders.awarded} and not coalesce(${tenders.winner} ~* ${NO_AWARD_SQL}, false)`;

/**
 * A lot re-filed under an edited title has a new key: the same organisation, code, amount and
 * winner is one contract, counted and listed once (53 such pairs, ~5 тэрбум₮, Nov 2026 audit).
 * The later copies are found once, by one uncorrelated join (a hashed subplan): the correlated
 * NOT EXISTS this replaced ran once per row inside the totals' `count(*) filter (…)`, took 10.8 s
 * on 8 000 lots, passed QUERY_TIMEOUT_MS, and /tenders was built and kept as "no data yet"
 * (Nov 6 2026). Same rows: 6 016 awarded, the same sum. 45 ms.
 */
export const tenderFirstOfSame = sql`${tenders.id} not in (select r.id from ${tenders} r join ${tenders} e on e.awarded and e.code = r.code and e.org_name = r.org_name and e.contract_mnt is not distinct from r.contract_mnt and e.winner is not distinct from r.winner and e.id < r.id)`;
