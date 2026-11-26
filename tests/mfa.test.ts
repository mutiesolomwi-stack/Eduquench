import test from "node:test";
import assert from "node:assert/strict";
import { adminNeedsMfa } from "../lib/mfa.ts";

test("admins need aal2; others do not", () => {
  assert.equal(adminNeedsMfa([{ role: "school_admin" }], "aal1"), true);
  assert.equal(adminNeedsMfa([{ role: "system_admin" }], undefined), true);
  assert.equal(adminNeedsMfa([{ role: "school_admin" }], "aal2"), false);
  assert.equal(adminNeedsMfa([{ role: "teacher" }], "aal1"), false);
  assert.equal(adminNeedsMfa([{ role: "student" }, { role: "school_admin" }], "aal1"), true);
});
