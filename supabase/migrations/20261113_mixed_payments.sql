alter table public.sales
  drop constraint if exists sales_payment_method_check;

alter table public.sales
  add constraint sales_payment_method_check
  check (payment_method in ('tunai', 'transfer', 'campuran'));

alter table public.purchases
  add column if not exists paid_amount numeric(14,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'purchases_paid_amount_check'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_paid_amount_check
      check (paid_amount >= 0 and paid_amount <= total);
  end if;
end;
$$;

update public.purchases
set paid_amount = total
where status = 'lunas' and paid_amount = 0;

create table if not exists public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('tunai', 'transfer')),
  created_at timestamptz not null default now()
);

alter table public.purchase_payments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'purchase_payments'
      and policyname = 'purchase_payments_store_owner'
  ) then
    create policy purchase_payments_store_owner on public.purchase_payments
      for all to authenticated
      using (public.user_owns_store(store_id))
      with check (public.user_owns_store(store_id));
  end if;
end;
$$;

grant select, insert, update, delete on public.purchase_payments to authenticated;

create or replace function public.set_purchase_paid_amount_from_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'lunas' then
    new.paid_amount := new.total;
  else
    new.paid_amount := least(coalesce(new.paid_amount, 0), new.total);
  end if;
  return new;
end;
$$;

drop trigger if exists purchases_sync_paid_amount on public.purchases;
create trigger purchases_sync_paid_amount
  before insert or update of total, status on public.purchases
  for each row execute function public.set_purchase_paid_amount_from_status();

