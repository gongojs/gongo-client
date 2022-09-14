import type Database from "./Database";

export type SubscriptionArguments = Record<string, unknown>;

export type UpdatedAt = Record<string, number>;

export interface SubscriptionObject {
  name: string;
  args?: SubscriptionArguments;
  updatedAt: UpdatedAt;
}

export default class Subscription {
  db: Database;
  name: string;
  args?: SubscriptionArguments;
  active: boolean;
  _hash: string;
  updatedAt: UpdatedAt;

  constructor(db: Database, name: string, args?: SubscriptionArguments) {
    this.db = db;
    this.name = name;
    this.args = args;
    this.active = true;
    this.updatedAt = {};
    this._hash = Subscription.toHash(this.name, this.args);
  }

  toObject() {
    // return Object.assign({}, this);
    const obj: Partial<SubscriptionObject> = { name: this.name };
    if (this.args) obj.args = this.args;
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
