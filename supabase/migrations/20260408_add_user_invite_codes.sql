-- Add personal invite_code column to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- Each invite code must be unique
CREATE UNIQUE INDEX IF NOT EXISTS users_invite_code_unique ON public.users (invite_code) WHERE invite_code IS NOT NULL;

-- Index for the login lookup (email + invite_code)
CREATE INDEX IF NOT EXISTS users_email_invite_code_idx ON public.users (email, invite_code);

-- Backfill any existing users with a random code
UPDATE public.users
SET invite_code = upper(encode(gen_random_bytes(3), 'hex'))
WHERE invite_code IS NULL;
