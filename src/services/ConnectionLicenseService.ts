import { In, IsNull } from "typeorm";

import { AppDataSource } from "../config/database";
import { ConnectionLicense } from "../entities/ConnectionLicense";
import {
  OrganizationLicense,
  PlanType,
  SubscriptionStatus,
  TrialUnlock,
} from "../entities/OrganizationLicense";
import { LicenseStatus, UserLicense } from "../entities/UserLicense";
import { clearCacheByPrefix } from "../config/utils/cache";
import { ConnectionLicenseRepository } from "../repositories/ConnectionLicenseRepository";
import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";

/**
 * Where a call's seats and plan live. `connection` null: the workspace row,
 * which carries the plan and seats of its primary connection.
 */
export type SeatPool = {
  workspace: OrganizationLicense;
  connection: ConnectionLicense | null;
};

export type ConnectionLicenseDescription = {
  valid: boolean;
  subscriptionStatus: SubscriptionStatus;
  planType: PlanType;
  numberOfLicenses?: number;
  stripeCustomerId?: string;
  byok: boolean;
  creditBalanceUsd: number;
  connectionId: string;
  trialEnd?: Date;
  trialReviewCreditsTotal?: number | null;
  trialReviewCreditsUsed?: number | null;
  trialReviewCreditsRemaining?: number | null;
  trialCreditTier?: string;
  trialUnlocks?: TrialUnlock[];
};

type UnbilledClaim =
  | { bound: true; movedSeats: number; droppedSeats: number }
  | { bound: false; subscribed?: ConnectionLicense };

const isByok = (planType?: PlanType) =>
  Boolean(planType && planType.includes("byok"));

const UNIQUE_VIOLATION = "23505";

const log = (message: string, data: Record<string, unknown>) =>
  console.log(JSON.stringify({ message, ...data }));

const clearLicenseCaches = () => {
  clearCacheByPrefix("org-license");
  clearCacheByPrefix("user-license");
  clearCacheByPrefix("users-license");
};

export class ConnectionLicenseService {
  /**
   * Whether a connection's licence carries a Stripe subscription of its own.
   * One without it bills nothing: seat calls and checkouts write the row
   * before they succeed, so it may be left by one that failed or was
   * abandoned.
   */
  static hasOwnSubscription(
    connection: Pick<ConnectionLicense, "stripeSubscriptionId">,
  ): boolean {
    return Boolean(connection.stripeSubscriptionId);
  }

  /**
   * The seat pool for `connectionId` in a workspace. A call with no
   * connection, or naming the primary, uses the workspace row. Until kodus-ai
   * binds a primary (server side, before a second connection is added),
   * every connection without a subscription of its own also uses the
   * workspace row: that is today's behaviour, and a caller cannot claim the
   * workspace plan by naming an id first. Once a primary is bound, any other
   * connection gets its own licence on the free plan, with no Stripe call.
   * Only `create` writes it (seats, checkout); a read gets an unsaved free
   * licence, so read calls never add rows.
   */
  static async resolve(
    organizationId: string,
    teamId: string,
    connectionId?: string,
    { create = false }: { create?: boolean } = {},
  ): Promise<SeatPool | null> {
    const workspace = await OrganizationLicenseRepository.findOne({
      where: { organizationId, teamId },
    });
    if (!workspace) return null;
    if (!connectionId || workspace.primaryConnectionId === connectionId) {
      return { workspace, connection: null };
    }

    const existing = await ConnectionLicenseRepository.findOne({
      where: { organizationLicenseId: workspace.id, connectionId },
    });

    if (workspace.primaryConnectionId == null) {
      return {
        workspace,
        connection:
          existing && this.hasOwnSubscription(existing) ? existing : null,
      };
    }

    if (existing) return { workspace, connection: existing };

    return {
      workspace,
      connection: create
        ? await this.createFor(workspace, connectionId)
        : this.unsavedFor(workspace, connectionId),
    };
  }

  /**
   * Names the workspace's primary connection when it has none yet. A
   * connection whose licence bills nothing can be named: its seats join the
   * workspace pool and the licence is dropped.
   */
  static async bindPrimary(
    organizationId: string,
    teamId: string,
    connectionId: string,
  ): Promise<{ found: boolean; primaryConnectionId: string | null }> {
    const workspace = await OrganizationLicenseRepository.findOne({
      where: { organizationId, teamId },
    });
    if (!workspace) return { found: false, primaryConnectionId: null };

    if (workspace.primaryConnectionId == null) {
      const existing = await ConnectionLicenseRepository.findOne({
        where: { organizationLicenseId: workspace.id, connectionId },
      });
      if (!existing) {
        await this.claimPrimary(workspace, connectionId);
      } else if (this.hasOwnSubscription(existing)) {
        // A connection billed on its own subscription never takes the
        // workspace's plan by being named here.
        this.logOwnSubscriptionRefusal(workspace, existing);
      } else {
        await this.claimPrimaryFromUnbilled(workspace, existing);
      }
    }

    return {
      found: true,
      primaryConnectionId: workspace.primaryConnectionId ?? null,
    };
  }

