import { StaffLogin } from '@/components/console/StaffLogin';

export default function CoachLoginPage() {
  return (
    <StaffLogin
      portal="Coach"
      destination="/coach"
      description="Review assigned clients, respond to check-ins, manage plans, and focus on the members who need attention."
      unauthorizedMessage="Those credentials do not belong to an authorized coach account."
    />
  );
}
