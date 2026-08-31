-- Zeno — Postgres schema (Supabase)
-- Money columns are BIGINT integer cents. Idempotent.

CREATE TABLE IF NOT EXISTS org (
  id SERIAL PRIMARY KEY,
  user_id TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  kra_pin TEXT,
  vat_registered BOOLEAN NOT NULL DEFAULT TRUE,
  address TEXT, phone TEXT, email TEXT,
  logo_url TEXT,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
  next_invoice_no INTEGER NOT NULL DEFAULT 1,
  next_quote_no INTEGER NOT NULL DEFAULT 1,
  invoice_template TEXT NOT NULL DEFAULT 'default',
  quote_template TEXT NOT NULL DEFAULT 'default',
  next_credit_note_no INTEGER NOT NULL DEFAULT 1,
  next_po_no INTEGER NOT NULL DEFAULT 1,
  next_payment_no INTEGER NOT NULL DEFAULT 1,
  cu_serial TEXT
);
-- Add auth columns to existing installs (idempotent)
ALTER TABLE org ADD COLUMN IF NOT EXISTS user_id TEXT UNIQUE;
ALTER TABLE org ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE org ADD COLUMN IF NOT EXISTS brand_color TEXT NOT NULL DEFAULT '#0f766e';
ALTER TABLE org ALTER COLUMN name SET DEFAULT '';


CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  company_name TEXT, email TEXT, phone TEXT, kra_pin TEXT,
  address TEXT, city TEXT, notes TEXT,
  is_withholding_agent BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'lead',
  expected_close TEXT, notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  item_group_id INTEGER,
  name TEXT NOT NULL,
  sku TEXT, unit TEXT NOT NULL DEFAULT 'unit', description TEXT,
  sale_price_cents BIGINT NOT NULL DEFAULT 0,
  purchase_cost_cents BIGINT NOT NULL DEFAULT 0,
  tax_class TEXT NOT NULL DEFAULT 'B16',
  sales_account_id INTEGER, purchase_account_id INTEGER,
  track_inventory BOOLEAN NOT NULL DEFAULT FALSE,
  reorder_level DOUBLE PRECISION NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS stock_lots (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL,
  remaining_qty DOUBLE PRECISION NOT NULL,
  unit_cost_cents BIGINT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  number TEXT NOT NULL,
  contact_id INTEGER,
  date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  paid_cents BIGINT NOT NULL DEFAULT 0,
  source_doc_id INTEGER,
  journal_entry_id INTEGER,
  cu_invoice_number TEXT, cu_serial TEXT, qr_url TEXT,
  paid_from_bank_account_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_lines (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL,
  item_id INTEGER,
  description TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit_price_cents BIGINT NOT NULL DEFAULT 0,
  discount_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_class TEXT NOT NULL DEFAULT 'B16',
  tax_rate_bp INTEGER NOT NULL DEFAULT 1600,
  net_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  gross_cents BIGINT NOT NULL DEFAULT 0,
  account_id INTEGER,
  cogs_cents BIGINT NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL,
  direction TEXT NOT NULL,
  contact_id INTEGER,
  document_id INTEGER,
  date TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  wht_cents BIGINT NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'mpesa',
  bank_account_id INTEGER,
  reference TEXT,
  journal_entry_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  opening_balance_cents BIGINT NOT NULL DEFAULT 0,
  opening_balance_date TEXT,
  opening_balance_entry_id INTEGER,
  archived BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id SERIAL PRIMARY KEY,
  bank_account_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uncategorized',
  category_account_id INTEGER,
  journal_entry_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  memo TEXT,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  reversal_of_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  debit_cents BIGINT NOT NULL DEFAULT 0,
  credit_cents BIGINT NOT NULL DEFAULT 0,
  contact_id INTEGER,
  memo TEXT
);

CREATE INDEX IF NOT EXISTS idx_doclines_doc ON document_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_jlines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jlines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_docs_type ON documents(type, status);
CREATE INDEX IF NOT EXISTS idx_lots_item ON stock_lots(item_id, date);

-- Multi-tenancy additions
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS item_group_id INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS opening_balance_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS opening_balance_date TEXT;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS opening_balance_entry_id INTEGER;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS org_id INTEGER;

ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS org_id INTEGER NOT NULL DEFAULT 1 REFERENCES org(id);

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permissions (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  role TEXT NOT NULL,
  perm_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(org_id, role, perm_key)
);
CREATE TABLE IF NOT EXISTS todos (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  due_date TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#0f766e',
  created_at TEXT NOT NULL
);

ALTER TABLE org ADD COLUMN IF NOT EXISTS custom_document_column_name TEXT;
ALTER TABLE org ADD COLUMN IF NOT EXISTS document_footer_text TEXT;

CREATE TABLE IF NOT EXISTS document_assignments (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  doc_id INTEGER NOT NULL REFERENCES documents(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS custom_column_value TEXT;
ALTER TABLE document_assignments ADD COLUMN IF NOT EXISTS assigned_by_id INTEGER;
ALTER TABLE notifications ALTER COLUMN member_id DROP NOT NULL;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS approval_note TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_by_role TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS credited_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS customer_contact_id INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS related_invoice_id INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_billable BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS cost_center_id INTEGER;
ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS warehouse_id INTEGER;
ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS billed_qty DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE org ADD COLUMN IF NOT EXISTS data_segregation BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE org ADD COLUMN IF NOT EXISTS item_groups_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS item_groups (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_groups_org_name ON item_groups(org_id, name);
CREATE INDEX IF NOT EXISTS idx_items_group ON items(org_id, item_group_id);

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS external_ref TEXT;

CREATE TABLE IF NOT EXISTS categorization_rules (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  keyword TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'out',
  category_account_id INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catrules_org ON categorization_rules(org_id, direction);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false;

-- PERFORMANCE INDEXES (ADDED FOR OPTIMIZATION)
CREATE INDEX IF NOT EXISTS idx_accounts_org ON accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(org_id, kind);
CREATE INDEX IF NOT EXISTS idx_items_org ON items(org_id);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(org_id, type, status);
CREATE INDEX IF NOT EXISTS idx_documents_contact ON documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_document_lines_org ON document_lines(org_id, document_id);
CREATE INDEX IF NOT EXISTS idx_document_assignments_org ON document_assignments(org_id, doc_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_org ON bank_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_bank_txns_org ON bank_transactions(org_id, category_account_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_org ON journal_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_org ON journal_lines(org_id, entry_id, account_id);
CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(org_id, document_id);
CREATE INDEX IF NOT EXISTS idx_activities_org ON activities(org_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_stock_lots_org ON stock_lots(org_id, item_id);
CREATE INDEX IF NOT EXISTS idx_members_org ON members(org_id);

-- Phase A: reconciliation, recurring, books lock
ALTER TABLE org ADD COLUMN IF NOT EXISTS lock_date TEXT;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reconciliation_id INTEGER;

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  bank_account_id INTEGER NOT NULL,
  statement_date TEXT NOT NULL,
  statement_balance_cents BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  completed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_recs_org ON bank_reconciliations(org_id, bank_account_id);

CREATE TABLE IF NOT EXISTS recurring_templates (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  contact_id INTEGER,
  paid_from_bank_account_id INTEGER,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  next_run_date TEXT NOT NULL,
  due_in_days INTEGER NOT NULL DEFAULT 30,
  tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  auto_issue BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  lines_json TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurring_org ON recurring_templates(org_id, active, next_run_date);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  name TEXT NOT NULL,
  asset_account_id INTEGER NOT NULL,
  depreciation_account_id INTEGER NOT NULL,
  expense_account_id INTEGER NOT NULL,
  purchase_date TEXT NOT NULL,
  purchase_cost_cents BIGINT NOT NULL,
  salvage_value_cents BIGINT NOT NULL DEFAULT 0,
  useful_life_months INTEGER NOT NULL,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  name TEXT NOT NULL,
  kra_pin TEXT,
  nssf_number TEXT,
  shif_number TEXT,
  basic_salary_cents BIGINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  journal_entry_id INTEGER,
  created_at TEXT NOT NULL
);

DROP TABLE IF EXISTS payslips;

CREATE TABLE IF NOT EXISTS statutory_rules (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  type TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  calculation_type TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_run_line_items (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL,
  sub_type TEXT,
  amount_cents BIGINT NOT NULL,
  is_deduction BOOLEAN NOT NULL DEFAULT FALSE,
  statutory_rule_id INTEGER REFERENCES statutory_rules(id)
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  correcting_run_id INTEGER REFERENCES payroll_runs(id),
  original_run_id INTEGER REFERENCES payroll_runs(id),
  amount_cents BIGINT NOT NULL,
  is_taxable BOOLEAN NOT NULL DEFAULT TRUE,
  is_deduction BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loan_ledger (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  principal_cents BIGINT NOT NULL,
  balance_cents BIGINT NOT NULL,
  installment_cents BIGINT NOT NULL,
  type TEXT NOT NULL DEFAULT 'amortizing',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loan_installments (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  loan_id INTEGER NOT NULL REFERENCES loan_ledger(id),
  payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id),
  amount_cents BIGINT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_records (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month TEXT NOT NULL,
  unpaid_days_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS due_in_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS paid_from_bank_account_id INTEGER;
ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS custom_roles (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(org_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_org_name ON custom_roles(org_id, name);

CREATE TABLE IF NOT EXISTS payment_gateways (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  gateway_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_gateways_org ON payment_gateways(org_id, gateway_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  gateway_id TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  payer_phone TEXT,
  payer_name TEXT,
  account_ref TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  matched_document_id INTEGER,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_events_org_ref ON payment_events(org_id, provider_ref);
ALTER TABLE payment_gateways ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
ALTER TABLE payment_gateways ADD COLUMN IF NOT EXISTS c2b_registered_at TEXT;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS payment_id INTEGER;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'in';
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_gateway_ref ON payment_events(gateway_id, provider_ref);

CREATE TABLE IF NOT EXISTS receipt_tokens (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  token TEXT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_tokens_token ON receipt_tokens(token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_tokens_payment ON receipt_tokens(payment_id);

CREATE TABLE IF NOT EXISTS sms_settings (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  provider TEXT NOT NULL DEFAULT 'advanta',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_settings_org ON sms_settings(org_id);

CREATE TABLE IF NOT EXISTS sms_log (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  payment_id INTEGER,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_ref TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_log_payment ON sms_log(payment_id);

ALTER TABLE org ADD COLUMN IF NOT EXISTS portal_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_portal_slug ON org(portal_slug);

CREATE TABLE IF NOT EXISTS portal_otps (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_otps_org_phone ON portal_otps(org_id, phone);

CREATE TABLE IF NOT EXISTS reminder_log (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  document_id INTEGER NOT NULL REFERENCES documents(id),
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_log_doc_kind ON reminder_log(document_id, kind);

ALTER TABLE org ADD COLUMN IF NOT EXISTS accountant_approval_limit_cents BIGINT;
ALTER TABLE org ADD COLUMN IF NOT EXISTS approval_request_phone TEXT;

CREATE TABLE IF NOT EXISTS approval_request_tokens (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  document_id INTEGER NOT NULL REFERENCES documents(id),
  token TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'sms',
  recipient TEXT,
  decision TEXT,
  note TEXT,
  acted_at TEXT,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_request_tokens_token ON approval_request_tokens(token);
CREATE INDEX IF NOT EXISTS idx_approval_request_tokens_doc ON approval_request_tokens(org_id, document_id);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  phone TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_sessions_token ON portal_sessions(token);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  paid_until TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(org_id);

CREATE TABLE IF NOT EXISTS portal_users (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_users_org_contact ON portal_users(org_id, contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_users_email ON portal_users(org_id, email);

CREATE TABLE IF NOT EXISTS knowledge_articles (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_org ON knowledge_articles(org_id);

CREATE TABLE IF NOT EXISTS org_audit_log (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  actor_member_id INTEGER,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  record_id INTEGER,
  record_label TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_audit_org_created ON org_audit_log(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_audit_org_module ON org_audit_log(org_id, module);

-- Inventory Adjustments (5100) split out of cost_of_goods_sold into its own
-- subtype — a large found-stock adjustment nets as a credit that was
-- distorting COGS/gross-profit and, when lumped into operating expenses,
-- making a genuine expense entry look like it reduced the Expense total.
UPDATE accounts SET subtype = 'inventory_adjustment' WHERE code = '5100' AND subtype = 'cost_of_goods_sold';

CREATE TABLE IF NOT EXISTS ai_messages (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  member_id INTEGER,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  nairobi_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_org_member_date ON ai_messages(org_id, member_id, nairobi_date);

CREATE TABLE IF NOT EXISTS item_types (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  name TEXT NOT NULL,
  is_group_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_types_org_name ON item_types(org_id, name);

-- Customer/item group subgroups + toggle for customer groups + product/service split.
ALTER TABLE org ADD COLUMN IF NOT EXISTS customer_groups_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- customer_groups was never captured in this migration history (only ever
-- applied ad hoc against the original database) — creating it here so a
-- fresh database (npm run db:push) doesn't fail on the ALTERs below.
CREATE TABLE IF NOT EXISTS customer_groups (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  name TEXT NOT NULL,
  parent_group_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_groups_org_name ON customer_groups(org_id, name);

ALTER TABLE customer_groups ADD COLUMN IF NOT EXISTS parent_group_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_customer_groups_parent ON customer_groups(parent_group_id);

ALTER TABLE item_groups ADD COLUMN IF NOT EXISTS parent_group_id INTEGER;
ALTER TABLE item_groups ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'both';
CREATE INDEX IF NOT EXISTS idx_item_groups_parent ON item_groups(parent_group_id);

-- items.item_group_id had no FK — archived items could carry a dangling
-- reference to an already-deleted group. Null those out before adding the
-- constraint, then enforce integrity at the DB level going forward.
UPDATE items SET item_group_id = NULL
  WHERE item_group_id IS NOT NULL AND item_group_id NOT IN (SELECT id FROM item_groups);

DO $$ BEGIN
  ALTER TABLE items ADD CONSTRAINT items_item_group_id_fkey
    FOREIGN KEY (item_group_id) REFERENCES item_groups(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE customer_groups ADD CONSTRAINT customer_groups_parent_group_id_fkey
    FOREIGN KEY (parent_group_id) REFERENCES customer_groups(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE item_groups ADD CONSTRAINT item_groups_parent_group_id_fkey
    FOREIGN KEY (parent_group_id) REFERENCES item_groups(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE contact_group_memberships ADD CONSTRAINT contact_group_memberships_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES customer_groups(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS matched_expense_claim_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_payment_events_expense_claim ON payment_events(matched_expense_claim_id);

-- Realtime: enable RLS + org-scoped SELECT policies on tables with live
-- client subscriptions, and add them to the realtime publication. RLS is
-- the actual security boundary here — the client-side .eq('org_id', ...)
-- filter passed to postgres_changes is a convenience, not a guarantee; a
-- client that drops the filter must still only receive rows visible to it.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_org_read ON notifications;
CREATE POLICY notifications_org_read ON notifications FOR SELECT
  USING (
    org_id IN (SELECT id FROM org WHERE user_id = auth.uid()::text)
    OR member_id IN (SELECT id FROM members WHERE user_id = auth.uid()::text)
  );

ALTER TABLE expense_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_claims_org_read ON expense_claims;
CREATE POLICY expense_claims_org_read ON expense_claims FOR SELECT
  USING (
    org_id IN (SELECT id FROM org WHERE user_id = auth.uid()::text)
    OR org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid()::text AND active = true)
  );

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE expense_claims;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  member_id INTEGER,
  requested_by_name TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_name TEXT,
  admin_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_org_status ON leave_requests(org_id, status);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS documents_org_read ON documents;
CREATE POLICY documents_org_read ON documents FOR SELECT
  USING (
    org_id IN (SELECT id FROM org WHERE user_id = auth.uid()::text)
    OR org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid()::text AND active = true)
  );
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE documents;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_requests_org_read ON leave_requests;
CREATE POLICY leave_requests_org_read ON leave_requests FOR SELECT
  USING (
    org_id IN (SELECT id FROM org WHERE user_id = auth.uid()::text)
    OR org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid()::text AND active = true)
  );
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE leave_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS item_types (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  name TEXT NOT NULL,
  is_group_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_types_org_name ON item_types(org_id, name);

ALTER TABLE org ADD COLUMN IF NOT EXISTS expense_claim_payout_limit_cents BIGINT;

CREATE TABLE IF NOT EXISTS expense_claim_payout_approvals (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  claim_id INTEGER NOT NULL REFERENCES expense_claims(id),
  token TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  destination_type TEXT NOT NULL,
  account_number TEXT,
  amount_cents BIGINT NOT NULL,
  gateway_id TEXT NOT NULL,
  recipient TEXT,
  decision TEXT,
  note TEXT,
  acted_at TEXT,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_expclaim_payout_approvals_token ON expense_claim_payout_approvals(token);
CREATE INDEX IF NOT EXISTS idx_expclaim_payout_approvals_claim ON expense_claim_payout_approvals(org_id, claim_id);

ALTER TABLE expense_claims ADD COLUMN IF NOT EXISTS payout_phone TEXT;

ALTER TABLE org ADD COLUMN IF NOT EXISTS expense_claim_payout_gateway_id TEXT;

ALTER TABLE org ADD COLUMN IF NOT EXISTS mpesa_till_gateway_id TEXT;

ALTER TABLE org ADD COLUMN IF NOT EXISTS bill_payout_gateway_id TEXT;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS payout_destination TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS payout_destination_type TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS payout_account_number TEXT;

ALTER TABLE org ADD COLUMN IF NOT EXISTS accountant_notify_phone TEXT;

ALTER TABLE org ADD COLUMN IF NOT EXISTS restrict_issued_invoice_edit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE org ADD COLUMN IF NOT EXISTS issued_invoice_edit_roles TEXT;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS payout_destination_type TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS payout_destination TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS payout_account_number TEXT;

CREATE TABLE IF NOT EXISTS ledger_integrity_findings (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  check_key TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  detail TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_integrity_org_check ON ledger_integrity_findings(org_id, check_key);
CREATE INDEX IF NOT EXISTS idx_ledger_integrity_unresolved ON ledger_integrity_findings(resolved_at);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opening_balance_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opening_balance_date TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opening_balance_entry_id INTEGER;

ALTER TABLE team_announcements ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT 'blue';

ALTER TABLE org ADD COLUMN IF NOT EXISTS show_collected_this_year_card BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE org ADD COLUMN IF NOT EXISTS show_invoice_collection_totals BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS is_heading BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS bom_consumption_json TEXT;

CREATE TABLE IF NOT EXISTS item_boms (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  parent_item_id INTEGER NOT NULL,
  component_item_id INTEGER NOT NULL,
  qty_per_unit DOUBLE PRECISION NOT NULL DEFAULT 1,
  waste_qty_per_unit DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_boms_org_parent ON item_boms(org_id, parent_item_id);

ALTER TABLE org ADD COLUMN IF NOT EXISTS bom_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE org ADD COLUMN IF NOT EXISTS block_insufficient_stock BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE items ADD COLUMN IF NOT EXISTS measurement_type TEXT;

ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS paid_from_bank_account_id INTEGER;
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS purchase_journal_entry_id INTEGER;

ALTER TABLE loan_ledger ADD COLUMN IF NOT EXISTS disbursed_from_bank_account_id INTEGER;
ALTER TABLE loan_ledger ADD COLUMN IF NOT EXISTS disbursement_journal_entry_id INTEGER;

ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS disposal_type TEXT;

ALTER TABLE org ADD COLUMN IF NOT EXISTS website TEXT;

-- ---------------------------------------------------------------------
-- Events vertical (Zeno Events) — Phase 0/1 schema slice.
-- ---------------------------------------------------------------------

ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  contact_id INTEGER,
  name TEXT NOT NULL,
  event_type TEXT,
  venue TEXT,
  event_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lead',
  budget_cents BIGINT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_contact ON projects(contact_id);
CREATE INDEX IF NOT EXISTS idx_projects_event_date ON projects(org_id, event_date);

CREATE TABLE IF NOT EXISTS inventory_items (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  item_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL DEFAULT 1,
  condition TEXT NOT NULL DEFAULT 'good',
  status TEXT NOT NULL DEFAULT 'in_store',
  warehouse_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_items_org_item ON inventory_items(org_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_status ON inventory_items(org_id, status);

CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  qty DOUBLE PRECISION NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_item_dates ON reservations(inventory_item_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_reservations_project ON reservations(project_id);

CREATE TABLE IF NOT EXISTS payment_schedule (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  milestone_name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT,
  amount_type TEXT NOT NULL,
  percentage_value DOUBLE PRECISION,
  fixed_amount_cents BIGINT,
  sequence_order INTEGER NOT NULL DEFAULT 0,
  document_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_schedule_project ON payment_schedule(project_id);

CREATE TABLE IF NOT EXISTS damage_reports (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  project_id INTEGER,
  reservation_id INTEGER,
  reported_by_member_id INTEGER,
  damage_type TEXT NOT NULL,
  description TEXT,
  photo_url TEXT NOT NULL,
  stage_reported TEXT NOT NULL,
  liability_status TEXT NOT NULL DEFAULT 'pending',
  resolved_by_member_id INTEGER,
  resolved_at TEXT,
  billed_to_client BOOLEAN NOT NULL DEFAULT FALSE,
  billed_amount_cents BIGINT NOT NULL DEFAULT 0,
  document_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_damage_reports_org_status ON damage_reports(org_id, liability_status);
CREATE INDEX IF NOT EXISTS idx_damage_reports_item ON damage_reports(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_damage_reports_org_project ON damage_reports(org_id, project_id);

CREATE TABLE IF NOT EXISTS hire_contracts (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty DOUBLE PRECISION NOT NULL DEFAULT 1,
  external_client_name TEXT NOT NULL,
  external_client_phone TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  actual_return_date TEXT,
  hire_fee_cents BIGINT NOT NULL DEFAULT 0,
  deposit_cents BIGINT NOT NULL DEFAULT 0,
  deposit_returned BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'out',
  document_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hire_contracts_org_status ON hire_contracts(org_id, status);
CREATE INDEX IF NOT EXISTS idx_hire_contracts_item ON hire_contracts(inventory_item_id);

-- ---------------------------------------------------------------------
-- Manifest / dispatch checklist system.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS manifests (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'draft',
  assigned_loading_member_id INTEGER,
  assigned_warehouse_member_id INTEGER,
  assigned_collection_member_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  reconciled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_manifests_org_project ON manifests(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_manifests_org_status ON manifests(org_id, status);

CREATE TABLE IF NOT EXISTS manifest_lines (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  manifest_id INTEGER NOT NULL REFERENCES manifests(id),
  line_type TEXT NOT NULL,
  inventory_item_id INTEGER,
  item_id INTEGER,
  description TEXT NOT NULL,
  qty_requested DOUBLE PRECISION NOT NULL DEFAULT 1,
  qty_used DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending',
  checked_by_member_id INTEGER,
  checked_at TEXT,
  notes TEXT,
  damage_report_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manifest_lines_org_manifest ON manifest_lines(org_id, manifest_id);
CREATE INDEX IF NOT EXISTS idx_manifest_lines_inventory_item ON manifest_lines(inventory_item_id);

-- Projects upgrade: Contracts, Item Location, Color theme.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS color_theme TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE manifest_lines ADD COLUMN IF NOT EXISTS location TEXT;

CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  subject TEXT NOT NULL,
  value_cents BIGINT NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  content TEXT,
  signature_photo_path TEXT,
  signed_at TEXT,
  signed_by_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contracts_org_project ON contracts(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_contracts_org_status ON contracts(org_id, status);

-- Projects as hub Phase B: Files, Tasks, Milestones, Audit log scoping.

CREATE TABLE IF NOT EXISTS project_files (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  doc_type TEXT,
  label TEXT,
  note TEXT,
  uploaded_at TEXT NOT NULL,
  uploaded_by_member_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_files_org_project ON project_files(org_id, project_id);

CREATE TABLE IF NOT EXISTS project_tasks (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  assigned_member_id INTEGER,
  due_date TEXT,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_member_id INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_org_project ON project_tasks(org_id, project_id);

ALTER TABLE org_audit_log ADD COLUMN IF NOT EXISTS project_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_org_audit_org_project ON org_audit_log(org_id, project_id);

-- Projects as hub Phase C: contract template setting.
ALTER TABLE org ADD COLUMN IF NOT EXISTS contract_template TEXT;

-- Projects as hub Phase E: billable expenses persisted onto invoices.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS billed_document_id INTEGER;

-- Billing model replacement: per-org custom fees + manual payment ledger.
ALTER TABLE org ADD COLUMN IF NOT EXISTS one_time_fee_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE org ADD COLUMN IF NOT EXISTS monthly_fee_cents BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS manual_payments (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  kind TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  paid_on TEXT NOT NULL,
  method TEXT,
  note TEXT,
  recorded_by_email TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manual_payments_org ON manual_payments(org_id);

-- Leads feature: multi-channel capture, pipeline, conversion, referrals.
ALTER TABLE org ADD COLUMN IF NOT EXISTS lead_form_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_lead_form_slug ON org(lead_form_slug);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  channel TEXT NOT NULL,
  channel_detail TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  event_type TEXT,
  event_date TEXT,
  message TEXT,
  details JSONB,
  stage TEXT NOT NULL DEFAULT 'new',
  lost_reason TEXT,
  assigned_member_id INTEGER,
  contacted_at TEXT,
  converted_contact_id INTEGER,
  converted_project_id INTEGER,
  referred_by_contact_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_org ON leads(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_stage ON leads(org_id, stage);

CREATE TABLE IF NOT EXISTS lead_channels (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  channel TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_channels_org_channel ON lead_channels(org_id, channel);

CREATE TABLE IF NOT EXISTS referral_codes (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  code TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL DEFAULT 'none',
  reward_value INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_org_contact ON referral_codes(org_id, contact_id);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES org(id),
  referral_code_id INTEGER NOT NULL REFERENCES referral_codes(id),
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  project_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  paid_on TEXT,
  created_at TEXT NOT NULL
);

-- Leads Batch 5: past-events Instagram post embed on the public lead form.
ALTER TABLE org ADD COLUMN IF NOT EXISTS instagram_post_urls JSONB;

-- Client portal project-based view + contract client-accept flow.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signature_method TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS portal_accepted_ip TEXT;
