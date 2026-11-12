"use client";

import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { csvDownload, localDate, rupiah, tanggal } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";

type Screen = "Dashboard" | "Kasir" | "Barang" | "Piutang" | "Pelanggan" | "Laporan" | "Pengaturan";
type Unit = { id: string; name: string; conversion_factor: number; sell_price: number; is_base: boolean };
type Product = {
  id: string; name: string; category_id: string | null; category_name: string; base_unit: string;
  sell_price: number; buy_price: number; stock_base: number; minimum_stock: number;
  barcode: string | null; units: Unit[];
};
type Customer = { id: string; name: string; phone: string | null; address: string | null; notes: string | null };
type Store = {
  id: string; name: string; address: string | null; phone: string | null; receipt_note: string | null;
  receipt_width: number; default_min_stock: number; transfer_info: string | null;
};
type Sale = {
  id: string; invoice_no: string; customer_id: string | null; total: number; status: string;
  created_at: string; payment_method: string; old_debt_paid: number; old_debt_remaining: number;
  change_amount: number; received_amount: number;
};
type SaleItemRecord = {
  id: string; sale_id: string; product_id: string | null; product_name: string; unit_name: string;
  quantity: number; conversion_factor: number; unit_price: number; cost_price: number; line_total: number;
};
type CartLine = { product: Product; quantity: number; unitId: string; unitName: string; factor: number; price: number };
type Receipt = {
  invoice: string; time: string; customer: string; items: CartLine[]; subtotal: number; discount: number;
  total: number; paymentMethod: string; received: number; oldDebtPaid: number; oldDebtRemaining: number;
  change: number; status: string; isDebtPayment?: boolean; remainingCustomerDebt?: number;
};
type DebtRow = {
  id: string; customer_id: string; balance: number; original_amount: number; sale_id: string;
  status: string; created_at: string; customer?: Customer; invoice_no?: string;
};
type DebtPaymentRow = { id: string; debt_id: string; amount: number; payment_method: string; created_at: string };
type StockMovement = {
  id: string; created_at: string; quantity_base: number; movement_type: string; description: string | null;
  products: { name: string; base_unit: string } | null;
};
type PurchaseRow = {
  id: string; purchased_at: string; supplier_name: string | null; status: string; total: number;
  purchase_items: { product_name: string; quantity: number; buy_price: number }[];
};
type ExportRow = {
  created_at?: string; purchased_at?: string; name?: string; phone?: string | null; base_unit?: string;
  stock_base?: number; invoice_no?: string; status?: string; total?: number; customer_id?: string;
  balance?: number; product_id?: string; movement_type?: string; quantity_base?: number; supplier_name?: string | null;
};
type ReportPayload = {
  title: string; period: string; columns: string[]; rows: string[][]; summary: string;
};
type InstallPromptEvent = Event & { prompt: () => Promise<void> };

async function fetchAllSales(client: SupabaseClient): Promise<Sale[]> {
  const pageSize = 500;
  const rows: Sale[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("sales")
      .select("id,invoice_no,customer_id,total,status,created_at,payment_method,old_debt_paid,old_debt_remaining,change_amount,received_amount")
      .order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as Sale[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function fetchSaleItems(client: SupabaseClient, saleIds: string[]): Promise<SaleItemRecord[]> {
  const rows: SaleItemRecord[] = [];
  for (let offset = 0; offset < saleIds.length; offset += 100) {
    const { data, error } = await client.from("sale_items")
      .select("id,sale_id,product_id,product_name,unit_name,quantity,conversion_factor,unit_price,cost_price,line_total")
      .in("sale_id", saleIds.slice(offset, offset + 100));
    if (error) throw error;
    rows.push(...(data ?? []) as SaleItemRecord[]);
  }
  return rows;
}

const screens: { name: Screen; glyph: string }[] = [
  { name: "Dashboard", glyph: "D" }, { name: "Kasir", glyph: "K" }, { name: "Barang", glyph: "B" },
  { name: "Piutang", glyph: "P" }, { name: "Pelanggan", glyph: "L" }, { name: "Laporan", glyph: "R" },
  { name: "Pengaturan", glyph: "S" },
];
const categoriesFallback = ["Semua", "Sembako", "Minuman", "Snack", "Rokok", "Lainnya"];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Ada kendala. Silakan coba lagi.";
}

function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Dialog({ title, children, onClose, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    (focusable()[0] ?? dialog)?.focus();
    const manageKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); dialog?.focus(); return; }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", manageKeys);
    return () => {
      window.removeEventListener("keydown", manageKeys);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Tutup">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function AuthPanel() {
  const supabase = getSupabase();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNote("");
    setError("");
    if (!supabase) {
      setError("Sambungkan Supabase terlebih dahulu. Isi URL dan kunci publik di file .env.local.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        const { data, error: authError } = await supabase.auth.signUp({
          email, password, options: { data: { store_name: storeName.trim() || "Toko Saya" } },
        });
        if (authError) throw authError;
        if (!data.session) setNote("Akun dibuat. Periksa email untuk mengonfirmasi pendaftaran, lalu masuk.");
      } else if (mode === "forgot") {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        });
        if (authError) throw authError;
        setNote("Jika email terdaftar, tautan untuk mengatur ulang kata sandi akan dikirim.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
      }
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === "register" ? "Buat akun toko" : mode === "forgot" ? "Lupa kata sandi?" : "Selamat datang";
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">K</div>
          <div><strong>Kasir Toko</strong><span>Kelontong</span></div>
        </div>
        <p className="eyebrow">CATATAN TOKO, LEBIH RAPI</p>
        <h1>{heading}</h1>
        <p className="auth-intro">
          {mode === "login" ? "Masuk untuk mulai mencatat penjualan dan stok toko." :
            mode === "register" ? "Buat ruang kerja toko Anda. Data setiap akun disimpan terpisah." :
              "Masukkan email akun untuk menerima tautan pengaturan ulang."}
        </p>
        {!supabase && <div className="notice notice-warn">Supabase belum disambungkan. Isi .env.local mengikuti panduan di README.</div>}
        <form className="form-stack" onSubmit={submit}>
          {mode === "register" && <Field label="Nama toko">
            <input autoComplete="organization" value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="Contoh: Warung Ibu" />
          </Field>}
          <Field label="Email">
            <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nama@email.com" />
          </Field>
          {mode !== "forgot" && <Field label="Kata sandi">
            <input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sedikitnya 8 karakter" />
          </Field>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {note && <p className="form-success" role="status">{note}</p>}
          <button className="button button-primary button-full" disabled={busy}>
            {busy ? "Memproses..." : mode === "register" ? "Buat akun" : mode === "forgot" ? "Kirim tautan" : "Masuk"}
          </button>
        </form>
        <div className="auth-links">
          {mode === "login" && <button className="text-button" onClick={() => { setMode("forgot"); setError(""); setNote(""); }}>Lupa kata sandi?</button>}
          <button className="text-button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); setNote(""); }}>
            {mode === "register" ? "Sudah punya akun? Masuk" : "Belum punya akun? Daftar"}
          </button>
          {mode === "forgot" && <button className="text-button" onClick={() => { setMode("login"); setError(""); setNote(""); }}>Kembali ke halaman masuk</button>}
        </div>
      </section>
      <aside className="auth-aside">
        <div className="receipt-mark" aria-hidden="true"><i /><i /><i /><b /></div>
        <p>Mulai dari satu transaksi.</p>
        <span>Catat penjualan, cek stok, dan lihat hutang pelanggan dari satu tempat.</span>
      </aside>
    </main>
  );
}

