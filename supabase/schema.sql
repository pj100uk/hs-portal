-- Schema dumped at 2026-04-23T08:40:13.443Z

TABLE: actions
  id uuid NOT NULL DEFAULT gen_random_uuid()
  site_id uuid
  title text NOT NULL
  description text
  priority text
  status text DEFAULT 'open'::text
  regulation text
  contractor text
  due_date text
  created_at timestamp DEFAULT now()
  source_document_name text
  source_document_id text
  hazard_ref text
  hazard text
  existing_controls text
  risk_rating text
  risk_level text
  resolved_date date
  source_folder_id text
  responsible_person text
  site_document_id uuid
  is_suggested bool NOT NULL DEFAULT false
  source_folder_path text
  issue_date text

TABLE: advisor_organisations
  id uuid NOT NULL DEFAULT gen_random_uuid()
  advisor_id uuid
  organisation_id uuid
  created_at timestamptz DEFAULT now()

TABLE: advisor_site_assignments
  id uuid NOT NULL DEFAULT gen_random_uuid()
  advisor_id uuid NOT NULL
  site_id uuid NOT NULL
  created_at timestamptz DEFAULT now()

TABLE: ai_usage_log
  id uuid NOT NULL DEFAULT gen_random_uuid()
  created_at timestamptz NOT NULL DEFAULT now()
  service text NOT NULL
  model text
  operation text
  site_id uuid
  organisation_id uuid
  input_tokens int4
  output_tokens int4
  cost_usd numeric
  metadata jsonb

TABLE: client_site_assignments
  id uuid NOT NULL DEFAULT gen_random_uuid()
  client_user_id uuid NOT NULL
  site_id uuid NOT NULL
  created_at timestamptz DEFAULT now()

TABLE: document_health
  id uuid NOT NULL DEFAULT gen_random_uuid()
  site_id uuid NOT NULL
  document_name text NOT NULL
  review_due date
  created_at timestamptz DEFAULT now()

TABLE: organisations
  id uuid NOT NULL DEFAULT gen_random_uuid()
  name text NOT NULL
  datto_folder_id text
  created_at timestamptz DEFAULT now()
  datto_folder_name text
  logo_url text

TABLE: profiles
  id uuid NOT NULL
  role text
  site_id uuid
  organisation_id uuid
  datto_workplace_user text
  datto_base_path text
  view_only bool NOT NULL DEFAULT false

TABLE: site_documents
  id uuid NOT NULL DEFAULT gen_random_uuid()
  site_id uuid NOT NULL
  uploaded_by uuid
  uploaded_at timestamptz NOT NULL DEFAULT now()
  file_name text NOT NULL
  datto_file_id text
  datto_folder_id text
  file_size_bytes int4
  document_name text
  document_type text
  issue_date date
  expiry_date date
  people_mentioned _text
  notes text
  client_provided bool NOT NULL DEFAULT true

TABLE: site_services
  id uuid NOT NULL DEFAULT gen_random_uuid()
  site_id uuid
  requirement_id uuid
  purchased bool DEFAULT false
  notes text
  updated_at timestamptz DEFAULT now()

TABLE: site_type_requirement_changes
  id uuid NOT NULL DEFAULT gen_random_uuid()
  site_type text NOT NULL
  change_summary text NOT NULL
  effective_date date
  acknowledged_at timestamptz
  acknowledged_by uuid
  created_at timestamptz DEFAULT now()

TABLE: site_type_requirements
  id uuid NOT NULL DEFAULT gen_random_uuid()
  site_type text NOT NULL
  requirement_name text NOT NULL
  description text
  is_mandatory bool DEFAULT false
  legal_basis text
  ai_generated bool DEFAULT true
  display_order int4 DEFAULT 0
  created_at timestamptz DEFAULT now()
  updated_at timestamptz DEFAULT now()

TABLE: sites
  id uuid NOT NULL DEFAULT gen_random_uuid()
  name text NOT NULL
  type text
  compliance_score int4 DEFAULT 0
  trend int4 DEFAULT 0
  created_at timestamp DEFAULT now()
  datto_folder_id int8
  organisation_id uuid
  advisor_id uuid
  last_ai_sync timestamptz
  excluded_datto_folder_ids _text DEFAULT '{}'::text[]
  employee_count int4
  iag_score int4
  datto_folder_path text
  included_datto_folder_ids _text
  datto_parent_folder_id text
  vault_folder_id text
  iag_weighted_score int4


