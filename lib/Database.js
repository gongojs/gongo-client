const Collection = require('./Collection').default;
const GongoIDB = require('./idb').default;
const sync = require('./sync');

class Database {

  constructor(opts = {}) {

    this.name = opts.name || 'default';
    this.collections = new Map();
    this.subscriptions = new Map();

    this.idb = new GongoIDB(this);
    this.idb.on('collectionsPopulated', () => {
      // TODO move somewhere else
      const subStore = this.gongoStore.findOne("subscriptions");
      Object.entries(subStore.subscriptions).forEach(([hash, subObj]) => {
        const sub = this.subscriptions.get(hash);
        sub.updatedAt = subObj.updatedAt;
      });
    });

    this.gongoStore = this.collection('__gongoStore', { isLocalCollection: true });
    this.gongoStore.persist({});

    this.getChangeSet = () => sync.getChangeSet(this);
  }

  didUpdate() {
    if (this.didUpdateTimeout)
      clearTimeout(this.didUpdateTimeout);

    this.didUpdateTimeout = setTimeout(() => this.updatesFinished(), 50);
  }

  updatesFinished() {
    console.log('database updated');

    if (this.transport && this.transport.poll)
      this.transport.poll();
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
    if (opts) sub.opts = opts;

    this.subscriptions.set(hash, sub);
  }

  subHash(name, opts) {
    const parts = [ name ];
    if (opts) parts.push(opts);
    return JSON.stringify(parts);
  }

  getSubscriptions() {
    return Array.from(this.subscriptions.values());
  }

  processSubResults(subs) {
    for (let sub of subs) {

      const hash = this.subHash(sub.name, sub.opts);
      const subObj = this.subscriptions.get(hash);
      if (!subObj.updatedAt)
        subObj.updatedAt = {};

      //const slug =  sub.name, sub.opts
      for (let pair of sub.results) {

        const coll = this.collection(pair.coll);
        let collUpdatedAt = 0;
        for (let entry of pair.entries) {

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

    const existing = this.gongoStore.findOne("subscriptions");
    if (existing)
      this.gongoStore._update("subscriptions", {
        _id: "subscriptions",
        subscriptions: Object.fromEntries(this.subscriptions)
      });
    else
      this.gongoStore._insert({
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
