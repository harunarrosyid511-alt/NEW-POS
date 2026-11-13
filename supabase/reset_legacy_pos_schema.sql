begin;

do $$
declare
  item record;
begin
  if to_regclass('auth.users') is null then
    raise exception 'Supabase Auth users table was not found.';
  end if;
  if to_regclass('public.stores') is not null then
    raise exception 'The current store schema already exists; refusing to reset it.';
  end if;
  if to_regclass('public.sales') is null
    or to_regclass('public.staff_profiles') is null then
    raise exception 'The expected legacy POS schema was not found; refusing to reset.';
  end if;

  for item in
    select t.tgname
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and n.nspname = 'public'
  loop
    execute format('drop trigger %I on auth.users', item.tgname);
  end loop;
end;
$$;

drop table if exists
  public.return_items,
  public.returns,
  public.purchase_items,
  public.sales_items,
  public.stock_movements,
  public.payments,
  public.purchases,
  public.sales,
  public.products,
  public.categories,
  public.customers,
  public.suppliers,
  public.units,
  public.settings,
  public.staff_profiles,
  public.stores,
  public.product_units,
  public.sale_items,
  public.debts,
  public.debt_payments,
  public.purchase_payments
cascade;

do $$
declare
  item record;
begin
  for item in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname = any(array[
        'user_owns_store',
        'create_store_for_new_user',
        'adjust_stock',
        'process_purchase',
        'process_purchase_with_split',
        'record_purchase_payment',
        'process_sale',
        'process_sale_with_split',
        'collect_debt',
        'collect_debt_with_split',
        'cancel_sale',
        'seed_example_products'
      ])
  loop
    execute format('drop function %s cascade', item.signature);
  end loop;
end;
$$;

commit;
