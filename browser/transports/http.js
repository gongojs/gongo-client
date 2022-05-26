const ARSON = require("arson");

const ObjectID = require("bson-objectid");

ARSON.registerType("ObjectID", {
  deconstruct: function (id) {
    return id instanceof ObjectID && [id.toHexString()];
  },

  reconstruct: function (args) {
    return args && ObjectID.createFromHexString(args[0]);
  },
});

class HTTPTransport {
  constructor(db, options = {}) {
    this.db = db;

    this.url = options.url || window.origin + "/api/gongoPoll";

    this.options = {
      pollInterval: 2000, // false, // 2000,
      pollWhenIdle: false,
      idleTimeout: 5000,
      debounceTime: 100,
      url: this.url,
      ...options,
    };

    db.on("updatesFinished", () => this.poll());
    db.on("subscriptionsChanged", () => this.poll());
    db.idb.on("collectionsPopulated", () => this.poll());

    this.idleTimer = null;
    this.idleState = false;
    this.wasPolling = false;

    const idleCheck = () => {
      clearTimeout(this.idleTimer);
      this.idleState = false;
      if (this.wasPolling) {
        console.log("Idle time ended, resuming polling");
        this.wasPolling = false;
        this.poll();
      }
      this.idleTimer = setTimeout(() => {
        this.idleState = true;
      }, this.options.idleTimeout);
    };

    ["mousemove", "keydown", "scroll"].forEach((e) =>
      window.addEventListener(e, idleCheck)
    );
    idleCheck();
  }

  setPollTimeout() {
    this.timeout = setTimeout(() => this.poll(), this.options.pollInterval);
  }

  poll() {
    if (!this.db.populated) {
      // console.log('Skipping unpopulated poll (will be called again post-population)');
      return;
    }

    if (this._promise) {
      // console.log("Skipping poll while poll already in progress");
      return this._promise;
    }

    if (this._debounceTimeout) {
      clearTimeout(this._debounceTimeout);
    }

    return (this._promise = new Promise((resolve, reject) => {
      this._debounceTimeout = setTimeout(() => {
        this._poll().then(() => {
          this._promise = null;
          resolve();
        });
      }, this.options.debounceTime);
    }));

    // return this._promise = this._poll().then(() => this._promise = null);
  }

  async _poll() {
    // const changeSet = this.db.getChangeSet();
    // const subscriptions = this.db.getSubscriptions(false);
    //const methods = this.db.getQueuedMethods();

    const changeSet = this.db.getChangeSet();
    if (changeSet) this.db.call("changeSet", changeSet);

    this.db.runSubscriptions();

    const calls = this.db.getAndFlushQueuedCalls();

    const auth = this.db.auth;

    const request = { $gongo: 2 };
    /*
    if (changeSet)
      request.changeSet = changeSet;
    if (subscriptions.length)
      request.subscriptions = subscriptions;
    if (auth && auth.authInfoToSend)
      request.auth = auth.authInfoToSend();
    */
    if (calls.length) {
      request.calls = calls.map((row) => [row.name, row.opts]);

      let responseTimeout;

      responseTimeout = setTimeout(() => {
        console.warn("No headers received after 5s for: ", request.calls);
        // TODO, check again later, and set another poll timer.
      }, 5000);

      const response = await fetch(this.url, {
        method: "POST",
        mode: "cors", // no-cors, *cors, same-origin
        cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
        //credentials: 'same-origin', // include, *same-origin, omit
        headers: {
          //'Content-Type': 'text/plain; charset=utf-8',
          "Content-Type": "application/json",
          // 'Content-Type': 'application/x-www-form-urlencoded',
        },
        redirect: "follow", // manual, *follow, error
        referrerPolicy: "no-referrer", // no-referrer, *client
        // body: ARSON.encode(request) // body data type must match "Content-Type" header
        body: JSON.stringify(request),
      });

      clearTimeout(responseTimeout);
      responseTimeout = setTimeout(() => {
        console.warn("No body received after 10s for: ", request.calls);
        // TODO, check again later, and set another poll timer.
        // Once we implement fetchWithProgress, can check on the progress too.
      }, 5000);

      //console.log(response);
      // { type: 'cors', url: 'http://localhost:3001/api/gongoPoll', redirected: false,
      //   status: 200, ok: true, statusText: "OK", headers: Headers, body: (...),
      //   bodyUsed: true }
      //
      // TODO, try...catch.  handle errors.

      const json = await response.json();
      clearTimeout(responseTimeout);

      if (!Array.isArray(json.calls)) {
        console.log("<- ", json);
        return;
      }

      // console.log('<- ', json.calls);

      this.db.processCallResults(json.calls, calls);

      /*
      const text = await response.text();

      //let json;
      try {
        json = ARSON.decode(text);
      } catch (error) {
        // TODO, should we also setPolltimeout here, re-use code from below
        // or better to stop polling after such an error.
        console.error("Bad response from server");
        console.error(error);
        console.error(text);
        this.timeout = null;
        return;
      }

      if (json.subResults)
        this.db.processSubResults(json.subResults);

      if (json.methodsResults)
        this.db.processMethodsResults(json.methodsResults);
      */
    } else {
      console.log("Skip empty call");
    }

    this.timeout = null;

    // don't do this for now during devel
    if (this.options.pollInterval) {
      if (!(this.idleState && !this.options.pollWhenIdle))
        this.setPollTimeout();
      else {
        this.wasPolling = true;
        console.log("Idle time detected, pausing polling");
      }
    }
  }
}

module.exports = { __esModule: true, default: HTTPTransport };
