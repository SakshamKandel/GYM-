import type { StaffRole } from '@gym/shared';

export type Tier = 'starter' | 'silver' | 'gold' | 'elite';
export type MemberStatus = 'active' | 'suspended';

/** One row in the directory table (server-loaded; createdAt serialized to ISO). */
export interface MemberRow {
  id: string;
  email: string;
  displayName: string;
  tier: Tier;
  /** ISO expiry for the current dated tier, or null = no expiry (contract
   * §4.7, additive). Feed to `effectiveTier` from @gym/shared to know whether
   * a non-starter `tier` has actually lapsed. */
  tierExpiresAt: string | null;
  status: MemberStatus;
  createdAt: string;
  /** The account's staff role (admins row), or null for a regular member.
   * Drives the rank gate on suspend/reactivate in the drawer. */
  staffRole: StaffRole | null;
}

/** A coach the admin can assign a member to. */
export interface CoachOption {
  id: string;
  label: string;
  email: string;
}

/** The assigned-coach summary returned by GET /api/admin/members/[id]. */
export interface AssignedCoach {
  assignmentId: string;
  coachId: string;
  email: string;
  displayName: string;
}

/** Full detail payload from GET /api/admin/members/[id]. */
export interface MemberDetail {
  member: {
    id: string;
    email: string;
    displayName: string;
    tier: Tier;
    tierExpiresAt: string | null;
    status: MemberStatus;
    createdAt: string;
    staffRole: StaffRole | null;
  };
  profile: Record<string, unknown> | null;
  coach: AssignedCoach | null;
}
