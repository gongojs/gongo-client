import ObjectID from "bson-objectid";

import Collection from "./Collection";
import type { Document } from "./Collection";
import Subscription, { SubscriptionOptions } from "./Subscription";
import { debug } from "./utils";
import Scheduler from "./scheduler";
const GongoIDB = require("./idb").default;
const sync = require("./sync");

import type { CollectionOptions, ServerDoc } from "./Collection";
import type { SubscriptionObject, SubscriptionArguments } from "./Subscription";
import type GongoAuth from "./auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Class = { new (...args: any[]): any };

export interface DatabaseOptions {
  // [key: string]: unknown;
  name?: string;
  gongoStoreNoPersist?: boolean;
}

export type DatabaseCallback = (this: Database) => void;

export interface CallOptions {
  [key: string]: unknown;
}

export interface CallResult {
  [key: string]: unknown;
}

export interface CallResultRaw {
  $result?: unknown;
  $error?: unknown;
  time: number;
}

export interface QueuedCall {
  name: string;
  opts: unknown;
  resolve: (value: CallResult) => void;
  reject: (reason: unknown) => void;
}

interface CollectionResults {
  coll: string;
  entries: Array<Record<string, unknown>>;
}

type PublicationResult = Array<CollectionResults>;

interface UpdateRange {
  coll: string;
  from: number;
  to: number;
}

interface ResultMeta {
  size: number;
  updateRanges: Array<UpdateRange>;
  url: string;
}

interface PublicationResponse {
  results?: PublicationResult;
  resultsMeta?: ResultMeta;
}

// export type DocWithObjectIds = Omit<Document, "_id">;

// See also objectifyStringIDs in sync.js
// TODO, move together
function stringifyObjectIDs(entry: Record<string, unknown>) {
  const oids = (entry.__ObjectIDs || (entry.__ObjectIDs = [])) as Array<string>;
  for (const [key, value] of Object.entries(entry)) {
    if (value instanceof ObjectID) {
      if (!oids.includes(key)) oids.push(key);
      entry[key] = (entry[key] as ObjectID).toHexString();
    } else if (
      Array.isArray(value) &&
      value.length > 0 &&
      value[0] instanceof ObjectID
    ) {
      if (!oids.includes(key + "[]")) oids.push(key + "[]");
      entry[key] = value.map((v) => (v as ObjectID).toHexString());
    }
  }

  stringifyObjectIDsOld(entry);
}

function stringifyObjectIDsOld(entry: Record<string, unknown>) {
  Object.keys(entry).forEach((key) => {
    if (
      entry[key] !== null &&
      typeof entry[key] === "object" &&
      (entry[key] as Record<string, unknown>)._bsontype === "ObjectID"
    ) {
      console.warn("Un-reconstructed ObjectID", key, entry);

      const oids = (entry.__ObjectIDs ||
        (entry.__ObjectIDs = [])) as Array<string>;
      if (!oids.includes(key)) oids.push(key);
      // @ts-expect-error: it's ok, we really have checked this out
      entry[key] = entry[key].id.toString("hex");
    }
  });
}

class Database {
  name: string;
  auth?: InstanceType<typeof GongoAuth>;
  collections: Map<string, Collection<Document>>;
  subscriptions: Map<string, Subscription>;
  extensions: Record<string, unknown>;
  queuedCalls: Array<QueuedCall>;
  callbacks: Record<string, Array<DatabaseCallback>>;
  idb: typeof GongoIDB;
  gongoStore: Collection<Document>;
  persistedQueriesExist?: boolean;
  runChangeSet: () => void;
  getChangeSet: () => Record<string, unknown>;
  _didUpdateTimeout?: ReturnType<typeof setTimeout>;
  populated: boolean; // set to true by idb
  scheduler: Scheduler;

  static Collection = Collection;

