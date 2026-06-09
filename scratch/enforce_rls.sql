-- 1. CLEANUP: Drop all existing RLS policies on our 10 tables to remove any insecure/permissive legacy rules
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename IN ('admins', 'students', 'exams', 'questions', 'exam_results', 'study_materials', 'login_logs', 'audit_logs', 'personal_assignments', 'exam_late_requests')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- 2. ENABLE RLS ON ALL TABLES
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_late_requests ENABLE ROW LEVEL SECURITY;

-- 3. CREATE GRANULAR SECURE POLICIES

-- RLS POLICIES FOR ADMINS
CREATE POLICY "Admins full access" ON public.admins
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins a WHERE a.id::text = auth.uid()::text)
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins a WHERE a.id::text = auth.uid()::text)
  );

-- RLS POLICIES FOR STUDENTS
CREATE POLICY "Students read own profile" ON public.students
  FOR SELECT TO authenticated 
  USING (id::text = auth.uid()::text);

CREATE POLICY "Admins full access students" ON public.students
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  );

-- RLS POLICIES FOR EXAMS
CREATE POLICY "Students read exams" ON public.exams
  FOR SELECT TO authenticated 
  USING (true);

CREATE POLICY "Admins full access exams" ON public.exams
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  );

-- RLS POLICIES FOR QUESTIONS
CREATE POLICY "Students read questions" ON public.questions
  FOR SELECT TO authenticated 
  USING (true);

CREATE POLICY "Admins full access questions" ON public.questions
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  );

-- RLS POLICIES FOR EXAM RESULTS
CREATE POLICY "Students manage own results" ON public.exam_results
  FOR ALL TO authenticated 
  USING (student_id::text = auth.uid()::text) 
  WITH CHECK (student_id::text = auth.uid()::text);

CREATE POLICY "Admins full access exam_results" ON public.exam_results
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  );

-- RLS POLICIES FOR STUDY MATERIALS
CREATE POLICY "Students read materials" ON public.study_materials
  FOR SELECT TO authenticated 
  USING (true);

CREATE POLICY "Admins full access materials" ON public.study_materials
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  );

-- RLS POLICIES FOR LOGIN LOGS
CREATE POLICY "Users insert own logs" ON public.login_logs
  FOR INSERT TO authenticated 
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Users update own logs" ON public.login_logs
  FOR UPDATE TO authenticated 
  USING (user_id::text = auth.uid()::text) 
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Admins read logs" ON public.login_logs
  FOR SELECT TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  );

-- RLS POLICIES FOR AUDIT LOGS
CREATE POLICY "Users insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated 
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Admins read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  );

-- RLS POLICIES FOR PERSONAL ASSIGNMENTS
CREATE POLICY "Students read own assignments" ON public.personal_assignments
  FOR SELECT TO authenticated 
  USING (student_id::text = auth.uid()::text);

CREATE POLICY "Admins full access assignments" ON public.personal_assignments
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  );

-- RLS POLICIES FOR EXAM LATE REQUESTS
CREATE POLICY "Students manage own requests" ON public.exam_late_requests
  FOR ALL TO authenticated 
  USING (student_id::text = auth.uid()::text) 
  WITH CHECK (student_id::text = auth.uid()::text);

CREATE POLICY "Admins full access requests" ON public.exam_late_requests
  FOR ALL TO authenticated 
  USING (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  ) 
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admins WHERE admins.id::text = auth.uid()::text)
  );

-- SCHEMA UPGRADE FOR MFA SECRET
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(32);
