- instead of idb.put on every entry, add it to a queue, debounce save entire array.
- subscription statuses (loading, how many loaded, etc)

```ts
const sub = useGongoSub("stars", {}, { sort: ["date", "desc"], limit: 200 });
sub.fetchMore();
```
