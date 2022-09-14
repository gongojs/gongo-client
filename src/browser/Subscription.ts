import type Database from "./Database";

export type SubscriptionArguments = Record<string, unknown>;

export type UpdatedAt = Record<string, number>;

export interface SubscriptionOptions {
  minInterval: number;
  maxInterval: number;
}

export interface SubscriptionObject {
  name: string;
  args?: SubscriptionArguments;
  opts?: SubscriptionOptions;
  updatedAt: UpdatedAt;
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
    if (this.opts) obj.opts = this.opts;
    if (this.updatedAt) obj.updatedAt = this.updatedAt;
    return obj as SubscriptionObject;
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
