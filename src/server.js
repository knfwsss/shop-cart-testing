const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const app = createApp();

function resetSessions() {
  app.locals.resetSessions();
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Корзина запущена: http://localhost:${PORT}`);
  });
}

module.exports = { app, resetSessions };
