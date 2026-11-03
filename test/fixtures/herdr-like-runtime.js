// Preload that imitates the Herdr mod runtime closely enough to catch the elkjs breakages:
// timers that throw and can't be replaced, no global/self/window, frozen built-in prototypes.
const refuse = () => { throw new Error("`setTimeout` is not available in the shell"); };
for (const name of ["setTimeout", "setInterval"])
  Object.defineProperty(globalThis, name, { get: () => refuse, set() {}, configurable: false });
for (const name of ["global", "self", "window"]) delete globalThis[name];
for (const proto of [Object.prototype, Function.prototype, Array.prototype, String.prototype, Error.prototype]) Object.freeze(proto);