  constructor(opts: DatabaseOptions = {}) {
    this.name = opts.name || "default";
    this.collections = new Map();
    this.subscriptions = new Map();
    this.extensions = {};
    this.queuedCalls = [];
    this.populated = false;
    this.scheduler = new Scheduler(this.subscriptions);

    this.callbacks = {
      updatesFinished: [],
      subscriptionsChanged: [],
    };

    this.idb = new GongoIDB(this);
    this.idb.on("collectionsPopulated", () => this.populateSubscriptions());
    this.idb.on("collectionsPopulated", () => {
      // On reload, let's try all failed requests again.
      this.collections.forEach((collection) =>
        collection.update(
          { __error: { $exists: true } },
          { $unset: { __error: true } }
        )
      );
    });

    this.gongoStore = this.collection("__gongoStore", {
      isLocalCollection: true,
    });
    if (!opts.gongoStoreNoPersist) this.gongoStore.persist({});

    this.getChangeSet = () => sync.getChangeSet(this);
    this.runChangeSet = () => sync.runChangeSet(this);
  }

  on(event: string, callback: DatabaseCallback) {
    if (!this.callbacks[event])
      throw new Error("db.on(event) on non-existent event: " + event);

    this.callbacks[event].push(callback);
  }

  off(event: string, callback: DatabaseCallback) {
    if (!this.callbacks[event])
      throw new Error("db.off(event) on non-existent event: " + event);

    // TODO, throw error on non-existent callback?
    this.callbacks[event] = this.callbacks[event].filter(
      (cb) => cb !== callback
    );
  }

  exec(event: string) {
    if (!this.callbacks[event])
      throw new Error("db.exec(event) on non-existent event: " + event);

    for (const callback of this.callbacks[event]) {
      try {
        callback.call(this);
      } catch (e) {
        console.error(e);
      }
    }
  }

  _didUpdate(source: string) {
    debug(`_didUpdate(${source})`);

    if (this._didUpdateTimeout) clearTimeout(this._didUpdateTimeout);

    this._didUpdateTimeout = setTimeout(() => this.exec("updatesFinished"), 50);
  }

  collection(name: string, opts?: CollectionOptions) {
    let coll = this.collections.get(name);
    if (coll) return coll;

    coll = new Collection(this, name, opts);
    this.collections.set(name, coll);
    return coll;
  }

  subscribe(
    name: string,
    args?: SubscriptionArguments,
    opts?: SubscriptionOptions
  ) {
    const sub = new Subscription(this, name, args, opts);
    const slug = sub.slug();

    const existing = this.subscriptions.get(slug);
    if (existing) {
      if (existing.active === false) {
        existing.active = true;
        this.exec("subscriptionsChanged");
      }
      // This may include extra opts we want to update but
      // that don't otherwise affect data (which form slug)
      existing.opts = sub.opts;
      return existing;
    }

    this.subscriptions.set(slug, sub);
    this.exec("subscriptionsChanged");

    return sub;
  }

  getSubscriptions(includeInactive = false, includePersistFalse = false) {
    return Array.from(this.subscriptions.values())
      .filter((sub) => includeInactive || sub.active !== false)
      .filter((sub) => includePersistFalse || sub.opts?.persist !== false)
      .map((sub) => sub.toObject());
  }

  getSubscriptionsToRun() {
    let toRun: Array<Subscription> = [];

    // Subscriptions with no opts ( {min,max}Interval )
    for (const [, sub] of this.subscriptions) {
      if (sub.active && !sub.opts?.minInterval) toRun.push(sub);
    }

    // From scheduler
    toRun = toRun.concat(this.scheduler.findAndUpdate());

    return toRun.map((sub) => sub.toObject());
  }