export function KasirApp() {
  const supabase = useMemo(() => getSupabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(() => Boolean(getSupabase()));
  const [screen, setScreen] = useState<Screen>("Kasir");
  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [categories, setCategories] = useState<string[]>(categoriesFallback);
  const [sales, setSales] = useState<Sale[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItemRecord[]>([]);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [allDebts, setAllDebts] = useState<DebtRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Semua");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [discount, setDiscount] = useState(0);
  const [received, setReceived] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("tunai");
  const [payOldDebt, setPayOldDebt] = useState(false);
  const [customerDebt, setCustomerDebt] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [productDialog, setProductDialog] = useState<Product | null | "new">(null);
  const [customerDialog, setCustomerDialog] = useState<Customer | null | "new">(null);
  const [stockDialog, setStockDialog] = useState<Product | null>(null);
  const [purchaseDialog, setPurchaseDialog] = useState(false);
  const [debtDialog, setDebtDialog] = useState<Customer | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setLoadError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      setStore(null);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleInstall);
  }, []);

  const userId = session?.user?.id;
  const loadData = useCallback(async () => {
    if (!supabase || !userId) return;
    setLoading(true);
    setLoadError("");
    try {
      const { data: storeData, error: storeError } = await supabase.from("stores")
        .select("*").eq("user_id", userId).single();
      if (storeError) throw storeError;
      setStore(storeData as Store);
      const [productResult, categoryResult, unitResult, customerResult, recentSales, debtResult] = await Promise.all([
        supabase.from("products").select("*").order("name"),
        supabase.from("categories").select("*").order("name"),
        supabase.from("product_units").select("*"),
        supabase.from("customers").select("*").order("name"),
        fetchAllSales(supabase),
        supabase.from("debts").select("id,customer_id,balance,original_amount,created_at,sale_id,status,sales(invoice_no)").order("created_at", { ascending: false }),
      ]);
      for (const result of [productResult, categoryResult, unitResult, customerResult, debtResult]) {
        if (result.error) throw result.error;
      }
      const categoryRows = (categoryResult.data ?? []) as { id: string; name: string }[];
      const unitRows = (unitResult.data ?? []) as (Unit & { product_id: string })[];
      const productRows = (productResult.data ?? []) as Omit<Product, "category_name" | "units">[];
      const itemRows = await fetchSaleItems(supabase, recentSales.map((sale) => sale.id));
      setCategories(["Semua", ...categoryRows.map((row) => row.name)]);
      setProducts(productRows.map((product) => ({
        ...product,
        category_name: categoryRows.find((row) => row.id === product.category_id)?.name ?? "Lainnya",
        units: unitRows.filter((unit) => unit.product_id === product.id),
      })) as Product[]);
      setCustomers((customerResult.data ?? []) as Customer[]);
      setSales(recentSales);
      setSaleItems(itemRows);
      const customerRows = (customerResult.data ?? []) as Customer[];
      const debtRows = (debtResult.data ?? []) as (DebtRow & { sales: { invoice_no: string }[] | null })[];
      const mappedDebts = debtRows.map((debt) => ({
        ...debt,
        customer: customerRows.find((customer) => customer.id === debt.customer_id),
        invoice_no: debt.sales?.[0]?.invoice_no,
      }));
      setAllDebts(mappedDebts);
      setDebts(mappedDebts.filter((debt) => debt.status === "terbuka" && Number(debt.balance) > 0));
    } catch (error) {
      setLoadError(messageOf(error));
    } finally {
      setLoading(false);
    }
  }, [userId, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (!supabase || !customerId) return;
    supabase.from("debts").select("balance").eq("customer_id", customerId)
      .eq("status", "terbuka").gt("balance", 0)
      .then(({ data, error }) => {
        if (error) { setLoadError(error.message); return; }
        setCustomerDebt((data ?? []).reduce((sum, row) => sum + Number(row.balance), 0));
      });
  }, [customerId, supabase]);

  const subtotal = cart.reduce((sum, line) => sum + line.quantity * line.price, 0);
  const total = Math.max(0, subtotal - Math.min(Math.max(0, discount), subtotal));
  const customerName = customers.find((customer) => customer.id === customerId)?.name ?? "Umum";
  const filteredProducts = products.filter((product) => {
    const matchesText = `${product.name} ${product.barcode ?? ""}`.toLocaleLowerCase("id").includes(search.toLocaleLowerCase("id"));
    return matchesText && (category === "Semua" || product.category_name === category);
  });

  function addToCart(product: Product) {
    if (product.stock_base <= 0) { setNotice("Stok barang ini sudah habis."); return; }
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id && line.unitId === "");
      if (existing) return current.map((line) => line === existing
        ? { ...line, quantity: Math.min(line.quantity + 1, product.stock_base) } : line);
      return [...current, {
        product, quantity: 1, unitId: "", unitName: product.base_unit, factor: 1, price: product.sell_price,
      }];
    });
    setNotice("");
  }

  function updateLine(index: number, patch: Partial<CartLine>) {
    setCart((current) => current.map((line, lineIndex) => lineIndex === index
      ? { ...line, ...patch } : line));
  }

  function selectCustomer(value: string) {
    setCustomerQuery(value);
    const match = customers.find((customer) => customer.name.toLocaleLowerCase("id") === value.trim().toLocaleLowerCase("id"));
    setCustomerId(match?.id ?? "");
    if (!match) setCustomerDebt(0);
  }

  async function processPayment() {
    if (!supabase || !cart.length) return;
    if (received < total && !customerId) {
      setNotice("Pilih pelanggan untuk mencatat sisa pembayaran sebagai hutang.");
      return;
    }
    if (payOldDebt && !customerId) {
      setNotice("Pilih pelanggan terlebih dahulu untuk membayar hutang lama.");
      return;
    }
    let confirmedOldDebt = customerDebt;
    if (payOldDebt && customerId) {
      const { data: currentDebts, error: debtError } = await supabase.from("debts")
        .select("balance").eq("customer_id", customerId).eq("status", "terbuka").gt("balance", 0);
      if (debtError) { setNotice(debtError.message); return; }
      confirmedOldDebt = (currentDebts ?? []).reduce((sum, debt) => sum + Number(debt.balance), 0);
      setCustomerDebt(confirmedOldDebt);
    }
    const paidForSale = Math.min(received, total);
    const oldDebtForSale = payOldDebt && received >= total
      ? Math.min(confirmedOldDebt, Math.max(0, received - total)) : 0;
    const confirmText = [
      `Pembeli: ${customerName}`,
      `Total belanja: ${rupiah(total)}`,
      `Uang diterima: ${rupiah(received)}`,
      `Untuk belanja: ${rupiah(paidForSale)}`,
      `Bayar hutang lama: ${rupiah(oldDebtForSale)}`,
      `Sisa hutang lama: ${rupiah(Math.max(0, confirmedOldDebt - oldDebtForSale))}`,
      received < total ? `Sisa hutang belanja ini: ${rupiah(total - received)}` : `Kembalian: ${rupiah(Math.max(0, received - paidForSale - oldDebtForSale))}`,
      "Lanjutkan proses pembayaran?",
    ].join("\n");
    if (!window.confirm(confirmText)) return;
    setNotice("");
    try {
      const { data, error } = await supabase.rpc("process_sale", {
        p_customer_id: customerId || null,
        p_items: cart.map((line) => ({
          product_id: line.product.id, unit_id: line.unitId || null, quantity: line.quantity,
        })),
        p_discount: discount,
        p_received: received,
        p_payment_method: paymentMethod,
        p_pay_old_debt: payOldDebt,
      });
      if (error) throw error;
      const result = data as {
        invoice_no: string; total: number; old_debt_paid: number; old_debt_remaining: number;
        change_amount: number; status: string;
      };
      setReceipt({
        invoice: result.invoice_no, time: new Date().toISOString(), customer: customerName, items: cart,
        subtotal, discount, total: Number(result.total), paymentMethod, received,
        oldDebtPaid: Number(result.old_debt_paid),
        oldDebtRemaining: Number(result.old_debt_remaining),
        change: Number(result.change_amount), status: result.status,
      });
      setCart([]);
      setDiscount(0);
      setReceived(0);
      setPayOldDebt(false);
      setCustomerId("");
      setCustomerQuery("");
      setCartOpen(false);
      await loadData();
    } catch (error) {
      setNotice(messageOf(error));
    }
  }

  async function saveReceipt(kind: "png" | "pdf") {
    const node = document.getElementById("receipt-paper");
    if (!node || !receipt) return;
    try {
      const image = await toPng(node, { pixelRatio: 2, backgroundColor: "#fff" });
      if (kind === "png") {
        const anchor = document.createElement("a");
        anchor.download = `${receipt.invoice}.png`;
        anchor.href = image;
        anchor.click();
      } else {
        const imageElement = new Image();
        imageElement.src = image;
        await imageElement.decode();
        const paperWidth = store?.receipt_width ?? 58;
        const contentWidth = paperWidth - 4;
        const contentHeight = contentWidth * imageElement.naturalHeight / imageElement.naturalWidth;
        const pdf = new jsPDF({ unit: "mm", format: [paperWidth, contentHeight + 4] });
        pdf.addImage(image, "PNG", 2, 2, contentWidth, contentHeight);
        pdf.save(`${receipt.invoice}.pdf`);
      }
    } catch (error) {
      setNotice(`Struk belum dapat disimpan: ${messageOf(error)}`);
    }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !store) return;
    const form = new FormData(event.currentTarget);
    const categoryName = String(form.get("category") ?? "Lainnya").trim();
    try {
      const { data: categoryRow, error: categoryLookupError } = await supabase.from("categories")
        .select("id").eq("store_id", store.id).eq("name", categoryName).maybeSingle();
      if (categoryLookupError) throw categoryLookupError;
      let categoryId = categoryRow?.id as string | undefined;
      if (!categoryId) {
        const { data, error } = await supabase.from("categories").insert({ store_id: store.id, name: categoryName }).select("id").single();
        if (error) throw error;
        categoryId = data.id;
      }
      const existing = productDialog !== "new" ? productDialog : null;
      const values = {
        store_id: store.id, category_id: categoryId, name: String(form.get("name")).trim(),
        barcode: String(form.get("barcode") ?? "").trim() || null,
        base_unit: String(form.get("base_unit") || "pcs").trim(),
        buy_price: Number(form.get("buy_price")), sell_price: Number(form.get("sell_price")),
        minimum_stock: Number(form.get("minimum_stock")),
      };
      if (!values.name || Object.values(values).some((value) => typeof value === "number" && (!Number.isFinite(value) || value < 0))) {
        throw new Error("Periksa kembali nama, harga, stok, dan batas stok.");
      }
      const stock = Number(form.get("stock_base"));
      if (!existing && (!Number.isFinite(stock) || stock < 0)) throw new Error("Jumlah stok awal tidak valid.");
      const result = existing
        ? await supabase.from("products").update(values).eq("id", existing.id).select("id").single()
        : await supabase.from("products").insert({ ...values, stock_base: stock }).select("id").single();
      if (result.error) throw result.error;
      const unitName = String(form.get("extra_unit_name") ?? "").trim();
      const factor = Number(form.get("extra_unit_factor"));
      const unitPrice = Number(form.get("extra_unit_price"));
      if (unitName) {
        if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error("Isi konversi dan harga satuan tambahan dengan benar.");
        }
        const { error: unitError } = await supabase.from("product_units").upsert({
          store_id: store.id, product_id: result.data.id, name: unitName,
          conversion_factor: factor, sell_price: unitPrice,
        }, { onConflict: "product_id,name" });
        if (unitError) throw unitError;
      }
      setProductDialog(null);
      setNotice("Barang berhasil disimpan.");
      await loadData();
    } catch (error) { setNotice(messageOf(error)); }
  }

  async function removeProduct(product: Product) {
    if (!supabase || !window.confirm(`Hapus barang "${product.name}"? Data transaksi lama tetap tersimpan.`)) return;
    const { data: movement, error: movementError } = await supabase.from("stock_movements")
      .select("id").eq("product_id", product.id).limit(1).maybeSingle();
    if (movementError) { setNotice(movementError.message); return; }
    if (movement) { setNotice("Barang memiliki riwayat stok dan tidak dapat dihapus. Ubah nama atau stoknya agar catatan lama tetap utuh."); return; }
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) setNotice(error.message);
    else { setNotice("Barang dihapus."); await loadData(); }
  }

  async function adjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !stockDialog) return;
    const form = new FormData(event.currentTarget);
    const quantity = Number(form.get("quantity"));
    const direction = String(form.get("direction"));
    const reason = String(form.get("reason"));
    if (!Number.isFinite(quantity) || quantity <= 0) { setNotice("Jumlah stok harus lebih dari nol."); return; }
    try {
      const { error } = await supabase.rpc("adjust_stock", {
        p_product_id: stockDialog.id, p_quantity: quantity, p_direction: direction, p_reason: reason,
      });
      if (error) throw error;
      setStockDialog(null);
      setNotice("Stok berhasil diperbarui.");
      await loadData();
    } catch (error) { setNotice(messageOf(error)); }
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !store) return;
    const form = new FormData(event.currentTarget);
    const values = {
      store_id: store.id, name: String(form.get("name")).trim(),
      phone: String(form.get("phone") ?? "").trim() || null,
      address: String(form.get("address") ?? "").trim() || null,
      notes: String(form.get("notes") ?? "").trim() || null,
    };
    if (!values.name) { setNotice("Nama pelanggan wajib diisi."); return; }
    const existing = customerDialog !== "new" ? customerDialog : null;
    const result = existing
      ? await supabase.from("customers").update(values).eq("id", existing.id)
      : await supabase.from("customers").insert(values).select("id").single();
    if (result.error) setNotice(result.error.message);
    else {
      if (!existing && "data" in result && result.data) {
        setCustomerId(result.data.id);
        setCustomerQuery(values.name);
      }
      setCustomerDialog(null);
      setNotice("Pelanggan berhasil disimpan.");
      await loadData();
    }
  }

  async function removeCustomer(customer: Customer) {
    if (!supabase || !window.confirm(`Hapus pelanggan "${customer.name}"?`)) return;
    const [saleResult, debtResult] = await Promise.all([
      supabase.from("sales").select("id", { count: "exact", head: true }).eq("customer_id", customer.id),
      supabase.from("debts").select("id", { count: "exact", head: true }).eq("customer_id", customer.id),
    ]);
    if (saleResult.error || debtResult.error) { setNotice(saleResult.error?.message ?? debtResult.error?.message ?? "Data pelanggan tidak dapat diperiksa."); return; }
    if ((saleResult.count ?? 0) > 0 || (debtResult.count ?? 0) > 0) {
      setNotice("Pelanggan memiliki riwayat transaksi atau hutang. Riwayat tidak dihapus, ubah data kontaknya saja.");
      return;
    }
    const { error } = await supabase.from("customers").delete().eq("id", customer.id);
    if (error) setNotice(error.message);
    else { setNotice("Pelanggan dihapus."); await loadData(); }
  }

  async function takeDebtPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !debtDialog) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const method = String(form.get("method"));
    try {
      const { data, error } = await supabase.rpc("collect_debt", {
        p_customer_id: debtDialog.id, p_amount: amount, p_payment_method: method,
      });
      if (error) throw error;
      const payment = data as { paid: number; remaining: number };
      setReceipt({
        invoice: `CICILAN-${Date.now()}`, time: new Date().toISOString(), customer: debtDialog.name,
        items: [], subtotal: Number(payment.paid), discount: 0, total: Number(payment.paid),
        paymentMethod: method, received: Number(payment.paid), oldDebtPaid: 0, oldDebtRemaining: 0,
        change: 0, status: "lunas", isDebtPayment: true, remainingCustomerDebt: Number(payment.remaining),
      });
      setDebtDialog(null);
      setNotice("Pembayaran cicilan berhasil dicatat. Simpan atau cetak bukti pembayarannya.");
      await loadData();
    } catch (error) { setNotice(messageOf(error)); }
  }

  async function createPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const product = products.find((item) => item.id === String(form.get("product")));
    const quantity = Number(form.get("quantity"));
    const price = Number(form.get("buy_price"));
    const supplierName = String(form.get("supplier") ?? "").trim();
    if (!product || quantity <= 0 || price < 0) { setNotice("Periksa produk, jumlah, dan harga kulakan."); return; }
    try {
      const { error } = await supabase.rpc("process_purchase", {
        p_product_id: product.id,
        p_quantity: quantity,
        p_buy_price: price,
        p_supplier_name: supplierName || null,
        p_payment_status: String(form.get("status")),
      });
      if (error) throw error;
      setPurchaseDialog(false);
      setNotice("Kulakan tersimpan dan stok bertambah.");
      await loadData();
    } catch (error) { setNotice(messageOf(error)); }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !store) return;
    const form = new FormData(event.currentTarget);
    const values = {
      name: String(form.get("name")).trim(), address: String(form.get("address") ?? "").trim() || null,
      phone: String(form.get("phone") ?? "").trim() || null,
      receipt_note: String(form.get("receipt_note") ?? "").trim() || null,
      receipt_width: Number(form.get("receipt_width")), default_min_stock: Number(form.get("default_min_stock")),
      transfer_info: String(form.get("transfer_info") ?? "").trim() || null,
    };
    const { error } = await supabase.from("stores").update(values).eq("id", store.id);
    if (error) setNotice(error.message);
    else { setNotice("Pengaturan toko tersimpan."); await loadData(); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const { error } = await supabase.auth.updateUser({ password });
    setNotice(error ? error.message : "Kata sandi berhasil diganti.");
    if (!error) event.currentTarget.reset();
  }

  async function signOut() {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) setNotice(error.message);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  async function exportReport(report: ReportPayload) {
    if (!supabase || !store) return;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    pdf.setFontSize(18);
    pdf.text(store.name, 16, 20);
    pdf.setFontSize(10);
    pdf.text([store.address ?? "", store.phone ?? ""].filter(Boolean).join(" | "), 16, 27);
    pdf.setFontSize(13);
    pdf.text(report.title, 16, 40);
    pdf.setFontSize(10);
    pdf.text(`Periode: ${report.period}`, 16, 47);
    pdf.text(`Dicetak: ${tanggal(new Date())}`, 16, 53);
    let y = 65;
    const columnWidth = 178 / Math.max(report.columns.length, 1);
    report.columns.forEach((column, index) => pdf.text(column.slice(0, 24), 16 + index * columnWidth, y));
    y += 8;
    for (const row of report.rows) {
      if (y > 275) { pdf.addPage(); y = 18; }
      row.forEach((value, index) => {
        const lines = pdf.splitTextToSize(value, columnWidth - 3);
        pdf.text(lines.slice(0, 2), 16 + index * columnWidth, y);
      });
      y += 10;
    }
    pdf.setFontSize(11);
    pdf.text(report.summary, 16, Math.min(y + 5, 283));
    pdf.save(`laporan-${report.title.toLocaleLowerCase("id").replaceAll(" ", "-")}.pdf`);
  }

  const visibleSales = sales.filter((sale) => sale.status !== "dibatalkan");
  const todaySales = visibleSales.filter((sale) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(sale.created_at)) === localDate());
  const todayTotal = todaySales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const totalDebt = debts.reduce((sum, debt) => sum + Number(debt.balance), 0);
  const todaySaleIds = new Set(todaySales.map((sale) => sale.id));
  const todayProfit = saleItems.filter((item) => todaySaleIds.has(item.sale_id))
    .reduce((sum, item) => sum + Number(item.line_total) - Number(item.quantity) * Number(item.conversion_factor) * Number(item.cost_price), 0);
  const lowStock = products.filter((product) => product.stock_base <= product.minimum_stock);
  const helpSteps: Record<Screen, string[]> = {
    Dashboard: ["Lihat ringkasan penjualan hari ini, jumlah transaksi, piutang, dan stok menipis.", "Grafik merangkum penjualan yang sudah tersimpan pada beberapa hari terakhir.", "Pilih menu di samping untuk membuka kasir, barang, pelanggan, piutang, laporan, atau pengaturan."],
    Kasir: ["Cari barang atau pilih kategori, lalu tekan Tambah untuk memasukkannya ke keranjang.", "Pilih pelanggan jika ingin menyimpan nama pembeli atau mencatat pembayaran yang belum lunas.", "Isi uang diterima dan metode bayar, lalu tekan Proses Pembayaran. Stok akan berkurang otomatis."],
    Barang: ["Tekan Tambah Barang untuk mencatat nama, kategori, harga, stok, dan satuan dasar.", "Gunakan tombol stok untuk koreksi dengan alasan. Perubahan tercatat di tab Riwayat Stok.", "Gunakan Kulakan untuk menambah stok dari supplier. Periksa jumlah dan harga sebelum menyimpan."],
    Piutang: ["Daftar ini hanya menampilkan hutang yang belum lunas, diurutkan dari tanggal tertua.", "Pilih Bayar/Cicil, masukkan nominal, lalu pilih tunai atau transfer.", "Pembayaran dipotong dari hutang terlama terlebih dahulu. Gunakan tombol WhatsApp untuk mengirim pengingat."],
    Pelanggan: ["Tekan Tambah Pelanggan lalu isi nama dan kontak yang tersedia.", "Gunakan kolom cari untuk menemukan pelanggan dari nama atau nomor HP.", "Data pelanggan membantu memilih nama pembeli di kasir dan mencatat hutang."],
    Laporan: ["Atur tanggal awal dan akhir untuk membatasi transaksi yang ditampilkan.", "Periksa jumlah transaksi dan total penjualan di tabel.", "Tekan Unduh PDF untuk menyimpan ringkasan penjualan pada rentang tanggal tersebut."],
    Pengaturan: ["Isi nama, alamat, dan nomor toko yang ingin dicetak pada struk.", "Pilih ukuran kertas dan batas stok yang biasa digunakan.", "Simpan perubahan. Gunakan Ekspor CSV untuk mengunduh salinan data toko."],
  };

  if (authLoading) return <main className="loading-page"><span className="loader" />Memeriksa akun...</main>;
  if (!session) return <AuthPanel />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand-lockup brand-home" onClick={() => setScreen("Kasir")}>
          <div className="brand-mark" aria-hidden="true">K</div>
          <div><strong>Kasir Toko</strong><span>Kelontong</span></div>
        </button>
        <div className="store-label"><span>TOKO AKTIF</span><strong>{store?.name ?? "Memuat toko..."}</strong></div>
        <nav className="side-nav" aria-label="Menu utama">
          {screens.map((item) => <button key={item.name} className={`nav-item ${screen === item.name ? "active" : ""}`} onClick={() => setScreen(item.name)}>
            <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>{item.name}
          </button>)}
        </nav>
        <div className="sidebar-bottom">
          {installPrompt && <button className="nav-item" onClick={installApp}><span className="nav-glyph">+</span>Pasang aplikasi</button>}
          <button className="nav-item" onClick={signOut}><span className="nav-glyph">↪</span>Keluar</button>
          <span className="account-email">{session.user.email}</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-heading">
            <p className="eyebrow">{new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" }).format(new Date())}</p>
            <h1>{screen === "Kasir" ? "Kasir" : screen}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`network-indicator ${typeof navigator !== "undefined" && !navigator.onLine ? "offline" : ""}`}>
              {typeof navigator !== "undefined" && !navigator.onLine ? "Offline" : "Tersambung"}
            </span>
            <button className="avatar-button" onClick={() => setScreen("Pengaturan")} aria-label="Buka pengaturan akun">
              {(session.user.email?.[0] ?? "T").toUpperCase()}
            </button>
          </div>
        </header>

        {(notice || loadError) && <div className={`notice ${loadError ? "notice-error" : "notice-info"}`} role={loadError ? "alert" : "status"}>
          <span>{loadError || notice}</span>
          <button className="notice-close" onClick={() => { setNotice(""); setLoadError(""); }} aria-label="Tutup pemberitahuan">×</button>
        </div>}
        {loading && <div className="loading-line"><span className="loader" />Memuat data toko...</div>}

        {screen === "Kasir" && <section className="pos-layout">
          <div className="product-area">
            <div className="search-row">
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama barang atau barcode..." aria-label="Cari nama barang atau barcode" />
                <kbd>/</kbd>
              </label>
              <button className="button button-quiet" onClick={() => { setSearch(""); setCategory("Semua"); }}>Atur ulang</button>
            </div>
            <div className="category-row" aria-label="Filter kategori">
              {categories.map((name) => <button key={name} className={`category-chip ${category === name ? "selected" : ""}`} onClick={() => setCategory(name)}>{name}</button>)}
            </div>
            <div className="section-heading">
              <div><h2>Pilih barang</h2><p>{filteredProducts.length} barang tersedia</p></div>
              <button className="text-button" onClick={() => setScreen("Barang")}>Kelola barang</button>
            </div>
            {!products.length && !loading ? <EmptyState title="Belum ada barang" description="Tambahkan barang sendiri atau isi daftar dengan contoh produk." action={<><button className="button button-primary" onClick={() => setProductDialog("new")}>Tambah barang</button><button className="button button-quiet" onClick={async () => {
              if (!supabase) return;
              const { error } = await supabase.rpc("seed_example_products");
              if (error) setNotice(error.message);
              else { setNotice("Contoh barang berhasil ditambahkan."); await loadData(); }
            }}>Isi contoh barang</button></>} /> : null}
            {products.length > 0 && filteredProducts.length === 0 && <EmptyState title="Barang tidak ditemukan" description="Coba kata pencarian lain atau pilih kategori Semua." action={<button className="button button-quiet" onClick={() => { setSearch(""); setCategory("Semua"); }}>Tampilkan semua barang</button>} />}
            <div className="product-grid">
              {filteredProducts.map((product) => <article className="product-card" key={product.id}>
                <div className={`product-stamp ${product.stock_base <= product.minimum_stock ? "stamp-low" : ""}`} aria-hidden="true">
                  {product.name.trim().slice(0, 1).toLocaleUpperCase("id")}
                </div>
                <div className="product-card-body">
                  <span className="product-category">{product.category_name}</span>
                  <h3>{product.name}</h3>
                  <strong className="product-price">{rupiah(product.sell_price)}</strong>
                  <span className={`stock-caption ${product.stock_base <= product.minimum_stock ? "text-danger" : ""}`}>
                    Stok {product.stock_base} {product.base_unit}
                  </span>
                  <button className="button button-add" disabled={product.stock_base <= 0} onClick={() => addToCart(product)}>
                    {product.stock_base <= 0 ? "Stok habis" : "Tambah"}
                  </button>
                </div>
              </article>)}
            </div>
          </div>

          <aside className={`cart-panel ${cartOpen ? "cart-panel-open" : ""}`}>
            <div className="cart-heading"><div><h2>Keranjang</h2><p>{cart.length} jenis barang</p></div><button className="icon-button mobile-only" onClick={() => setCartOpen(false)} aria-label="Tutup keranjang">×</button></div>
            <Field label="Nama pembeli">
              <input list="customer-list" value={customerQuery} onChange={(event) => selectCustomer(event.target.value)} placeholder="Pilih pelanggan atau Umum" />
              <datalist id="customer-list">{customers.map((customer) => <option key={customer.id} value={customer.name} />)}</datalist>
            </Field>
            {!customerId && <button className="text-button quick-customer" onClick={() => setCustomerDialog("new")}>+ Tambah pelanggan baru</button>}
            {customerId && customerDebt > 0 && <div className="notice notice-warn debt-warning">
              <span>{customerName} masih punya hutang {rupiah(customerDebt)}.</span>
              <label className="checkbox-row"><input type="checkbox" checked={payOldDebt} onChange={(event) => setPayOldDebt(event.target.checked)} />Bayar hutang lama sekalian</label>
            </div>}
            <div className="cart-lines">
              {cart.length === 0 && <div className="cart-empty"><span className="basket-mark" aria-hidden="true">+</span><strong>Keranjang masih kosong</strong><span>Pilih barang untuk mulai mencatat.</span></div>}
              {cart.map((line, index) => <div className="cart-line" key={`${line.product.id}-${line.unitId}`}>
                <div className="cart-line-info"><strong>{line.product.name}</strong><span>{rupiah(line.price)} / {line.unitName}</span></div>
                <div className="cart-line-tools">
                  {line.product.units.length > 0 && <select aria-label={`Satuan ${line.product.name}`} value={line.unitId} onChange={(event) => {
                    const unit = line.product.units.find((item) => item.id === event.target.value);
                    updateLine(index, { unitId: unit?.id ?? "", unitName: unit?.name ?? line.product.base_unit, factor: unit?.conversion_factor ?? 1, price: Number(unit?.sell_price ?? line.product.sell_price) });
                  }}>
                    <option value="">/{line.product.base_unit}</option>
                    {line.product.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                  </select>}
                  <div className="quantity-control">
                    <button aria-label={`Kurangi ${line.product.name}`} onClick={() => line.quantity <= 1
                      ? setCart((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      : updateLine(index, { quantity: line.quantity - 1 })}>−</button>
                    <span>{line.quantity}</span>
                    <button aria-label={`Tambah ${line.product.name}`} onClick={() => updateLine(index, { quantity: line.quantity + 1 })}>+</button>
                  </div>
                </div>
                <strong className="cart-line-total">{rupiah(line.quantity * line.price)}</strong>
              </div>)}
            </div>
            <div className="cart-summary">
              <label className="summary-input"><span>Subtotal</span><strong>{rupiah(subtotal)}</strong></label>
              <label className="summary-input"><span>Diskon (Rp)</span><input type="number" min="0" max={subtotal} value={discount || ""} onChange={(event) => setDiscount(Number(event.target.value))} placeholder="0" /></label>
              <div className="summary-total"><span>Total belanja</span><strong>{rupiah(total)}</strong></div>
              <div className="payment-options" role="group" aria-label="Metode pembayaran">
                {["tunai", "transfer"].map((method) => <button key={method} className={`payment-option ${paymentMethod === method ? "chosen" : ""}`} onClick={() => setPaymentMethod(method)}>
                  <span aria-hidden="true">{method === "tunai" ? "Rp" : "TF"}</span>{method === "tunai" ? "Tunai" : "Transfer"}
                </button>)}
              </div>
              {paymentMethod === "transfer" && store?.transfer_info && <p className="transfer-note">{store.transfer_info}</p>}
              <Field label="Uang diterima">
                <input type="number" min="0" inputMode="numeric" value={received || ""} onChange={(event) => setReceived(Number(event.target.value))} placeholder={rupiah(total)} />
              </Field>
              <div className="quick-cash">
                {[total, 20000, 50000, 100000].filter((amount, index, list) => amount > 0 && list.indexOf(amount) === index).map((amount) =>
                  <button key={amount} onClick={() => setReceived(amount)}>{amount === total ? "Uang pas" : `${amount / 1000}rb`}</button>)}
              </div>
              <div className="change-row"><span>{received < total ? "Sisa dibayar" : payOldDebt ? "Kembalian" : "Kembalian"}</span><strong>{rupiah(Math.max(0, received - total - (payOldDebt ? customerDebt : 0)))}</strong></div>
              {received < total && <p className="form-hint">Kurang {rupiah(total - received)}. Pilih pelanggan untuk mencatat hutang.</p>}
              {payOldDebt && customerDebt > 0 && <p className="form-hint">Pembayaran hutang lama memakai kelebihan uang setelah belanja dibayar.</p>}
              <button className="button button-primary button-full process-button" disabled={!cart.length || loading} onClick={processPayment}>Proses Pembayaran</button>
            </div>
          </aside>
        </section>}

        {screen === "Dashboard" && <DashboardScreen todayTotal={todayTotal} todayCount={todaySales.length} todayProfit={todayProfit} totalDebt={totalDebt} lowStock={lowStock} sales={visibleSales} products={products} saleItems={saleItems} customers={customers} onNavigate={setScreen} />}
        {screen === "Barang" && <ProductsScreen products={products} categories={categories.filter((name) => name !== "Semua")} onAdd={() => setProductDialog("new")} onEdit={setProductDialog} onRemove={removeProduct} onStock={setStockDialog} onPurchase={() => setPurchaseDialog(true)} supabase={supabase} storeId={store?.id ?? ""} loading={loading} />}
        {screen === "Piutang" && <DebtScreen debts={debts} allDebts={allDebts} storeName={store?.name ?? "Toko"} supabase={supabase} onPay={setDebtDialog} />}
        {screen === "Pelanggan" && <CustomersScreen customers={customers} debts={debts} sales={sales} onAdd={() => setCustomerDialog("new")} onEdit={setCustomerDialog} onRemove={removeCustomer} />}
        {screen === "Laporan" && <ReportsScreen sales={sales} saleItems={saleItems} products={products} debts={debts} supabase={supabase} onDownload={exportReport} onReceipt={async (sale) => {
          if (!supabase) return;
          const [{ data: items, error: itemError }, { data: customer, error: customerError }] = await Promise.all([
            supabase.from("sale_items").select("*").eq("sale_id", sale.id),
            sale.customer_id ? supabase.from("customers").select("name").eq("id", sale.customer_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
          ]);
          if (itemError || customerError) { setNotice(itemError?.message ?? customerError?.message ?? "Struk tidak dapat dimuat."); return; }
          const saleItems = items ?? [];
          const lines: CartLine[] = saleItems.map((item) => ({
            product: {
              id: item.product_id ?? item.id, name: item.product_name, category_id: null, category_name: "",
              base_unit: item.unit_name, sell_price: Number(item.unit_price), buy_price: Number(item.cost_price),
              stock_base: 0, minimum_stock: 0, barcode: null, units: [],
            },
            quantity: Number(item.quantity), unitId: "", unitName: item.unit_name,
            factor: Number(item.conversion_factor), price: Number(item.unit_price),
          }));
          const subtotalValue = saleItems.reduce((sum, item) => sum + Number(item.line_total), 0);
          setReceipt({
            invoice: sale.invoice_no, time: sale.created_at, customer: customer?.name ?? "Umum", items: lines,
            subtotal: subtotalValue, discount: subtotalValue - Number(sale.total), total: Number(sale.total),
            paymentMethod: sale.payment_method, received: Number(sale.received_amount ?? 0),
            oldDebtPaid: Number(sale.old_debt_paid), oldDebtRemaining: Number(sale.old_debt_remaining),
            change: Number(sale.change_amount), status: sale.status,
          });
        }} onCancel={async (sale) => {
          if (!supabase || !window.confirm(`Batalkan transaksi ${sale.invoice_no}? Stok barang akan dikembalikan.`)) return;
          const { error } = await supabase.rpc("cancel_sale", { p_sale_id: sale.id });
          if (error) setNotice(error.message);
          else { setNotice("Transaksi dibatalkan dan stok dikembalikan."); await loadData(); }
        }} />}
        {screen === "Pengaturan" && store && <SettingsScreen store={store} products={products} customers={customers} sales={sales} onSave={saveSettings} onChangePassword={changePassword} supabase={supabase} onNotice={setNotice} />}
      </main>

      <nav className="bottom-nav" aria-label="Navigasi bawah">
        {screens.slice(0, 5).map((item) => <button key={item.name} className={screen === item.name ? "active" : ""} onClick={() => setScreen(item.name)}>
          <span className="nav-glyph" aria-hidden="true">{item.glyph}</span><span>{item.name}</span>
        </button>)}
      </nav>
      {screen === "Kasir" && cart.length > 0 && <button className="floating-cart" onClick={() => setCartOpen(true)}>
        Lihat keranjang ({cart.reduce((sum, line) => sum + line.quantity, 0)}) <strong>{rupiah(total)}</strong>
      </button>}
      <button className="help-button" onClick={() => setHelpOpen(true)} aria-label="Info dan bantuan">i</button>

      {helpOpen && <Dialog title={`Panduan ${screen}`} onClose={() => setHelpOpen(false)}>
        <ol className="help-list">{helpSteps[screen].map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol>
        <button className="button button-primary button-full" onClick={() => setHelpOpen(false)}>Saya mengerti</button>
      </Dialog>}

      {productDialog && <Dialog title={productDialog === "new" ? "Tambah barang" : "Ubah barang"} onClose={() => setProductDialog(null)}>
        <form className="form-stack" onSubmit={saveProduct}>
          <Field label="Nama barang"><input name="name" required defaultValue={productDialog === "new" ? "" : productDialog.name} placeholder="Contoh: Mi instan" /></Field>
          <Field label="Kategori"><input name="category" list="category-options" defaultValue={productDialog === "new" ? "" : productDialog.category_name} placeholder="Pilih atau ketik kategori" required /><datalist id="category-options">{categories.filter((item) => item !== "Semua").map((item) => <option key={item}>{item}</option>)}</datalist></Field>
          <Field label="Barcode (opsional)"><input name="barcode" defaultValue={productDialog === "new" ? "" : productDialog.barcode ?? ""} /></Field>
          <div className="form-grid-two">
            <Field label="Satuan dasar"><input name="base_unit" required defaultValue={productDialog === "new" ? "pcs" : productDialog.base_unit} placeholder="pcs, kg, botol" /></Field>
            <Field label="Batas stok menipis"><input name="minimum_stock" type="number" min="0" step="0.001" required defaultValue={productDialog === "new" ? store?.default_min_stock ?? 5 : productDialog.minimum_stock} /></Field>
            <Field label="Harga beli"><input name="buy_price" type="number" min="0" required defaultValue={productDialog === "new" ? "" : productDialog.buy_price} /></Field>
            <Field label="Harga jual"><input name="sell_price" type="number" min="0" required defaultValue={productDialog === "new" ? "" : productDialog.sell_price} /></Field>
            {productDialog === "new"
              ? <Field label="Stok awal"><input name="stock_base" type="number" min="0" step="0.001" required defaultValue={0} /></Field>
              : <p className="form-hint">Stok saat ini: {productDialog.stock_base} {productDialog.base_unit}. Gunakan tombol Ubah stok agar perubahannya tercatat.</p>}
            <Field label="Nama satuan tambahan (opsional)"><input name="extra_unit_name" defaultValue={productDialog === "new" ? "" : productDialog.units[0]?.name ?? ""} placeholder="Contoh: dus" /></Field>
            <Field label="Isi satuan tambahan dalam satuan dasar"><input name="extra_unit_factor" type="number" min="0.001" step="0.001" defaultValue={productDialog === "new" ? "" : productDialog.units[0]?.conversion_factor ?? ""} placeholder="Contoh: 40 pcs" /></Field>
            <Field label="Harga jual satuan tambahan"><input name="extra_unit_price" type="number" min="0" defaultValue={productDialog === "new" ? "" : productDialog.units[0]?.sell_price ?? ""} placeholder="Harga per dus" /></Field>
          </div>
          <p className="form-hint">Stok disimpan memakai satuan dasar. Isi satuan tambahan, jumlah satuan dasar, dan harga untuk menjual dalam kemasan lebih besar.</p>
          <button className="button button-primary button-full">Simpan barang</button>
        </form>
      </Dialog>}

      {stockDialog && <Dialog title={`Ubah stok: ${stockDialog.name}`} onClose={() => setStockDialog(null)}>
        <form className="form-stack" onSubmit={adjustStock}>
          <Field label="Perubahan"><select name="direction"><option value="tambah">Tambah stok</option><option value="kurangi">Kurangi stok</option></select></Field>
          <Field label={`Jumlah (${stockDialog.base_unit})`}><input name="quantity" type="number" min="0.001" step="0.001" required /></Field>
          <Field label="Alasan"><select name="reason"><option value="stok masuk">Stok masuk</option><option value="rusak">Rusak</option><option value="kadaluarsa">Kadaluarsa</option><option value="hilang">Hilang</option><option value="koreksi hitungan">Koreksi hitungan</option></select></Field>
          <p className="form-hint">Stok sekarang: {stockDialog.stock_base} {stockDialog.base_unit}.</p>
          <button className="button button-primary button-full">Simpan perubahan stok</button>
        </form>
      </Dialog>}

      {customerDialog && <Dialog title={customerDialog === "new" ? "Tambah pelanggan" : "Ubah pelanggan"} onClose={() => setCustomerDialog(null)}>
        <form className="form-stack" onSubmit={saveCustomer}>
          <Field label="Nama pelanggan"><input name="name" required defaultValue={customerDialog === "new" ? "" : customerDialog.name} /></Field>
          <Field label="Nomor HP"><input name="phone" inputMode="tel" defaultValue={customerDialog === "new" ? "" : customerDialog.phone ?? ""} /></Field>
          <Field label="Alamat"><input name="address" defaultValue={customerDialog === "new" ? "" : customerDialog.address ?? ""} /></Field>
          <Field label="Catatan"><textarea name="notes" rows={3} defaultValue={customerDialog === "new" ? "" : customerDialog.notes ?? ""} /></Field>
          <button className="button button-primary button-full">Simpan pelanggan</button>
        </form>
      </Dialog>}

      {purchaseDialog && <Dialog title="Catat kulakan" onClose={() => setPurchaseDialog(false)}>
        <form className="form-stack" onSubmit={createPurchase}>
          <Field label="Supplier"><input name="supplier" placeholder="Nama supplier (opsional)" /></Field>
          <Field label="Barang"><select name="product" required defaultValue=""><option value="" disabled>Pilih barang</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
          <Field label="Jumlah satuan dasar"><input name="quantity" type="number" min="0.001" step="0.001" required /></Field>
          <Field label="Harga beli per satuan dasar"><input name="buy_price" type="number" min="0" required /></Field>
          <Field label="Status pembayaran"><select name="status"><option value="lunas">Lunas</option><option value="belum_lunas">Belum lunas</option></select></Field>
          <p className="form-hint">Simpan kulakan akan menambah stok barang yang dipilih.</p>
          <button className="button button-primary button-full">Simpan kulakan</button>
        </form>
      </Dialog>}

      {debtDialog && <Dialog title={`Pembayaran ${debtDialog.name}`} onClose={() => setDebtDialog(null)}>
        <form className="form-stack" onSubmit={takeDebtPayment}>
          <p className="debt-total">Total hutang aktif <strong>{rupiah(debts.filter((debt) => debt.customer_id === debtDialog.id).reduce((sum, debt) => sum + Number(debt.balance), 0))}</strong></p>
          <Field label="Jumlah cicilan"><input name="amount" type="number" min="1" required /></Field>
          <Field label="Metode pembayaran"><select name="method"><option value="tunai">Tunai</option><option value="transfer">Transfer</option></select></Field>
          <p className="form-hint">Pembayaran akan mengurangi hutang yang paling lama terlebih dahulu.</p>
          <button className="button button-primary button-full">Simpan pembayaran</button>
        </form>
      </Dialog>}

      {receipt && <Dialog title="Transaksi berhasil" onClose={() => setReceipt(null)} wide>
        <div className="receipt-actions">
          <button className="button button-quiet" onClick={() => void saveReceipt("png")}>Simpan gambar</button>
          <button className="button button-quiet" onClick={() => void saveReceipt("pdf")}>Simpan PDF</button>
          <button className="button button-quiet" onClick={() => window.print()}>Cetak</button>
          <button className="button button-quiet" onClick={() => {
            const text = `${store?.name ?? "Toko"}%0A${receipt.invoice}%0ATotal: ${encodeURIComponent(rupiah(receipt.total))}%0AStatus: ${receipt.status.toUpperCase()}`;
            window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
          }}>WhatsApp</button>
        </div>
        <div className="receipt-paper" id="receipt-paper" style={{ width: `${store?.receipt_width ?? 58}mm` }}>
          <h2>{store?.name ?? "Toko Saya"}</h2>
          {store?.address && <p>{store.address}</p>}{store?.phone && <p>{store.phone}</p>}
          <div className="receipt-divider" />
          <p>No. {receipt.invoice}</p><p>{tanggal(receipt.time)}</p><p>Kasir: {session.user.email}</p><p>Pembeli: {receipt.customer}</p>
          <div className="receipt-divider" />
          {receipt.items.map((line, index) => <div className="receipt-item" key={`${line.product.id}-${index}`}>
            <span>{line.product.name}</span><span>{line.quantity} {line.unitName} × {rupiah(line.price)}</span><strong>{rupiah(line.quantity * line.price)}</strong>
          </div>)}
          <div className="receipt-divider" />
          {receipt.isDebtPayment ? <>
            <div className="receipt-row receipt-strong"><span>Jumlah cicilan</span><span>{rupiah(receipt.total)}</span></div>
            <div className="receipt-row"><span>Metode bayar</span><span>{receipt.paymentMethod}</span></div>
            <div className="receipt-row"><span>Sisa seluruh hutang</span><span>{rupiah(receipt.remainingCustomerDebt)}</span></div>
            <div className="receipt-status paid">BUKTI CICILAN</div>
          </> : <>
            <div className="receipt-row"><span>Subtotal</span><span>{rupiah(receipt.subtotal)}</span></div>
            {receipt.discount > 0 && <div className="receipt-row"><span>Diskon</span><span>-{rupiah(receipt.discount)}</span></div>}
            <div className="receipt-row receipt-strong"><span>Total</span><span>{rupiah(receipt.total)}</span></div>
            <div className="receipt-row"><span>Uang diterima</span><span>{rupiah(receipt.received)}</span></div>
            <div className="receipt-row"><span>Untuk belanja ({receipt.paymentMethod})</span><span>{rupiah(Math.min(receipt.total, receipt.received))}</span></div>
            {receipt.paymentMethod === "transfer" && store?.transfer_info && <div className="receipt-row"><span>Rekening</span><span>{store.transfer_info}</span></div>}
            {receipt.oldDebtPaid > 0 && <><div className="receipt-row"><span>Bayar hutang lama</span><span>{rupiah(receipt.oldDebtPaid)}</span></div><div className="receipt-row"><span>Sisa hutang lama</span><span>{rupiah(receipt.oldDebtRemaining)}</span></div></>}
            {receipt.status === "hutang" && <div className="receipt-row"><span>Sisa hutang transaksi ini</span><span>{rupiah(receipt.total - Math.min(receipt.total, receipt.received))}</span></div>}
            <div className="receipt-row"><span>Kembalian</span><span>{rupiah(receipt.change)}</span></div>
            <div className={`receipt-status ${receipt.status === "lunas" ? "paid" : "unpaid"}`}>{receipt.status.toUpperCase()}</div>
          </>}
          <p className="receipt-footer">{store?.receipt_note ?? "Terima kasih, selamat belanja kembali"}</p>
        </div>
      </Dialog>}
    </div>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark" aria-hidden="true">K</div><h2>{title}</h2><p>{description}</p>{action && <div className="empty-actions">{action}</div>}</div>;
}

function DashboardScreen({ todayTotal, todayCount, todayProfit, totalDebt, lowStock, sales, products, saleItems, customers, onNavigate }: {
  todayTotal: number; todayCount: number; todayProfit: number; totalDebt: number; lowStock: Product[]; sales: Sale[];
  products: Product[]; saleItems: SaleItemRecord[]; customers: Customer[]; onNavigate: (screen: Screen) => void;
}) {
  const [period, setPeriod] = useState<"7" | "30" | "bulan">("7");
  const recent = sales.slice(0, 5);
  const count = period === "7" ? 7 : period === "30" ? 30 : Number(localDate().split("-")[2]);
  const [year, month, dayOfMonth] = localDate().split("-").map(Number);
  const days = Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, dayOfMonth - (count - 1 - index), 12));
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
    return {
      key,
      label: new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "Asia/Jakarta" }).format(date),
      total: sales.filter((sale) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })
        .format(new Date(sale.created_at)) === key).reduce((sum, sale) => sum + Number(sale.total), 0),
    };
  });
  const max = Math.max(...days.map((day) => day.total), 1);
  const topProducts = new Map<string, { name: string; quantity: number; unit: string }>();
  for (const item of saleItems) {
    const product = products.find((entry) => entry.id === item.product_id);
    const key = item.product_id ?? item.product_name;
    const old = topProducts.get(key);
    topProducts.set(key, {
      name: item.product_name,
      quantity: (old?.quantity ?? 0) + Number(item.quantity) * Number(item.conversion_factor),
      unit: product?.base_unit ?? item.unit_name,
    });
  }
  const bestProducts = [...topProducts.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
  const customerTotals = new Map<string, number>();
  for (const sale of sales) if (sale.customer_id) {
    customerTotals.set(sale.customer_id, (customerTotals.get(sale.customer_id) ?? 0) + Number(sale.total));
  }
  const bestCustomers = [...customerTotals.entries()].map(([id, amount]) => ({
    customer: customers.find((customer) => customer.id === id), amount,
  })).filter((row): row is { customer: Customer; amount: number } => Boolean(row.customer))
    .sort((a, b) => b.amount - a.amount).slice(0, 5);
  return <section className="page-content">
    <div className="welcome-row"><div><h2>Ringkasan toko</h2><p>Angka di bawah berasal dari transaksi dan stok yang tercatat.</p></div><button className="button button-primary" onClick={() => onNavigate("Kasir")}>Buka kasir</button></div>
    <div className="metric-grid">
      <Metric label="Penjualan hari ini" value={rupiah(todayTotal)} helper={`${todayCount} transaksi`} />
      <Metric label="Laba hari ini" value={rupiah(todayProfit)} helper="Penjualan dikurangi harga beli" />
      <Metric label="Total piutang aktif" value={rupiah(totalDebt)} helper="Dari seluruh pelanggan" />
      <Metric label="Stok menipis" value={String(lowStock.length)} helper="Periksa dan tambah stok" action={() => onNavigate("Barang")} />
    </div>
    <div className="dashboard-columns">
      <section className="surface chart-surface"><div className="section-heading"><div><h2>Ringkasan penjualan</h2><p>{period === "bulan" ? "Bulan ini" : `${period} hari terakhir`}</p></div>
        <div className="chart-periods">{[["7", "7 hari"], ["30", "30 hari"], ["bulan", "Bulan ini"]].map(([key, label]) => <button key={key} className={period === key ? "selected" : ""} onClick={() => setPeriod(key as typeof period)}>{label}</button>)}</div>
      </div>
        {sales.length === 0 ? <EmptyState title="Belum ada transaksi" description="Transaksi yang selesai akan muncul pada ringkasan ini." action={<button className="button button-quiet" onClick={() => onNavigate("Kasir")}>Buka kasir</button>} /> :
          <div className="chart-scroll"><div className={`bar-chart ${count > 7 ? "bar-chart-long" : ""}`} role="img" aria-label="Grafik jumlah penjualan per hari">
            {days.map((day) => <div className="bar-column" key={day.key} title={`${day.key}: ${rupiah(day.total)}`}>
              <span>{count <= 7 && day.total ? rupiah(day.total) : " "}</span><div className="bar-track"><i style={{ height: `${Math.max(4, day.total / max * 100)}%` }} /></div><small>{count > 7 ? day.key.slice(-2) : day.label}</small>
            </div>)}
          </div></div>}
      </section>
      <section className="surface low-stock-surface"><div className="section-heading"><div><h2>Stok perlu dicek</h2><p>{lowStock.length} barang di bawah batas minimum</p></div><button className="text-button" onClick={() => onNavigate("Barang")}>Lihat barang</button></div>
        {lowStock.length === 0 ? <p className="inline-empty">Belum ada barang yang stoknya menipis.</p> : lowStock.slice(0, 6).map((product) =>
          <div className="compact-row" key={product.id}><span>{product.name}</span><strong>{product.stock_base} {product.base_unit}</strong></div>)}
      </section>
    </div>
    <div className="dashboard-columns">
      <section className="surface low-stock-surface"><div className="section-heading"><div><h2>Barang sering terjual</h2><p>Jumlah berdasarkan satuan terkecil</p></div></div>
        {bestProducts.length ? bestProducts.map((item) => <div className="compact-row" key={item.name}><span>{item.name}</span><strong>{item.quantity} {item.unit}</strong></div>) : <p className="inline-empty">Belum ada catatan penjualan barang.</p>}
      </section>
      <section className="surface low-stock-surface"><div className="section-heading"><div><h2>Pelanggan teratas</h2><p>Berdasarkan nilai transaksi tersimpan</p></div></div>
        {bestCustomers.length ? bestCustomers.map((row) => <div className="compact-row" key={row.customer.id}><span>{row.customer.name}</span><strong>{rupiah(row.amount)}</strong></div>) : <p className="inline-empty">Belum ada transaksi atas nama pelanggan.</p>}
      </section>
    </div>
    <section className="surface table-surface"><div className="section-heading"><div><h2>Transaksi terbaru</h2><p>Catatan penjualan yang terakhir masuk</p></div><button className="text-button" onClick={() => onNavigate("Laporan")}>Buka laporan</button></div>
      {recent.length === 0 ? <p className="inline-empty">Belum ada transaksi. Penjualan pertama dapat dimulai di menu Kasir.</p> :
        <div className="table-scroll"><table><thead><tr><th>Transaksi</th><th>Tanggal</th><th>Status</th><th className="align-right">Total</th></tr></thead><tbody>
          {recent.map((sale) => <tr key={sale.id}><td>{sale.invoice_no}</td><td>{tanggal(sale.created_at)}</td><td><StatusTag status={sale.status} /></td><td className="align-right">{rupiah(sale.total)}</td></tr>)}
        </tbody></table></div>}
    </section>
    <p className="inventory-caption">Jumlah barang tersimpan: {products.length}</p>
  </section>;
}

