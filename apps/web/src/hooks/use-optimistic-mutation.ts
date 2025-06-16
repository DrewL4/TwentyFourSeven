"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface OptimisticMutationOptions<TData, TError, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  queryKey: (string | number | object)[];
  optimisticUpdate?: (variables: TVariables, previousData: any) => any;
  onSuccess?: (data: TData, variables: TVariables, context: any) => void;
  onError?: (error: TError, variables: TVariables, context: any) => void;
  successMessage?: string;
  errorMessage?: string;
}

export function useOptimisticMutation<TData, TError, TVariables>({
  mutationFn,
  queryKey,
  optimisticUpdate,
  onSuccess,
  onError,
  successMessage,
  errorMessage
}: OptimisticMutationOptions<TData, TError, TVariables>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onMutate: async (variables: TVariables) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });
      
      // Snapshot the previous value
      const previousData = queryClient.getQueryData(queryKey);
      
      // Apply optimistic update if provided
      if (optimisticUpdate && previousData) {
        const updatedData = optimisticUpdate(variables, previousData);
        queryClient.setQueryData(queryKey, updatedData);
      }
      
      return { previousData };
    },
    onError: (error: TError, variables: TVariables, context: any) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      
      // Show error message
      if (errorMessage) {
        toast.error(errorMessage);
      }
      
      // Call custom error handler
      onError?.(error, variables, context);
    },
    onSuccess: (data: TData, variables: TVariables, context: any) => {
      // Invalidate queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey });
      
      // Show success message
      if (successMessage) {
        toast.success(successMessage);
      }
      
      // Call custom success handler
      onSuccess?.(data, variables, context);
    }
  });
} 