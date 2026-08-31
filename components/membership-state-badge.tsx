import { Badge } from "@/components/ui/badge";
import { MEMBERSHIP_STATES, type MembershipState } from "@/lib/enums";

const VARIANTS: Record<
  MembershipState,
  "default" | "secondary" | "outline" | "destructive"
> = {
  active: "secondary",
  completed: "outline",
  scheduled: "outline",
  inactive: "destructive",
};

export function MembershipStateBadge({ state }: { state: MembershipState }) {
  return (
    <Badge variant={VARIANTS[state]}>{MEMBERSHIP_STATES[state]}</Badge>
  );
}