function Metric({ label, value, helper, action }: { label: string; value: string; helper: string; action?: () => void }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><button className="metric-helper" onClick={action} disabled={!action}>{helper}</button></article>;
}

function StatusTag({ status }: { status: string }) {
  const label = status === "lunas" ? "Lunas" : status === "hutang" ? "Hutang" : "Dibatalkan";
  return <span className={`status-tag ${status}`}>{label}</span>;
}

function ProductsScreen({ products, categories, onAdd, onEdit, onRemove, onStock, onPurchase, supabase, storeId, loading }: {
  products: Product[]; categories: string[]; onAdd: () => void; onEdit: (product: Product) => void;
  onRemove: (product: Product) => void; onStock: (product: Product) => void; onPurchase: () => void;
  supabase: ReturnType<typeof getSupabase>; storeId: string; loading: boolean;
}) {
  const [tab, setTab] = useState<"produk" | "kulakan" | "stok">("produk");
  const [history, setHistory] = useState<StockMovement[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    if (tab === "stok") supabase.from("stock_movements").select("*,products(name,base_unit)").order("created_at", { ascending: false }).limit(100)
      .then(({ data, error: resultError }) => { if (resultError) setError(resultError.message); else setHistory((data ?? []) as StockMovement[]); });
    if (tab === "kulakan") supabase.from("purchases").select("*,purchase_items(product_name,quantity,buy_price)").order("purchased_at", { ascending: false }).limit(100)
      .then(({ data, error: resultError }) => { if (resultError) setError(resultError.message); else setPurchases((data ?? []) as PurchaseRow[]); });
  }, [supabase, tab]);
  const list = products.filter((product) => product.name.toLocaleLowerCase("id").includes(query.toLocaleLowerCase("id")));
  return <section className="page-content">
    <div className="page-toolbar"><div><h2>Barang & stok</h2><p>Kelola barang, periksa jumlah stok, dan catat kulakan.</p></div><div className="toolbar-actions"><button className="button button-quiet" onClick={onPurchase}>Catat kulakan</button><button className="button button-primary" onClick={onAdd}>Tambah barang</button></div></div>
    <div className="tab-row" role="tablist">
      {[["produk", "Produk & Stok"], ["kulakan", "Kulakan"], ["stok", "Riwayat Stok"]].map(([key, title]) =>
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "selected" : ""} onClick={() => { setError(""); setTab(key as typeof tab); }}>{title}</button>)}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading && <p className="inline-empty">Memuat daftar barang...</p>}
    {tab === "produk" && <>
      <label className="search-box product-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari barang..." aria-label="Cari barang" /></label>
      {list.length === 0 && !loading ? <EmptyState title="Barang belum tersedia" description="Tambahkan barang untuk mulai mencatat stok dan penjualan." action={<button className="button button-primary" onClick={onAdd}>Tambah barang</button>} /> :
        <div className="surface table-surface table-scroll"><table><thead><tr><th>Nama barang</th><th>Kategori</th><th>Stok</th><th>Harga jual</th><th>Status stok</th><th>Aksi</th></tr></thead><tbody>
          {list.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small className="table-subtext">{product.barcode || "Tanpa barcode"}</small></td><td>{categories.includes(product.category_name) ? product.category_name : "Lainnya"}</td><td>{product.stock_base} {product.base_unit}</td><td>{rupiah(product.sell_price)}</td><td>{product.stock_base <= product.minimum_stock ? <span className="status-tag hutang">Stok menipis</span> : <span className="status-tag lunas">Tersedia</span>}</td><td><div className="row-actions"><button onClick={() => onStock(product)}>Ubah stok</button><button onClick={() => onEdit(product)}>Ubah</button><button onClick={() => onRemove(product)}>Hapus</button></div></td></tr>)}
        </tbody></table></div>}
    </>}
    {tab === "kulakan" && (purchases.length === 0 ? <EmptyState title="Belum ada catatan kulakan" description="Catat pembelian barang dari supplier untuk menambah stok." action={<button className="button button-primary" onClick={onPurchase}>Catat kulakan</button>} /> :
      <div className="surface table-surface table-scroll"><table><thead><tr><th>Tanggal</th><th>Supplier</th><th>Barang</th><th>Status</th><th>Total</th></tr></thead><tbody>
        {purchases.map((purchase) => <tr key={purchase.id}><td>{tanggal(purchase.purchased_at)}</td><td>{purchase.supplier_name || "Tidak disebutkan"}</td><td>{purchase.purchase_items?.map((item) => `${item.product_name} (${item.quantity})`).join(", ")}</td><td>{purchase.status === "lunas" ? "Lunas" : "Belum lunas"}</td><td>{rupiah(purchase.total)}</td></tr>)}
      </tbody></table></div>)}
    {tab === "stok" && (history.length === 0 ? <EmptyState title="Riwayat stok masih kosong" description="Perubahan dari penjualan, kulakan, dan penyesuaian akan tercatat di sini." /> :
      <div className="surface table-surface table-scroll"><table><thead><tr><th>Tanggal</th><th>Barang</th><th>Perubahan</th><th>Jenis</th><th>Keterangan</th></tr></thead><tbody>
        {history.map((item) => <tr key={item.id}><td>{tanggal(item.created_at)}</td><td>{item.products?.name ?? "Barang dihapus"}</td><td>{item.quantity_base > 0 ? "+" : ""}{item.quantity_base} {item.products?.base_unit}</td><td>{item.movement_type}</td><td>{item.description || "-"}</td></tr>)}
      </tbody></table></div>)}
    <span className="visually-hidden">Toko {storeId}</span>
  </section>;
}

