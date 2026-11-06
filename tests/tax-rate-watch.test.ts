import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { healthProblems } from "@/lib/health";
import { isTaxRateNews, taxRateIssueBody, watchFrom } from "@/lib/tax/rate-watch";

describe("tax-rate watch", () => {
  it("notices a change to the personal income tax or the social insurance contribution", () => {
    for (const t of [
      "ХУВЬ ХҮНИЙ ОРЛОГЫН АЛБАН ТАТВАРЫН ТУХАЙ ХУУЛЬД НЭМЭЛТ, ӨӨРЧЛӨЛТ ОРУУЛАХ ТУХАЙ",
      "Нийгмийн даатгалын шимтгэлийн хувь хэмжээг бууруулах хуулийн төслийг баталлаа",
      "ХХОАТ-ын шатлалыг шинэчилж, 2027 оноос хөнгөлөлт үзүүлнэ",
      "НДШ-ийн хувийг 11.5-аас 10 болгож бууруулахаар хэлэлцэв",
      "Татварын багц хуулийг УИХ баталлаа",
      "Нийгмийн даатгалын тухай хуулийн шинэчилсэн найруулгыг өргөн барив",
      // Real headlines, Oct–Nov 2026.
      "Нийгмийн даатгалын шимтгэлийн хэмжээг бууруулж, хөнгөлөлт үзүүлэхээр шийдлээ",
      "Ажил олгогчийн нийгмийн даатгалын шимтгэлийн хувь хэмжээ буурлаа",
      "Ажил олгогчийн даатгалын шимтгэл 2027.01.01-ээс буурагдлаа",
      "2027 оноос тэтгэвэрлэгчид ажиллахдаа даатгалын шимтгэл төлөхгүй болно",
      "Ахмад настнарт суурь тэтгэвэр олгож, ажил олгогчийн шимтгэлийг хөнгөлнө",
    ])
      assert.equal(isTaxRateNews(t), true, t);
  });

  it("leaves out refunds, debts, filing reminders and other taxes", () => {
    for (const t of [
      "ХХОАТ-ын буцаан олголтыг 11-р сарын 10-наас олгоно",
      "НДШ-ийн өрийг барагдуулах ажлыг эрчимжүүлэв",
      "Хувь хүний орлогын албан татварын тайланг цахимаар хүлээн авч байна",
      "Нийгмийн даатгалын сангийн 2026 оны төсөвт 8.1 их наяд ₮ орлого тусгалаа",
      "Гэр бүлийн гараашийг татвараас чөлөөлж, 2027 оноос 1.3 их наяд ₮ хэмнэнэ",
      "Аж ахуйн нэгжийн орлогын албан татварын хуульд өөрчлөлт оруулна",
      "10-р сарын нийгмийн даатгалыг төлөхөд 4 хоног үлдлээ",
      "⏳ АЖИЛ ОЛГОГЧ, ДААТГУУЛАГЧДЫН АНХААРАЛД: 10 дугаар сарын нийгмийн даатгалын шимтгэлээ төлөхөд 4 хоног үлдлээ",
      "367 төрлийн зөвшөөрлөөс татвар, даатгалын шимтгэлийн шаардлагыг хаслаа",
      "Татварын ерөнхий газрын 33 албан хаагч сургалтад хамрагдлаа",
      "Боловсролд хөрөнгө оруулсан компанид татварын хөнгөлөлтийн журам шинэчлэгдэнэ",
    ])
      assert.equal(isTaxRateNews(t), false, t);
  });

  it("watches from the day after RATES_CHECKED (Ulaanbaatar), so moving it past a story clears it", () => {
    assert.equal(watchFrom("2026-11-04").toISOString(), "2026-11-04T16:00:00.000Z");
  });

  it("the issue lists each story with our link and its source, and says what to do", () => {
    const body = taxRateIssueBody([{ id: 7, slug: "a-b", title: "НДШ-ийн хувийг [10] болгож бууруулна", day: "2026-11-08", url: "https://legalinfo.mn/x" }], "2026-11-04", "https://iltodmedee.mn");
    assert.ok(body.startsWith("<!-- tax-watch: 7 -->\n"));
    assert.match(body, /- 2026-11-08 · \[НДШ-ийн хувийг 10 болгож бууруулна\]\(https:\/\/iltodmedee\.mn\/article\/a-b\) · \[эх сурвалж\]\(https:\/\/legalinfo\.mn\/x\)/);
    assert.match(body, /RATES_CHECKED/);
    assert.match(body, /SI_RATE/);
  });

  it("the watchdog report names it as a yellow line", () => {
    const dated = { governmentsVerified: "2026-11-01", programmeEnd: "2028-07-01", populationYear: 2025, ratesChecked: "2026-11-04", projectsVerified: "2026-11-01" };
    const p = healthProblems({ taxRateNews: [{ title: "НДШ-ийн хувийг бууруулна", slug: "x" }] }, { socialConfigured: {}, dated }, new Date("2026-11-10T00:00:00Z"));
    const line = p.find((x) => x.text.includes("ХХОАТ / НДШ"));
    assert.equal(line?.level, "info");
    assert.match(line!.text, /1 мэдээ/);
  });
});
