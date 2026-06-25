import { type Capability, can } from '@playwright-reports/shared';
import { useAuth } from './useAuth';

export function useCan(): (capability: Capability) => boolean {
  const session = useAuth();
  const role = session.data?.user.role ?? null;
  return (capability: Capability) => can(role, capability);
}
