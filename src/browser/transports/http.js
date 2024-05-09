const ARSON = require("arson");
const ObjectID = require("bson-objectid");

const { debug } = require("../utils");

ARSON.registerType("ObjectID", {
  deconstruct: function (id) {
    return id instanceof ObjectID && [id.toHexString()];
  },

  reconstruct: function (args) {
    return args && ObjectID.createFromHexString(args[0]);
  },
});

// Adapted from https://fetch-progress.anthum.com/fetch-basic/supported-browser.js
function fetchWithProgress(url, opts, onProgress) {
  return fetch(url, opts).then((response) => {
    // to access headers, server must send CORS header "Access-Control-Expose-Headers: content-encoding, content-length x-file-size"
    // server must send custom x-file-size header if gzip or other content-encoding is used
    const contentEncoding = response.headers.get("content-encoding");
    const contentLength = response.headers.get(
      contentEncoding ? "x-file-size" : "content-length"
    );
    if (contentLength === null) return response;

    const total = parseInt(contentLength);
    let loaded = 0;

    return new Response(
      new ReadableStream({
        async start(controller) {
          const reader = response.body.getReader();
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.byteLength;
            onProgress({ total, loaded, progress: loaded / total });
            controller.enqueue(value);
          }
          controller.close();
        },
      })
    );
  });
}

class HTTPTransport {
  constructor(db, options = {}) {
    this.db = db;

    this.url = options.url || window.origin + "/api/gongoPoll";

    this.options = {
      pollInterval: 2000, // false, // 2000,
      pollWhenIdle: false,
      idleTimeout: 30 * 1000,
      debounceTime: 100,
      url: this.url,
      ...options,
    };

    db.on("updatesFinished", () => this.poll("updatesFinished"));
    db.idb.once("collectionsPopulated", () =>
      // Poll every time subscriptions are changed, but not before
      // collections are populated.
      db.on("subscriptionsChanged", () => this.poll("subscriptionsChanged"))
    );
    db.idb.on("collectionsPopulated", () => this.poll("collectionsPopulated"));

    this.idleTimer = null;
    this.idleState = false;
    this.wasPolling = false;

    const idleCheck = () => {
      clearTimeout(this.idleTimer);
      this.idleState = false;
      if (this.wasPolling) {
        console.log("Idle time ended, resuming polling");
        this.wasPolling = false;
        this.poll("Idle time ended and was polling before");
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
    if (this.timeout) {
      console.log(
        "setPollTimeout() called again during timeout time, skipping..."
      );
      return;
    }

    this.timeout = setTimeout(
      () => this.poll("setPollTimeout"),
      this.options.pollInterval
    );
  }

  poll(source) {
    if (!this.db.populated) {
      // console.log('Skipping unpopulated poll (will be called again post-population)');
      return;
    }

    if (this._promise) {
      // console.log("Skipping poll while poll already in progress");
      return this._promise;
    }

    debug(`poll(${source})`);

    // cpoll() might be called directly while a timer is running too
    clearTimeout(this.timeout);

    if (this._debounceTimeout) {
      clearTimeout(this._debounceTimeout);
    }

    return (this._promise = new Promise((resolve) => {
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
    this.db.runChangeSet();
    this.db.runSubscriptions();

    const calls = this.db.getAndFlushQueuedCalls();

    const request = { $gongo: 2 };

    const auth = this.db.auth;
    if (auth && auth.authInfoToSend) request.auth = auth.authInfoToSend();

    if (calls.length) {
      request.calls = calls.map((row) => [row.name, row.opts]);

      let responseTimeout;

      responseTimeout = setTimeout(() => {
        console.warn("No headers received after 5s for: ", request.calls);
        // TODO, check again later, and set another poll timer.
      }, 5000);

      const response = await fetch(
        /*WithProgress*/ this.url,
        {
          method: "POST",
          mode: "cors", // no-cors, *cors, same-origin
          cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
          //credentials: 'same-origin', // include, *same-origin, omit
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            // "Content-Type": "application/json",
            // 'Content-Type': 'application/x-www-form-urlencoded',
          },
          redirect: "follow", // manual, *follow, error
          referrerPolicy: "no-referrer", // no-referrer, *client
          body: ARSON.encode(request), // body data type must match "Content-Type" header
          // body: JSON.stringify(request),
        },
        console.log
      );

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

      //const json = await response.json();
      const body = await response.text();
      clearTimeout(responseTimeout);

      let json;
      try {
        json = ARSON.decode(body);
      } catch (error) {
        console.error("Error decoding: " + body);
        console.error(error);
        return;
      }

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
