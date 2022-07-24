import type Collection from "./Collection";
import type { Document } from "./Collection";

export interface ChangeStreamEvent {
  [key: string]: unknown;
  operationType: string;
  ns: { db: string; coll: string };
  documentKey: { _id: string };
}

export type ChangeStreamCallback = (change?: ChangeStreamEvent) => void;

export default class ChangeStream<DocType extends Document> {
  collection?: Collection<DocType>;
  callbacks: Record<string, Array<ChangeStreamCallback>>;
  _isClosed = false;

  constructor(collection?: Collection<DocType>) {
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

  exec(event: string, obj?: ChangeStreamEvent) {
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
