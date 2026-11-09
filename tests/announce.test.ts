import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ANNOUNCEMENTS, announcementImageUrl, currentAnnouncement } from "@/lib/social/announce";
import { threadsLength } from "@/lib/social/threads";

/** Asking for likes, shares, follows or comments is against the social rules (docs/agents/social.md). */
const ENGAGEMENT_ASK = /лайк|like|share|шэйр|хуваалц|коммент|сэтгэгдэл үлдээ|дагаарай|follow|таглаа|tag хий/i;

describe("feature announcements", () => {
  it("each has a JPEG under public/, a unique ref, and fits every platform", () => {
    assert.equal(new Set(ANNOUNCEMENTS.map((a) => a.ref)).size, ANNOUNCEMENTS.length);
    for (const a of ANNOUNCEMENTS) {
      const file = `public${a.image}`;
      assert.ok(existsSync(file), `${file} is missing`);
      const head = readFileSync(file).subarray(0, 3);
      assert.deepEqual([...head], [0xff, 0xd8, 0xff], `${file} is not a JPEG (Instagram takes JPEG only)`);
      assert.ok(threadsLength(a.threads) <= 500, `Threads text is ${threadsLength(a.threads)} of 500`);
      assert.ok(a.instagram.length <= 2_200);
      assert.ok((a.instagram.match(/#/g) ?? []).length <= 30, "Instagram allows 30 hashtags");
      assert.ok(a.facebook.includes(a.link) && a.threads.includes(a.link), "the link is in the Facebook and Threads text");
      for (const text of [a.facebook, a.instagram, a.threads]) assert.doesNotMatch(text, ENGAGEMENT_ASK);
    }
  });

  it("the newest one is posted, from the production site", () => {
    const a = currentAnnouncement();
    assert.equal(a, ANNOUNCEMENTS.at(-1));
    assert.ok(announcementImageUrl(a!).startsWith("https://iltodmedee.mn/promo/"));
  });
});
