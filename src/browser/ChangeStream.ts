import type Collection from "./Collection";

export type ChangeStreamCallback = (obj?: unknown) => void;

export default class ChangeStream {
  collection?: Collection;
  callbacks: Record<string, Array<ChangeStreamCallback>>;
  _isClosed = false;

  constructor(collection?: Collection) {
    this.collection = collection;
    this.callbacks = {
      change: [],
      populateStart: [],
      populateEnd: [],
      close: [],
    };
  }

  on(event: string, callback: ChangeStreamCallback) {
    this.callbacks[event].push(callback);
  }

  exec(event: string, obj?: unknown) {
    for (const callback of this.callbacks[event]) {
      try {
        callback(obj);
      } catch (e) {
        console.error(e);
      }
    }
  }

  close() {
    if (this._isClosed) return;

    this._isClosed = true;
    this.exec("close");

    // delete this.callbacks;
  }

  isClosed() {
    return this._isClosed;
  }
}
