-- =====================================================================
-- DATABASE HARDENING & ROW LEVEL SECURITY (RLS) ENFORCEMENT
-- Harman Rathi Testing Agency (HRTA) Portal - Security System Upgrade
-- =====================================================================

-- This script enables Row Level Security (RLS) on all system tables
-- and configures granular policies to restrict unauthenticated access,
-- isolate student records to their respective owners, and enforce
-- administrative authority for backend and direct DB calls.

-- ---------------------------------------------------------------------
-- 1. ADMINS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access" ON public.admins;
CREATE POLICY "Admins full access" ON public.admins
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins a WHERE a.id = auth.uid())
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins a WHERE a.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 2. STUDENTS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read own profile" ON public.students;
CREATE POLICY "Students read own profile" ON public.students
  FOR SELECT TO authenticated 
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Admins full access students" ON public.students;
CREATE POLICY "Admins full access students" ON public.students
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 3. EXAMS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read exams" ON public.exams;
CREATE POLICY "Students read exams" ON public.exams
  FOR SELECT TO authenticated 
  USING (true);

DROP POLICY IF EXISTS "Admins full access exams" ON public.exams;
CREATE POLICY "Admins full access exams" ON public.exams
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 4. QUESTIONS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read questions" ON public.questions;
CREATE POLICY "Students read questions" ON public.questions
  FOR SELECT TO authenticated 
  USING (true);

DROP POLICY IF EXISTS "Admins full access questions" ON public.questions;
CREATE POLICY "Admins full access questions" ON public.questions
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 5. EXAM RESULTS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students manage own results" ON public.exam_results;
CREATE POLICY "Students manage own results" ON public.exam_results
  FOR ALL TO authenticated 
  USING (student_id = auth.uid()) 
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Admins full access exam_results" ON public.exam_results;
CREATE POLICY "Admins full access exam_results" ON public.exam_results
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 6. STUDY MATERIALS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.study_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read materials" ON public.study_materials;
CREATE POLICY "Students read materials" ON public.study_materials
  FOR SELECT TO authenticated 
  USING (true);

DROP POLICY IF EXISTS "Admins full access materials" ON public.study_materials;
CREATE POLICY "Admins full access materials" ON public.study_materials
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 7. LOGIN LOGS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own logs" ON public.login_logs;
CREATE POLICY "Users insert own logs" ON public.login_logs
  FOR INSERT TO authenticated 
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own logs" ON public.login_logs;
CREATE POLICY "Users update own logs" ON public.login_logs
  FOR UPDATE TO authenticated 
  USING (user_id = auth.uid()) 
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read logs" ON public.login_logs;
CREATE POLICY "Admins read logs" ON public.login_logs
  FOR SELECT TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 8. AUDIT LOGS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert audit logs" ON public.audit_logs;
CREATE POLICY "Users insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated 
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 9. PERSONAL ASSIGNMENTS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.personal_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read own assignments" ON public.personal_assignments;
CREATE POLICY "Students read own assignments" ON public.personal_assignments
  FOR SELECT TO authenticated 
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Admins full access assignments" ON public.personal_assignments;
CREATE POLICY "Admins full access assignments" ON public.personal_assignments
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 10. EXAM LATE REQUESTS TABLE POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE public.exam_late_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students manage own requests" ON public.exam_late_requests;
CREATE POLICY "Students manage own requests" ON public.exam_late_requests
  FOR ALL TO authenticated 
  USING (student_id = auth.uid()) 
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Admins full access requests" ON public.exam_late_requests;
CREATE POLICY "Admins full access requests" ON public.exam_late_requests
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 11. ADMINS TABLE SCHEMA UPGRADE FOR MFA
-- ---------------------------------------------------------------------
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(32);
