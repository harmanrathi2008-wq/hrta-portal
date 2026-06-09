-- ============================================================
-- FIX: Add RLS policies for the 'tasks' table
-- The tasks table was missing from enforce_rls.sql, which caused
-- the student dashboard daily planner bar chart, journey log,
-- and friends feed to return no data (silently blocked by RLS).
--
-- HOW TO RUN:
-- 1. Open your Supabase project → SQL Editor
-- 2. Paste this entire script and click RUN
-- 3. You should see success messages for all statements
-- ============================================================

-- Step 1: Enable RLS on tasks (safe to run even if already enabled)
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop any existing policies on tasks (clean slate)
DROP POLICY IF EXISTS "Students manage own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admins full access tasks" ON public.tasks;
DROP POLICY IF EXISTS "Students read shared tasks" ON public.tasks;

-- Step 3: Allow each student to fully manage their OWN tasks
-- (daily_task and journey_log rows belong to the student whose ID is student_id)
CREATE POLICY "Students manage own tasks" ON public.tasks
  FOR ALL TO authenticated
  USING (student_id::text = auth.uid()::text)
  WITH CHECK (student_id::text = auth.uid()::text);

-- Step 4: Admins can see and manage ALL tasks
CREATE POLICY "Admins full access tasks" ON public.tasks
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Step 5: Allow any student to READ task_share rows (Friends Feed feature)
-- task_share rows have the SENDER's student_id, not the receiver's.
-- So we must open SELECT for status='task_share' to all authenticated users.
CREATE POLICY "Students read shared tasks" ON public.tasks
  FOR SELECT TO authenticated
  USING (status = 'task_share');

-- ============================================================
-- VERIFICATION: Run these SELECT statements to confirm policies
-- ============================================================
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'tasks';
