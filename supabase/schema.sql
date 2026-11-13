create extension if not exists pgcrypto;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'Toko Saya',
  address text,
  phone text,
  logo_url text,
  receipt_note text default 'Terima kasih, selamat belanja kembali',
  receipt_width integer not null default 58 check (receipt_width in (58, 80)),
  default_min_stock numeric not null default 5 check (default_min_stock >= 0),
  transfer_info text,
  created_at timestamptz not null default now()
);

create or replace function public.user_owns_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stores
    where id = target_store and user_id = auth.uid()
  );
$$;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  barcode text,
  photo_url text,
  base_unit text not null default 'pcs',
  buy_price numeric(14,2) not null default 0 check (buy_price >= 0),
  sell_price numeric(14,2) not null default 0 check (sell_price >= 0),
  stock_base numeric(14,3) not null default 0 check (stock_base >= 0),
  minimum_stock numeric(14,3) not null default 5 check (minimum_stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, barcode)
);

create table public.product_units (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  conversion_factor numeric(14,3) not null check (conversion_factor > 0),
  sell_price numeric(14,2) not null check (sell_price >= 0),
  is_base boolean not null default false,
  unique (product_id, name)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  invoice_no text not null,
  customer_id uuid references public.customers(id) on delete set null,
  cashier_id uuid references auth.users(id) on delete set null,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  received_amount numeric(14,2) not null default 0,
  change_amount numeric(14,2) not null default 0,
  old_debt_paid numeric(14,2) not null default 0,
  old_debt_remaining numeric(14,2) not null default 0,
  payment_method text not null check (payment_method in ('tunai', 'transfer', 'campuran')),
  status text not null default 'lunas' check (status in ('lunas', 'hutang', 'dibatalkan')),
  created_at timestamptz not null default now(),
  canceled_at timestamptz,
  unique (store_id, invoice_no)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  conversion_factor numeric(14,3) not null default 1 check (conversion_factor > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  cost_price numeric(14,2) not null default 0,
  line_total numeric(14,2) not null check (line_total >= 0)
);

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  sale_id uuid not null unique references public.sales(id) on delete cascade,
  original_amount numeric(14,2) not null check (original_amount > 0),
  balance numeric(14,2) not null check (balance >= 0),
  status text not null default 'terbuka' check (status in ('terbuka', 'lunas', 'dibatalkan')),
  created_at timestamptz not null default now()
);

create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('tunai', 'transfer')),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  debt_payment_id uuid references public.debt_payments(id) on delete set null,
  payment_kind text not null check (payment_kind in ('penjualan', 'cicilan', 'bayar_hutang_lama', 'pengembalian')),
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('tunai', 'transfer')),
  created_at timestamptz not null default now(),
  check (sale_id is not null or debt_payment_id is not null)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text,
  total numeric(14,2) not null default 0 check (total >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0 and paid_amount <= total),
  status text not null default 'lunas' check (status in ('lunas', 'belum_lunas')),
  purchased_at timestamptz not null default now(),
  notes text
);

create table public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('tunai', 'transfer')),
  created_at timestamptz not null default now()
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  conversion_factor numeric(14,3) not null default 1 check (conversion_factor > 0),
  buy_price numeric(14,2) not null check (buy_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  movement_type text not null check (movement_type in ('penjualan', 'kulakan', 'penyesuaian', 'pembatalan')),
  quantity_base numeric(14,3) not null check (quantity_base <> 0),
  description text,
  reference_id uuid,
  created_at timestamptz not null default now()
);

create index sales_store_created_idx on public.sales (store_id, created_at desc);
create index debts_customer_fifo_idx on public.debts (customer_id, created_at);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index products_store_name_idx on public.products (store_id, name);

create or replace function public.create_store_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_store_id uuid;
begin
  insert into public.stores (user_id, name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'store_name', ''), 'Toko Saya'))
  returning id into new_store_id;
  insert into public.categories (store_id, name)
  values
    (new_store_id, 'Sembako'),
    (new_store_id, 'Minuman'),
    (new_store_id, 'Snack'),
    (new_store_id, 'Rokok'),
    (new_store_id, 'Lainnya');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_store on auth.users;
