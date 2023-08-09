import type Database from "./Database";

export type SubscriptionArguments = Record<string, unknown>;

export type UpdatedAt = Record<string, number>;

export interface SubscriptionOptions {
  // transport scheduling
  minInterval?: number;
  maxInterval?: number;
  // sort and pagination
  sort?: [string, string];
  limit?: number;
}

export interface SubscriptionObject {
  name: string;
  args?: SubscriptionArguments;
  opts?: SubscriptionOptions;
  updatedAt: UpdatedAt;
  lastSortedValue?: unknown;
}

export default class Subscription {
  db: Database;
  name: string;
  args?: SubscriptionArguments;
  opts?: SubscriptionOptions;
  active: boolean;
  _hash: string;
  updatedAt: UpdatedAt;
  lastCalled: number;
  lastSortedValue?: unknown;

  constructor(
    db: Database,
    name: string,
    args?: SubscriptionArguments,
    opts?: SubscriptionOptions
  ) {
    this.db = db;
    this.name = name;
    this.args = args;
    this.opts = opts;
    this.active = true;
    this.updatedAt = {};
    this.lastCalled = 0;
    this._hash = Subscription.toHash(this.name, this.args);
  }

  toObject() {
    // return Object.assign({}, this);
    const obj: Partial<SubscriptionObject> = { name: this.name };
    if (this.args) obj.args = this.args;

    // Previously we didn't save this when is was just {min,max}Interval
    // but now we do, because of sort and limit.
    if (this.opts) obj.opts = this.opts;

    if (this.updatedAt) obj.updatedAt = this.updatedAt;
    if (this.lastSortedValue) obj.lastSortedValue = this.lastSortedValue;

    return obj as SubscriptionObject;
  }

  loadMore() {
    if (!this.lastSortedValue) {
      throw new Error("Can't loadMore() without lastSortedValue");
    }

    const subObj = this.toObject();
    // @ts-expect-error: later
    delete subObj.updatedAt;

    this.db.runSubscriptions([subObj], true /*immediate*/);
  }

  hash() {
    if (this._hash) return this._hash;

    return (this._hash = Subscription.toHash(this.name, this.args));
  }

  static toHash(name: string, opts?: SubscriptionArguments) {
    const parts: [string, SubscriptionArguments?] = [name];
    if (opts) parts.push(opts);
    return JSON.stringify(parts);
  }

  static fromHash(hash: string, db: Database) {
    const [name, opts] = JSON.parse(hash);
    return new Subscription(db, name, opts);
  }

  stop() {
    this.active = false;
  }

  delete() {
    this.db.subscriptions.delete(this.hash());
    //this.db.exec('subscriptionsChanged');

    this.db.gongoStore._insertOrReplaceOne({
      _id: "subscriptions",
      subscriptions: this.db.getSubscriptions(true),
    });
  }
}
