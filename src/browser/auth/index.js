const utils = require("../utils");
const debug = utils.debug.extend("auth");
const openCenteredPopup = require("./popup").default;
const ARSON = require("arson");

class GongoAuth {
  constructor(db) {
    this.db = db;
    this._id = "auth";
    this.callbacks = { auth: [] };

    this.accounts = db.collection("accounts");
    this.accounts.persist();
    db.subscribe("accounts");

    if (db.extensions.transport)
      throw new Error("Should load auth extension before transport extension!");

    db.idb.on("collectionsPopulated", () => this._initializeFromDb());
  }

  on(event, callback) {
    if (!this.callbacks[event]) throw new Error("No such event: " + event);

    this.callbacks[event].push(callback);
  }

  exec(event) {
    for (let callback of this.callbacks[event]) {
      try {
        callback();
      } catch (e) {
        console.error(e);
      }
    }
  }

  _initializeFromDb() {
    debug("initializefromDB on collectionsPopulated hook");
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

    this.exec("auth");
  }

  async _updateDb() {
    return await this.db.gongoStore.updateId(this._id, {
      $set: {
        sessionId: this.sessionId,
        userId: this.userId,
        jwt: this.jwt,
      },
    });
  }

  createSessionId() {
    return utils.randomId(32);
  }

  getSessionId() {
    return this.sessionId;
  }

  authInfoToSend() {
    if (this.jwt) return { jwt: this.jwt };

    return { sid: this.sessionId };
  }

  getUserId() {
    return this.userId;
  }

  async loginWithPassword(email, password) {
    const result = await this.db.call("loginWithPassword", { email, password });
    if (result) {
      if (result.userId) this.userId = result.userId;
      if (result.jwt) this.jwt = result.jwt;
    } else {
      this.userId = null;
    }

    this._updateDb(); // no need to await
    this.exec("auth");
  }

  // not a logout, only handle locally (useful before logout code written)
  async clear() {
    this.jwt = null;
    this.sessionId = this.createSessionId();
    this.userId = null;
    this._updateDb(); // no need to await
    this.exec("auth");
  }

  // TODO, get all this info from accounts collection.
  async loginWithService(name) {
    const state = { sessionId: this.getSessionId() };

    const s = this.accounts.findOne({ name });
    if (!s) throw new Error("No such service: " + name);

    let url, expectedOrigin;
    if (s.type === "server") {
      // eslint-disable-next-line no-undef
      location.href =
        "/api/gongoAuth?service=" +
        name +
        "&auth=1&state=" +
        encodeURIComponent(JSON.stringify(state));
      return;
    } else if (s.type === "getServiceLoginUrl") {
      // Until we have support for multiple call URLs
      // let url = await this.db.call("getServiceLoginUrl", { service: name });
      const pollUrl = this.db.transport.url.replace(/Poll/, "Auth?poll=1");
      const request = {
        $gongo: 2,
        auth: this.authInfoToSend(),
        calls: [["getServiceLoginUrl", { service: name }]],
      };
      const response = await fetch(pollUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: ARSON.encode(request),
      });
      const text = await response.text();
      const pollResult = ARSON.decode(text);
      const result = pollResult.calls[0];
      url = result.$result;
      expectedOrigin = s.redirect_uri.match(
        /(https?:\/\/.*?)\/(:[0-9]+){0,1}/
      )[1];
    } else {
      url =
        s.oauth2.authorize_url +
        "?client_id=" +
        s.oauth2.client_id +
        "&redirect_uri=" +
        s.oauth2.redirect_uri +
        "&scope=" +
        s.oauth2.scope +
        "&response_type=" +
        s.oauth2.response_type +
        "&state=" +
        encodeURIComponent(JSON.stringify(state));
      expectedOrigin = s.oauth2.redirect_uri.match(
        /(https?:\/\/.*?)\/(:[0-9]+){0,1}/
      )[1];
    }

    debug(`loginWithService(${name}) on ${url}`);

    // default width, height from meteor's oauth/oauth_browser.js
    var win = openCenteredPopup(url, 651, 331);

    const receive = (event) => {
      if (event.origin !== expectedOrigin)
        throw new Error(
          `Origin mismatch, expected: "${expectedOrigin}", received: "${event.origin}"`
        );

      const data = event.data;

      if (!data.userId) {
        // Fail silently, it's probably a postMessage from somewhere else.
        return;
      }

      window.removeEventListener("message", receive);
      //console.log(data);
      // TODO...  { source: 'gongo', payload: { userId: XXX }}

      if (data.userId) this.userId = data.userId;
      if (data.jwt) this.jwt = data.jwt;

      this._updateDb(); // no need to await
      this.exec("auth");
    };

    window.addEventListener("message", receive, win);
  }
}

module.exports = { __esModule: true, default: GongoAuth };
