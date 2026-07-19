import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /api/health', () => {
  it('returns ok status for llmrpg-server', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('llmrpg-server');
    expect(typeof res.body.time).toBe('string');
    expect(() => new Date(res.body.time).toISOString()).not.toThrow();
  });
});
