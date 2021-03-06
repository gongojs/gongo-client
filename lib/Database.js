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
    this.queuedMethods = [];
    this.waitingMethods = new Map();

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
  processSubResults(subs) {
    for (let subObj of subs) {
      // sub ~= { name, opts, results }
      if (subObj.error) {
        console.warn("Ignoring subscription", subObj);
        continue;
      }

      const hash = Subscription.toHash(subObj.name, subObj.opts);
      const sub = this.subscriptions.get(hash);
      if (!sub.updatedAt)
        sub.updatedAt = {};

      //const slug =  sub.name, sub.opts
      for (let pair of subObj.results) {
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
    }

    this.gongoStore._insertOrReplaceOne({
      _id: "subscriptions",
      subscriptions: this.getSubscriptions(true)
    });
  }

  // --- methods ---

  call(name, opts) {
    return new Promise((resolve, reject) => {
      const id = utils.randomId();
      this.queuedMethods.push({ name, opts, id, resolve, reject });
      this._didUpdate(); // TODO different queue?
    });
  }

  getQueuedMethods() {
    const queued = this.queuedMethods;
    const out = new Array(queued.length);
    this.queuedMethods = [];

    for (let i=0; i < queued.length; i++) {
      const data = queued[i];
      this.waitingMethods.set(data.id, data);
      out[i] = { id: data.id, name: data.name, opts: data.opts };
    }

    return out;
  }

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
