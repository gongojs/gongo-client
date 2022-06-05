import type Database from "./Database";

export type SubscriptionOptions = Record<string, unknown>;

export type UpdatedAt = Record<string, number>;

export default class Subscription {
  db: Database;
  name: string;
  opts?: SubscriptionOptions;
  active: boolean;
  _hash: string;
  updatedAt: UpdatedAt;

  constructor(db: Database, name: string, opts?: SubscriptionOptions) {
    this.db = db;
    this.name = name;
    this.opts = opts;
    this.active = true;
    this.updatedAt = {};
    this._hash = Subscription.toHash(this.name, this.opts);
  }

  toObject() {
    // return Object.assign({}, this);
    const obj: Partial<SubscriptionOptions> = { name: this.name };
    if (this.opts) obj.opts = this.opts;
    if (this.updatedAt) obj.updatedAt = this.updatedAt;
    return obj;
  }

  hash() {
    if (this._hash) return this._hash;

    return (this._hash = Subscription.toHash(this.name, this.opts));
  }

  static toHash(name: string, opts?: SubscriptionOptions) {
    const parts: [string, SubscriptionOptions?] = [name];
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
