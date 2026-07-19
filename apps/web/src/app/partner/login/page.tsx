import { StaffLogin } from '@/components/console/StaffLogin';

export default function PartnerLoginPage() {
  return (
    <StaffLogin
      portal="Partner"
      destination="/partner"
      description="Run today’s fulfilment, keep the menu accurate, manage subscribers, and understand revenue without losing the live queue."
      unauthorizedMessage="Those credentials do not belong to an active partner account."
    />
  );
}
