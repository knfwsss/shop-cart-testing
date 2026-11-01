// Поднимает корзину на свободном порту и прогоняет Postman-коллекцию через Newman.
const path = require('path');
const newman = require('newman');
const { createApp } = require('../../../src/app');

const reportDir = process.env.NEWMAN_REPORT_DIR || 'reports/newman';

const server = createApp().listen(0, '127.0.0.1', () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  newman.run(
    {
      collection: require(path.join(__dirname, 'shop-cart.postman_collection.json')),
      envVar: [{ key: 'baseUrl', value: baseUrl }],
      reporters: ['cli', 'junit', 'json'],
      reporter: {
        junit: { export: path.join(reportDir, 'newman-junit.xml') },
        json: { export: path.join(reportDir, 'newman-report.json') },
      },
    },
    (err, summary) => {
      server.close();
      if (err) {
        console.error(err);
        process.exit(1);
      }
      process.exit(summary.run.failures.length > 0 ? 1 : 0);
    },
  );
});
