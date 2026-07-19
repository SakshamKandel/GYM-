export interface GymReportRow {
  id: string;
  gymId: string;
  gymName: string;
  gymSlug: string;
  field: 'hours' | 'phone' | 'address' | 'location' | 'closed' | 'other';
  note: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  reporterEmail: string;
}

export interface GymReviewRow {
  id: string;
  gymId: string;
  gymName: string;
  gymSlug: string;
  stars: number;
  note: string;
  status: 'visible' | 'hidden';
  createdAt: string;
  authorEmail: string;
}
