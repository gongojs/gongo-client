const sift = require('sift').default;
const { debounce, debug: gongoDebug } = require('./utils');
const debug = gongoDebug.extend('cursor');

let cursorId = 0;

class Cursor {

  constructor(collection, query = {}, options = {}) {
    this.collection = collection;
    this.changeStreams = [];

    if (!options.includePendingDeletes)
      query.__pendingDelete = { $exists: false };

    this._query = query;
    this.query = sift(query);
    this._id = cursorId++;
  }

  slug() {
    return this.collection.name + '#' + JSON.stringify(this._query);
  }

  toArray() {
    return new Promise((resolve, reject) => {
      resolve(this.toArraySync());
    });
  }

  toArraySync() {
    const out = [];
    for (let pair of this.collection.documents)
      if (this.query(pair[1])) {
        out.push(pair[1]);
        if (this._limitBy === 1)
          return out;
      }

    if (this._sortFunc)
      out.sort(this._sortFunc);

    // TODO XXX, if we're NOT sorting, we could short-circuit the original for-loop

    if (this._limitBy)
      return out.slice(0, this._limitBy);
    else
      return out;
  }

  // https://mongodb.github.io/node-mongodb-native/api-generated/cursor.html#sort
  sort(keyOrList, direction) {
    if (typeof keyOrList === 'string') {

      const key = keyOrList;

      if (direction === 'asc' || direction === 'ascending' || direction === 1)
        this._sortFunc = (a,b) => typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key] - b[key];
      else if (direction === 'desc' || direction === 'descending' || direction === -1)
        this._sortFunc = (a,b) => typeof b[key] === 'string' ? b[key].localeCompare(a[key]) : b[key] - a[key];
      else
        throw new Error("Invalid direction for sort(key, direction), expected "
          + "'asc', 'ascending', 1, 'desc', 'descending', -1, but got "
          + JSON.stringify(direction));

    } else {

      throw new Error("sort(array) not done yet" + JSON.stringify(keyOrList));

    }

    return this;
  }

  limit(limit) {
    this._limitBy = limit;
    return this;
  }

  // --- watching ---

  watch(onUpdate, opts = {}) {
    debug(`watch ${this.collection.name}#${this._id}`, this._query);
    if (opts.debounce === undefined) opts.debounce = 50;
    const onUpdateFunc = opts.debounce ? debounce(onUpdate, opts.debounce) : onUpdate;

    const update = initial => {
      const data = this.toArraySync();
      this.lastDataIds = data.map(x => x._id);
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

      if (this.lastDataIds.includes(_id) || doc && this.query(doc)) {
        // Note: in theory we could update the data array directly rather
        // than re-running the query.  Potential future optimization, unclear
        // how much added benefit and could introduce side-effects.
        update();
      }
    });

    return data;
  }

  unwatch() {
    debug(`unwatch ${this.collection.name}#${this._id}, closing `
      + `${this.changeStreams.length} changeStreams`);
    this.changeStreams.forEach(cs => cs.close());
  }

}

module.exports = { __esModule: true, default: Cursor };
