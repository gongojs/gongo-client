const ARSON = require('arson');

const ObjectID = require("bson-objectid");

ARSON.registerType("ObjectID", {

  deconstruct: function (id) {
    return id instanceof ObjectID && [ id.toHexString() ];
  },

  reconstruct: function (args) {
    return args && ObjectID.createFromHexString(args[0]);
  }

});

class HTTPTransport {

  constructor(db, options = {}) {
    this.db = db;

    this.url = options.url || (window.origin + '/api/gongoPoll');

    this.options = {
      pollInterval: false, // 2000,
      pollWhenIdle: false,
      idleTimeout: 5000,
      debounceTime: 100,
      url: this.url,
      ...options
    };

    db.on('updatesFinished', () => this.poll());
    db.on('subscriptionsChanged', () => this.poll());
    db.idb.on('collectionsPopulated', () => this.poll());

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
    }

    ['mousemove','keydown','scroll']
      .forEach(e => window.addEventListener(e, idleCheck));
    idleCheck();
  }

  setPollTimeout() {
    this.timeout = setTimeout(() => this.poll(), this.options.pollInterval);
  }

  poll() {
    if (!this.db.populated) {
      console.log('Skip unpopulated poll');
      return;
    }

    if (this._promise) {
      console.log("Skipping poll while poll already in progress");
      return this._promise;
    }

    if (this._debounceTimeout) {
      clearTimeout(this._debounceTimeout);
    }

    return this._promise = new Promise((resolve, reject) => {
      this._debounceTimeout = setTimeout(() => {
        this._poll().then(() => {
          this._promise = null;
          resolve();
        });
      }, this.options.debounceTime);
    });

    // return this._promise = this._poll().then(() => this._promise = null);
  }

  async _poll() {
    const changeSet = this.db.getChangeSet();
    const subscriptions = this.db.getSubscriptions(false);
    const methods = this.db.getQueuedMethods();
    const auth = this.db.auth;

    const request = {};
    if (changeSet)
      request.changeSet = changeSet;
    if (subscriptions.length)
      request.subscriptions = subscriptions;
    if (auth && auth.authInfoToSend)
      request.auth = auth.authInfoToSend();
    if (methods.length)
      request.methods = methods;

    console.log('-> ', request)

    const response = await fetch(this.url, {
      method: 'POST',
      mode: 'cors', // no-cors, *cors, same-origin
      cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      //credentials: 'same-origin', // include, *same-origin, omit
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Gongo-Request-API': '1',
        //'Content-Type': 'application/json'
        // 'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'follow', // manual, *follow, error
      referrerPolicy: 'no-referrer', // no-referrer, *client
      body: ARSON.encode(request) // body data type must match "Content-Type" header
    });

    //console.log(response);
    // { type: 'cors', url: 'http://localhost:3001/api/gongoPoll', redirected: false,
    //   status: 200, ok: true, statusText: "OK", headers: Headers, body: (...),
    //   bodyUsed: true }

    //const json = await response.json();
    const json = ARSON.decode(await response.text());

    console.log('<- ', json);

    if (json.subResults)
      this.db.processSubResults(json.subResults);

    if (json.methodsResults)
      this.db.processMethodsResults(json.methodsResults);

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