create trigger on_auth_user_created_store
  after insert on auth.users
  for each row execute function public.create_store_for_new_user();

insert into public.stores (user_id, name)
select
  id,
  coalesce(nullif(raw_user_meta_data->>'store_name', ''), 'Toko Saya')
from auth.users
on conflict (user_id) do nothing;

insert into public.categories (store_id, name)
select s.id, category.name
from public.stores s
cross join (values ('Sembako'), ('Minuman'), ('Snack'), ('Rokok'), ('Lainnya')) as category(name)
where exists (select 1 from auth.users u where u.id = s.user_id)
on conflict (store_id, name) do nothing;

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity numeric,
  p_direction text,
  p_reason text
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
begin
  select id into v_store from public.stores where user_id = auth.uid();
  select * into v_product from public.products
    where id = p_product_id and store_id = v_store for update;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Jumlah stok harus lebih dari nol.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Isi alasan perubahan stok.'; end if;
  if p_direction not in ('tambah', 'kurangi') then raise exception 'Jenis perubahan stok tidak dikenal.'; end if;
  v_delta := case when p_direction = 'tambah' then p_quantity else -p_quantity end;
  if v_product.stock_base + v_delta < 0 then raise exception 'Stok tidak cukup untuk pengurangan ini.'; end if;
  update public.products set stock_base = stock_base + v_delta, updated_at = now()
    where id = p_product_id;
  insert into public.stock_movements (
    store_id, product_id, movement_type, quantity_base, description
  ) values (v_store, p_product_id, 'penyesuaian', v_delta, p_reason);
  return v_product.stock_base + v_delta;
end;
$$;