create or replace function public.process_purchase_with_split(
  p_product_id uuid,
  p_quantity numeric,
  p_buy_price numeric,
  p_supplier_name text,
  p_cash_amount numeric,
  p_transfer_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_paid numeric;
  v_status text;
  v_purchase_id uuid;
  v_store uuid;
begin
  if p_quantity is null or p_quantity <= 0 or p_buy_price is null or p_buy_price < 0 then
    raise exception 'Periksa jumlah dan harga kulakan.';
  end if;
  if p_cash_amount is null or p_cash_amount < 0
    or p_transfer_amount is null or p_transfer_amount < 0 then
    raise exception 'Jumlah tunai dan transfer tidak boleh negatif.';
  end if;
  v_total := round(p_quantity * p_buy_price, 2);
  v_paid := p_cash_amount + p_transfer_amount;
  if v_paid > v_total then raise exception 'Pembayaran kulakan melebihi total.'; end if;
  v_status := case when v_paid = v_total then 'lunas' else 'belum_lunas' end;

  v_purchase_id := public.process_purchase(
    p_product_id, p_quantity, p_buy_price, p_supplier_name, v_status
  );
  select id into v_store from public.stores where user_id = auth.uid();
  update public.purchases set paid_amount = v_paid where id = v_purchase_id and store_id = v_store;
  if p_cash_amount > 0 then
    insert into public.purchase_payments (store_id, purchase_id, amount, payment_method)
    values (v_store, v_purchase_id, p_cash_amount, 'tunai');
  end if;
  if p_transfer_amount > 0 then
    insert into public.purchase_payments (store_id, purchase_id, amount, payment_method)
    values (v_store, v_purchase_id, p_transfer_amount, 'transfer');
  end if;
  return v_purchase_id;
end;
$$;

create or replace function public.record_purchase_payment(
  p_purchase_id uuid,
  p_cash_amount numeric,
  p_transfer_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_purchase public.purchases%rowtype;
  v_payment_amount numeric;
  v_paid_amount numeric;
begin
  if p_cash_amount is null or p_cash_amount < 0
    or p_transfer_amount is null or p_transfer_amount < 0
    or p_cash_amount + p_transfer_amount <= 0 then
    raise exception 'Masukkan jumlah tunai atau transfer lebih dari nol.';
  end if;
  select id into v_store from public.stores where user_id = auth.uid();
  select * into v_purchase from public.purchases
    where id = p_purchase_id and store_id = v_store for update;
  if not found then raise exception 'Catatan kulakan tidak ditemukan.'; end if;

  v_payment_amount := p_cash_amount + p_transfer_amount;
  if v_payment_amount > v_purchase.total - v_purchase.paid_amount then
    raise exception 'Pembayaran melebihi sisa hutang supplier.';
  end if;
  v_paid_amount := v_purchase.paid_amount + v_payment_amount;
  if p_cash_amount > 0 then
    insert into public.purchase_payments (store_id, purchase_id, amount, payment_method)
    values (v_store, p_purchase_id, p_cash_amount, 'tunai');
  end if;
  if p_transfer_amount > 0 then
    insert into public.purchase_payments (store_id, purchase_id, amount, payment_method)
    values (v_store, p_purchase_id, p_transfer_amount, 'transfer');
  end if;
  update public.purchases set
    paid_amount = v_paid_amount,
    status = case when v_paid_amount = total then 'lunas' else 'belum_lunas' end
  where id = p_purchase_id and store_id = v_store;
  return jsonb_build_object(
    'paid_amount', v_paid_amount, 'remaining_amount', v_purchase.total - v_paid_amount,
    'status', case when v_paid_amount = v_purchase.total then 'lunas' else 'belum_lunas' end
  );
end;
$$;

create or replace function public.process_sale_with_split(
  p_customer_id uuid,
  p_items jsonb,
  p_discount numeric,
  p_cash_amount numeric,
  p_transfer_amount numeric,
  p_pay_old_debt boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_result jsonb;
  v_sale_id uuid;
  v_paid_for_sale numeric;
  v_cash numeric := coalesce(p_cash_amount, 0);
  v_transfer numeric := coalesce(p_transfer_amount, 0);
  v_cash_sale numeric;
  v_transfer_sale numeric;
  v_cash_old_remaining numeric;
  v_transfer_old_remaining numeric;
  v_cash_part numeric;
  v_transfer_part numeric;
  v_payment record;
  v_debt_payment_id uuid;
begin
  if p_cash_amount is null or p_cash_amount < 0
    or p_transfer_amount is null or p_transfer_amount < 0 then
    raise exception 'Jumlah tunai dan transfer tidak boleh negatif.';
  end if;
  select id into v_store from public.stores where user_id = auth.uid();
  if v_store is null then raise exception 'Toko belum tersedia untuk akun ini.'; end if;

  v_result := public.process_sale(
    p_customer_id, p_items, p_discount, v_cash + v_transfer, 'tunai', p_pay_old_debt
  );
  v_sale_id := (v_result->>'sale_id')::uuid;
  v_paid_for_sale := (v_result->>'paid_for_sale')::numeric;
  v_cash_sale := least(v_cash, v_paid_for_sale);
  v_transfer_sale := v_paid_for_sale - v_cash_sale;
  v_cash_old_remaining := v_cash - v_cash_sale;
  v_transfer_old_remaining := v_transfer - v_transfer_sale;

  delete from public.payments
    where sale_id = v_sale_id and payment_kind = 'penjualan';
  if v_cash_sale > 0 then
    insert into public.payments (store_id, sale_id, payment_kind, amount, payment_method)
    values (v_store, v_sale_id, 'penjualan', v_cash_sale, 'tunai');
  end if;
  if v_transfer_sale > 0 then
    insert into public.payments (store_id, sale_id, payment_kind, amount, payment_method)
    values (v_store, v_sale_id, 'penjualan', v_transfer_sale, 'transfer');
  end if;

  for v_payment in
    select p.id as payment_id, dp.id as debt_payment_id, dp.debt_id, dp.amount
    from public.payments p
    join public.debt_payments dp on dp.id = p.debt_payment_id
    where p.sale_id = v_sale_id and p.payment_kind = 'bayar_hutang_lama'
    order by dp.created_at, dp.id
  loop
    delete from public.payments where id = v_payment.payment_id;
    delete from public.debt_payments where id = v_payment.debt_payment_id;
    v_cash_part := least(v_cash_old_remaining, v_payment.amount);
    v_transfer_part := v_payment.amount - v_cash_part;
    if v_transfer_part > v_transfer_old_remaining then
      raise exception 'Rincian pembayaran tidak sesuai dengan jumlah yang diterima.';
    end if;
    if v_cash_part > 0 then
      insert into public.debt_payments (store_id, debt_id, amount, payment_method)
      values (v_store, v_payment.debt_id, v_cash_part, 'tunai')
      returning id into v_debt_payment_id;
      insert into public.payments (
        store_id, sale_id, debt_payment_id, payment_kind, amount, payment_method
      ) values (v_store, v_sale_id, v_debt_payment_id, 'bayar_hutang_lama', v_cash_part, 'tunai');
    end if;
    if v_transfer_part > 0 then
      insert into public.debt_payments (store_id, debt_id, amount, payment_method)
      values (v_store, v_payment.debt_id, v_transfer_part, 'transfer')
      returning id into v_debt_payment_id;
      insert into public.payments (
        store_id, sale_id, debt_payment_id, payment_kind, amount, payment_method
      ) values (v_store, v_sale_id, v_debt_payment_id, 'bayar_hutang_lama', v_transfer_part, 'transfer');
    end if;
    v_cash_old_remaining := v_cash_old_remaining - v_cash_part;
    v_transfer_old_remaining := v_transfer_old_remaining - v_transfer_part;
  end loop;

  update public.sales set payment_method = case
    when v_cash_sale > 0 and v_transfer_sale > 0 then 'campuran'
    when v_transfer_sale > 0 then 'transfer'
    else 'tunai'
  end where id = v_sale_id and store_id = v_store;
  return v_result;
end;
$$;

create or replace function public.collect_debt_with_split(
  p_customer_id uuid,
  p_cash_amount numeric,
  p_transfer_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash_result jsonb;
  v_transfer_result jsonb;
  v_paid numeric := 0;
  v_remaining numeric;
begin
  if p_cash_amount is null or p_cash_amount < 0
    or p_transfer_amount is null or p_transfer_amount < 0
    or p_cash_amount + p_transfer_amount <= 0 then
    raise exception 'Masukkan jumlah tunai atau transfer lebih dari nol.';
  end if;
  if p_cash_amount > 0 then
    v_cash_result := public.collect_debt(p_customer_id, p_cash_amount, 'tunai');
    v_paid := v_paid + (v_cash_result->>'paid')::numeric;
    v_remaining := (v_cash_result->>'remaining')::numeric;
  end if;
  if p_transfer_amount > 0 then
    v_transfer_result := public.collect_debt(p_customer_id, p_transfer_amount, 'transfer');
    v_paid := v_paid + (v_transfer_result->>'paid')::numeric;
    v_remaining := (v_transfer_result->>'remaining')::numeric;
  end if;
  return jsonb_build_object('paid', v_paid, 'remaining', v_remaining);
end;
$$;

create or replace function public.cancel_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_sale public.sales%rowtype;
  v_line record;
  v_payment record;
begin
  select id into v_store from public.stores where user_id = auth.uid();
  select * into v_sale from public.sales
    where id = p_sale_id and store_id = v_store for update;
  if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
  if v_sale.status = 'dibatalkan' then raise exception 'Transaksi sudah dibatalkan.'; end if;
  if exists (
    select 1 from public.debt_payments dp join public.debts d on d.id = dp.debt_id
    where d.sale_id = p_sale_id
  ) then raise exception 'Transaksi memiliki cicilan. Selesaikan penyesuaian hutang terlebih dahulu.'; end if;
  if exists (
    select 1 from public.payments
    where sale_id = p_sale_id and payment_kind = 'bayar_hutang_lama'
  ) then raise exception 'Transaksi sudah dipakai untuk membayar hutang lama. Minta bantuan pengelola untuk membatalkannya.'; end if;
  for v_line in select product_id, quantity, conversion_factor from public.sale_items where sale_id = p_sale_id
  loop
    if v_line.product_id is not null then
      update public.products set stock_base = stock_base + (v_line.quantity * v_line.conversion_factor), updated_at = now()
        where id = v_line.product_id and store_id = v_store;
      insert into public.stock_movements (
        store_id, product_id, movement_type, quantity_base, description, reference_id
      ) values (
        v_store, v_line.product_id, 'pembatalan',
        v_line.quantity * v_line.conversion_factor, 'Pembatalan ' || v_sale.invoice_no, p_sale_id
      );
    end if;
  end loop;
  update public.debts set balance = 0, status = 'dibatalkan' where sale_id = p_sale_id;
  for v_payment in
    select amount, payment_method from public.payments
    where sale_id = p_sale_id and payment_kind = 'penjualan'
  loop
    insert into public.payments (store_id, sale_id, payment_kind, amount, payment_method)
    values (v_store, p_sale_id, 'pengembalian', v_payment.amount, v_payment.payment_method);
  end loop;
  update public.sales set status = 'dibatalkan', canceled_at = now() where id = p_sale_id;
end;
$$;

grant execute on function public.process_sale_with_split(uuid, jsonb, numeric, numeric, numeric, boolean) to authenticated;
grant execute on function public.collect_debt_with_split(uuid, numeric, numeric) to authenticated;
grant execute on function public.process_purchase_with_split(uuid, numeric, numeric, text, numeric, numeric) to authenticated;
grant execute on function public.record_purchase_payment(uuid, numeric, numeric) to authenticated;
