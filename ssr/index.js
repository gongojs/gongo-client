class Cursor {
  slug() {
    return "X"
  }
  toArraySync() {
    return [];
  }
  toArray() {
    return Promise.resolve([]);
  }
}

class Collection {
  find() { return new Cursor() }
  persist() { }
}

class DB {
  extend() {}
  collection(name) {
    return new Collection(name);
  }
  subscribe() {}
}

const db = new DB();
module.exports = db;

//module.exports = { __esModule: true, default: DB };