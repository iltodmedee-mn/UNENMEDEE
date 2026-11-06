import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hookCard } from "@/lib/og";
import { hookWords } from "@/lib/social/hook";

describe("feed card (poster look)", () => {
  it("renders a story with amount, share and fact bar, and a digest with its next headlines", async () => {
    const story = await hookCard({
      series: "Шинэ мэдээ",
      corner: "11.03",
      kicker: "Эдийн засаг",
      words: hookWords("Гэр бүлийн гараашийг татвараас чөлөөлж, 2027 оноос 1.3 их наяд ₮ хэмнэнэ"),
      sub: "Гэр бүлийн гарааш, зогсоолтой иргэд: Үл хөдлөхийн албан татвар төлөхгүй болох",
      amount: "1.3 их наяд ₮",
      share: "≈ 379,500₮",
      fact: 71,
      credit: [["Эх сурвалж", "Монгол Улсын Засгийн газар"]],
      ghost: "₮",
    });
    const digest = await hookCard({
      series: "Өглөөний тойм · 07:05",
      corner: "10 мэдээ",
      kicker: "Гол мэдээ",
      words: hookWords("Улсын валютын нөөц 8.76 тэрбум ам.долларт хүрлээ"),
      sub: "Валютын нөөц өндөр байгаа нь ханшийг тогтвортой байлгахад нөлөөлнө.",
      list: ["Нэг", "Хоёр", "Гурав"],
      credit: [["Бүх мэдээ", "эх сурвалжтай"]],
    });
    for (const r of [story, digest]) {
      const png = new Uint8Array(await r.arrayBuffer());
      assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47]);
    }
  });
});
