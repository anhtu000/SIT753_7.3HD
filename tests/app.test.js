const request = require('supertest');
const app = require('../index');

describe('FLOW retail application basic tests', () => {
  test('GET /health should return app health status', async () => {
    const res = await request(app).get('/health');

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.app).toBe('flow-retail');
  });

  test('GET / should return homepage', async () => {
    const res = await request(app).get('/');

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Hot products');
  });

  test('GET /DProject_ProductList should return product list page', async () => {
    const res = await request(app).get('/DProject_ProductList');

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Add to cart');
  });

  test('GET /DProject_Cart should redirect unauthenticated user to login', async () => {
    const res = await request(app).get('/DProject_Cart');

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/DProject_Login');
  });

  test('POST /login with empty data should show validation error', async () => {
    const res = await request(app)
      .post('/login')
      .send('username=&password=')
      .set('Content-Type', 'application/x-www-form-urlencoded');

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Username and password cannot be empty');
  });

  test('GET /metrics should expose Prometheus metrics', async () => {
    const res = await request(app).get('/metrics');

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('flow_http_requests_total');
  });
});