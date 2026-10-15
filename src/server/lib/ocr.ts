import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import type { OcrWord } from "../../shared/scan.ts";

/** Reads the words in a picture, with where each sits. */
export type OcrEngine = {
  read(image: Uint8Array): Promise<OcrWord[]>;
  /** Stops the worker, if one was started. */
  close(): Promise<void>;
};

// The English data ships in node_modules, so nothing is fetched at run time. The "best_int"
// model is the smaller and faster of the two the package holds, and reads screenshots well.
const require = createRequire(import.meta.url);
const LANG_PATH = join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");

/**
 * Text recognition with tesseract.js (WebAssembly; nothing to compile). One worker is
 * started on the first picture and kept for the next; pictures queue behind it. A picture
 * it cannot read throws, and the worker is replaced before the next one, in case it was
 * left in a bad state.
 */
export function createTesseractEngine(): OcrEngine {
  let worker: Promise<Worker> | null = null;
  // Nothing is cached to disk: the container's filesystem is read-only. A failure is
  // reported through the rejected promise; without an errorHandler tesseract.js also throws
  // it where nothing catches it, which would take the server down.
  const start = () =>
    (worker ??= createWorker("eng", 1, { langPath: LANG_PATH, cacheMethod: "none", errorHandler: () => undefined }));

  return {
    async read(image) {
      const running = await start();
      try {
        const { data } = await running.recognize(Buffer.from(image), {}, { blocks: true, text: false });
        const words: OcrWord[] = [];
        for (const block of data.blocks ?? []) {
          for (const paragraph of block.paragraphs) {
            for (const line of paragraph.lines) {
              for (const { text, bbox, confidence } of line.words) {
                words.push({ text, x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1, confidence });
              }
            }
          }
        }
        return words;
      } catch (error) {
        worker = null;
        void running.terminate().catch(() => undefined);
        throw error;
      }
    },
    async close() {
      const running = worker;
      worker = null;
      if (running) await (await running).terminate();
    },
  };
}
