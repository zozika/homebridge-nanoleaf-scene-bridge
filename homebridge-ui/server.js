// Backend of the settings page: hands the scene lists recorded by the running plugin to the page,
// which cannot reach the Nanoleaf devices itself.
const fs = require('node:fs/promises');
const path = require('node:path');

const { SCENE_CATALOG_FILE } = require('../dist/sceneCatalog.js');

(async () => {
  // plugin-ui-utils is an ES module.
  const { HomebridgePluginUiServer } = await import('@homebridge/plugin-ui-utils');

  class UiServer extends HomebridgePluginUiServer {
    constructor() {
      super();
      this.onRequest('/scenes', () => this.readCatalog());
      this.ready();
    }

    async readCatalog() {
      try {
        return JSON.parse(await fs.readFile(path.join(this.homebridgeStoragePath, SCENE_CATALOG_FILE), 'utf8'));
      } catch {
        return {};
      }
    }
  }

  return new UiServer();
})();