  async runSubscriptions(
    subscriptions?: SubscriptionObject[],
    immediate = false
  ) {
    if (!subscriptions) subscriptions = this.getSubscriptionsToRun();

    if (!subscriptions.length) return;

    await Promise.all(
      subscriptions.map(async (subReq) => {
        let callResult;
        try {
          callResult = await this.call(
            "subscribe",
            subReq as unknown as CallOptions,
            immediate
          );
        } catch (error) {
          if (error instanceof Error) {
            console.error(
              "Skipping subscription error: " +
                JSON.stringify(subReq) +
                "\n" +
                (error.stack || `{$error.name}: ${error.message}`)
            );
          } else {
            console.error(
              "Skipping subscription error: " +
                JSON.stringify(subReq) +
                "\n" +
                JSON.stringify(error)
            );
          }
          return;
        }

        const pubRes = callResult as PublicationResponse;
        const results = pubRes.results;
        if (!results) return;

        const slug = Subscription.toSlug(subReq.name, subReq.args, subReq.opts);
        const sub = this.subscriptions.get(slug);
        if (!sub) {
          console.error(
            "Internal error, subscription disappeared: " +
              JSON.stringify(subReq)
          );
          return;
        }

        //const slug =  sub.name, sub.opts
        for (const { coll: collName, entries } of results) {
          const coll = this.collection(collName);
          let collUpdatedAt = sub.updatedAt[collName] || 0;
          for (const _entry of entries) {
            const entry = _entry as ServerDoc<Document>;
            // entry ~= [ { _id: "", __updatedAt: "", blah: "str" }, {}, ... ]

            stringifyObjectIDs(entry);

            if (
              typeof entry.__updatedAt === "number" &&
              entry.__updatedAt > collUpdatedAt
            )
              collUpdatedAt = entry.__updatedAt;

            if (typeof entry._id !== "string") {
              console.error(
                "runSubscriptions() received doc without _id: " +
                  JSON.stringify(entry)
              );
              break;
            }

            if (entry.__deleted) coll._remove(entry._id);
            else coll._insert(entry);
          }

          sub.updatedAt[collName] = collUpdatedAt;
        }

        /*
         * If the subscription has a sort, we need to track the value of the
         * last sorted field, so it can be used for loadMore()
         */
        const sortKey = sub.opts?.sort && sub.opts.sort[0];
        if (
          sortKey &&
          sub.opts?.limit &&
          results.length > 0 &&
          results[0].entries.length > 0 &&
          /*
           * 1) Always set lastSortedValue if it doesn't previously exist
           * 2) If it does exist, only update it on loadMore()'s and NOT
           *    on a normal poll (i.e. when updatedAt specified); that's
           *    because a normal poll won't match the sub.opts.limit but
           *    of course, isn't the actual end of the sorted data.
           */
          (!sub.lastSortedValue || (sub.lastSortedValue && !subReq.updatedAt))
        ) {
          sub.lastSortedValue =
            results[0].entries.length === sub.opts.limit
              ? results[0].entries[results[0].entries.length - 1][sortKey]
              : "__END__";
        }
      })
    );

    Subscription.updatePersistedSubscriptions(this);
    // console.log("saved", this.getSubscriptions(true));
  }

  populateSubscriptions() {
    const subStore = this.gongoStore.findOne("subscriptions");
    if (subStore && subStore.subscriptions) {
      const subscriptions = subStore.subscriptions as Array<SubscriptionObject>;
      // console.log("loaded", subscriptions);

      for (const subObj of subscriptions) {
        const slug = Subscription.toSlug(subObj.name, subObj.args, subObj.opts);
        let sub = this.subscriptions.get(slug);
        if (!sub) {
          sub = new Subscription(this, subObj.name, subObj.args, subObj.opts);
          sub.active = false;
        }

        if (subObj.updatedAt) sub.updatedAt = subObj.updatedAt;
        if (subObj.lastSortedValue)
          sub.lastSortedValue = subObj.lastSortedValue;

        this.subscriptions.set(slug, sub);
        sub.updatedAt = subObj.updatedAt;
      }
    }
  }

  /*
      const subResults1 = [
        {
          "name": "testSub",
          "results": [
            {
              "coll": "testCol",
              "entries": [
                {
                  "_id": "id1",
                  "__updatedAt": 1582820783188
                }
              ]
            }
          ]
        }
      ];
   */

