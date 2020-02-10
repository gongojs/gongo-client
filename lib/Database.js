const Collection = require('./Collection').default;
const GongoIDB = require('./idb').default;
const sync = require('./sync');

class Database {

  constructor(opts = {}) {

    this.name = opts.name || 'default';
    this.collections = new Map();
    this.subscriptions = [];

    this.idb = new GongoIDB(this);
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

  collection(name) {
    if (!this.collections.has(name))
      this.collections.set(name, new Collection(this, name));

    return this.collections.get(name);
  }

  subscribe(name, opts) {
    const sub = { name };
    if (opts) sub.opts = opts;
    sub.slug = JSON.stringify(opts);
    this.subscriptions.push(sub);
  }

  processSubResults(subs) {
    for (let sub of subs) {
      //const slug =  sub.name, sub.opts
      for (let pair of sub.results) {
        const coll = this.collection(pair.coll);
        for (let entry of pair.entries) {
          if (entry.__deleted)
            coll._remove(entry._id);
          else
            coll._insert(entry);
        }
      }
    }
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
