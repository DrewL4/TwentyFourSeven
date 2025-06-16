"use client";

import { useOptimisticMutation } from "./use-optimistic-mutation";

interface CrudMutationOptions<TItem> {
  queryKey: (string | number | object)[];
  mutations: {
    create?: (variables: any) => Promise<TItem>;
    update?: (variables: any) => Promise<TItem>;
    delete?: (variables: { id: string }) => Promise<void>;
  };
  messages?: {
    createSuccess?: string;
    updateSuccess?: string;
    deleteSuccess?: string;
  };
}

export function useCrudMutations<TItem extends { id: string }>({
  queryKey,
  mutations,
  messages = {}
}: CrudMutationOptions<TItem>) {
  
  const createMutation = mutations.create ? useOptimisticMutation({
    mutationFn: mutations.create,
    queryKey,
    optimisticUpdate: (variables, previousData) => {
      const optimisticItem = {
        id: `temp-${Date.now()}`,
        ...variables,
      };
      return Array.isArray(previousData) 
        ? [...previousData, optimisticItem]
        : [optimisticItem];
    },
    successMessage: messages.createSuccess || "Created successfully",
  }) : null;

  const updateMutation = mutations.update ? useOptimisticMutation({
    mutationFn: mutations.update,
    queryKey,
    optimisticUpdate: (variables, previousData) => {
      if (!Array.isArray(previousData)) return previousData;
      
      return previousData.map(item => 
        item.id === variables.id 
          ? { ...item, ...variables }
          : item
      );
    },
    successMessage: messages.updateSuccess || "Updated successfully",
  }) : null;

  const deleteMutation = mutations.delete ? useOptimisticMutation({
    mutationFn: mutations.delete,
    queryKey,
    optimisticUpdate: (variables, previousData) => {
      if (!Array.isArray(previousData)) return previousData;
      
      return previousData.filter(item => item.id !== variables.id);
    },
    successMessage: messages.deleteSuccess || "Deleted successfully",
  }) : null;

  return {
    create: createMutation,
    update: updateMutation,
    delete: deleteMutation,
  };
}

// Usage example for new pages:
/*
const { create, update, delete: deleteMutation } = useCrudMutations({
  queryKey: ["channels"],
  mutations: {
    create: orpc.channels.create,
    update: orpc.channels.update,
    delete: orpc.channels.delete,
  },
  messages: {
    createSuccess: "Channel created!",
    updateSuccess: "Channel updated!",
    deleteSuccess: "Channel deleted!",
  }
});
*/ 