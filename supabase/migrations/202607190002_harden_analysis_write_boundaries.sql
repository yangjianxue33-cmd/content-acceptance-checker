revoke insert, update, delete on table public.analysis_modules from authenticated;
revoke insert, update, delete on table public.issues from authenticated;

drop policy if exists "Authenticated owners can insert analysis modules"
on public.analysis_modules;
drop policy if exists "Authenticated owners can update analysis modules"
on public.analysis_modules;
drop policy if exists "Authenticated owners can delete analysis modules"
on public.analysis_modules;

drop policy if exists "Authenticated owners can insert issues"
on public.issues;
drop policy if exists "Authenticated owners can update issues"
on public.issues;
drop policy if exists "Authenticated owners can delete issues"
on public.issues;
