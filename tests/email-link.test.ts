import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gmailComposeUrl } from "@/components/iltod/email-link";

describe("contact e-mail link", () => {
  it("opens Gmail's compose page with the address filled in", () => {
    assert.equal(gmailComposeUrl("info@iltodmedee.mn"), "https://mail.google.com/mail/?view=cm&fs=1&to=info%40iltodmedee.mn");
  });

  it("encodes plus signs correctly in email addresses", () => {
    assert.equal(gmailComposeUrl("a+b@iltodmedee.mn"), "https://mail.google.com/mail/?view=cm&fs=1&to=a%2Bb%40iltodmedee.mn");
  });
});
