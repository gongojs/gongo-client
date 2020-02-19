const sift = require('sift').default;

class Cursor {

  constructor(collection, query = {}, options = {}) {
    this.collection = collection;

    if (!options.includePendingDeletes)
      query.__pendingDelete = { $exists: false };

    this._query = query;
    this.query = sift(query);
  }

  toArray() {
    return new Promise((resolve, reject) => {
      resolve(this.toArraySync());
    });
  }

  toArraySync() {
    const out = [];
    for (let pair of this.collection.documents)
      if (this.query(pair[1]))
        out.push(pair[1]);

    if (this._sortFunc)
      out.sort(this._sortFunc);

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

}

module.exports = { __esModule: true, default: Cursor };
