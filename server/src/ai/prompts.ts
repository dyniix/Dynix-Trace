import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AppError } from "../errors.ts";

const PROMPTS_DIR = fileURLToPath(new URL("../../prompts/", import.meta.url));
const PROMPT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const INVESTIGATOR_PROMPT_ID = "freefire-investigator";

export type LoadedPrompt = {
  id: string;
  version: number;
  updated: string;
  content: string;
};

type PromptHeader = {
  id?: string;
  version?: string;
  updated?: string;
};

function parseHeader(block: string): PromptHeader {
  const header: PromptHeader = {};
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "id" || key === "version" || key === "updated") {
      header[key] = value;
    }
  }
  return header;
}

export function loadPrompt(id: string): LoadedPrompt {
  if (!PROMPT_ID_PATTERN.test(id)) {
    throw new AppError(
      "INVALID_PROMPT_ID",
      400,
      `Invalid prompt id "${id}".`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(`${PROMPTS_DIR}${id}.md`, "utf8");
  } catch {
    throw new AppError("PROMPT_NOT_FOUND", 404, `Prompt "${id}" was not found.`);
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new AppError(
      "PROMPT_INVALID",
      500,
      `Prompt "${id}" is missing its version header.`,
    );
  }

  const header = parseHeader(match[1]);
  const version = Number.parseInt(header.version ?? "", 10);
  if (header.id !== id || !Number.isInteger(version) || version < 1) {
    throw new AppError(
      "PROMPT_INVALID",
      500,
      `Prompt "${id}" has an invalid version header.`,
    );
  }

  const content = match[2].trim();
  if (content.length === 0) {
    throw new AppError("PROMPT_INVALID", 500, `Prompt "${id}" has no content.`);
  }

  return { id, version, updated: header.updated ?? "", content };
}

export function loadInvestigatorPrompt(): LoadedPrompt {
  return loadPrompt(INVESTIGATOR_PROMPT_ID);
}
