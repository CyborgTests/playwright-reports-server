import type { Capability } from '@playwright-reports/shared';
import { useAuth } from './useAuth';

export function useHasCapability(): (capability: Capability) => boolean {
  const capabilities = useAuth().data?.capabilities;
  return (capability: Capability) => capabilities?.includes(capability) ?? false;
}
