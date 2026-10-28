"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

/** Request missing titles from WatchTower as the signed-in user, and say plainly what happened. */
export function useRequestMissing(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.franchises.requestMissing.mutationOptions({
      retry: false,
      onSuccess: (out) => {
        const parts: string[] = [];
        if (out.requested) parts.push(`${out.requested} requested`);
        if (out.alreadyRequested) parts.push(`${out.alreadyRequested} already requested`);
        if (out.failed) parts.push(`${out.failed} could not be requested`);
        const firstProblem = out.results.find((r) => !r.outcome.ok && r.outcome.status !== "duplicate");
        const text = parts.join(", ") || "Nothing to request";
        if (out.failed && !out.requested && !out.alreadyRequested) {
          toast.error(firstProblem ? firstProblem.outcome.message : text);
        } else {
          toast.success(text, {
            description: out.failed && firstProblem ? firstProblem.outcome.message : undefined,
          });
        }
        queryClient.invalidateQueries({ queryKey: orpc.franchises.get.key() });
        queryClient.invalidateQueries({ queryKey: orpc.franchises.list.key() });
        onDone?.();
      },
      onError: (error: Error) => toast.error(error.message || "Could not send the request"),
    }),
  );
}
