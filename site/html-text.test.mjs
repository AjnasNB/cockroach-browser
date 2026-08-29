import assert from "node:assert/strict";
import test from "node:test";
import { stripHtml } from "./html-text.mjs";

test("extracts list text and decodes safe entities once", () => {
  assert.equal(
    stripHtml('<ul><li>One &amp; two</li><li>&quot;Three&quot; &#39;four&#39;</li></ul>'),
    '- One & two\n- "Three" \'four\''
  );
});

test("does not reconstruct markup from nested tags or encoded entities", () => {
  for (const input of [
    "<scr<script>ipt>alert(1)</script>",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
    "&amp;lt;script&amp;gt;alert(1)",
    "safe<script"
  ]) {
    const text = stripHtml(input);
    assert.doesNotMatch(text, /<script/i);
    assert.doesNotMatch(text, /<scr<script/i);
  }
});
