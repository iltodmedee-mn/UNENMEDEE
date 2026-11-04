import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gmailComposeUrl } from "@/components/iltod/email-link";

describe("contact e-mail link", () => {
  it("opens Gmail's compose page with the address filled in", () => {
    assert.equal(gmailComposeUrl("info@iltodmedee.mn"), "https://mail.google.com/mail/?view=cm&fs=1&to=info%40iltodmedee.mn");
  });
});
