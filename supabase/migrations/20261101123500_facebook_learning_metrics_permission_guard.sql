-- Pause Facebook engagement metrics collection while pages_read_user_content
-- is not approved. Keeps publishing and all learning history untouched.
ALTER TABLE public.facebook_rotation_settings
 ADD COLUMN IF NOT EXISTS learning_metrics_paused boolean NOT NULL DEFAULT false;
UPDATE public.facebook_rotation_settings
 SET learning_metrics_paused=true,updated_at=now()
 WHERE id=true;
COMMENT ON COLUMN public.facebook_rotation_settings.learning_metrics_paused IS
 'Pauses Graph engagement reads requiring pages_read_user_content; does not pause new-product publishing.';
