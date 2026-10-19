import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../src/errors.ts";
import { INVESTIGATOR_PROMPT_ID, loadInvestigatorPrompt, loadPrompt } from "../src/ai/prompts.ts";

test("the freefire-investigator prompt loads with a version header and evidence rules", () => {
  const prompt = loadInvestigatorPrompt();
  assert.equal(prompt.id, INVESTIGATOR_PROMPT_ID);
  assert.ok(Number.isInteger(prompt.version));
  assert.ok(prompt.version >= 1);
  assert.ok(prompt.content.includes("finding IDs"));
  assert.ok(prompt.content.includes("hypothesis"));
  assert.ok(prompt.content.includes("Defender exclusion"));
  assert.ok(prompt.content.includes("inconclusive"));
});

test("loading an unknown prompt fails with PROMPT_NOT_FOUND", () => {
  assert.throws(
    () => loadPrompt("this-prompt-does-not-exist"),
    (error: unknown) => error instanceof AppError && error.code === "PROMPT_NOT_FOUND",
  );
});

test("prompt ids cannot traverse outside the prompts directory", () => {
  assert.throws(
    () => loadPrompt("../../env"),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_PROMPT_ID",
  );
  assert.throws(
    () => loadPrompt("Free Fire Prompt"),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_PROMPT_ID",
  );
});
