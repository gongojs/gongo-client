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
  _slug: string;
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
    this._slug = Subscription.toSlug(this.name, this.args, this.opts);
  }

  static optsThatAffectData(opts?: SubscriptionOptions) {
    if (!opts) return {};

    return {
      // Sort affects pagination, lastSortedValue.  If we change the
      // sort, its a new / "different" subscription.
      sort: opts.sort,
    };
  }

  optsThatAffectData() {
    return Subscription.optsThatAffectData(this.opts);
  }

  toObject() {
    // return Object.assign({}, this);
    const obj: Partial<SubscriptionObject> = { name: this.name };
    if (this.args) obj.args = this.args;

    // Previously we didn't save this when is was just {min,max}Interval
    // but now we do, because of sort and limit.
    if (this.opts) obj.opts = this.opts;
    // if (this.opts) obj.opts = this.optsThatAffectData();

    if (this.updatedAt) obj.updatedAt = this.updatedAt;
    if (this.lastSortedValue) obj.lastSortedValue = this.lastSortedValue;

    return obj as SubscriptionObject;
  }

  async loadMore() {
    if (!this.lastSortedValue) {
      throw new Error("Can't loadMore() without lastSortedValue");
    } else if (this.lastSortedValue === "__END__") {
      console.log("Skipping loadMore() because lastSortedValue is __END__");
      return;
    }

    const subObj = this.toObject();
    // @ts-expect-error: later
    delete subObj.updatedAt;

    return await this.db.runSubscriptions([subObj], true /*immediate*/);
  }

  slug() {
    if (this._slug) return this._slug;

    return (this._slug = Subscription.toSlug(this.name, this.args, this.opts));
  }

  static toSlug(
    name: string,
    args?: SubscriptionArguments,
    opts?: SubscriptionOptions
  ) {
    return JSON.stringify([name, args, Subscription.optsThatAffectData(opts)]);
  }

  static fromSlug(slug: string, db: Database) {
    const [name, args, opts] = JSON.parse(slug);
    return new Subscription(db, name, args, opts);
  }

  stop() {
    this.active = false;
  }

  delete() {
    this.db.subscriptions.delete(this.slug());
    //this.db.exec('subscriptionsChanged');

    this.db.gongoStore._insertOrReplaceOne({
      _id: "subscriptions",
      subscriptions: this.db.getSubscriptions(true),
    });
  }
}
