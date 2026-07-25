import type { Metadata } from 'next';
import { StaffLogin } from '@/components/console/StaffLogin';

export const metadata: Metadata = { title: 'Sign in' };

export default function AdminLoginPage() {
  return (
    <StaffLogin
      portal="Admin"
      destination="/admin"
      description="Members, payments, partners, content and permissions, all in one place. Every change is recorded against your name."
      unauthorizedMessage="That email and password do not open an admin account."
    />
  );
}
