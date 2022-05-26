const Collection = require('./Collection').default;
const Subscription = require('./Subscription').default;
const GongoIDB = require('./idb').default;
const utils = require('./utils');
const sync = require('./sync');

const ObjectID = require("bson-objectid");

// See also objectifyStringIDs in sync.js
// TODO, move together
function stringifyObjectIDs(entry) {
  Object.keys(entry).forEach(key => {
    if (entry[key] instanceof ObjectID) {
      if (!entry.__ObjectIDs) entry.__ObjectIDs = [];
      if (!entry.__ObjectIDs.includes(key)) entry.__ObjectIDs.push(key);
      entry[key] = entry[key].toHexString();
    }
  });

  stringifyObjectIDsOld(entry);
}

function stringifyObjectIDsOld(entry) {
  Object.keys(entry).forEach(key => {
    if (entry[key] !== null && typeof entry[key] === 'object'
        && entry[key]._bsontype === 'ObjectID') {

      console.warn("Un-reconstructed ObjectID", key, entry);

      if (!entry.__ObjectIDs) entry.__ObjectIDs = [];
      if (!entry.__ObjectIDs.includes(key)) entry.__ObjectIDs.push(key);
      entry[key] = entry[key].id.toString('hex');
    }
  });
}

class Database {

  constructor(opts = {}) {

    this.name = opts.name || 'default';
    this.collections = new Map();
    this.subscriptions = new Map();
    this.extensions = {};
    this.queuedCalls = [];

    this.callbacks = {
      updatesFinished: [],
      subscriptionsChanged: [],
    };

    this.idb = new GongoIDB(this);
    this.idb.on('collectionsPopulated', () => this.populateSubscriptions());

    this.gongoStore = this.collection('__gongoStore', { isLocalCollection: true });
    if (!opts.gongoStoreNoPersist)
      this.gongoStore.persist({});

    this.getChangeSet = () => sync.getChangeSet(this);
  }

  on(event, callback) {
    if (!this.callbacks[event])
      throw new Error("db.on(event) on non-existent event: " + event);

    this.callbacks[event].push(callback);
  }

  off(event, callback) {
    if (!this.callbacks[event])
      throw new Error("db.off(event) on non-existent event: " + event);

    // TODO, throw error on non-existent callback?
    this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
  }

  exec(event) {
    if (!this.callbacks[event])
      throw new Error("db.exec(event) on non-existent event: " + event);

    for (let callback of this.callbacks[event]) {
      try {
        callback.call(this);
      } catch (e) {
        console.error(e);
      }
    }
  }

  _didUpdate() {
    if (this._didUpdateTimeout)
      clearTimeout(this._didUpdateTimeout);

    this._didUpdateTimeout = setTimeout(() => this.exec('updatesFinished'), 50);
  }

  collection(name, opts) {
    let coll = this.collections.get(name);
    if (coll)
      return coll;

    coll = new Collection(this, name, opts);
    this.collections.set(name, coll);
    return coll;
  }

  subscribe(name, opts) {
    const sub = new Subscription(this, name, opts);
    const hash = sub.hash();

    const existing = this.subscriptions.get(hash);
    if (existing) {
      if (existing.active === false) {
        existing.active = true;
        this.exec('subscriptionsChanged');
      }
      return existing;
    }

    this.subscriptions.set(hash, sub);
    this.exec('subscriptionsChanged');

    return sub;
  }

  getSubscriptions(includeInactive=false) {
    return Array.from( this.subscriptions.values() )
      .filter(sub => includeInactive || sub.active !== false)
      .map(sub => sub.toObject())
  }
  
  async runSubscriptions() {
    await Promise.all(this.getSubscriptions(false).map(async subReq => {
      let results;
      try {
        results = await this.call("subscribe", subReq)
      } catch (error) {
        console.error(
          "Skipping subscription error: " + JSON.stringify(subReq) + "\n" + (error.stack || `{$error.name}: ${error.message}`)
        );
        return;
      }

      const hash = Subscription.toHash(subReq.name, subReq.opts);
      const sub = this.subscriptions.get(hash);
      if (!sub.updatedAt)
        sub.updatedAt = {};

      //const slug =  sub.name, sub.opts
      for (let pair of results) {
        // pair ~= { coll, entries }

        const coll = this.collection(pair.coll);
        let collUpdatedAt = sub.updatedAt[pair.coll] || 0;
        for (let entry of pair.entries) {
          // entry ~= [ { _id: "", __updatedAt: "", blah: "str" }, {}, ... ]
          //
          stringifyObjectIDs(entry);

          if (entry.__updatedAt > collUpdatedAt)
            collUpdatedAt = entry.__updatedAt;

          if (entry.__deleted)
            coll._remove(entry._id);
          else
            coll._insert(entry);

        }

        sub.updatedAt[pair.coll] = collUpdatedAt;
      }


    }));

    this.gongoStore._insertOrReplaceOne({
      _id: "subscriptions",
      subscriptions: this.getSubscriptions(true)
    });
  }

  populateSubscriptions() {
    const subStore = this.gongoStore.findOne("subscriptions");
    if (subStore && subStore.subscriptions)
    subStore.subscriptions.forEach(subObj => {
      let hash = Subscription.toHash(subObj.name, subObj.opts);
      let sub = this.subscriptions.get(hash);
      if (!sub) {
        sub = new Subscription(this, subObj.name, subObj.opts);
        sub.active = false;
        if (subObj.updatedAt)
          sub.updatedAt = subObj.updatedAt;
        this.subscriptions.set(hash, sub);
      }
      sub.updatedAt = subObj.updatedAt;
    });
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

  call(name, opts) {
    return new Promise((resolve, reject) => {
      // const id = utils.randomId();
      this.queuedCalls.push({ name, opts, /*id,*/ resolve, reject });
      this._didUpdate(); // TODO different queue?
    });
  }

  getAndFlushQueuedCalls() {
    const queued = this.queuedCalls;
    this.queuedCalls = [];
    return queued;
  }
  
  async processCallResults(callResults, waitingCalls) {
    const debugResults = { ok: [], fail: [], emptySubs: [] };
    
    if (callResults.length !== waitingCalls.length) {
      console.error({ callResults, waitingCalls })
      throw new Error("processCallResults: callResults and waitingCalls had different lengths");
    }
    
    // TODO, need to try/catch calls too, to avoid a failure breaking future polls
    for (let i=0; i < callResults.length; i++) {
      const call = waitingCalls[i];
      const result = callResults[i];
      if (result.$result !== undefined) {
        // console.log(`> ${call.name}(${JSON.stringify(call.opts)})`);
        // console.log(result.$result);
        if (call.name === "subscribe" && Array.isArray(result.$result) && result.$result.length === 0)
          debugResults.emptySubs.push({ method: call.name, opts: call.opts, result: result.$result, time: result.time });
        else
          debugResults.ok.push({ method: call.name, opts: call.opts, result: result.$result, time: result.time });
        call.resolve(result.$result);
      } else if (result.$error !== undefined) {
        call.reject(result.$error);
        debugResults.ok.push({ method: call.name, opts: call.opts, error: result.$error, time: result.time });
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

  extend(name, Class, options) {
    // TODO, only allow up until a certain point and then lock.
    this[name] = this.extensions[name] = new Class(this, options);
  }

}

Database.Collection = Collection;

module.exports = {
  __esModule: true,
  default: Database,
  stringifyObjectIDs,
};
