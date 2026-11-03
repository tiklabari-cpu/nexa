/**
 * Custom panels (KN-05 · K29 · tm 379): the admin's list and the
 * per-conversation read the Details pane embeds.
 *
 * Every read and write runs inside the caller's tenant transaction, so RLS
 * (`custom_panels_tenant`) is the floor under the `licenseId` filters below; a
 * panel of another workspace is simply absent — 404, never 403 (NFR-S5).
 *
 * "Visible for this conversation" is the panel's own rule, separate from and
 * on top of who may see the conversation (`chat/access.ts`): an enabled panel
 * whose team list is empty, or names one of the conversation's teams
 * (`chat_access`). An admin who sees every conversation still sees a Sales
 * panel only on Sales conversations — the panel is about the conversation's
 * team, not the reader's reach.
 */
import { randomUUID } from 'node:crypto';
import type { CustomPanel } from '@prisma/client';
import {
  CUSTOM_PANELS_MAX,
  customPanelOrigin,
  customPanelUrlProblem,
  type CustomPanelUrlProblem,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { newPanelSecret, type PanelSecretCodec } from './panel-token.js';

export interface CustomPanelView {
  id: string;
  name: string;
  url: string;
  origin: string;
  visible_group_ids: number[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatPanelView {
  id: string;
  name: string;
  url: string;
  origin: string;
}

export interface CustomPanelInput {
  name: string;
  url: string;
  visibleGroupIds: number[];
  enabled: boolean;
}

export type CustomPanelPatch = Partial<CustomPanelInput>;

const URL_MESSAGES: Record<CustomPanelUrlProblem, string> = {
  invalid: 'url: enter a full address such as https://backoffice.example/player.',
  not_https: 'url: a panel must be served over https://.',
  credentials: 'url: remove the user name and password from the address.',
  fragment: 'url: remove the #fragment from the address.',
  too_long: 'url: the address is longer than 2048 characters.',
};

export function serialiseCustomPanel(row: CustomPanel): CustomPanelView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    origin: customPanelOrigin(row.url),
    visible_group_ids: row.visibleGroupIds.map(Number),
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function chatPanelView(row: Pick<CustomPanel, 'id' | 'name' | 'url'>): ChatPanelView {
  return { id: row.id, name: row.name, url: row.url, origin: customPanelOrigin(row.url) };
}

/** The address rule, as a 400 whose `details.reason` the console translates. */
export function assertPanelUrl(url: string): void {
  const problem = customPanelUrlProblem(url);
  if (problem) throw ApiError.validation(URL_MESSAGES[problem], { reason: `url_${problem}` });
}

export class CustomPanelService {
  constructor(private readonly codec: PanelSecretCodec) {}

  async list(tx: TenantClient, tenant: TenantContext): Promise<CustomPanelView[]> {
    const rows = await tx.customPanel.findMany({
      where: { licenseId: tenant.licenseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: CUSTOM_PANELS_MAX,
    });
    return rows.map(serialiseCustomPanel);
  }

  async create(
    tx: TenantClient,
    tenant: TenantContext,
    input: CustomPanelInput,
    createdBy: string | null,
  ): Promise<{ panel: CustomPanelView; secret: string }> {
    assertPanelUrl(input.url);
    // The licence row serialises two admins adding the 20th and 21st panel at
    // once: without it both counts read 19 and both inserts land.
    await tx.$queryRaw`SELECT 1 FROM licenses WHERE id = ${tenant.licenseId} FOR UPDATE`;
    const count = await tx.customPanel.count({ where: { licenseId: tenant.licenseId } });
    if (count >= CUSTOM_PANELS_MAX) {
      throw ApiError.validation(`A workspace has at most ${CUSTOM_PANELS_MAX} custom panels.`, {
        reason: 'limit_reached',
      });
    }
    const groups = await this.#groups(tx, tenant, input.visibleGroupIds);
    const id = randomUUID();
    const secret = newPanelSecret();
    const row = await tx.customPanel.create({
      data: {
        id,
        licenseId: tenant.licenseId,
        name: input.name,
        url: input.url,
        visibleGroupIds: groups,
        enabled: input.enabled,
        signingSecretCiphertext: this.codec.seal(tenant.licenseId, id, secret),
        createdBy,
      },
    });
    return { panel: serialiseCustomPanel(row), secret };
  }

  /** The panel after the change and the names of the fields that changed, or null when absent. */
  async update(
    tx: TenantClient,
    tenant: TenantContext,
    id: string,
    patch: CustomPanelPatch,
  ): Promise<{ panel: CustomPanelView; changed: string[] } | null> {
    const current = await tx.customPanel.findFirst({
      where: { id, licenseId: tenant.licenseId },
    });
    if (!current) return null;
    if (patch.url !== undefined) assertPanelUrl(patch.url);
    const groups =
      patch.visibleGroupIds === undefined
        ? undefined
        : await this.#groups(tx, tenant, patch.visibleGroupIds);

    const changed: string[] = [];
    if (patch.name !== undefined && patch.name !== current.name) changed.push('name');
    if (patch.url !== undefined && patch.url !== current.url) changed.push('url');
    if (patch.enabled !== undefined && patch.enabled !== current.enabled) changed.push('enabled');
    if (
      groups !== undefined &&
      groups.map(String).join(',') !== current.visibleGroupIds.map(String).join(',')
    ) {
      changed.push('visible_group_ids');
    }
    if (changed.length === 0) return { panel: serialiseCustomPanel(current), changed };

    const row = await tx.customPanel.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(groups !== undefined ? { visibleGroupIds: groups } : {}),
      },
    });
    return { panel: serialiseCustomPanel(row), changed };
  }

  /** The removed panel's origin, or null when there was none to remove. */
  async remove(tx: TenantClient, tenant: TenantContext, id: string): Promise<string | null> {
    const current = await tx.customPanel.findFirst({
      where: { id, licenseId: tenant.licenseId },
      select: { url: true },
    });
    if (!current) return null;
    await tx.customPanel.delete({ where: { id } });
    return customPanelOrigin(current.url);
  }

  async rotateSecret(
    tx: TenantClient,
    tenant: TenantContext,
    id: string,
  ): Promise<{ panel: CustomPanelView; secret: string } | null> {
    const current = await tx.customPanel.findFirst({
      where: { id, licenseId: tenant.licenseId },
      select: { id: true },
    });
    if (!current) return null;
    const secret = newPanelSecret();
    const row = await tx.customPanel.update({
      where: { id },
      data: { signingSecretCiphertext: this.codec.seal(tenant.licenseId, id, secret) },
    });
    return { panel: serialiseCustomPanel(row), secret };
  }

  /** The enabled panels a conversation of these teams shows, oldest first. */
  async forChat(
    tx: TenantClient,
    tenant: TenantContext,
    chatGroupIds: bigint[],
  ): Promise<ChatPanelView[]> {
    const rows = await tx.customPanel.findMany({
      where: {
        licenseId: tenant.licenseId,
        enabled: true,
        OR: [
          { visibleGroupIds: { isEmpty: true } },
          ...(chatGroupIds.length > 0 ? [{ visibleGroupIds: { hasSome: chatGroupIds } }] : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, url: true },
      take: CUSTOM_PANELS_MAX,
    });
    return rows.map(chatPanelView);
  }

  /**
   * One panel as this conversation shows it, with its secret opened — or null
   * when it is disabled, absent, or not for these teams. The same rule as
   * {@link forChat}, so a token is never minted for a panel the pane would
   * not have drawn.
   */
  async signingPanel(
    tx: TenantClient,
    tenant: TenantContext,
    panelId: string,
    chatGroupIds: bigint[],
  ): Promise<{ id: string; secret: string } | null> {
    const row = await tx.customPanel.findFirst({
      where: {
        id: panelId,
        licenseId: tenant.licenseId,
        enabled: true,
        OR: [
          { visibleGroupIds: { isEmpty: true } },
          ...(chatGroupIds.length > 0 ? [{ visibleGroupIds: { hasSome: chatGroupIds } }] : []),
        ],
      },
      select: { id: true, signingSecretCiphertext: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      secret: this.codec.open(tenant.licenseId, row.id, row.signingSecretCiphertext),
    };
  }

  /** The requested teams, deduplicated and sorted, each one this workspace's. */
  async #groups(tx: TenantClient, tenant: TenantContext, ids: number[]): Promise<bigint[]> {
    const unique = [...new Set(ids)].sort((a, b) => a - b).map((id) => BigInt(id));
    if (unique.length === 0) return [];
    const found = await tx.group.count({
      where: { licenseId: tenant.licenseId, id: { in: unique } },
    });
    if (found !== unique.length) {
      throw ApiError.validation('visible_group_ids: name only this workspace’s teams.', {
        reason: 'unknown_group',
      });
    }
    return unique;
  }
}
