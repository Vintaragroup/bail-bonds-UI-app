import { useQuery, useMutation } from '@tanstack/react-query';
import { getJSON, sendJSON } from './dashboard';

export function useCheckins(scope = 'today', options = {}) {
  return useQuery({
    queryKey: ['checkins', scope],
    queryFn: () => getJSON(`/checkins?scope=${encodeURIComponent(scope)}`),
    staleTime: 30_000,
    ...options,
  });
}

export function useUpdateCheckinStatus(options = {}) {
  return useMutation({
    mutationFn: ({ id, status, note }) =>
      sendJSON(`/checkins/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: { status, note },
      }),
    ...options,
  });
}

export function useLogCheckinContact(options = {}) {
  return useMutation({
    mutationFn: ({ id, increment = 1 }) =>
      sendJSON(`/checkins/${encodeURIComponent(id)}/contact`, {
        method: 'PATCH',
        body: { increment },
      }),
    ...options,
  });
}
