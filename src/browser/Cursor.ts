import sift from "sift";

import { debounce, debug as gongoDebug } from "./utils";
import type Collection from "./Collection";
import type { Document, Query, WithId } from "./Collection";
import type ChangeStream from "./ChangeStream";
import type { ChangeStreamEvent } from "./ChangeStream";

const debug = gongoDebug.extend("cursor");

let cursorId = 0;

export interface CursorOptions {
  includePendingDeletes?: boolean;
}

export interface WatchOptions {
  debounce?: number | false;
}

export type SortFunction<DocType extends Document> = (
  a: WithId<DocType>,
  b: WithId<DocType>
) => number;

export default class Cursor<DocType extends Document> {
  collection: Collection<DocType>;
  changeStreams: Array<ChangeStream<DocType>>;
  query: ReturnType<typeof sift>;

  _id: number;
  _queryResults: null | Array<WithId<DocType>>;
  _query: Query;
  _sortFunc?: SortFunction<DocType>;
  _needsCount?: boolean;
  _skip?: number;
  _limit?: number;
  _lastDataIds: Array<string>;

  _toArraySyncCache:
    | Record<string, never>
    | {
        queryResult: null | Array<WithId<DocType>>;
        skip?: number;
        limit?: number;
        out: Array<WithId<DocType>>;
      };

  constructor(
    collection: Collection<DocType>,
    query: Query = {},
    options: CursorOptions = {}
  ) {
    this.collection = collection;
    this.changeStreams = [];

    if (!options.includePendingDeletes)
      query.__pendingDelete = { $exists: false };

    this._query = query;
    this.query = sift(query);
    this._id = cursorId++;

    this._queryResults = null;
    this._toArraySyncCache = {};
    this._lastDataIds = [];
  }

  slug() {
    return this.collection.name + "#" + JSON.stringify(this._query);
  }

  _resultsSync() {
    if (this._queryResults) return this._queryResults;

    let count = 0;
    const out = (this._queryResults = []) as Array<WithId<DocType>>;
    for (const pair of this.collection.documents)
      if (this.query(pair[1])) {
        out.push(pair[1]);
        // if (!this._sortFunc && this._limit === 1)
        //   return out;
        if (!this._sortFunc && !this._needsCount && ++count === this._limit)
          break;
      }

    if (this._sortFunc) out.sort(this._sortFunc);

    return out;
  }

  // TODO, should client provide a live version of this?
  count() {
    if (!this._needsCount) {
      this._needsCount = true;
      this._queryResults = null;
    }
    const out = this._resultsSync();
    return out.length;
  }

  toArray() {
    return new Promise((resolve) => {
      resolve(this.toArraySync());
    });
  }

  toArraySync() {
    let out = this._resultsSync();

    const cache = this._toArraySyncCache;
    if (
      out === cache.queryResult &&
      this._skip === cache.skip &&
      this._limit === cache.limit
    )
      return cache.out;

    if (this._skip || this._limit)
      out = out.slice(
        this._skip || 0,
        this._limit ? (this._skip || 0) + this._limit : undefined
      );

    this._toArraySyncCache = {
      queryResult: this._queryResults,
      skip: this._skip,
      limit: this._limit,
      out,
    };
    return out;
  }

  // https://mongodb.github.io/node-mongodb-native/api-generated/cursor.html#sort
  sort(
    keyOrList: string,
    direction: "asc" | "ascending" | "desc" | "descending" | 1 | -1
  ) {
    if (typeof keyOrList === "string") {
      const key = keyOrList;

      if (direction === "asc" || direction === "ascending" || direction === 1)
        this._sortFunc = (a, b) =>
          typeof a[key] === "string"
            ? // @ts-expect-error: save for another day
              a[key].localeCompare(b[key])
            : // @ts-expect-error: save for another day
              a[key] - b[key];
      else if (
        direction === "desc" ||
        direction === "descending" ||
        direction === -1
      )
        this._sortFunc = (a, b) =>
          typeof b[key] === "string"
            ? // @ts-expect-error: save for another day
              b[key].localeCompare(a[key])
            : // @ts-expect-error: save for another day
              b[key] - a[key];
      else
        throw new Error(
          "Invalid direction for sort(key, direction), expected " +
            "'asc', 'ascending', 1, 'desc', 'descending', -1, but got " +
            JSON.stringify(direction)
        );
    } else {
      throw new Error("sort(array) not done yet" + JSON.stringify(keyOrList));
    }

    return this;
  }

