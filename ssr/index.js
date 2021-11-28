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
}

class DB {
  extend() {}
  collection(name) {
    return new Collection(name);
  }
}

console.log("ssr index");

const db = new DB();
module.exports = db;

//module.exports = { __esModule: true, default: DB };