create or replace function public.process_purchase(
  p_product_id uuid,
  p_quantity numeric,
  p_buy_price numeric,
  p_supplier_name text default null,
  p_payment_status text default 'lunas'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_product public.products%rowtype;
  v_supplier_id uuid;
  v_purchase_id uuid := gen_random_uuid();
  v_total numeric;
begin
  select id into v_store from public.stores where user_id = auth.uid();
  select * into v_product from public.products
    where id = p_product_id and store_id = v_store for update;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  if p_quantity is null or p_quantity <= 0 or p_buy_price is null or p_buy_price < 0 then
    raise exception 'Periksa jumlah dan harga kulakan.';
  end if;
  if p_payment_status not in ('lunas', 'belum_lunas') then raise exception 'Status pembayaran tidak dikenal.'; end if;
  if nullif(trim(p_supplier_name), '') is not null then
    insert into public.suppliers (store_id, name)
      values (v_store, trim(p_supplier_name))
      on conflict do nothing;
    select id into v_supplier_id from public.suppliers
      where store_id = v_store and name = trim(p_supplier_name)
      order by created_at limit 1;
  end if;
  v_total := p_quantity * p_buy_price;
  insert into public.purchases (
    id, store_id, supplier_id, supplier_name, total, paid_amount, status
  ) values (
    v_purchase_id, v_store, v_supplier_id, nullif(trim(p_supplier_name), ''),
    v_total, case when p_payment_status = 'lunas' then v_total else 0 end, p_payment_status
  );
  insert into public.purchase_items (
    store_id, purchase_id, product_id, product_name, unit_name, quantity,
    conversion_factor, buy_price, line_total
  ) values (
    v_store, v_purchase_id, v_product.id, v_product.name, v_product.base_unit,
    p_quantity, 1, p_buy_price, v_total
  );
  update public.products set
    stock_base = stock_base + p_quantity, buy_price = p_buy_price, updated_at = now()
    where id = v_product.id;
  insert into public.stock_movements (
    store_id, product_id, movement_type, quantity_base, description, reference_id
  ) values (
    v_store, v_product.id, 'kulakan', p_quantity,
    'Kulakan dari ' || coalesce(nullif(trim(p_supplier_name), ''), 'supplier'),
    v_purchase_id
  );
  return v_purchase_id;
end;
$$;

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

create or replace function public.process_sale(
  p_customer_id uuid,
  p_items jsonb,
  p_discount numeric default 0,
  p_received numeric default 0,
  p_payment_method text default 'tunai',
  p_pay_old_debt boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_sale_id uuid := gen_random_uuid();
  v_invoice text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_unit public.product_units%rowtype;
  v_quantity numeric;
  v_factor numeric;
  v_unit_name text;
  v_unit_price numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_received numeric := greatest(coalesce(p_received, 0), 0);
  v_paid_for_sale numeric;
  v_old_debt_paid numeric := 0;
  v_change numeric := 0;
  v_status text;
  v_debt record;
  v_pay numeric;
  v_debt_payment_id uuid;
  v_old_debt_remaining numeric := 0;
begin
  select id into v_store from public.stores where user_id = auth.uid();
  if v_store is null then raise exception 'Toko belum tersedia untuk akun ini.'; end if;
  if p_payment_method not in ('tunai', 'transfer') then raise exception 'Metode pembayaran tidak dikenal.'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Keranjang masih kosong.';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Keranjang masih kosong.';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and store_id = v_store
  ) then raise exception 'Pelanggan tidak ditemukan.'; end if;

  v_invoice := 'TRX-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD-HH24MISS') || '-' || upper(substr(replace(v_sale_id::text, '-', ''), 1, 5));
  insert into public.sales (
    id, store_id, invoice_no, customer_id, cashier_id, payment_method, status
  ) values (v_sale_id, v_store, v_invoice, p_customer_id, auth.uid(), p_payment_method, 'lunas');

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity <= 0 then raise exception 'Jumlah barang harus lebih dari nol.'; end if;
    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and store_id = v_store
      for update;
    if not found then raise exception 'Salah satu barang tidak ditemukan.'; end if;

    v_factor := 1;
    v_unit_name := v_product.base_unit;
    v_unit_price := v_product.sell_price;
    if nullif(v_item->>'unit_id', '') is not null then
      select * into v_unit from public.product_units
        where id = (v_item->>'unit_id')::uuid
          and product_id = v_product.id and store_id = v_store;
      if not found then raise exception 'Satuan barang tidak ditemukan.'; end if;
      v_factor := v_unit.conversion_factor;
      v_unit_name := v_unit.name;
      v_unit_price := v_unit.sell_price;
    end if;
    if v_product.stock_base < v_quantity * v_factor then
      raise exception 'Stok % tidak mencukupi.', v_product.name;
    end if;
    v_line_total := round(v_quantity * v_unit_price, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into public.sale_items (
      store_id, sale_id, product_id, product_name, unit_name,
      quantity, conversion_factor, unit_price, cost_price, line_total
    ) values (
      v_store, v_sale_id, v_product.id, v_product.name, v_unit_name,
      v_quantity, v_factor, v_unit_price, v_product.buy_price, v_line_total
    );
    update public.products
      set stock_base = stock_base - (v_quantity * v_factor), updated_at = now()
      where id = v_product.id;
    insert into public.stock_movements (
      store_id, product_id, movement_type, quantity_base, description, reference_id
    ) values (
      v_store, v_product.id, 'penjualan', -(v_quantity * v_factor), 'Penjualan ' || v_invoice, v_sale_id
    );
  end loop;

  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_subtotal then
    raise exception 'Diskon tidak boleh melebihi subtotal.';
  end if;
  v_total := v_subtotal - coalesce(p_discount, 0);
  v_paid_for_sale := least(v_received, v_total);
  v_status := case when v_paid_for_sale < v_total then 'hutang' else 'lunas' end;

  if v_status = 'hutang' and p_customer_id is null then
    raise exception 'Pilih pelanggan untuk mencatat sisa pembayaran sebagai hutang.';
  end if;
  if p_pay_old_debt and p_customer_id is null then
    raise exception 'Pilih pelanggan untuk membayar hutang lama.';
  end if;

  if v_paid_for_sale > 0 then
    insert into public.payments (store_id, sale_id, payment_kind, amount, payment_method)
    values (v_store, v_sale_id, 'penjualan', v_paid_for_sale, p_payment_method);
  end if;

  if p_pay_old_debt and v_paid_for_sale = v_total and v_received > v_total then
    for v_debt in
      select id, balance from public.debts
      where store_id = v_store and customer_id = p_customer_id
        and status = 'terbuka' and balance > 0
      order by created_at asc, id asc
      for update
    loop
      exit when v_old_debt_paid >= v_received - v_total;
      v_pay := least(v_debt.balance, v_received - v_total - v_old_debt_paid);
      if v_pay <= 0 then exit; end if;
      update public.debts
        set balance = balance - v_pay,
            status = case when balance - v_pay = 0 then 'lunas' else 'terbuka' end
        where id = v_debt.id;
      insert into public.debt_payments (store_id, debt_id, amount, payment_method)
      values (v_store, v_debt.id, v_pay, p_payment_method)
      returning id into v_debt_payment_id;
      insert into public.payments (
        store_id, sale_id, debt_payment_id, payment_kind, amount, payment_method
      ) values (v_store, v_sale_id, v_debt_payment_id, 'bayar_hutang_lama', v_pay, p_payment_method);
      v_old_debt_paid := v_old_debt_paid + v_pay;
    end loop;
  end if;

  if p_customer_id is not null then
    select coalesce(sum(balance), 0) into v_old_debt_remaining
      from public.debts
      where store_id = v_store and customer_id = p_customer_id and status = 'terbuka';
  end if;

  if v_status = 'hutang' then
    insert into public.debts (store_id, customer_id, sale_id, original_amount, balance)
    values (v_store, p_customer_id, v_sale_id, v_total - v_paid_for_sale, v_total - v_paid_for_sale);
  end if;
  v_change := greatest(v_received - v_paid_for_sale - v_old_debt_paid, 0);
  update public.sales set
    subtotal = v_subtotal, discount = coalesce(p_discount, 0), total = v_total,
    received_amount = v_received, change_amount = v_change,
    old_debt_paid = v_old_debt_paid, old_debt_remaining = v_old_debt_remaining, status = v_status
  where id = v_sale_id;
  return jsonb_build_object(
    'sale_id', v_sale_id, 'invoice_no', v_invoice, 'subtotal', v_subtotal,
    'total', v_total, 'status', v_status, 'paid_for_sale', v_paid_for_sale,
    'old_debt_paid', v_old_debt_paid, 'old_debt_remaining', v_old_debt_remaining,
    'change_amount', v_change
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
  v_old_debt_paid numeric;
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
  v_old_debt_paid := (v_result->>'old_debt_paid')::numeric;
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

create or replace function public.collect_debt(
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text default 'tunai'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_debt record;
  v_remaining numeric := p_amount;
  v_paid numeric := 0;
  v_pay numeric;
  v_payment_id uuid;
  v_balance numeric;
begin
  select id into v_store from public.stores where user_id = auth.uid();
  if v_store is null or not exists (
    select 1 from public.customers where id = p_customer_id and store_id = v_store
  ) then raise exception 'Pelanggan tidak ditemukan.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Masukkan jumlah cicilan lebih dari nol.'; end if;
  if p_payment_method not in ('tunai', 'transfer') then raise exception 'Metode pembayaran tidak dikenal.'; end if;
  select coalesce(sum(balance), 0) into v_balance from public.debts
    where store_id = v_store and customer_id = p_customer_id and status = 'terbuka';
  if v_balance = 0 then raise exception 'Pelanggan ini tidak memiliki hutang terbuka.'; end if;
  if p_amount > v_balance then raise exception 'Jumlah pembayaran melebihi total hutang pelanggan.'; end if;

  for v_debt in
    select id, balance, sale_id from public.debts
    where store_id = v_store and customer_id = p_customer_id
      and status = 'terbuka' and balance > 0
    order by created_at asc, id asc
    for update
  loop
    exit when v_remaining <= 0;
    v_pay := least(v_debt.balance, v_remaining);
    update public.debts
      set balance = balance - v_pay,
          status = case when balance - v_pay = 0 then 'lunas' else 'terbuka' end
      where id = v_debt.id;
    insert into public.debt_payments (store_id, debt_id, amount, payment_method)
    values (v_store, v_debt.id, v_pay, p_payment_method)
    returning id into v_payment_id;
    insert into public.payments (
      store_id, sale_id, debt_payment_id, payment_kind, amount, payment_method
    ) values (v_store, v_debt.sale_id, v_payment_id, 'cicilan', v_pay, p_payment_method);
    v_remaining := v_remaining - v_pay;
    v_paid := v_paid + v_pay;
  end loop;

  if v_paid = 0 then raise exception 'Pelanggan ini tidak memiliki hutang terbuka.'; end if;
  select coalesce(sum(balance), 0) into v_balance from public.debts
    where store_id = v_store and customer_id = p_customer_id and status = 'terbuka';
  return jsonb_build_object('paid', v_paid, 'remaining', v_balance);
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

create or replace function public.seed_example_products()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_count integer := 0;
  v_product uuid;
  v_category uuid;
  item record;
begin
  select id into v_store from public.stores where user_id = auth.uid();
  if v_store is null then raise exception 'Toko belum tersedia.'; end if;
  if exists (select 1 from public.products where store_id = v_store) then
    raise exception 'Contoh hanya dapat ditambahkan saat daftar barang masih kosong.';
  end if;
  for item in
    select * from (values
      ('Beras Ramos 5 kg', 'Sembako', 'karung', 68000::numeric, 75000::numeric, 15::numeric),
      ('Minyak Goreng 1 L', 'Sembako', 'botol', 16000::numeric, 19000::numeric, 24::numeric),
      ('Gula Pasir 1 kg', 'Sembako', 'kg', 15500::numeric, 18000::numeric, 18::numeric),
      ('Air Mineral 600 ml', 'Minuman', 'botol', 2500::numeric, 4000::numeric, 48::numeric),
      ('Mi Instan Goreng', 'Sembako', 'pcs', 2500::numeric, 3500::numeric, 60::numeric),
      ('Biskuit Cokelat', 'Snack', 'bungkus', 4500::numeric, 6000::numeric, 20::numeric)
    ) as products(name, category, unit_name, buy_price, sell_price, stock)
  loop
    insert into public.categories (store_id, name) values (v_store, item.category)
      on conflict (store_id, name) do update set name = excluded.name
      returning id into v_category;
    insert into public.products (
      store_id, category_id, name, base_unit, buy_price, sell_price, stock_base, minimum_stock
    ) values (
      v_store, v_category, item.name, item.unit_name, item.buy_price, item.sell_price, item.stock, 5
    ) returning id into v_product;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

alter table public.stores enable row level security;
create policy stores_owner_select on public.stores for select to authenticated using (user_id = auth.uid());
create policy stores_owner_insert on public.stores for insert to authenticated with check (user_id = auth.uid());
create policy stores_owner_update on public.stores for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'categories', 'products', 'product_units', 'customers', 'suppliers',
    'sales', 'sale_items', 'debts', 'debt_payments', 'payments',
    'purchases', 'purchase_payments', 'purchase_items', 'stock_movements'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.user_owns_store(store_id)) with check (public.user_owns_store(store_id))',
      table_name || '_store_owner', table_name
    );
  end loop;
end;
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.stores, public.categories, public.products, public.product_units,
  public.customers, public.suppliers, public.sales, public.sale_items,
  public.debts, public.debt_payments, public.payments, public.purchases,
  public.purchase_payments,
  public.purchase_items, public.stock_movements
to authenticated;

grant execute on function public.process_sale(uuid, jsonb, numeric, numeric, text, boolean) to authenticated;
grant execute on function public.process_sale_with_split(uuid, jsonb, numeric, numeric, numeric, boolean) to authenticated;
grant execute on function public.collect_debt(uuid, numeric, text) to authenticated;
grant execute on function public.collect_debt_with_split(uuid, numeric, numeric) to authenticated;
grant execute on function public.cancel_sale(uuid) to authenticated;
grant execute on function public.seed_example_products() to authenticated;
grant execute on function public.adjust_stock(uuid, numeric, text, text) to authenticated;
grant execute on function public.process_purchase(uuid, numeric, numeric, text, text) to authenticated;
grant execute on function public.process_purchase_with_split(uuid, numeric, numeric, text, numeric, numeric) to authenticated;
grant execute on function public.record_purchase_payment(uuid, numeric, numeric) to authenticated;
