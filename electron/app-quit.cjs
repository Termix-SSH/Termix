function quitApp(app, window) {
  window?.destroy();
  app.quit();
}

module.exports = { quitApp };
