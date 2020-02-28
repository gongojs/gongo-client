const Collection = require('./Collection').default;
const GongoIDB = require('./idb').default;
const sync = require('./sync');

class Database {

  constructor(opts = {}) {

    this.name = opts.name || 'default';
    this.callbacks = {};
    this.collections = new Map();
    this.subscriptions = new Map();

    this.idb = new GongoIDB(this);
    this.idb.on('collectionsPopulated', () => this.populateSubscriptions());

    this.gongoStore = this.collection('__gongoStore', { isLocalCollection: true });
    if (!opts.gongoStoreNoPersist)
      this.gongoStore.persist({});

    this.getChangeSet = () => sync.getChangeSet(this);
  }

  on(event, callback) {
    if (!this.callbacks[event])
      this.callbacks[event] = [];

    this.callbacks[event].push(callback);
  }

  exec(event) {
    if (this.callbacks[event])
      this.callbacks[event].forEach(callback => callback.call(this));
    else
      throw new Error("exec(event) on non-existent event: " + event);
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
    const sub = { name };
    const hash = this.subHash(name, opts);
    const existing = this.subscriptions.get(hash);
    if (existing)
      return existing;

    if (opts) sub.opts = opts;

    this.subscriptions.set(hash, sub);
    return sub;
  }

  subHash(name, opts) {
    const parts = [ name ];
    if (opts) parts.push(opts);
    return JSON.stringify(parts);
  }

  getSubscriptions() {
    const subs = Array.from(this.subscriptions.values());
    return subs;
  }

  populateSubscriptions() {
    const subStore = this.gongoStore.findOne("subscriptions");
    if (subStore && subStore.subscriptions)
    Object.entries(subStore.subscriptions).forEach(([hash, subObj]) => {
      let sub = this.subscriptions.get(hash);
      if (!sub)
        sub = this.subscriptions.set(hash, { active: false });  // TODO, { name? }
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
    for (let sub of subs) {
      // sub ~= { name, opts, results }

      const hash = this.subHash(sub.name, sub.opts);
      const subObj = this.subscriptions.get(hash);
      if (!subObj.updatedAt)
        subObj.updatedAt = {};

      //const slug =  sub.name, sub.opts
      for (let pair of sub.results) {
        // pair ~= { coll, entries }

        const coll = this.collection(pair.coll);
        let collUpdatedAt = subObj.updatedAt[pair.coll] || 0;
        for (let entry of pair.entries) {
          // entry ~= [ { _id: "", __updatedAt: "", blah: "str" }, {}, ... ]

          if (entry.__updatedAt > collUpdatedAt)
            collUpdatedAt = entry.__updatedAt;

          if (entry.__deleted)
            coll._remove(entry._id);
          else
            coll._insert(entry);

        }

        subObj.updatedAt[pair.coll] = collUpdatedAt;
      }
    }

    this.gongoStore._insertOrReplaceOne({
      _id: "subscriptions",
      subscriptions: Object.fromEntries(this.subscriptions)
    });
  }

  /**
   * [getTime Returns the current UNIX epoc in milliseconds.  Always use this
   *   for timestmaps in the database, as it may differ from the browser's
   *   Date.now() if we synchronize time over the network.]
   * @return {[Int]} [The current UNIX epoc in milliseconds.]
   */
  getTime() {
    return Date.now();
  }

}

module.exports = { __esModule: true, default: Database };
