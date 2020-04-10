const utils = require('../utils');

class GongoAuth {

  constructor(db) {
    this.db = db;
    this._id = 'auth';
    this.callbacks = { auth: [] };

    if (db.extensions.transport)
      throw new Error('Should load auth extension before transport extension!');

    console.log('constructor');
    db.idb.on('collectionsPopulated', () => this._initializeFromDb());
  }

  on(event, callback) {
    if (!this.callbacks[event])
      throw new Error('No such event: ' + event);

    this.callbacks[event].push(callback);
  }

  exec(event) {
    for (let callback of this.callbacks[event])
      callback();
  }

  _initializeFromDb() {
    console.log('initializefromDB on collectionsPopulated hook');
    const saved = this.db.gongoStore.findOne(this._id);

    if (saved) {

      this.sessionId = saved.sessionId;
      this.userId = saved.userId;
      this.jwt = saved.jwt;

    } else {

      this.sessionId = this.createSessionId();
      this.db.gongoStore.insert({
        _id: this._id,
        sessionId: this.sessionId,
      });

    }

    this.exec('auth');
  }

  async _updateDb() {
    return await this.db.gongoStore.updateId(this._id, {
      $set: {
        sessionId: this.sessionId,
        userId: this.userId,
        jwt: this.jwt,
      }
    });
  }

  createSessionId() {
    return utils.randomId(32);
  }

  getSessionId() {
    return this.sessionId;
  }

  authInfoToSend() {
    if (this.jwt)
      return { jwt: this.jwt };

    return { sid: this.sessionId };
  }

  getUserId() {

  }

  async loginWithPassword(email, password) {
    const result = await this.db.call('loginWithPassword', { email, password });
    if (result) {
      if (result.userId) this.userId = result.userId;
      if (result.jwt) this.jwt = result.jwt;
    } else {
      this.userId = null;
    }

    this._updateDb(); // no need to await
    this.exec('auth');
  }

}

module.exports = { __esModule: true, default: GongoAuth };