  // --- methods ---

  call(
    name: string,
    opts?: CallOptions,
    immediate = true
  ): Promise<CallResult> {
    return new Promise((resolve, reject) => {
      // const id = utils.randomId();
      this.queuedCalls.push({ name, opts, /*id,*/ resolve, reject });

      if (immediate) {
        // Don't do this for e.g. db.runSubs() because that's called during polls.
        this._didUpdate("call#" + name); // TODO different queue?
      }
    });
  }

  getAndFlushQueuedCalls() {
    const queued = this.queuedCalls;
    this.queuedCalls = [];
    return queued;
  }

  async processCallResults(
    callResults: Array<CallResultRaw>,
    waitingCalls: Array<QueuedCall>
  ) {
    type DebugResult = {
      method: string;
      opts: unknown;
      result?: unknown;
      error?: unknown;
      time: number;
    };
    const debugResults = { ok: [], fail: [], emptySubs: [] } as {
      ok: Array<DebugResult>;
      fail: Array<DebugResult>;
      emptySubs: Array<string>;
    };

    if (callResults.length !== waitingCalls.length) {
      console.error({ callResults, waitingCalls });
      throw new Error(
        "processCallResults: callResults and waitingCalls had different lengths"
      );
    }

    // TODO, need to try/catch calls too, to avoid a failure breaking future polls
    for (let i = 0; i < callResults.length; i++) {
      const call = waitingCalls[i];
      const result = callResults[i];
      if (result.$result !== undefined) {
        // console.log(`> ${call.name}(${JSON.stringify(call.opts)})`);
        // console.log(result.$result);

        if (call.name === "subscribe") {
          const pubRes = result.$result as PublicationResponse;
          if (
            !(pubRes.results || pubRes.resultsMeta) ||
            (pubRes.results && pubRes.results.length === 0)
          ) {
            const { name, opts } = call.opts as Record<string, unknown>;
            debugResults.emptySubs.push(
              name +
                (opts
                  ? " " +
                    JSON.stringify(opts)
                      .replace(/([{,])"(.*?)"/g, "$1$2")
                      .replace(/"/g, "'")
                  : "")
            );

            call.resolve(result.$result as CallResult);
            continue;
          }
        }

        debugResults.ok.push({
          method: call.name,
          opts: call.opts,
          result: result.$result,
          time: result.time,
        });

        call.resolve(result.$result as CallResult);
      } else if (result.$error !== undefined) {
        call.reject(result.$error);

        debugResults.ok.push({
          method: call.name,
          opts: call.opts,
          error: result.$error,
          time: result.time,
        });
      } else if (!result.time) {
        // TODO.  should be "else".  when we switch to ARSON, $result: undefined will work
        call.reject(new Error("Invalid result: " + JSON.stringify(result)));
      }
    }

    console.log(debugResults);
  }

  /*
  processMethodsResults(methodsResults) {
    for (let result of methodsResults) {
      const data = this.waitingMethods.get(result.id);
      this.waitingMethods.delete(result.id);

      if (result.error)
        data.reject(result.error);
      else
        data.resolve(result.result);
    }
  }
  */

  // --- other ---

  /**
   * [getTime Returns the current UNIX epoc in milliseconds.  Always use this
   *   for timestmaps in the database, as it may differ from the browser's
   *   Date.now() if we synchronize time over the network.]
   * @return {[Int]} [The current UNIX epoc in milliseconds.]
   */
  getTime() {
    return Date.now();
  }

  /* modules / extensions */

  extend(name: string, Class: Class, options?: Record<string, unknown>) {
    // TODO, only allow up until a certain point and then lock.
    // @ts-expect-error: figure out correct ts way to do this <T extends something> i guess :)
    this[name] = this.extensions[name] = new Class(this, options);
  }
}

export { stringifyObjectIDs };
export default Database;
