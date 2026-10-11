/* eslint-disable @typescript-eslint/no-require-imports */
// Preload for scripts that import route handlers outside Next: "server-only" throws unless the react-server condition is set,
// and that condition breaks next/navigation. Usage: tsx --require ./scripts/_stub-server-only.cjs ...
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "server-only" ? require.resolve("../tests/stubs/server-only.ts") : resolve.call(this, request, ...rest);
};
