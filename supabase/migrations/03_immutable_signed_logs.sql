-- 1. Signed Audit Logs (Blockchain-like Chain)
CREATE TABLE IF NOT EXISTS public.signed_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    user_id UUID,
    ip_address TEXT,
    user_agent TEXT,
    previous_signature TEXT,
    signature TEXT NOT NULL, -- HMAC-SHA256 hash of log + previous signature
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Force immutability trigger
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are cryptographically chained and immutable.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_modification ON public.signed_audit_logs;
CREATE TRIGGER trg_prevent_audit_modification
BEFORE UPDATE OR DELETE ON public.signed_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

-- 2. Threat Alerts Table
CREATE TABLE IF NOT EXISTS public.intrusion_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    description TEXT NOT NULL,
    ip_address TEXT,
    metadata JSONB,
    resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 3. Device & Session Activity Table
CREATE TABLE IF NOT EXISTS public.session_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    refresh_token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    device_info JSONB,
    is_revoked BOOLEAN DEFAULT false,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.signed_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intrusion_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_activity ENABLE ROW LEVEL SECURITY;

-- Simple RLS Policies allowing full read/write for service role (admin) and read only for authenticated admin users
DROP POLICY IF EXISTS "Allow service role full access on signed_audit_logs" ON public.signed_audit_logs;
CREATE POLICY "Allow service role full access on signed_audit_logs" 
ON public.signed_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role full access on intrusion_alerts" ON public.intrusion_alerts;
CREATE POLICY "Allow service role full access on intrusion_alerts" 
ON public.intrusion_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role full access on session_activity" ON public.session_activity;
CREATE POLICY "Allow service role full access on session_activity" 
ON public.session_activity FOR ALL TO service_role USING (true) WITH CHECK (true);
