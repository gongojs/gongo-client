class HTTPTransport {

  constructor(db, url, options = {}) {
    this.db = db;
    this.url = url;
    db.transport = this;

    this.options = {
      pollInterval: 2000,
      ...options
    };

    db.on('updatesFinished', () => {
      console.log('database updated');
      this.poll();
    });
  }

  setPollTimeout() {
    this.timeout = setTimeout(() => this.poll(), this.options.pollInterval);
  }

  async poll() {
    const changeSet = this.db.getChangeSet();
    const subscriptions = this.db.getSubscriptions();

    const request = {};
    if (changeSet)
      request.changeSet = changeSet;
    if (subscriptions.length)
      request.subscriptions = subscriptions;

    console.log('-> ', request)

    const response = await fetch(this.url, {
      method: 'POST',
      mode: 'cors', // no-cors, *cors, same-origin
      cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      //credentials: 'same-origin', // include, *same-origin, omit
      headers: {
        'Content-Type': 'application/json'
        // 'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'follow', // manual, *follow, error
      referrerPolicy: 'no-referrer', // no-referrer, *client
      body: JSON.stringify(request) // body data type must match "Content-Type" header
    });

    //console.log(response);
    // { type: 'cors', url: 'http://localhost:3001/api/gongoPoll', redirected: false,
    //   status: 200, ok: true, statusText: "OK", headers: Headers, body: (...),
    //   bodyUsed: true }

    const json = await response.json();

    console.log('<- ', json);

    if (json.subResults)
      this.db.processSubResults(json.subResults);

    // don't do this for now during devel
    //this.setPollTimeout();
  }



}

module.exports = { __esModule: true, default: HTTPTransport };
