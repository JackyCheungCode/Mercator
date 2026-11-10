ALTER TABLE public.analysis_jobs
  DROP CONSTRAINT IF EXISTS analysis_jobs_status_check;

ALTER TABLE public.analysis_jobs
  ADD CONSTRAINT analysis_jobs_status_check
  CHECK (status = ANY (ARRAY[
    'queued'::text,
    'preprocessing'::text,
    'recognizing'::text,
    'validating'::text,
    'completed'::text,
    'review_required'::text,
    'failed'::text,
    'cancelled'::text
  ]));
