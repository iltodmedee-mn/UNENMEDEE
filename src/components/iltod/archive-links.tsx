import Link from "next/link";

import { archiveShortLabel } from "@/lib/archive";
import { getArchiveDays } from "@/lib/queries";

/**
 * "Өмнөх өдрүүдийн мэдээ": plain server-rendered links to the last days' archives under a feed,
 * so stories that left the first 20 rows stay reachable without JavaScript (crawlers included).
 */
export async function ArchiveLinks({ days = 7 }: { days?: number }) {
  const list = (await getArchiveDays(days + 1)).slice(0, days);
  if (list.length === 0) return null;
  return (
    <nav aria-labelledby="archive-links" className="cv-auto flex flex-col gap-2 border-t border-line pt-4">
      <h2 id="archive-links" className="label-mono text-tertiary">
        Өмнөх өдрүүдийн мэдээ
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {list.map((d) => (
          <li key={d.date}>
            <Link href={`/archive/${d.date}`} prefetch={false} className="text-secondary hover:text-primary hover:underline">
              {archiveShortLabel(d.date)} <span className="num-mono text-tertiary">({d.stories})</span>
            </Link>
          </li>
        ))}
        <li>
          <Link href="/archive" prefetch={false} className="font-semibold text-brand-secondary hover:underline">
            Бүх архив →
          </Link>
        </li>
      </ul>
    </nav>
  );
}
