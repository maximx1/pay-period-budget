import { useMutation } from "@tanstack/react-query";
import type { ScanResponse } from "../../../shared/scan.ts";
import { api } from "../../lib/api.ts";

/** Sends one screenshot to be read. Nothing is saved: the answer is the transactions found in it. */
export function useScanScreenshot() {
  return useMutation({
    mutationFn: (image: File) => {
      const form = new FormData();
      form.append("image", image);
      return api.upload<ScanResponse>("/api/transactions/scan", form);
    },
  });
}
