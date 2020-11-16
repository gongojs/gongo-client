const utils = require('../utils');
const debug = utils.debug.extend('auth');
const openCenteredPopup = require('./popup').default;

class GongoAuth {

  constructor(db) {
    this.db = db;
    this._id = 'auth';
    this.callbacks = { auth: [] };

    this.accounts = db.collection('accounts');
    this.accounts.persist();
    db.subscribe('accounts');

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

  // TODO, get all this info from accounts collection.
  async loginWithService(name) {
    const state = { sessionId: this.getSessionId() };

    const s = this.accounts.findOne({ name });
    if (!s)
      throw new Error("No such service: " + name);

    const url = s.oauth2.authorize_url
      + '?client_id=' + s.oauth2.client_id
      + '&redirect_uri=' + s.oauth2.redirect_uri
      + '&scope=' + s.oauth2.scope
      + '&response_type=' + s.oauth2.response_type
      + '&state=' + encodeURIComponent(JSON.stringify(state));

    debug(`loginWithService(${name}) on ${url}`);

    const expectedOrigin = s.oauth2.redirect_uri.match(/(https?:\/\/.*?)\/(:[0-9]+){0,1}/)[1];

    // default width, height from meteor's oauth/oauth_browser.js
    var win = openCenteredPopup(url, 651, 331);

    const receive = event => {
      if (event.origin !== expectedOrigin)
        return;

      const data = event.data;

      if (!data.userId)
        return;

      window.removeEventListener("message", receive);
      //console.log(data);
      // TODO...  { source: 'gongo', payload: { userId: XXX }}

      if (data.userId) this.userId = data.userId;
      if (data.jwt) this.jwt = data.jwt;

      this._updateDb(); // no need to await
      this.exec('auth');
    }

    window.addEventListener("message", receive, win);
  }
}


module.exports = { __esModule: true, default: GongoAuth };