  /**
   * A connection was removed from the workspace. When it was the primary,
   * the slot frees until kodus-ai binds the next one.
   * A connection's own subscription is left as is: cancelling it is the
   * customer's call, through the portal.
   */
  static async release(
    organizationId: string,
    teamId: string,
    connectionId: string,
  ): Promise<{ released: boolean }> {
    const workspace = await OrganizationLicenseRepository.findOne({
      where: { organizationId, teamId },
    });
    if (!workspace || workspace.primaryConnectionId !== connectionId) {
      return { released: false };
    }

    const result = await OrganizationLicenseRepository.update(
      { id: workspace.id, primaryConnectionId: connectionId },
      { primaryConnectionId: null },
    );
    const released = (result.affected ?? 0) > 0;
    if (released) {
      workspace.primaryConnectionId = null;
      clearLicenseCaches();
      log("connection_license_primary_released", {
        organizationId,
        teamId,
        licenseId: workspace.id,
        connectionId,
      });
    }
    return { released };
  }

  /**
   * Plan of a connection billed on its own licence: its subscription when it
   * has one, else the workspace trial while it runs, else the free plan. The
   * wallet is always the workspace's.
   */
  static describe(
    workspace: OrganizationLicense,
    connection: ConnectionLicense,
  ): ConnectionLicenseDescription {
    const base = {
      connectionId: connection.connectionId,
      creditBalanceUsd: Number(workspace.creditBalanceUsd ?? 0),
      stripeCustomerId: workspace.stripeCustomerId,
    };

    if (connection.stripeSubscriptionId) {
      return {
        ...base,
        valid: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL].includes(
          connection.subscriptionStatus,
        ),
        subscriptionStatus: connection.subscriptionStatus,
        planType: connection.planType,
        numberOfLicenses: connection.totalLicenses,
        byok: isByok(connection.planType),
      };
    }

    const trialRunning =
      workspace.subscriptionStatus === SubscriptionStatus.TRIAL &&
      (!workspace.trialEnd || new Date() <= new Date(workspace.trialEnd));
    if (trialRunning) {
      return {
        ...base,
        valid: true,
        subscriptionStatus: SubscriptionStatus.TRIAL,
        planType: workspace.planType,
        trialEnd: workspace.trialEnd,
        byok: isByok(workspace.planType),
        trialReviewCreditsTotal: workspace.trialReviewCreditsTotal,
        trialReviewCreditsUsed: workspace.trialReviewCreditsUsed,
        trialReviewCreditsRemaining: workspace.trialReviewCreditsRemaining,
        trialCreditTier: workspace.trialCreditTier,
        trialUnlocks: workspace.trialUnlocks,
      };
    }