function DebtScreen({ debts, allDebts, storeName, supabase, onPay }: {
  debts: DebtRow[]; allDebts: DebtRow[]; storeName: string; supabase: ReturnType<typeof getSupabase>;
  onPay: (customer: Customer) => void;
}) {
  const [selected, setSelected] = useState<Customer | null>(null);
  const [payments, setPayments] = useState<DebtPaymentRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const grouped = new Map<string, { customer: Customer; amount: number; oldest: string }>();
  for (const debt of debts) {
    if (!debt.customer) continue;
    const current = grouped.get(debt.customer_id);
    grouped.set(debt.customer_id, {
      customer: debt.customer, amount: (current?.amount ?? 0) + Number(debt.balance),
      oldest: !current || debt.created_at < current.oldest ? debt.created_at : current.oldest,
    });
  }
  const total = [...grouped.values()].reduce((sum, group) => sum + group.amount, 0);

  async function showDetails(customer: Customer) {
    setSelected(customer);
    setPayments([]);
    setDetailError("");
    const debtIds = allDebts.filter((debt) => debt.customer_id === customer.id).map((debt) => debt.id);
    if (!supabase || debtIds.length === 0) return;
    setDetailLoading(true);
    const { data, error } = await supabase.from("debt_payments").select("*")
      .in("debt_id", debtIds).order("created_at", { ascending: false });
    if (error) setDetailError(error.message);
    else setPayments((data ?? []) as DebtPaymentRow[]);
    setDetailLoading(false);
  }

  return <section className="page-content">
    <div className="page-toolbar"><div><h2>Piutang pelanggan</h2><p>Catatan hutang yang belum lunas, dari tanggal terlama.</p></div></div>
    <div className="debt-summary surface"><div><span>Total piutang aktif</span><strong>{rupiah(total)}</strong></div><span>{grouped.size} pelanggan memiliki hutang</span></div>
    {grouped.size === 0 ? <EmptyState title="Tidak ada hutang aktif" description="Transaksi yang pembayarannya belum lunas akan tercatat di halaman ini." /> :
      <div className="customer-debt-list">
        {[...grouped.values()].sort((a, b) => a.oldest.localeCompare(b.oldest)).map(({ customer, amount, oldest }) => <article className="surface debt-card" key={customer.id}>
          <div className="customer-initial">{customer.name.slice(0, 1).toLocaleUpperCase("id")}</div>
          <div className="debt-customer-info"><strong>{customer.name}</strong><span>Hutang tertua {tanggal(oldest)}</span>{customer.phone && <span>{customer.phone}</span>}</div>
          <strong className="debt-amount">{rupiah(amount)}</strong>
          <button className="button button-quiet" onClick={() => void showDetails(customer)}>Rincian hutang</button>
          <button className="button button-primary" onClick={() => onPay(customer)}>Bayar / Cicil</button>
          {customer.phone && <a className="button button-quiet" target="_blank" rel="noreferrer" href={`https://wa.me/${whatsappNumber(customer.phone)}?text=${encodeURIComponent(`Halo ${customer.name}, catatan hutang di ${storeName} saat ini ${rupiah(amount)}. Silakan hubungi kami jika ingin membayar. Terima kasih.`)}`}>Ingatkan WhatsApp</a>}
        </article>)}
      </div>}
    {selected && <Dialog title={`Rincian hutang ${selected.name}`} onClose={() => setSelected(null)} wide>
      <h3 className="detail-subheading">Semua transaksi yang pernah berhutang</h3>
      <div className="table-scroll"><table><thead><tr><th>Tanggal</th><th>No. transaksi</th><th>Hutang awal</th><th>Sisa</th><th>Status</th></tr></thead><tbody>
        {allDebts.filter((debt) => debt.customer_id === selected.id).map((debt) => <tr key={debt.id}>
          <td>{tanggal(debt.created_at)}</td><td>{debt.invoice_no ?? "-"}</td>
          <td>{rupiah(debt.original_amount)}</td><td>{rupiah(debt.balance)}</td>
          <td>{debt.status === "dibatalkan" ? "Dibatalkan" : Number(debt.balance) === 0 ? "Lunas" : "Terbuka"}</td>
        </tr>)}
      </tbody></table></div>
      <h3 className="detail-subheading">Riwayat cicilan untuk hutang aktif</h3>
      {detailLoading ? <p className="inline-empty" role="status">Memuat riwayat cicilan...</p>
        : detailError ? <p className="form-error" role="alert">{detailError}</p>
          : payments.length === 0 ? <p className="inline-empty">Belum ada cicilan untuk hutang yang masih aktif.</p>
            : <div className="table-scroll"><table><thead><tr><th>Tanggal</th><th>Metode</th><th>Jumlah</th></tr></thead><tbody>
              {payments.map((payment) => <tr key={payment.id}><td>{tanggal(payment.created_at)}</td><td>{payment.payment_method}</td><td>{rupiah(payment.amount)}</td></tr>)}
            </tbody></table></div>}
    </Dialog>}
  </section>;
}

