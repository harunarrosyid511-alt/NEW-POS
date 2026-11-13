create or replace function public.adjust_stock_on_date(
  p_product_id uuid,
  p_quantity numeric,
  p_direction text,
  p_reason text,
  p_movement_date date default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_product public.products%rowtype;
  v_delta numeric;
  v_date date := coalesce(p_movement_date, (now() at time zone 'Asia/Jakarta')::date);
  v_event_at timestamptz;
begin
  if v_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal perubahan stok tidak boleh melebihi hari ini.';
  end if;
  v_event_at := (v_date + (now() at time zone 'Asia/Jakarta')::time) at time zone 'Asia/Jakarta';
  select id into v_store from public.stores where user_id = auth.uid();
  select * into v_product from public.products
    where id = p_product_id and store_id = v_store for update;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Jumlah stok harus lebih dari nol.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Isi alasan perubahan stok.'; end if;
  if p_direction is null or p_direction not in ('tambah', 'kurangi') then
    raise exception 'Jenis perubahan stok tidak dikenal.';
  end if;
  v_delta := case when p_direction = 'tambah' then p_quantity else -p_quantity end;
  if v_product.stock_base + v_delta < 0 then raise exception 'Stok tidak cukup untuk pengurangan ini.'; end if;
  update public.products set stock_base = stock_base + v_delta, updated_at = now()
    where id = p_product_id;
  insert into public.stock_movements (
    store_id, product_id, movement_type, quantity_base, description, created_at
  ) values (v_store, p_product_id, 'penyesuaian', v_delta, p_reason, v_event_at);
  return v_product.stock_base + v_delta;
end;
$$;

create or replace function public.process_purchase_with_split_on_date(
  p_product_id uuid,
  p_quantity numeric,
  p_buy_price numeric,
  p_supplier_name text,
  p_cash_amount numeric,
  p_transfer_amount numeric,
  p_purchase_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_purchase_id uuid;
  v_date date := coalesce(p_purchase_date, (now() at time zone 'Asia/Jakarta')::date);
  v_event_at timestamptz;
begin
  if v_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal kulakan tidak boleh melebihi hari ini.';
  end if;
  v_event_at := (v_date + (now() at time zone 'Asia/Jakarta')::time) at time zone 'Asia/Jakarta';
  select id into v_store from public.stores where user_id = auth.uid();
  if v_store is null then raise exception 'Toko belum tersedia untuk akun ini.'; end if;

  v_purchase_id := public.process_purchase_with_split(
    p_product_id, p_quantity, p_buy_price, p_supplier_name, p_cash_amount, p_transfer_amount
  );
  update public.purchases set purchased_at = v_event_at
    where id = v_purchase_id and store_id = v_store;
  update public.stock_movements set created_at = v_event_at
    where store_id = v_store and reference_id = v_purchase_id and movement_type = 'kulakan';
  update public.purchase_payments set created_at = v_event_at
    where store_id = v_store and purchase_id = v_purchase_id;
  return v_purchase_id;
end;
$$;

create or replace function public.process_sale_with_split_on_date(
  p_customer_id uuid,
  p_items jsonb,
  p_discount numeric,
  p_cash_amount numeric,
  p_transfer_amount numeric,
  p_pay_old_debt boolean,
  p_transaction_date date default null
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
  v_date date := coalesce(p_transaction_date, (now() at time zone 'Asia/Jakarta')::date);
  v_event_at timestamptz;
begin
  if v_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal transaksi tidak boleh melebihi hari ini.';
  end if;
  v_event_at := (v_date + (now() at time zone 'Asia/Jakarta')::time) at time zone 'Asia/Jakarta';
  select id into v_store from public.stores where user_id = auth.uid();
  if v_store is null then raise exception 'Toko belum tersedia untuk akun ini.'; end if;

  v_result := public.process_sale_with_split(
    p_customer_id, p_items, p_discount, p_cash_amount, p_transfer_amount, p_pay_old_debt
  );
  v_sale_id := (v_result->>'sale_id')::uuid;
  update public.sales set created_at = v_event_at
    where id = v_sale_id and store_id = v_store;
  update public.stock_movements set created_at = v_event_at
    where store_id = v_store and reference_id = v_sale_id and movement_type = 'penjualan';
  update public.debts set created_at = v_event_at
    where store_id = v_store and sale_id = v_sale_id;
  update public.payments set created_at = v_event_at
    where store_id = v_store and sale_id = v_sale_id;
  update public.debt_payments dp set created_at = v_event_at
    where dp.store_id = v_store and exists (
      select 1 from public.payments p
      where p.store_id = v_store and p.sale_id = v_sale_id and p.debt_payment_id = dp.id
    );
  return v_result || jsonb_build_object('created_at', v_event_at);
end;
$$;

grant execute on function public.adjust_stock_on_date(uuid, numeric, text, text, date) to authenticated;
grant execute on function public.process_purchase_with_split_on_date(uuid, numeric, numeric, text, numeric, numeric, date) to authenticated;
grant execute on function public.process_sale_with_split_on_date(uuid, jsonb, numeric, numeric, numeric, boolean, date) to authenticated;
