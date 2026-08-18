const { syncBuiltinESMExports } = require("node:module");
const types = require("node:util/types");

const originalIsNativeError = types.isNativeError;
types.isNativeError = (value) =>
  originalIsNativeError(value) || value instanceof Error;
syncBuiltinESMExports();
