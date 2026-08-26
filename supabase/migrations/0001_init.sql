-- PopularNow — schema, RLS, funcții de sold
-- supabase db push  (sau lipește în SQL Editor)

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  balance numeric(12,2) not null default 0,
  company_name text,
  vat_id text,
  created_at timestamptz default now()
);

create table if not exists services (
  service integer primary key,
  name text not null,
  type text default 'Default',
  category text not null,
  cost numeric(12,4) not null,          -- preț furnizor / 1k (USD sau valuta prm4u)
  rate numeric(12,4) not null,          -- preț revânzare / 1k în lei
  min integer not null,
  max integer not null,
  refill boolean default false,
  cancel boolean default false,
  active boolean default true,
  synced_at timestamptz default now()
);

create table if not exists orders (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  service integer not null,
  service_name text not null,
  link text not null,
  quantity integer not null,
  charge numeric(12,2) not null,
  status text not null default 'pending',
  provider_order_id text,
  start_count integer,
  remains integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists orders_user_idx on orders (user_id, created_at desc);
create index if not exists orders_open_idx on orders (status) where status in ('pending','processing','in progress');

create table if not exists payments (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  method text not null,
  amount numeric(12,2) not null,
  status text not null default 'pending',
  provider_ref text,
  created_at timestamptz default now()
);

create table if not exists tickets (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  order_id bigint references orders(id),
  subject text not null,
  status text default 'open',
  created_at timestamptz default now()
);

-- profil creat automat la înregistrare
create or replace function handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ── RLS: clientul citește doar ce e al lui, nu scrie niciodată sold ──
alter table profiles enable row level security;
alter table orders   enable row level security;
alter table payments enable row level security;
alter table tickets  enable row level security;
alter table services enable row level security;

drop policy if exists own_profile on profiles;
create policy own_profile on profiles for select using (auth.uid() = id);

drop policy if exists own_orders on orders;
create policy own_orders on orders for select using (auth.uid() = user_id);

drop policy if exists own_payments on payments;
create policy own_payments on payments for select using (auth.uid() = user_id);

drop policy if exists own_tickets on tickets;
create policy own_tickets on tickets for all using (auth.uid() = user_id);

drop policy if exists read_services on services;
create policy read_services on services for select using (active);

-- ── sold: mișcat doar prin funcții security definer ──
create or replace function debit_balance(p_user uuid, p_amount numeric)
returns numeric language plpgsql security definer as $$
declare new_balance numeric;
begin
  update profiles set balance = balance - p_amount
   where id = p_user and balance >= p_amount
   returning balance into new_balance;
  if new_balance is null then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;
  return new_balance;
end $$;

create or replace function credit_balance(p_user uuid, p_amount numeric)
returns numeric language plpgsql security definer as $$
declare new_balance numeric;
begin
  update profiles set balance = balance + p_amount where id = p_user
   returning balance into new_balance;
  return new_balance;
end $$;

revoke all on function debit_balance(uuid, numeric) from anon, authenticated;
revoke all on function credit_balance(uuid, numeric) from anon, authenticated;
