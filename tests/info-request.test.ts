import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addWorkingDays, buildLetter, letterDate, missingFields, type RequestInput } from "@/lib/info-request";

const base: RequestInput = {
  org: "Сангийн яам",
  name: "Б.Болд",
  address: "",
  phone: "99112233",
  email: "bold@example.mn",
  question: "2026 оны төсвийн тодотголын хүрээнд санхүүжүүлсэн хөрөнгө оруулалтын төслийн жагсаалт",
  form: "electronic",
  date: "2026-11-06",
};

describe("information request letter", () => {
  it("cites the law's clauses and carries what 13.4 asks for", () => {
    const text = buildLetter(base);
    assert.ok(text.startsWith("Сангийн яам-д\n\nМЭДЭЭЛЭЛ ХҮСЭХ ТУХАЙ"));
    assert.ok(text.includes("Нийтийн мэдээллийн ил тод байдлын тухай хуулийн 13 дугаар зүйлд заасны дагуу"));
    assert.ok(text.includes("15.6-д заасны дагуу"));
    assert.ok(text.includes("ажлын 5 өдрийн дотор"));
    assert.ok(text.includes("14.1.2-т зааснаар"));
    assert.ok(text.includes("Мэдээллийг цахим хэлбэрээр (цахим шуудангаар) авахыг хүсье."));
    assert.ok(text.includes("Хүсэлт гаргагч: Б.Болд\nУтас: 99112233\nЦахим шуудан: bold@example.mn"));
    assert.ok(text.includes("Огноо: 2026 оны 11 дүгээр сарын 06"));
    assert.ok(!text.includes("Хаяг:"), "an empty address is left out, not printed blank");
  });

  it("lists what is still missing, and needs an e-mail for electronic delivery", () => {
    assert.deepEqual(missingFields(base), []);
    assert.deepEqual(missingFields({ ...base, org: " ", phone: "", question: "төсөв" }), ["байгууллагын нэр", "утасны дугаар", "хүсэх мэдээлэл"]);
    assert.deepEqual(missingFields({ ...base, email: "", address: "" }), ["хаяг эсвэл цахим шуудан", "цахим шуудан (цахимаар авах бол)"]);
    assert.deepEqual(missingFields({ ...base, email: "", address: "СБД, 1-р хороо", form: "paper" }), []);
  });

  it("counts working days, skipping weekends", () => {
    assert.equal(addWorkingDays("2026-11-06", 5), "2026-11-13"); // Friday → next Friday
    assert.equal(addWorkingDays("2026-11-09", 5), "2026-11-16"); // Monday → next Monday
    assert.equal(addWorkingDays("2026-11-07", 1), "2026-11-09"); // Saturday → Monday
    assert.equal(addWorkingDays("2026-11-06", 15), "2026-11-27");
    assert.equal(letterDate("2026-01-05"), "2026 оны 1 дүгээр сарын 05");
  });
});
