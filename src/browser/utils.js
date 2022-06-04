const debug = require("debug")("gongo");

const testEnv =
  typeof process === "object" && process.env && process.env.NODE_ENV === "test";

if (!testEnv)
  console.log(
    "Gongo uses `debug` for logging.  Set localStorage.debug = 'gongo:*'"
  );

class Log {
  constructor(prefix, _console = console) {
    this.prefix = "[" + prefix + "]";
    this.console = _console;

    this.debug = this._console.bind(this, "debug");
    this.info = this._console.bind(this, "info");
    this.log = this._console.bind(this, "log");
    this.trace = this._console.bind(this, "trace");
    this.warn = this._console.bind(this, "warn");
  }

  _console(level, ...args) {
    if (typeof args[0] === "string") args[0] = this.prefix + " " + args[0];
    else args.unshift(this.prefix);
    this.console[level].apply(console, args);
  }
}

function debounce(func, delay) {
  let timeout;
  return function () {
    clearTimeout(timeout);
    const args = arguments,
      that = this;
    timeout = setTimeout(() => func.apply(that, args), delay);
  };
}

// Thanks Meteor, https://github.com/meteor/meteor/blob/devel/packages/random/random.js
const UNMISTAKABLE_CHARS =
  "23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz";

function randomId(charsCount = 17) {
  let id = "";
  const values = new Uint32Array(charsCount);
  window.crypto.getRandomValues(values);
  for (let i = 0; i < charsCount; i++)
    id += UNMISTAKABLE_CHARS[values[i] % UNMISTAKABLE_CHARS.length];
  return id;
}

const log = new Log("gongo-client");

module.exports = { Log, log, debounce, randomId, debug };
