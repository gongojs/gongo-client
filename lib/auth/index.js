const utils = require('../utils');
const debug = utils.debug.extend('auth');
const openCenteredPopup = require('./popup').default;

class GongoAuth {

  constructor(db) {
    this.db = db;
    this._id = 'auth';
    this.callbacks = { auth: [] };

    if (db.extensions.transport)
      throw new Error('Should load auth extension before transport extension!');

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
    debug('initializefromDB on collectionsPopulated hook');
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
    return this.userId;
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

  // not a logout, only handle locally (useful before logout code written)
  async clear() {
    this.jwt = null;
    this.sessionId = this.createSessionId();
    this.userId = null;
    this._updateDb(); // no need to await
    this.exec('auth');
  }

  popupLogin() {
    var state = { sessionId: this.getSessionId(), src: 'google' };

    var OAUTHURL    =   'https://accounts.google.com/o/oauth2/auth?';
    var SCOPE       =   'https://www.googleapis.com/auth/userinfo.profile';
    var CLIENTID    =   '280224356955-8bjvuouktap8sul2shlc2565i07p7gi0.apps.googleusercontent.com';
    var REDIRECT    =   'http://localhost:3001/api/gongoAuth'
    var TYPE        =   'code';
    var STATE       =   encodeURIComponent(JSON.stringify(state));
    var url        =   OAUTHURL + 'scope=' + SCOPE + '&client_id=' + CLIENTID + '&redirect_uri=' + REDIRECT + '&response_type=' + TYPE + '&state=' + STATE;

    // default width, height from meteor's oauth/oauth_browser.js
    var win = openCenteredPopup(url, 651, 331);
  }

}

module.exports = { __esModule: true, default: GongoAuth };
