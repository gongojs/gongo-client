class Cursor<DocType> {
  collection: Collection<DocType>;

  constructor(collection: Collection<DocType>) {
    this.collection = collection;
  }

  slug() {
    return "X";
  }
  toArraySync() {
    return [] as Array<DocType>;
  }
  toArray() {
    return Promise.resolve([]);
  }
}

class Collection<DocType = Record<string,unknown>> {
  constructor(name: string) {
    //
  }
  find(): Cursor<DocType> {
    return new Cursor<DocType>(this);
  }
  persist() {}
}

class Database {
  extend(name: string, extension: unknown, options?: Record<string,unknown>) {
    //
  }
  collection(name: string) {
    return new Collection(name);
  }
  subscribe(name: string, opts?: Record<string,unknown>) {
    //
  }
}

const db = new Database();

export { Database, Cursor, Collection };
export default db;
//module.exports = { __esModule: true, default: DB };
