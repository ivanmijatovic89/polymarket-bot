/** Evidence-only CJS/ESM tracing, never installed in the trading runtime. */
const { appendFileSync, realpathSync } = require('node:fs')
const { register } = require('node:module')
const { pathToFileURL } = require('node:url')
const Module = require('node:module')
const trace = (filename) => {
  appendFileSync(
    process.env.PMB_DISPATCH_DEPENDENCY_TRACE,
    `${JSON.stringify(realpathSync(filename))}\n`,
  )
}
trace(__filename)
// Diagnostic instrumentation observes the original file before compiled CJS
// evaluation. Its Node version and these hook bytes are pinned by the runner.
const compile = Module.prototype._compile
Module.prototype._compile = function (content, filename) {
  trace(filename)
  return compile.call(this, content, filename)
}
for (const extension of ['.json', '.node']) {
  const load = Module._extensions[extension]
  Module._extensions[extension] = function (module, filename) {
    trace(filename)
    return load(module, filename)
  }
}
register('./dispatch-dependency-loader.mjs', pathToFileURL(__filename))
