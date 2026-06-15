-- CREATE PROCTOR LOCKS TABLE FOR RELIABLE REAL-TIME PROCTORING STATUS SYNCHRONIZATION
CREATE TABLE IF NOT EXISTS public.proctor_locks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    exam_result_id UUID REFERENCES public.exam_results(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'locked',
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_active_proctor_lock UNIQUE(student_id, exam_id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.proctor_locks ENABLE ROW LEVEL SECURITY;

-- Enable public access policies for proctor_locks
DROP POLICY IF EXISTS "Allow all access to proctor_locks" ON public.proctor_locks;
CREATE POLICY "Allow all access to proctor_locks" ON public.proctor_locks FOR ALL TO anon USING (true) WITH CHECK (true);
