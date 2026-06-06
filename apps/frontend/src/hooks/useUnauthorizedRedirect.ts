import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { withQueryParams } from '../lib/network';
import { withBase } from '../lib/url';
import { useAuth } from './useAuth';

export function useUnauthorizedRedirect(): void {
  const session = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (session.status === 'unauthenticated' && window.location.pathname !== '/login') {
      toast.warning('Unauthorized');
      navigate(
        withQueryParams(withBase('/login'), {
          callbackUrl: encodeURI(withBase(window.location.pathname)),
        })
      );
    }
  }, [session.status, navigate]);
}
