-- Idempotent SQL script to enable Supabase Realtime replication
-- Copy and paste this script in your Supabase Dashboard SQL Editor and click RUN

DO $$
BEGIN
  -- 1. Enable Realtime for proctor_locks
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr 
    JOIN pg_publication p ON p.oid = pr.prpubid 
    JOIN pg_class c ON c.oid = pr.prrelid 
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'proctor_locks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.proctor_locks;
    RAISE NOTICE 'Added proctor_locks to supabase_realtime publication.';
  ELSE
    RAISE NOTICE 'proctor_locks is already in supabase_realtime publication.';
  END IF;

  -- 2. Enable Realtime for audit_logs
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr 
    JOIN pg_publication p ON p.oid = pr.prpubid 
    JOIN pg_class c ON c.oid = pr.prrelid 
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'audit_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;
    RAISE NOTICE 'Added audit_logs to supabase_realtime publication.';
  ELSE
    RAISE NOTICE 'audit_logs is already in supabase_realtime publication.';
  END IF;

  -- 3. Enable Realtime for login_logs
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr 
    JOIN pg_publication p ON p.oid = pr.prpubid 
    JOIN pg_class c ON c.oid = pr.prrelid 
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'login_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.login_logs;
    RAISE NOTICE 'Added login_logs to supabase_realtime publication.';
  ELSE
    RAISE NOTICE 'login_logs is already in supabase_realtime publication.';
  END IF;
END $$;