function CustomersScreen({ customers, debts, sales, onAdd, onEdit, onRemove }: {
  customers: Customer[]; debts: DebtRow[]; sales: Sale[]; onAdd: () => void;
  onEdit: (customer: Customer) => void; onRemove: (customer: Customer) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const filtered = customers.filter((customer) => `${customer.name} ${customer.phone ?? ""}`.toLocaleLowerCase("id").includes(query.toLocaleLowerCase("id")));
  const debtOf = (id: string) => debts.filter((debt) => debt.customer_id === id).reduce((sum, debt) => sum + Number(debt.balance), 0);
  const saleCount = (id: string) => sales.filter((sale) => sale.customer_id === id).length;
  const spendOf = (id: string) => sales.filter((sale) => sale.customer_id === id && sale.status !== "dibatalkan")
    .reduce((sum, sale) => sum + Number(sale.total), 0);
  return <section className="page-content">
    <div className="page-toolbar"><div><h2>Daftar pelanggan</h2><p>Simpan kontak untuk mempercepat transaksi dan mencatat hutang.</p></div><button className="button button-primary" onClick={onAdd}>Tambah pelanggan</button></div>
    <label className="search-box product-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama atau nomor HP..." aria-label="Cari pelanggan" /></label>
    {filtered.length === 0 ? <EmptyState title={customers.length ? "Pelanggan tidak ditemukan" : "Belum ada pelanggan"} description={customers.length ? "Coba kata pencarian lain." : "Tambahkan pelanggan untuk menyimpan riwayat belanja dan pembayaran hutang."} action={!customers.length ? <button className="button button-primary" onClick={onAdd}>Tambah pelanggan</button> : undefined} /> :
      <div className="surface table-surface table-scroll"><table><thead><tr><th>Nama</th><th>Kontak</th><th>Riwayat transaksi</th><th>Total belanja</th><th>Total hutang</th><th>Aksi</th></tr></thead><tbody>
        {filtered.map((customer) => <tr key={customer.id}><td><button className="table-action customer-history-trigger" onClick={() => setSelected(customer)}>{customer.name}</button>{customer.address && <small className="table-subtext">{customer.address}</small>}</td><td>{customer.phone || "-"}</td><td>{saleCount(customer.id)} transaksi</td><td>{rupiah(spendOf(customer.id))}</td><td>{rupiah(debtOf(customer.id))}</td><td><div className="row-actions"><button onClick={() => onEdit(customer)}>Ubah</button><button onClick={() => onRemove(customer)}>Hapus</button></div></td></tr>)}
      </tbody></table></div>}
    {selected && <Dialog title={`Riwayat ${selected.name}`} onClose={() => setSelected(null)} wide>
      <p className="form-hint">{selected.phone || "Nomor HP belum dicatat"} · {saleCount(selected.id)} transaksi · Piutang aktif {rupiah(debtOf(selected.id))}</p>
      {sales.filter((sale) => sale.customer_id === selected.id).length === 0
        ? <p className="inline-empty">Belum ada transaksi untuk pelanggan ini.</p>
        : <div className="table-scroll"><table><thead><tr><th>No. transaksi</th><th>Tanggal</th><th>Status</th><th>Total</th></tr></thead><tbody>
          {sales.filter((sale) => sale.customer_id === selected.id).map((sale) => <tr key={sale.id}><td>{sale.invoice_no}</td><td>{tanggal(sale.created_at)}</td><td><StatusTag status={sale.status} /></td><td>{rupiah(sale.total)}</td></tr>)}
        </tbody></table></div>}
    </Dialog>}
  </section>;
}

function ReportsScreen({ sales, saleItems, products, debts, supabase, onDownload, onReceipt, onCancel }: {
  sales: Sale[]; saleItems: SaleItemRecord[]; products: Product[];
  debts: DebtRow[]; supabase: ReturnType<typeof getSupabase>;
  onDownload: (report: ReportPayload) => void;
  onReceipt: (sale: Sale) => void; onCancel: (sale: Sale) => void;
}) {
  const [start, setStart] = useState(localDate());
  const [end, setEnd] = useState(localDate());
  const [status, setStatus] = useState("semua");
  const [kind, setKind] = useState<"penjualan" | "laba" | "stok" | "kulakan" | "piutang" | "terlaris">("penjualan");
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase || kind !== "kulakan") return;
    const timer = window.setTimeout(() => {
      setLoadingPurchases(true);
      void supabase.from("purchases").select("id,purchased_at,supplier_name,status,total,purchase_items(product_name,quantity,buy_price)")
        .order("purchased_at", { ascending: false }).then(({ data, error: resultError }) => {
          if (resultError) setError(resultError.message);
          else setPurchases((data ?? []) as PurchaseRow[]);
          setLoadingPurchases(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [kind, supabase]);
  const filteredSales = sales.filter((sale) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(sale.created_at));
    return date >= start && date <= end && (status === "semua" || sale.status === status);
  });
  const activeSales = filteredSales.filter((sale) => sale.status !== "dibatalkan");
  const saleIds = new Set(activeSales.map((sale) => sale.id));
  const periodItems = saleItems.filter((item) => saleIds.has(item.sale_id));
  const totalSales = activeSales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const costTotal = periodItems.reduce((sum, item) =>
    sum + Number(item.quantity) * Number(item.conversion_factor) * Number(item.cost_price), 0);
  const profitBySale = new Map<string, number>();
  for (const item of periodItems) {
    profitBySale.set(item.sale_id, (profitBySale.get(item.sale_id) ?? 0)
      + Number(item.line_total) - Number(item.quantity) * Number(item.conversion_factor) * Number(item.cost_price));
  }
  const purchaseRows = purchases.filter((purchase) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(purchase.purchased_at));
    return date >= start && date <= end;
  });
  const topProducts = new Map<string, { name: string; quantity: number; unit: string }>();
  for (const item of periodItems) {
    const key = item.product_id ?? item.product_name;
    const product = products.find((candidate) => candidate.id === item.product_id);
    const existing = topProducts.get(key);
    topProducts.set(key, {
      name: item.product_name,
      quantity: (existing?.quantity ?? 0) + Number(item.quantity) * Number(item.conversion_factor),
      unit: product?.base_unit ?? item.unit_name,
    });
  }
  let title = "Penjualan";
  let columns = ["No. transaksi", "Tanggal", "Status", "Metode", "Total"];
  let rows = filteredSales.map((sale) => [
    sale.invoice_no, tanggal(sale.created_at), sale.status, sale.payment_method, rupiah(sale.total),
  ]);
  let summary = `Total penjualan: ${rupiah(totalSales)} dari ${activeSales.length} transaksi`;
  let isLoading = false;
  let emptyTitle = "Belum ada transaksi pada rentang ini";
  let emptyDescription = "Coba pilih tanggal lain. Transaksi baru akan muncul setelah pembayaran diproses.";

  if (kind === "laba") {
    title = "Laba rugi sederhana";
    columns = ["No. transaksi", "Tanggal", "Penjualan", "Harga beli", "Laba"];
    rows = activeSales.map((sale) => {
      const cost = periodItems.filter((item) => item.sale_id === sale.id)
        .reduce((sum, item) => sum + Number(item.quantity) * Number(item.conversion_factor) * Number(item.cost_price), 0);
      return [sale.invoice_no, tanggal(sale.created_at), rupiah(sale.total), rupiah(cost), rupiah(profitBySale.get(sale.id) ?? 0)];
    });
    summary = `Penjualan ${rupiah(totalSales)} · Harga beli ${rupiah(costTotal)} · Laba ${rupiah(totalSales - costTotal)}`;
    emptyTitle = "Belum ada data laba rugi";
    emptyDescription = "Transaksi penjualan yang tersimpan akan dihitung bersama harga beli barang.";
  } else if (kind === "stok") {
    title = "Stok barang";
    columns = ["Barang", "Kategori", "Satuan", "Jumlah", "Batas minimum"];
    rows = products.map((product) => [
      product.name, product.category_name, product.base_unit, String(product.stock_base), String(product.minimum_stock),
    ]);
    summary = `${products.filter((product) => product.stock_base <= product.minimum_stock).length} barang di bawah batas stok minimum`;
    emptyTitle = "Belum ada barang";
    emptyDescription = "Tambahkan barang agar ringkasan stok tersedia.";
  } else if (kind === "kulakan") {
    title = "Kulakan";
    columns = ["Tanggal", "Supplier", "Barang", "Status", "Total"];
    rows = purchaseRows.map((purchase) => [
      tanggal(purchase.purchased_at), purchase.supplier_name ?? "Tidak disebutkan",
      purchase.purchase_items.map((item) => `${item.product_name} (${item.quantity})`).join(", "),
      purchase.status === "lunas" ? "Lunas" : "Belum lunas", rupiah(purchase.total),
    ]);
    summary = `Total kulakan: ${rupiah(purchaseRows.reduce((sum, purchase) => sum + Number(purchase.total), 0))}`;
    isLoading = loadingPurchases;
    emptyTitle = "Belum ada catatan kulakan";
    emptyDescription = "Kulakan yang disimpan akan muncul pada rentang tanggal ini.";
  } else if (kind === "piutang") {
    title = "Piutang pelanggan";
    columns = ["Pelanggan", "Tanggal hutang", "No. transaksi", "Sisa hutang"];
    rows = debts.map((debt) => [
      debt.customer?.name ?? "Pelanggan dihapus", tanggal(debt.created_at), debt.invoice_no ?? "-", rupiah(debt.balance),
    ]);
    summary = `Total piutang aktif: ${rupiah(debts.reduce((sum, debt) => sum + Number(debt.balance), 0))}`;
    emptyTitle = "Tidak ada hutang aktif";
    emptyDescription = "Hutang yang belum lunas akan tercatat di menu ini.";
  } else if (kind === "terlaris") {
    title = "Produk terlaris";
    columns = ["Peringkat", "Barang", "Terjual (satuan dasar)"];
    rows = [...topProducts.values()].sort((a, b) => b.quantity - a.quantity)
      .map((item, index) => [String(index + 1), item.name, `${item.quantity} ${item.unit}`]);
    summary = `${topProducts.size} barang terjual pada rentang tanggal ini`;
    emptyTitle = "Belum ada barang terjual";
    emptyDescription = "Data barang terlaris muncul setelah ada transaksi.";
  }
  const period = kind === "stok" || kind === "piutang" ? "Saat ini" : `${start} sampai ${end}`;
  const report: ReportPayload = { title, period, columns, rows, summary };
  return <section className="page-content">
    <div className="page-toolbar"><div><h2>Laporan</h2><p>Ringkasan dari transaksi, stok, kulakan, dan piutang.</p></div><button className="button button-primary" disabled={isLoading || rows.length === 0} onClick={() => onDownload(report)}>Unduh PDF</button></div>
    <div className="tab-row report-tabs" role="tablist">
      {([["penjualan", "Penjualan"], ["laba", "Laba rugi"], ["stok", "Stok"], ["kulakan", "Kulakan"], ["piutang", "Piutang"], ["terlaris", "Produk terlaris"]] as const)
        .map(([key, label]) => <button key={key} role="tab" aria-selected={kind === key} className={kind === key ? "selected" : ""} onClick={() => { setError(""); setKind(key); }}>{label}</button>)}
    </div>
    {kind !== "stok" && kind !== "piutang" && <div className="report-filters surface">
      <Field label="Dari tanggal"><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
      <Field label="Sampai tanggal"><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
      {kind === "penjualan" ? <Field label="Status"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="semua">Semua transaksi</option><option value="lunas">Lunas</option><option value="hutang">Hutang</option><option value="dibatalkan">Dibatalkan</option></select></Field> : <div />}
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {isLoading ? <p className="inline-empty" role="status">Memuat laporan kulakan...</p> : rows.length === 0
      ? <EmptyState title={emptyTitle} description={emptyDescription} />
      : <>
        <div className="report-total surface"><span>{rows.length} baris</span><strong>{summary}</strong><small>Periode: {period}</small></div>
        <div className="surface table-surface table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}{kind === "penjualan" && <th>Aksi</th>}</tr></thead><tbody>
          {kind === "penjualan" ? filteredSales.map((sale) => <tr key={sale.id}><td>{sale.invoice_no}</td><td>{tanggal(sale.created_at)}</td><td><StatusTag status={sale.status} /></td><td>{sale.payment_method}</td><td>{rupiah(sale.total)}</td><td><div className="row-actions"><button onClick={() => onReceipt(sale)}>Lihat struk</button><button className="table-action" disabled={sale.status === "dibatalkan"} onClick={() => onCancel(sale)}>{sale.status === "dibatalkan" ? "Dibatalkan" : "Batalkan"}</button></div></td></tr>)
            : rows.map((row, index) => <tr key={`${kind}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}
        </tbody></table></div>
      </>}
  </section>;
}

function SettingsScreen({ store, products, customers, sales, onSave, onChangePassword, supabase, onNotice }: {
  store: Store; products: Product[]; customers: Customer[]; sales: Sale[];
  onSave: (event: FormEvent<HTMLFormElement>) => void; onChangePassword: (event: FormEvent<HTMLFormElement>) => void;
  supabase: ReturnType<typeof getSupabase>; onNotice: (message: string) => void;
}) {
  async function exportData() {
    if (!supabase) return;
    try {
      const [purchaseResult, debtResult, movementResult] = await Promise.all([
        supabase.from("purchases").select("*"),
        supabase.from("debts").select("*"),
        supabase.from("stock_movements").select("*"),
      ]);
      for (const result of [purchaseResult, debtResult, movementResult]) if (result.error) throw result.error;
      csvDownload("cadangan-data-toko.csv", [
        ["Jenis data", "Tanggal", "Nama / nomor", "Status / satuan", "Jumlah"],
        ...products.map((item) => ["Barang", "", item.name, item.base_unit, item.stock_base]),
        ...customers.map((item) => ["Pelanggan", "", item.name, item.phone ?? "", ""]),
        ...sales.map((item) => ["Penjualan", tanggal(item.created_at), item.invoice_no, item.status, item.total]),
        ...((purchaseResult.data ?? []) as ExportRow[]).map((item) => ["Kulakan", tanggal(item.purchased_at), item.supplier_name ?? "", item.status ?? "", item.total ?? 0]),
        ...((debtResult.data ?? []) as ExportRow[]).map((item) => ["Piutang", tanggal(item.created_at), item.customer_id ?? "", item.status ?? "", item.balance ?? 0]),
        ...((movementResult.data ?? []) as ExportRow[]).map((item) => ["Stok", tanggal(item.created_at), item.product_id ?? "", item.movement_type ?? "", item.quantity_base ?? 0]),
      ]);
      onNotice("File CSV berhasil diunduh. Simpan file tersebut di tempat yang aman.");
    } catch (error) { onNotice(`Data belum dapat diekspor: ${messageOf(error)}`); }
  }
  return <section className="page-content settings-layout">
    <section className="surface settings-card"><div className="section-heading"><div><h2>Informasi toko</h2><p>Data ini dicetak pada struk transaksi.</p></div></div>
      <form className="form-stack" onSubmit={onSave}>
        <Field label="Nama toko"><input name="name" required defaultValue={store.name} /></Field>
        <Field label="Alamat"><textarea name="address" rows={2} defaultValue={store.address ?? ""} /></Field>
        <Field label="Nomor HP toko"><input name="phone" inputMode="tel" defaultValue={store.phone ?? ""} /></Field>
        <Field label="Catatan di bawah struk"><input name="receipt_note" defaultValue={store.receipt_note ?? ""} /></Field>
        <div className="form-grid-two">
          <Field label="Ukuran kertas struk"><select name="receipt_width" defaultValue={store.receipt_width}><option value="58">58 mm</option><option value="80">80 mm</option></select></Field>
          <Field label="Batas stok menipis"><input name="default_min_stock" type="number" min="0" step="0.001" defaultValue={store.default_min_stock} /></Field>
        </div>
        <Field label="Info rekening transfer"><textarea name="transfer_info" rows={2} defaultValue={store.transfer_info ?? ""} placeholder="Contoh: nama bank dan nomor rekening" /></Field>
        <button className="button button-primary">Simpan pengaturan</button>
      </form>
    </section>
    <section className="surface settings-card"><div className="section-heading"><div><h2>Akun & salinan data</h2><p>Jaga akses akun dan simpan salinan catatan toko.</p></div></div>
      <form className="form-stack" onSubmit={onChangePassword}>
        <Field label="Kata sandi baru"><input name="password" type="password" minLength={8} required placeholder="Sedikitnya 8 karakter" /></Field>
        <button className="button button-quiet">Ganti kata sandi</button>
      </form>
      <div className="backup-block"><div><strong>Ekspor data toko</strong><p>Unduh daftar barang, pelanggan, transaksi, stok, dan piutang sebagai CSV.</p></div><button className="button button-quiet" onClick={() => void exportData()}>Unduh CSV</button></div>
    </section>
  </section>;
}
