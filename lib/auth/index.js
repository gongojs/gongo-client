const utils = require('../utils');

class GongoAuth {

  constructor(db) {
    this.db = db;
    this._id = 'auth';

    if (db.extensions.transport)
      throw new Error('Should load auth extension before transport extension!');

    console.log('constructor');
    db.idb.on('collectionsPopulated', () => this.initializeFromDb());
  }

  initializeFromDb() {
    console.log('initializefromDB on collectionsPopulated hook');
    const saved = this.db.gongoStore.findOne(this._id);

    if (saved) {

      this.sessionId = saved.sessionId;
      this.userId = saved.userId;

    } else {

      this.sessionId = this.createSessionId();
      this.db.gongoStore.insert({
        _id: this._id,
        sessionId: this.sessionId,
      });

    }
  }

  async updateDb() {
    return await this.db.gongoStore.updateId(this._id, {
      $set: {
        sessionId: this.sessionId,
        userId: this.userId,
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
    return { sid: this.sessionId };
  }

  getUserId() {

  }

  async loginWithPassword(email, password) {
    const result = await this.db.call('loginWithPassword', { email, password });
    if (result.userId) this.userId = result.userId;

    console.log('loginWithPassword', this.userId);
    await this.updateDb();
  }

}

module.exports = { __esModule: true, default: GongoAuth };
