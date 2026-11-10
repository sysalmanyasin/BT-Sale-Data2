-- Required by the Closing PDF Storage RLS policies.
grant execute on function public.is_active_staff(uuid) to authenticated;
