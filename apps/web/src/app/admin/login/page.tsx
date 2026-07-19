import { StaffLogin } from '@/components/console/StaffLogin';

export default function AdminLoginPage() {
  return (
    <StaffLogin
      portal="Admin"
      destination="/admin"
      description="Manage members, payments, partners, content, permissions, and operations from one accountable console."
      unauthorizedMessage="Those credentials do not belong to an authorized admin account."
    />
  );
}
