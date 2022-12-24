import _debug from "debug";
const debug = _debug("gongo");

const testEnv =
  typeof process === "object" && process.env && process.env.NODE_ENV === "test";

if (!testEnv)
  console.log(
    "Gongo uses `debug` for logging.  Set localStorage.debug = 'gongo,gongo:*'"
  );

class Log {
  prefix: string;
  console: typeof console;
  debug: typeof console.debug;
  info: typeof console.info;
  log: typeof console.log;
  trace: typeof console.trace;
  warn: typeof console.warn;

  constructor(prefix: string, _console = console) {
    this.prefix = "[" + prefix + "]";
    this.console = _console;

    this.debug = this._console.bind(this, "debug");
    this.info = this._console.bind(this, "info");
    this.log = this._console.bind(this, "log");
    this.trace = this._console.bind(this, "trace");
    this.warn = this._console.bind(this, "warn");
  }

  _console(
    level: "debug" | "info" | "log" | "trace" | "warn",
    ...args: unknown[]
  ) {
    if (typeof args[0] === "string") args[0] = this.prefix + " " + args[0];
    else args.unshift(this.prefix);
    this.console[level].apply(console, args);
  }
}

// Inspired by https://gist.github.com/ca0v/73a31f57b397606c9813472f7493a940?permalink_comment_id=3728415#gistcomment-3728415
function debounce<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timer: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    return new Promise<ReturnType<T>>((resolve) => {
      timer = setTimeout(() => {
        const returnValue = callback(...args) as ReturnType<T>;
        resolve(returnValue);
      }, delay);
    });
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

export { Log, log, debounce, randomId, debug };
