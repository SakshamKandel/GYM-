export type Tier = 'starter' | 'silver' | 'gold' | 'elite';
export type MemberStatus = 'active' | 'suspended';

/** One row in the directory table (server-loaded; createdAt serialized to ISO). */
export interface MemberRow {
  id: string;
  email: string;
  displayName: string;
  tier: Tier;
  status: MemberStatus;
  createdAt: string;
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
    status: MemberStatus;
    createdAt: string;
  };
  profile: Record<string, unknown> | null;
  coach: AssignedCoach | null;
}
