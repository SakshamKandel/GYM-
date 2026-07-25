import type { Metadata } from 'next';
import { StaffLogin } from '@/components/console/StaffLogin';

export const metadata: Metadata = { title: 'Sign in' };

export default function CoachLoginPage() {
  return (
    <StaffLogin
      portal="Coach"
      destination="/coach"
      description="See your clients, answer their check-ins, and get to whoever has gone quiet."
      unauthorizedMessage="That email and password do not open a coach account."
    />
  );
}
