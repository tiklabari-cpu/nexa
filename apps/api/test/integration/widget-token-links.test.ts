/**
 * What the visitor's token carries for the widget footer and the contract that
 * describes it (FR-MOD-11.5, tm 257.17).
 *
 * `POST /customer/token` has always sent a `widget` object; the OpenAPI document
 * never listed it, so the field drifted from its description without a test
 * noticing (`contract-parity` compares paths and methods only). It now carries
 * two more facts about the deployment: the privacy policy address
 * (`PRIVACY_POLICY_URL`) and where "Powered by SiyahTuş" links — nowhere in the
 * public pilot, today's placeholder address everywhere else.
 */
import type { PrismaClient } from '@prisma/client';
import { loadOpenApiDocument } from '@siyahtus/contract';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PRIVACY = 'https://legal.example.test/privacy';
const PLACEHOLDER = 'https://siyahtus.example';
const PILOT = { PILOT_MODE: 'true', PILOT_CONTACT_EMAIL: 'pilot-contact@example.test' };

const APPEARANCE_KEYS = [
  'mobile_fullscreen',
  'position',
  'powered_by',
  'powered_by_url',
  'primary_color',
  'privacy_policy_url',
  'theme',
];

describe('POST /customer/token: widget footer links (FR-MOD-11.5)', () => {
  let owner: PrismaClient;
  let ordinary: TestServer;
  let withPolicy: TestServer;
  let pilot: TestServer;
  let fx: Fixtures;

  async function widgetOf(server: TestServer): Promise<Record<string, unknown>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json().widget;
  }

  beforeAll(async () => {
    owner = ownerClient();
    [ordinary, withPolicy, pilot] = await Promise.all([
      startTestServer({ PILOT_MODE: 'false', PRIVACY_POLICY_URL: undefined }),
      startTestServer({ PILOT_MODE: 'false', PRIVACY_POLICY_URL: PRIVACY }),
      startTestServer({ ...PILOT, PRIVACY_POLICY_URL: PRIVACY }),
    ]);
  });

  afterAll(async () => {
    await Promise.all([ordinary.close(), withPolicy.close(), pilot.close()]);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await Promise.all([ordinary, withPolicy, pilot].map((s) => clearRateLimits(s.app)));
  });

  it('carries exactly the seven appearance fields the contract names', async () => {
    const widget = await widgetOf(ordinary);

    expect(Object.keys(widget).sort()).toEqual(APPEARANCE_KEYS);

    const document = loadOpenApiDocument() as unknown as {
      components: { schemas: Record<string, { required: string[]; properties: object }> };
    };
    const schema = document.components.schemas['WidgetAppearance']!;
    expect(Object.keys(schema.properties).sort()).toEqual(APPEARANCE_KEYS);
    expect([...schema.required].sort()).toEqual(APPEARANCE_KEYS);
  });

  it('lists `widget` among the token response’s required fields', () => {
    const document = loadOpenApiDocument() as unknown as {
      paths: Record<
        string,
        {
          post: {
            responses: Record<
              string,
              {
                content: Record<string, { schema: { required: string[]; properties: object } }>;
              }
            >;
          };
        }
      >;
    };
    const schema =
      document.paths['/customer/token']!.post.responses['200']!.content['application/json']!.schema;

    expect(schema.required).toContain('widget');
    expect(schema.properties).toHaveProperty('widget');
  });

  it('names no privacy policy when the deployment has none', async () => {
    expect((await widgetOf(ordinary))['privacy_policy_url']).toBeNull();
  });

  it('carries PRIVACY_POLICY_URL when it is set', async () => {
    expect((await widgetOf(withPolicy))['privacy_policy_url']).toBe(PRIVACY);
  });

  it('keeps today’s “Powered by” address on an ordinary deployment', async () => {
    expect((await widgetOf(ordinary))['powered_by_url']).toBe(PLACEHOLDER);
    expect((await widgetOf(withPolicy))['powered_by_url']).toBe(PLACEHOLDER);
  });

  it('sends no “Powered by” address in the pilot, and still the privacy policy', async () => {
    const widget = await widgetOf(pilot);

    expect(widget['powered_by_url']).toBeNull();
    expect(widget['privacy_policy_url']).toBe(PRIVACY);
    // The brand itself is still there — only its link is gone.
    expect(widget['powered_by']).toBe(true);
  });

  it('leaves the five workspace-chosen fields as they were', async () => {
    const widget = await widgetOf(ordinary);

    expect(widget).toMatchObject({
      primary_color: '#2d67fa',
      position: 'bottom-right',
      theme: 'auto',
      mobile_fullscreen: true,
      powered_by: true,
    });
  });
});