  limit(limit: number) {
    this._limit = limit;
    return this;
  }

  skip(skip: number) {
    this._skip = skip;
    return this;
  }

  // --- watching ---
  watch(
    onUpdate: (docs: Array<WithId<DocType>>) => void,
    opts: WatchOptions = {}
  ) {
    let changes: Array<ChangeStreamEvent> = [];
    const context = `${this.collection.name}#${this._id}.watch()`;
    debug(`${context}: init`, this._query);
    if (opts.debounce === undefined) opts.debounce = 50;

    const update = (initial?: boolean) => {
      if (!initial) this._queryResults = null;

      const data = this.toArraySync();
      this._lastDataIds = data.map((x) => x._id);
      return initial ? data : onUpdate(data);
    };

    const data = update(true);
    const cs = this.collection.watch();
    this.changeStreams.push(cs);

    // Iterate through all queued changes.  If we find a relevant one,
    // short-circuit and run update.
    const _checkChanges = () => {
      let relevantChange = false;
      for (const change of changes) {
        // operationType: 'insert', fullDocument: {}, documentKey: { _id: XXX }
        // operationType: 'update', fullDocument: {}, documentKey: { _id: XXX }
        // operationType: 'delete', documentKey: { _id: XXX }
        const _id = change.documentKey._id;
        const doc = change.fullDocument;

        // If the change was for a doc that is already in our cursor, or
        // a new doc that matches our query
        if (this._lastDataIds.includes(_id) || (doc && this.query(doc))) {
          relevantChange = true;
          break;
        }
      }

      const length = changes.length;
      changes = [];

      if (relevantChange) {
        debug(
          `${context}: relevant change in ${length} updates, running onUpdate()`
        );
        update();
      } else {
        debug(
          `${context}: no relevant changes in ${length} updates, skipping onUpdate()`
        );
      }
    };

    const checkChanges = opts.debounce
      ? debounce(_checkChanges, opts.debounce)
      : _checkChanges;

    // TODO, what if population didn't affect our result set? optimize? compare arrays?
    // @ts-expect-error: it's ok, we don't use the ChangeStreamEvent
    cs.on("populateEnd", update);

    cs.on("change", (change?: ChangeStreamEvent) => {
      //debug(`queued change ${this.collection.name}#${this._id}`, change);
      if (!change)
        throw new Error(
          "cs.on('change') expected a change, not: " + JSON.stringify(change)
        );
      changes.push(change);
      checkChanges();
    });

    return data;
  }

  /*
  watch_old(onUpdate, opts = {}) {
    debug(`watch_old ${this.collection.name}#${this._id}`, this._query);
    if (opts.debounce === undefined) opts.debounce = 50;
    const onUpdateFunc = opts.debounce ? debounce(onUpdate, opts.debounce) : onUpdate;

    const update = initial => {
      if (!initial)
        this._queryResults = null;

      const data = this.toArraySync();
      this._lastDataIds = data.map(x => x._id);
      return initial ? data : onUpdateFunc(data);
    }

    const data = update(true);
    const cs = this.collection.watch();
    this.changeStreams.push(cs);

    // TODO, what if population didn't affect our result set? optimize? compare arrays?
    cs.on('populateEnd', update );

    cs.on('change', change => {
      debug(`change ${this.collection.name}#${this._id}`, change)
      // operationType: 'insert', fullDocument: {}, documentKey: { _id: XXX }
      // operationType: 'update', fullDocument: {}, documentKey: { _id: XXX }
      // operationType: 'delete', documentKey: { _id: XXX }
      const _id = change.documentKey._id;
      const doc = change.fullDocument;

      // If the change was for a doc that is already in our cursor, or
      // a new doc that matches our query
      if (this._lastDataIds.includes(_id) || doc && this.query(doc)) {
        // Note: in theory we could update the data array directly rather
        // than re-running the query.  Potential future optimization, unclear
        // how much added benefit and could introduce side-effects.
        update();
      }
    });

    return data;
  }
  */

  findAndWatch(callback: (docs: Array<WithId<DocType>>) => void) {
    const data = this.watch(callback);
    if (data) callback(data);
  }

  unwatch() {
    debug(
      `unwatch ${this.collection.name}#${this._id}, closing ` +
        `${this.changeStreams.length} changeStreams`
    );
    this.changeStreams.forEach((cs) => cs.close());
  }
}
