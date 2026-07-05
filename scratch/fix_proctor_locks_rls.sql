-- ============================================================
-- FIX: Add RLS policies for the 'proctor_locks' table
-- The proctor_locks table RLS policies were set only for 'anon',
-- which blocked authenticated students and admins from writing
-- or updating lock statuses (throwing RLS violations).
--
-- HOW TO RUN:
-- 1. Open your Supabase project → SQL Editor
-- 2. Paste this entire script and click RUN
-- 3. You should see success messages for all statements
-- ============================================================

-- Step 1: Enable RLS on proctor_locks (safe to run even if already enabled)
ALTER TABLE public.proctor_locks ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop any legacy or insecure policies on proctor_locks
DROP POLICY IF EXISTS "Allow all access to proctor_locks" ON public.proctor_locks;
DROP POLICY IF EXISTS "Students manage own proctor_locks" ON public.proctor_locks;
DROP POLICY IF EXISTS "Admins full access proctor_locks" ON public.proctor_locks;

-- Step 3: Create RLS policy for students to manage their own proctor_locks
-- (Students can read, insert, update, or delete lock records linked to their UID)
CREATE POLICY "Students manage own proctor_locks" ON public.proctor_locks
  FOR ALL TO authenticated
  USING (student_id::text = auth.uid()::text)
  WITH CHECK (student_id::text = auth.uid()::text);

-- Step 4: Create RLS policy for admins to have full access to all locks
CREATE POLICY "Admins full access proctor_locks" ON public.proctor_locks
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ============================================================
-- VERIFICATION: Run this query to confirm policies are applied
-- ============================================================
-- SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'proctor_locks';
