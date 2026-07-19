import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import * as worldLook from '../src/tools/world-look';

describe('POST /api/tools/world-look', () => {
  beforeEach(() => {
    worldLook.resetWorldLookState();
  });

  it('returns description and entities for a valid call', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/tools/world-look')
      .send({ input: {} });

    expect(res.status).toBe(200);
    expect(res.body.description).toMatch(/Milltown/i);
    expect(res.body.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'npc_bram',
          type: 'npc',
          name: 'Bram the Gatekeeper',
        }),
        expect.objectContaining({
          id: 'loc_milltown_gate',
          type: 'location',
          name: 'Milltown Gate',
        }),
      ]),
    );
    expect(res.body.referenced).toEqual(res.body.entities);
  });

  it('is idempotent for the same X-SkillShop-Request-Id', async () => {
    const app = createApp();
    const headers = { 'X-SkillShop-Request-Id': 'req-idem-1' };

    const first = await request(app)
      .post('/api/tools/world-look')
      .set(headers)
      .send({ input: { target: 'surroundings' } });

    const second = await request(app)
      .post('/api/tools/world-look')
      .set(headers)
      .send({ input: { target: 'surroundings' } });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(worldLook.worldLookExecutionCount).toBe(1);
  });

  it('returns JSON error for invalid _llmrpg context', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/tools/world-look')
      .send({
        input: {
          _llmrpg: { actingEntityId: 'npc_bram' },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: expect.stringMatching(/_llmrpg|context|Invalid/i),
      }),
    );
    expect(res.body.description).toBeUndefined();
  });

  it('tailors description when target is Bram', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/tools/world-look')
      .send({ input: { target: 'Bram' } });

    expect(res.status).toBe(200);
    expect(res.body.description).toMatch(/Bram/i);
    expect(res.body.description).toMatch(/Gatekeeper|spear|gatehouse/i);
  });
});
