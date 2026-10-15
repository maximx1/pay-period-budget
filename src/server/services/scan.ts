import { describeLayout, rowsFromWords, type ScanResponse } from "../../shared/scan.ts";
import type { ScanModelConfig } from "../env.ts";
import { AppError } from "../lib/errors.ts";
import type { OcrEngine } from "../lib/ocr.ts";
import { readWithModel } from "../lib/scanModel.ts";
import type { DataStore } from "../repos/types.ts";
import type { PeriodService } from "./periods.ts";

export type ScanService = ReturnType<typeof createScanService>;

/** The kinds of picture read, by the bytes they start with (the browser's word for the type is not trusted). */
const SIGNATURES: Array<{ mimeType: string; matches: (bytes: Uint8Array) => boolean }> = [
  { mimeType: "image/png", matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mimeType: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mimeType: "image/webp",
    matches: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
];

/**
 * Reads the transactions in a screenshot: the built-in reader always, and the owner's own
 * model on top when one is configured, falling back to the built-in rows if it fails.
 * Nothing is saved; the picture is dropped once read.
 */
export function createScanService(deps: {
  store: DataStore;
  periods: PeriodService;
  ocr: OcrEngine;
  model: ScanModelConfig | null;
  fetch?: typeof fetch;
}) {
  const { store, periods, ocr, model } = deps;

  return {
    async scan(userId: string, image: Uint8Array): Promise<ScanResponse> {
      const kind = SIGNATURES.find((signature) => signature.matches(image));
      if (!kind) throw new AppError(400, "validation", "That isn't a picture this can read. Use a PNG, JPEG or WebP screenshot.");
      // The budget's today, for dates shown without a year. Also refuses an account with no budget.
      const today = await periods.today(store, userId);

      let words;
      try {
        words = await ocr.read(image);
      } catch {
        throw new AppError(400, "validation", "That picture couldn't be read. Try another screenshot.");
      }
      const rows = rowsFromWords(words, today);
      if (!model) return { rows, reader: "built_in", notice: null };

      try {
        const answer = await readWithModel(model, { layout: describeLayout(words), image, mimeType: kind.mimeType, today }, deps.fetch);
        return { rows: answer, reader: "model", notice: null };
      } catch (error) {
        const why = error instanceof Error ? error.message : "it failed";
        return { rows, reader: "built_in", notice: `The reading model wasn't used: ${why}. These are from the built-in reader.` };
      }
    },
  };
}