    return {
      ...base,
      valid: true,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      planType: PlanType.FREE_BYOK,
      numberOfLicenses: connection.totalLicenses,
      byok: true,
    };
  }

  /** Every licence of the workspace's other connections. */
  static async listForWorkspace(
    workspace: OrganizationLicense,
  ): Promise<ConnectionLicense[]> {
    return ConnectionLicenseRepository.find({
      where: { organizationLicenseId: workspace.id },
      order: { createdAt: "ASC" },
    });
  }

  private static async claimPrimary(
    workspace: OrganizationLicense,
    connectionId: string,
  ): Promise<boolean> {
    const result = await OrganizationLicenseRepository.update(
      { id: workspace.id, primaryConnectionId: IsNull() },
      { primaryConnectionId: connectionId },
    );
    if ((result.affected ?? 0) > 0) {
      workspace.primaryConnectionId = connectionId;
      clearLicenseCaches();
      log("connection_license_primary_bound", {
        organizationId: workspace.organizationId,
        teamId: workspace.teamId,
        licenseId: workspace.id,
        connectionId,
      });
      return true;
    }

    return this.readWinner(workspace, connectionId);
  }

  /**
   * Binds a connection whose licence has no subscription of its own, in one
   * transaction. The licence is re-read under a lock, so a checkout that has
   * stored its subscription since keeps it and refuses the bind. Its seats
   * move to the workspace pool, except a git id the workspace already seats,
   * which keeps that seat; then the licence is dropped.
   */
  private static async claimPrimaryFromUnbilled(
    workspace: OrganizationLicense,
    unbilled: ConnectionLicense,
  ): Promise<boolean> {
    const connectionId = unbilled.connectionId;
    const outcome: UnbilledClaim = await AppDataSource.transaction(
      async (manager) => {
        const licences = manager.getRepository(ConnectionLicense);
        const workspaces = manager.getRepository(OrganizationLicense);
        const seats = manager.getRepository(UserLicense);

        const locked = await licences.findOne({
          where: { id: unbilled.id },
          lock: { mode: "pessimistic_write" },
        });
        if (locked && this.hasOwnSubscription(locked)) {
          return { bound: false, subscribed: locked };
        }

        const claimed = await workspaces.update(
          { id: workspace.id, primaryConnectionId: IsNull() },
          { primaryConnectionId: connectionId },
        );
        if ((claimed.affected ?? 0) === 0) return { bound: false };
        if (!locked) return { bound: true, movedSeats: 0, droppedSeats: 0 };

        const held = await seats.find({
          where: { connectionLicenseId: locked.id },
        });
        const workspaceSeats = held.length
          ? await seats.find({
              where: {
                organizationLicenseId: workspace.id,
                connectionLicenseId: IsNull(),
                git_id: In(held.map((seat) => seat.git_id)),
              },
            })
          : [];
        // A git id the workspace already seats keeps that seat, active when
        // either of the two was: the user loses no access on the bind.
        const activeHeld = new Set(
          held
            .filter((seat) => seat.licenseStatus === LicenseStatus.ACTIVE)
            .map((seat) => seat.git_id),
        );
        const reactivated = workspaceSeats.filter(
          (seat) =>
            seat.licenseStatus !== LicenseStatus.ACTIVE &&
            activeHeld.has(seat.git_id),
        );
        if (reactivated.length) {
          await seats.update(
            { id: In(reactivated.map((seat) => seat.id)) },
            { licenseStatus: LicenseStatus.ACTIVE },
          );
          await workspaces.increment(
            { id: workspace.id },
            "assignedLicenses",
            reactivated.length,
          );
        }
        const seatedOnWorkspace = new Set(
          workspaceSeats.map((seat) => seat.git_id),
        );
        const moving = held.filter((seat) => !seatedOnWorkspace.has(seat.git_id));
        if (moving.length) {
          await seats.update(
            { id: In(moving.map((seat) => seat.id)) },
            { connectionLicenseId: null },
          );
        }
        const activeMoved = moving.filter(
          (seat) => seat.licenseStatus === LicenseStatus.ACTIVE,
        ).length;
        if (activeMoved) {
          await workspaces.increment(
            { id: workspace.id },
            "assignedLicenses",
            activeMoved,
          );
        }
        // Seats still on it duplicate the workspace's and cascade with it.
        await licences.delete({ id: locked.id });
        return {
          bound: true,
          movedSeats: moving.length,
          droppedSeats: held.length - moving.length,
        };
      },
    );

    if (outcome.bound === true) {
      workspace.primaryConnectionId = connectionId;
      clearLicenseCaches();
      log("connection_license_primary_bound", {
        organizationId: workspace.organizationId,
        teamId: workspace.teamId,
        licenseId: workspace.id,
        connectionId,
        droppedConnectionLicenseId: unbilled.id,
        movedSeats: outcome.movedSeats,
        droppedSeats: outcome.droppedSeats,
      });
      return true;
    }
    if (outcome.subscribed) {
      this.logOwnSubscriptionRefusal(workspace, outcome.subscribed);
      return false;
    }
    return this.readWinner(workspace, connectionId);
  }

  /** Another request bound the primary first: read who won. */
  private static async readWinner(
    workspace: OrganizationLicense,
    connectionId: string,
  ): Promise<boolean> {
    const fresh = await OrganizationLicenseRepository.findOne({
      where: { id: workspace.id },
    });
    workspace.primaryConnectionId = fresh?.primaryConnectionId ?? null;
    return workspace.primaryConnectionId === connectionId;
  }

  private static logOwnSubscriptionRefusal(
    workspace: OrganizationLicense,
    connection: ConnectionLicense,
  ): void {
    log("connection_license_primary_refused", {
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      licenseId: workspace.id,
      connectionId: connection.connectionId,
      connectionLicenseId: connection.id,
      reason: "own_subscription",
    });
  }

  private static freeLicenceOf(workspace: OrganizationLicense, connectionId: string) {
    return {
      organizationLicenseId: workspace.id,
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      connectionId,
      planType: PlanType.FREE_BYOK,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      stripeSubscriptionId: null,
      totalLicenses: 0,
      assignedLicenses: 0,
    };
  }

  private static unsavedFor(
    workspace: OrganizationLicense,
    connectionId: string,
  ): ConnectionLicense {
    return ConnectionLicenseRepository.create(this.freeLicenceOf(workspace, connectionId));
  }

  private static async createFor(
    workspace: OrganizationLicense,
    connectionId: string,
  ): Promise<ConnectionLicense> {
    try {
      const created = await ConnectionLicenseRepository.save(
        ConnectionLicenseRepository.create(this.freeLicenceOf(workspace, connectionId)),
      );
      clearLicenseCaches();
      log("connection_license_created", {
        organizationId: workspace.organizationId,
        teamId: workspace.teamId,
        licenseId: workspace.id,
        connectionLicenseId: created.id,
        connectionId,
      });
      return created;
    } catch (error) {
      if ((error as { code?: string })?.code !== UNIQUE_VIOLATION) throw error;
      const raced = await ConnectionLicenseRepository.findOne({
        where: { organizationLicenseId: workspace.id, connectionId },
      });
      if (!raced) throw error;
      return raced;
    }
  }
}
