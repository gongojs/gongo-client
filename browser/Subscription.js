class Subscription {
  constructor(db, name, opts) {
    this.db = db;
    this.name = name;
    this.opts = opts;
  }

  toObject() {
    // return Object.assign({}, this);
    const obj = { name: this.name };
    if (this.opts) obj.opts = this.opts;
    if (this.updatedAt) obj.updatedAt = this.updatedAt;
    return obj;
  }

  hash() {
    if (this._hash) return this._hash;

    return (this._hash = Subscription.toHash(this.name, this.opts));
  }

  static toHash(name, opts) {
    const parts = [name];
    if (opts) parts.push(opts);
    return JSON.stringify(parts);
  }

  static fromHash(hash) {
    const [name, opts] = JSON.parse(hash);
    return new Subscription(this, name, opts);
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

module.exports = { __esModule: true, default: Subscription };
