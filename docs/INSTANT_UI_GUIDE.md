# 🚀 Instant UI Updates Guide

This app is configured to provide **instant UI feedback** without browser refreshes. Here's what you get automatically and what you need to implement for new pages.

## ✅ What's Already App-Wide (Automatic)

### 1. Optimized QueryClient Configuration
All queries and mutations automatically get:
- **5-minute caching** - reduces loading states
- **No refetch on window focus** - prevents unnecessary updates  
- **Smart retry logic** - handles network failures gracefully
- **Toast error notifications** - user-friendly error handling

### 2. Provider Setup
- React Query is properly configured in `apps/web/src/components/providers.tsx`
- DevTools enabled for debugging
- Toast notifications for user feedback

## 🛠️ For New Pages - Choose Your Approach

### Option 1: Quick CRUD Setup (Recommended)
For standard create/read/update/delete operations:

```typescript
import { useCrudMutations } from "@/hooks/use-crud-mutations";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

function MyNewPage() {
  // Get data
  const itemsQuery = useQuery(orpc.myItems.list.queryOptions());
  
  // Get instant CRUD mutations
  const { create, update, delete: deleteMutation } = useCrudMutations({
    queryKey: ["myItems"],
    mutations: {
      create: orpc.myItems.create,
      update: orpc.myItems.update,
      delete: orpc.myItems.delete,
    },
    messages: {
      createSuccess: "Item created!",
      updateSuccess: "Item updated!",
      deleteSuccess: "Item deleted!",
    }
  });

  const handleCreate = (data) => {
    create.mutate(data); // Shows instantly in UI!
  };

  const handleDelete = (id) => {
    deleteMutation.mutate({ id }); // Removes instantly from UI!
  };
}
```

### Option 2: Custom Optimistic Updates
For more complex scenarios:

```typescript
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";

function MyComplexPage() {
  const addToChannelMutation = useOptimisticMutation({
    mutationFn: orpc.channels.addShow,
    queryKey: ["channels"],
    optimisticUpdate: (variables, previousData) => {
      // Custom logic for your specific use case
      return previousData.map(channel => 
        channel.id === variables.channelId
          ? { ...channel, shows: [...channel.shows, variables.show] }
          : channel
      );
    },
    successMessage: "Show added to channel!",
    errorMessage: "Failed to add show"
  });
}
```

### Option 3: Manual Implementation
For full control, add to existing mutations:

```typescript
const myMutation = useMutation(orpc.something.create.mutationOptions({
  onMutate: async (variables) => {
    await queryClient.cancelQueries({ queryKey: ["something"] });
    const previousData = queryClient.getQueryData(["something"]);
    
    // Update UI optimistically
    queryClient.setQueryData(["something"], (old) => [...old, variables]);
    
    return { previousData };
  },
  onError: (err, variables, context) => {
    // Rollback on error
    if (context?.previousData) {
      queryClient.setQueryData(["something"], context.previousData);
    }
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["something"] });
  }
}));
```

## 🎯 Best Practices

### 1. Always Provide Rollback
```typescript
onError: (err, variables, context) => {
  if (context?.previousData) {
    queryClient.setQueryData(queryKey, context.previousData);
  }
}
```

### 2. Use Consistent Query Keys
```typescript
// Good - consistent structure
["channels"]
["channels", channelId]
["channels", channelId, "programming"]

// Bad - inconsistent
["getChannels"]
["channel-details", channelId]
```

### 3. Handle Loading States
```typescript
<Button disabled={mutation.isPending}>
  {mutation.isPending ? "Saving..." : "Save"}
</Button>
```

### 4. Provide User Feedback
```typescript
successMessage: "Operation completed!",
errorMessage: "Something went wrong"
```

## 🔧 Utilities Available

### Reordering Utilities
For drag-and-drop operations:
```typescript
import { createOptimisticReorderUpdate } from "@/utils/optimistic-reorder";

const reorderMutation = useOptimisticMutation({
  mutationFn: orpc.items.reorder,
  queryKey: ["items"],
  optimisticUpdate: createOptimisticReorderUpdate(sourceIndex, destIndex)
});
```

## 📊 Debugging

- **React Query DevTools**: Available in development mode
- **Toast Notifications**: Automatic error reporting
- **Console Logs**: All query states are logged in DevTools

## 🎉 Result

With these patterns, your new pages will have:
- ⚡ **Instant UI updates** - no waiting for server responses
- 🔄 **Automatic error recovery** - rollback on failures  
- 🎯 **Consistent user experience** - same patterns across app
- 🛠️ **Easy debugging** - built-in tools and logging 