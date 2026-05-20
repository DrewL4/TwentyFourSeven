# 🚀 Instant UI Updates Guide

This app is configured to provide **instant UI feedback** without browser refreshes. Here's what you get automatically and what you need to implement for new pages.

## ✅ What's Already App-Wide (Automatic)

### 1. Optimized QueryClient Configuration
All queries and mutations automatically get (see `apps/web/src/utils/orpc.ts`):
- **2-minute stale time** — data stays fresh without constant refetching
- **10-minute garbage collection** — default query cache retention
- **Heavy queries** (`guide.current`, `library.shows` / `library.movies` / `library.search`) use `HEAVY_QUERY_OPTIONS` in `apps/web/src/utils/query-options.ts`: **60s stale**, **2min gc** to limit browser memory on large payloads
- **Library metadata** (`library.stats`, `servers.listForLibrary`) use `LIBRARY_LIST_OPTIONS`: **3min stale**, **10min gc**
- **No refetch on window focus** — prevents unnecessary updates
- **Smart retry logic** — handles network failures gracefully
- **Toast error notifications** — user-friendly error handling

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

## Performance verification checklist (manual)

After deploying the slim API + static web changes:

1. **Home / Guide / Channels** — Network tab: channel list payloads should be KB-scale (`channels.listSummary`), not multi‑MB program trees.
2. **Library** — Stats row loads first via `library.stats` (counts only). `servers.listForLibrary` supplies library cards with `_count` (not sample rows). Shows/movies load in pages of 50 with **Load more**; debounced search (≥2 chars) uses a single `library.search` call. Collections load lazily when scrolled into view (`IntersectionObserver`); the stats row shows `collectionCount` immediately.
3. **Channel editor** — Selecting a channel loads detail via `channels.get`; lineup uses `guide.channel`; episode trees load via `library.showsByIds` for linked shows only.
4. **Streaming** — With `concurrentStreams` = N, the (N+1)th viewer receives HTTP **503** with a clear JSON error.
5. **XMLTV** — `/media.xml` serves correctly; regenerating programs invalidates the on-disk cache (`XMLTV_STATIC_PATH`).
6. **Docker prod** — Only one Node process (API on 3000); UI is static files under nginx `/app/apps/web/out`.

## 🎉 Result

With these patterns, your new pages will have:
- ⚡ **Instant UI updates** - no waiting for server responses
- 🔄 **Automatic error recovery** - rollback on failures  
- 🎯 **Consistent user experience** - same patterns across app
- 🛠️ **Easy debugging** - built-in tools and logging 