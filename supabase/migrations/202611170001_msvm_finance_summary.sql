-- MSVM live financial summary: aggregate-only, read-only to signed-in clients.
create table if not exists public.msvm_finance_summary (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cash_balance numeric(14,2) not null default 0,
  reserved_funds numeric(14,2) not null default 0,
  available_cash numeric(14,2) not null default 0,
  cleared_income numeric(14,2) not null default 0,
  cleared_expenses numeric(14,2) not null default 0,
  net_cash_movement numeric(14,2) not null default 0,
  pending_transaction_count integer not null default 0,
  overdue_bill_count integer not null default 0,
  total_debt numeric(14,2) not null default 0,
  savings_goal_remaining numeric(14,2) not null default 0,
  synced_at timestamptz not null default now()
);

alter table public.msvm_finance_summary enable row level security;

drop policy if exists "Users can read their own MSVM finance summary" on public.msvm_finance_summary;
create policy "Users can read their own MSVM finance summary"
  on public.msvm_finance_summary for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.msvm_finance_summary from anon, authenticated;
grant select on public.msvm_finance_summary to authenticated;
grant all on public.msvm_finance_summary to service_role;
