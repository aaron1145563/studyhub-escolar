alter table public.studyhub_workspaces
  add column if not exists student_phone text,
  add column if not exists email_notifications boolean not null default true;
