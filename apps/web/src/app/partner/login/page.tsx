import type { Metadata } from 'next';
import { StaffLogin } from '@/components/console/StaffLogin';

export const metadata: Metadata = { title: 'Sign in' };

export default function PartnerLoginPage() {
  return (
    <StaffLogin
      portal="Partner"
      destination="/partner"
      description="Cook today’s orders, keep the menu right, look after your weekly meal plans, and see what you have earned."
      unauthorizedMessage="That email and password do not open a restaurant account."
    />
  );
}
