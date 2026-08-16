const GAME = require("../config/game");
const SafebooruAPI = require("./safebooru");
const E621API = require("./e621");
const Rule34API = require("./rule34");

const adapters = {
  safebooru: new SafebooruAPI(GAME.apis.safebooru),
  e621: new E621API(GAME.apis.e621),
  rule34: new Rule34API(GAME.apis.rule34),
};

function getAdapter(name) {
  const adapter = adapters[name.toLowerCase()];
  if (!adapter) throw new Error(`Unknown API adapter: ${name}`);
  return adapter;
}

function getDefaultAdapter() {
  if (adapters.safebooru.isAvailable()) return adapters.safebooru;
  if (adapters.rule34.isAvailable()) return adapters.rule34;
  if (adapters.e621.isAvailable()) return adapters.e621;
  throw new Error("No image API adapter is available. Configure at least one.");
}

function listAvailable() {
  return Object.entries(adapters)
    .filter(([, a]) => a.isAvailable())
    .map(([name, a]) => ({ name, apiName: a.config.name }));
}

module.exports = {
  getAdapter,
  getDefaultAdapter,
  listAvailable,
  adapters,
};
